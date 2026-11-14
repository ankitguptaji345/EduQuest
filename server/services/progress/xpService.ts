import crypto from 'node:crypto';
import { getDb } from '../../core/database.ts';
import { identityRepo } from '../../repositories/identityRepo.ts';
import { progressRepo, type AchievementRow } from '../../repositories/progressRepo.ts';

// Blueprint §4.4: XP required to reach level n is 100 * n^1.5 (rounded).
// Level 1 starts at 0 XP; Level 2 threshold = round(100 * 2^1.5) = 283 XP.
export function xpThresholdForLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.round(100 * Math.pow(n, 1.5));
}

export function computeLevelFromXp(totalXp: number): number {
  let lvl = 1;
  while (xpThresholdForLevel(lvl + 1) <= totalXp && lvl < 100) {
    lvl += 1;
  }
  return lvl;
}

export function getLocalDateString(timezone: string, date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}

function getPreviousLocalDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

export interface AwardXpResult {
  awarded: boolean;
  amount: number;
  new_total: number;
  new_level: number;
  level_up: boolean;
}

export const xpService = {
  awardXp(params: {
    userId: string;
    amount: number;
    sourceType: 'lesson' | 'challenge' | 'assessment' | 'improvement' | 'boss' | 'daily_goal' | 'achievement';
    sourceId: string | null;
    reason: string;
    idempotencyKey: string;
  }): AwardXpResult {
    const db = getDb();
    if (params.amount <= 0) {
      const stats = identityRepo.getStats(params.userId)!;
      return {
        awarded: false,
        amount: 0,
        new_total: stats.total_xp,
        new_level: stats.level,
        level_up: false,
      };
    }

    const profile = identityRepo.getProfile(params.userId);
    const localDate = getLocalDateString(profile?.timezone || 'UTC');
    const prevDate = getPreviousLocalDate(localDate);
    const txId = crypto.randomUUID();

    let inserted = false;
    let newTotal = 0;
    let newLevel = 1;
    let levelUp = false;

    db.exec('BEGIN IMMEDIATE');
    try {
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO xp_transactions
           (id, user_id, amount, source_type, source_id, reason, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          txId,
          params.userId,
          params.amount,
          params.sourceType,
          params.sourceId,
          params.reason,
          params.idempotencyKey,
        );

      const stats = db
        .prepare('SELECT * FROM user_stats WHERE user_id = ?')
        .get(params.userId) as {
        total_xp: number;
        level: number;
        current_streak: number;
        longest_streak: number;
        last_active_local_date: string | null;
      };

      if (res.changes > 0) {
        inserted = true;
        newTotal = stats.total_xp + params.amount;
        newLevel = computeLevelFromXp(newTotal);
        levelUp = newLevel > stats.level;

        let nextStreak = stats.current_streak;
        if (!stats.last_active_local_date) {
          nextStreak = 1;
        } else if (stats.last_active_local_date === localDate) {
          nextStreak = Math.max(1, stats.current_streak);
        } else if (stats.last_active_local_date === prevDate) {
          nextStreak = stats.current_streak + 1;
        } else {
          nextStreak = 1;
        }
        const nextLongest = Math.max(stats.longest_streak, nextStreak);

        db.prepare(
          `UPDATE user_stats
           SET total_xp = ?, level = ?, current_streak = ?, longest_streak = ?, last_active_local_date = ?, updated_at = datetime('now')
           WHERE user_id = ?`,
        ).run(newTotal, newLevel, nextStreak, nextLongest, localDate, params.userId);
      } else {
        newTotal = stats.total_xp;
        newLevel = stats.level;
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    if (inserted) {
      this.evaluateLevelAndStreakAchievements(params.userId);
    }

    return {
      awarded: inserted,
      amount: inserted ? params.amount : 0,
      new_total: newTotal,
      new_level: newLevel,
      level_up: levelUp,
    };
  },

  evaluateLevelAndStreakAchievements(userId: string): AchievementRow[] {
    const stats = identityRepo.getStats(userId);
    if (!stats) return [];
    const unlocked: AchievementRow[] = [];

    if (stats.level >= 3) {
      const a = this.unlockWithBonus(userId, 'level_3', { level: stats.level });
      if (a) unlocked.push(a);
    }
    if (stats.level >= 5) {
      const a = this.unlockWithBonus(userId, 'level_5', { level: stats.level });
      if (a) unlocked.push(a);
    }
    if (stats.current_streak >= 3) {
      const a = this.unlockWithBonus(userId, 'streak_3', { streak: stats.current_streak });
      if (a) unlocked.push(a);
    }
    return unlocked;
  },

  evaluateAchievements(
    userId: string,
    trigger:
      | 'document_ready'
      | 'assessment_completed'
      | 'perfect_assessment'
      | 'tutor_citation'
      | 'misconception_resolved'
      | 'quest_completed'
      | 'boss_defeated',
  ): AchievementRow[] {
    const codeMap: Record<typeof trigger, string> = {
      document_ready: 'first_upload',
      assessment_completed: 'first_diagnostic',
      perfect_assessment: 'perfect_round',
      tutor_citation: 'curious_scholar',
      misconception_resolved: 'misconception_buster',
      quest_completed: 'quest_pioneer',
      boss_defeated: 'boss_slayer',
    };
    const code = codeMap[trigger];
    const unlocked = this.unlockWithBonus(userId, code, { trigger });
    return unlocked ? [unlocked] : [];
  },

  unlockWithBonus(
    userId: string,
    code: string,
    context: Record<string, unknown>,
  ): AchievementRow | null {
    const ach = progressRepo.unlockAchievement(userId, code, context);
    if (!ach) return null;
    if (ach.xp_bonus > 0) {
      this.awardXp({
        userId,
        amount: ach.xp_bonus,
        sourceType: 'achievement',
        sourceId: null,
        reason: `Achievement unlocked: ${ach.name}`,
        idempotencyKey: `ach:${userId}:${code}`,
      });
    }
    return ach;
  },
};
