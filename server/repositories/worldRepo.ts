import crypto from 'node:crypto';
import { getDb } from '../core/database.ts';
import type { SourceRef } from './topicRepo.ts';

export interface LearningWorldRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  document_id: string | null;
  position: number;
  title: string;
  theme_key: string;
  description: string;
  status: 'generating' | 'ready' | 'failed';
  model: string;
  prompt_version: string;
}

export interface QuestRow {
  id: string;
  user_id: string;
  world_id: string;
  position: number;
  kind: 'lesson' | 'practice' | 'checkpoint' | 'boss';
  title: string;
  intro: string;
  objective: string;
  topic_ids: string[];
  lesson_markdown: string | null;
  completion_rules: { lesson_required?: boolean; min_items?: number; min_accuracy?: number };
  mastery_threshold: number;
  xp_reward: number;
  unlock_rule: { requires_completed?: string[]; min_topic_score?: number | null };
  source_refs: SourceRef[];
}

export interface QuestAttemptRow {
  id: string;
  user_id: string;
  quest_id: string;
  attempt_no: number;
  status: 'in_progress' | 'paused' | 'completed' | 'failed' | 'abandoned';
  progress: Record<string, unknown>;
  assessment_id: string | null;
  score: number | null;
  passed: boolean | null;
  started_at: string;
  paused_at: string | null;
  resumed_at: string | null;
  completed_at: string | null;
  xp_awarded: number;
}

function hydrateQuest(r: Record<string, unknown>): QuestRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    world_id: String(r.world_id),
    position: Number(r.position),
    kind: r.kind as QuestRow['kind'],
    title: String(r.title),
    intro: String(r.intro),
    objective: String(r.objective),
    topic_ids: JSON.parse(String(r.topic_ids || '[]')),
    lesson_markdown: r.lesson_markdown ? String(r.lesson_markdown) : null,
    completion_rules: JSON.parse(String(r.completion_rules || '{}')),
    mastery_threshold: Number(r.mastery_threshold ?? 0.75),
    xp_reward: Number(r.xp_reward ?? 50),
    unlock_rule: JSON.parse(String(r.unlock_rule || '{}')),
    source_refs: JSON.parse(String(r.source_refs || '[]')),
  };
}

function hydrateAttempt(r: Record<string, unknown>): QuestAttemptRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    quest_id: String(r.quest_id),
    attempt_no: Number(r.attempt_no),
    status: r.status as QuestAttemptRow['status'],
    progress: JSON.parse(String(r.progress || '{}')),
    assessment_id: r.assessment_id ? String(r.assessment_id) : null,
    score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
    passed: r.passed === null || r.passed === undefined ? null : Boolean(r.passed),
    started_at: String(r.started_at),
    paused_at: r.paused_at ? String(r.paused_at) : null,
    resumed_at: r.resumed_at ? String(r.resumed_at) : null,
    completed_at: r.completed_at ? String(r.completed_at) : null,
    xp_awarded: Number(r.xp_awarded || 0),
  };
}

export const worldRepo = {
  findWorldByDocument(userId: string, documentId: string): LearningWorldRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM learning_worlds WHERE user_id = ? AND document_id = ? LIMIT 1')
      .get(userId, documentId) as unknown as LearningWorldRow | undefined;
  },

  listWorlds(userId: string): LearningWorldRow[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM learning_worlds WHERE user_id = ? ORDER BY position ASC')
      .all(userId) as unknown as LearningWorldRow[];
  },

  getWorld(userId: string, worldId: string): LearningWorldRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM learning_worlds WHERE id = ? AND user_id = ?')
      .get(worldId, userId) as unknown as LearningWorldRow | undefined;
  },

  createWorldWithQuests(world: LearningWorldRow, quests: QuestRow[]): LearningWorldRow {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO learning_worlds
         (id, user_id, subject_id, document_id, position, title, theme_key, description, status, model, prompt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        world.id,
        world.user_id,
        world.subject_id,
        world.document_id,
        world.position,
        world.title,
        world.theme_key,
        world.description,
        world.status,
        world.model,
        world.prompt_version,
      );

      const qStmt = db.prepare(
        `INSERT INTO quests
         (id, user_id, world_id, position, kind, title, intro, objective, topic_ids, lesson_markdown, completion_rules, mastery_threshold, xp_reward, unlock_rule, source_refs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const q of quests) {
        qStmt.run(
          q.id,
          world.user_id,
          world.id,
          q.position,
          q.kind,
          q.title,
          q.intro,
          q.objective,
          JSON.stringify(q.topic_ids),
          q.lesson_markdown,
          JSON.stringify(q.completion_rules),
          q.mastery_threshold,
          q.xp_reward,
          JSON.stringify(q.unlock_rule),
          JSON.stringify(q.source_refs),
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return this.getWorld(world.user_id, world.id)!;
  },

  listQuestsForWorld(userId: string, worldId: string): QuestRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM quests WHERE user_id = ? AND world_id = ? ORDER BY position ASC')
      .all(userId, worldId) as Array<Record<string, unknown>>;
    return rows.map(hydrateQuest);
  },

  getQuest(userId: string, questId: string): QuestRow | undefined {
    const db = getDb();
    const r = db
      .prepare('SELECT * FROM quests WHERE id = ? AND user_id = ?')
      .get(questId, userId) as Record<string, unknown> | undefined;
    return r ? hydrateQuest(r) : undefined;
  },

  setQuestLessonMarkdown(userId: string, questId: string, markdown: string): void {
    const db = getDb();
    db.prepare('UPDATE quests SET lesson_markdown = ? WHERE id = ? AND user_id = ?').run(
      markdown,
      questId,
      userId,
    );
  },

  listAttemptsForUser(userId: string): QuestAttemptRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM quest_attempts WHERE user_id = ? ORDER BY started_at DESC')
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map(hydrateAttempt);
  },

  getActiveAttempt(userId: string, questId: string): QuestAttemptRow | undefined {
    const db = getDb();
    const r = db
      .prepare(
        `SELECT * FROM quest_attempts
         WHERE user_id = ? AND quest_id = ? AND status IN ('in_progress','paused') LIMIT 1`,
      )
      .get(userId, questId) as Record<string, unknown> | undefined;
    return r ? hydrateAttempt(r) : undefined;
  },

  getAttemptById(userId: string, attemptId: string): QuestAttemptRow | undefined {
    const db = getDb();
    const r = db
      .prepare('SELECT * FROM quest_attempts WHERE id = ? AND user_id = ?')
      .get(attemptId, userId) as Record<string, unknown> | undefined;
    return r ? hydrateAttempt(r) : undefined;
  },

  createAttempt(params: {
    userId: string;
    questId: string;
    assessmentId: string | null;
    progress?: Record<string, unknown>;
  }): QuestAttemptRow {
    const db = getDb();
    const countRow = db
      .prepare('SELECT COUNT(*) as cnt FROM quest_attempts WHERE user_id = ? AND quest_id = ?')
      .get(params.userId, params.questId) as { cnt: number };
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO quest_attempts (id, user_id, quest_id, attempt_no, status, progress, assessment_id)
       VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`,
    ).run(
      id,
      params.userId,
      params.questId,
      (countRow?.cnt || 0) + 1,
      JSON.stringify(params.progress || {}),
      params.assessmentId,
    );
    return this.getAttemptById(params.userId, id)!;
  },

  updateAttempt(
    userId: string,
    attemptId: string,
    patch: {
      status?: QuestAttemptRow['status'];
      progress?: Record<string, unknown>;
      assessmentId?: string | null;
      score?: number | null;
      passed?: boolean | null;
      xpAwarded?: number;
    },
  ): QuestAttemptRow | undefined {
    const db = getDb();
    const existing = this.getAttemptById(userId, attemptId);
    if (!existing) return undefined;

    const status = patch.status ?? existing.status;
    db.prepare(
      `UPDATE quest_attempts
       SET status = ?,
           progress = ?,
           assessment_id = ?,
           score = ?,
           passed = ?,
           xp_awarded = ?,
           paused_at = CASE WHEN ? = 'paused' THEN datetime('now') ELSE paused_at END,
           resumed_at = CASE WHEN ? = 'in_progress' AND status = 'paused' THEN datetime('now') ELSE resumed_at END,
           completed_at = CASE WHEN ? IN ('completed','failed','abandoned') THEN COALESCE(completed_at, datetime('now')) ELSE completed_at END
       WHERE id = ? AND user_id = ?`,
    ).run(
      status,
      JSON.stringify(patch.progress ?? existing.progress),
      patch.assessmentId !== undefined ? patch.assessmentId : existing.assessment_id,
      patch.score !== undefined ? patch.score : existing.score,
      patch.passed !== undefined ? (patch.passed === null ? null : patch.passed ? 1 : 0) : existing.passed === null ? null : existing.passed ? 1 : 0,
      patch.xpAwarded ?? existing.xp_awarded,
      status,
      status,
      status,
      attemptId,
      userId,
    );
    return this.getAttemptById(userId, attemptId);
  },

  getCompletedQuestIds(userId: string): Set<string> {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT quest_id FROM quest_attempts WHERE user_id = ? AND status = 'completed' AND passed = 1`,
      )
      .all(userId) as Array<{ quest_id: string }>;
    return new Set(rows.map((r) => r.quest_id));
  },
};
