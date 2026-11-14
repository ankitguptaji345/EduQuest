import crypto from 'node:crypto';
import { getDb } from '../core/database.ts';

export interface XpTransactionRow {
  id: string;
  user_id: string;
  amount: number;
  source_type: 'lesson' | 'challenge' | 'assessment' | 'improvement' | 'boss' | 'daily_goal' | 'achievement';
  source_id: string | null;
  reason: string;
  idempotency_key: string;
  created_at: string;
}

export interface AchievementRow {
  code: string;
  name: string;
  description: string;
  category: string;
  icon_key: string;
  xp_bonus: number;
  rule_version: string;
}

export interface UserAchievementRow {
  user_id: string;
  achievement_code: string;
  unlocked_at: string;
  context: Record<string, unknown>;
}

export interface LearningSessionRow {
  id: string;
  user_id: string;
  started_at: string;
  last_heartbeat_at: string;
  ended_at: string | null;
  active_seconds: number;
  activity: 'reading' | 'tutor' | 'assessment' | 'quest' | 'boss';
  subject_id: string | null;
  document_id: string | null;
  local_date: string;
}

export interface RecommendationRow {
  id: string;
  user_id: string;
  kind: 'practice_topic' | 'resolve_misconception' | 'review' | 'take_quest' | 'take_boss' | 'upload_material';
  target_type: string;
  target_id: string | null;
  title: string;
  reason: string;
  evidence: Record<string, unknown>;
  priority: number;
  status: 'active' | 'dismissed' | 'completed' | 'expired';
  generated_at: string;
  expires_at: string | null;
  rules_version: string;
}

export const progressRepo = {
  listXpTransactions(userId: string, limit = 50): XpTransactionRow[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM xp_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as unknown as XpTransactionRow[];
  },

  listAchievements(): AchievementRow[] {
    const db = getDb();
    return db.prepare('SELECT * FROM achievements ORDER BY xp_bonus ASC').all() as unknown as AchievementRow[];
  },

  listUserAchievements(userId: string): UserAchievementRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM user_achievements WHERE user_id = ? ORDER BY unlocked_at DESC')
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      user_id: String(r.user_id),
      achievement_code: String(r.achievement_code),
      unlocked_at: String(r.unlocked_at),
      context: JSON.parse(String(r.context || '{}')),
    }));
  },

  unlockAchievement(userId: string, code: string, context: Record<string, unknown> = {}): AchievementRow | null {
    const db = getDb();
    const ach = db.prepare('SELECT * FROM achievements WHERE code = ?').get(code) as
      | AchievementRow
      | undefined;
    if (!ach) return null;

    const res = db
      .prepare(
        `INSERT OR IGNORE INTO user_achievements (user_id, achievement_code, context)
         VALUES (?, ?, ?)`,
      )
      .run(userId, code, JSON.stringify(context));

    return res.changes > 0 ? ach : null;
  },

  startSession(params: {
    userId: string;
    activity: LearningSessionRow['activity'];
    subjectId?: string | null;
    documentId?: string | null;
    localDate: string;
  }): LearningSessionRow {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO learning_sessions (id, user_id, activity, subject_id, document_id, local_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, params.userId, params.activity, params.subjectId ?? null, params.documentId ?? null, params.localDate);
    return this.getSession(params.userId, id)!;
  },

  getSession(userId: string, sessionId: string): LearningSessionRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM learning_sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as unknown as LearningSessionRow | undefined;
  },

  heartbeatSession(userId: string, sessionId: string): LearningSessionRow | undefined {
    const db = getDb();
    const existing = this.getSession(userId, sessionId);
    if (!existing || existing.ended_at) return existing;

    const lastMs = new Date(existing.last_heartbeat_at + (existing.last_heartbeat_at.endsWith('Z') ? '' : 'Z')).getTime();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - lastMs) / 1000));
    // Blueprint §4.2: Active seconds are capped per heartbeat (max 60s) so idle tabs do not inflate them
    const addedSec = Math.min(elapsedSec, 60);

    db.prepare(
      `UPDATE learning_sessions
       SET active_seconds = active_seconds + ?, last_heartbeat_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(addedSec, sessionId, userId);

    return this.getSession(userId, sessionId);
  },

  endSession(userId: string, sessionId: string): LearningSessionRow | undefined {
    const db = getDb();
    this.heartbeatSession(userId, sessionId);
    db.prepare(
      `UPDATE learning_sessions SET ended_at = COALESCE(ended_at, datetime('now')) WHERE id = ? AND user_id = ?`,
    ).run(sessionId, userId);
    return this.getSession(userId, sessionId);
  },

  listSessionsSince(userId: string, sinceLocalDate: string): LearningSessionRow[] {
    const db = getDb();
    return db
      .prepare(
        'SELECT * FROM learning_sessions WHERE user_id = ? AND local_date >= ? ORDER BY local_date ASC',
      )
      .all(userId, sinceLocalDate) as unknown as LearningSessionRow[];
  },

  replaceActiveRecommendations(
    userId: string,
    items: Array<Omit<RecommendationRow, 'generated_at' | 'expires_at' | 'rules_version'>>,
  ): void {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`DELETE FROM recommendations WHERE user_id = ? AND status = 'active'`).run(userId);
      const stmt = db.prepare(
        `INSERT INTO recommendations
         (id, user_id, kind, target_type, target_id, title, reason, evidence, priority, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of items) {
        stmt.run(
          r.id,
          userId,
          r.kind,
          r.target_type,
          r.target_id,
          r.title,
          r.reason,
          JSON.stringify(r.evidence),
          r.priority,
          r.status,
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  listRecommendations(userId: string): RecommendationRow[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM recommendations WHERE user_id = ? AND status = 'active' ORDER BY priority DESC LIMIT 8`,
      )
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      kind: r.kind as RecommendationRow['kind'],
      target_type: String(r.target_type),
      target_id: r.target_id ? String(r.target_id) : null,
      title: String(r.title),
      reason: String(r.reason),
      evidence: JSON.parse(String(r.evidence || '{}')),
      priority: Number(r.priority),
      status: r.status as RecommendationRow['status'],
      generated_at: String(r.generated_at),
      expires_at: r.expires_at ? String(r.expires_at) : null,
      rules_version: String(r.rules_version),
    }));
  },

  dismissRecommendation(userId: string, recId: string): boolean {
    const db = getDb();
    const res = db
      .prepare(`UPDATE recommendations SET status = 'dismissed' WHERE id = ? AND user_id = ?`)
      .run(recId, userId);
    return res.changes > 0;
  },

  logAiUsage(params: {
    userId: string;
    feature: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    status: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO ai_usage (id, user_id, feature, model, tokens_in, tokens_out, latency_ms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      params.userId,
      params.feature,
      params.model,
      params.tokensIn,
      params.tokensOut,
      params.latencyMs,
      params.status,
    );
  },
};
