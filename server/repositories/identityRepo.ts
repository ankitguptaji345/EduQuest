import crypto from 'node:crypto';
import { getDb } from '../core/database.ts';

export interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  avatar_key: string;
  education_level: string;
  course: string;
  timezone: string;
  onboarding_completed_at: string | null;
  deletion_requested_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreferencesRow {
  user_id: string;
  interests: string[];
  subjects_of_interest: string[];
  goals: string[];
  explanation_style: string;
  daily_goal_minutes: number;
  ai_daily_budget_override: number | null;
  updated_at: string;
}

export interface UserStatsRow {
  user_id: string;
  total_xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  last_active_local_date: string | null;
  updated_at: string;
}

export interface SubjectRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon_key: string;
  archived_at: string | null;
  created_at: string;
}

export const identityRepo = {
  findAuthByEmail(email: string): { id: string; email: string; password_hash: string } | undefined {
    const db = getDb();
    return db
      .prepare('SELECT id, email, password_hash FROM profiles WHERE lower(email) = lower(?)')
      .get(email.trim()) as { id: string; email: string; password_hash: string } | undefined;
  },

  createUser(params: { id: string; email: string; passwordHash: string; fullName: string }): ProfileRow {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO profiles (id, email, password_hash, full_name)
         VALUES (?, ?, ?, ?)`,
      ).run(params.id, params.email.trim().toLowerCase(), params.passwordHash, params.fullName.trim());

      db.prepare(`INSERT INTO user_preferences (user_id) VALUES (?)`).run(params.id);
      db.prepare(`INSERT INTO user_stats (user_id) VALUES (?)`).run(params.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return this.getProfile(params.id)!;
  },

  updatePasswordHash(userId: string, passwordHash: string): void {
    const db = getDb();
    db.prepare(`UPDATE profiles SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
      passwordHash,
      userId,
    );
  },

  getProfile(userId: string): ProfileRow | undefined {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, email, full_name, avatar_key, education_level, course, timezone,
                onboarding_completed_at, deletion_requested_at, created_at, updated_at
         FROM profiles WHERE id = ?`,
      )
      .get(userId) as ProfileRow | undefined;
  },

  updateProfile(
    userId: string,
    patch: Partial<Pick<ProfileRow, 'full_name' | 'avatar_key' | 'education_level' | 'course' | 'timezone'>>,
  ): ProfileRow | undefined {
    const db = getDb();
    const existing = this.getProfile(userId);
    if (!existing) return undefined;
    db.prepare(
      `UPDATE profiles
       SET full_name = ?, avatar_key = ?, education_level = ?, course = ?, timezone = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      patch.full_name ?? existing.full_name,
      patch.avatar_key ?? existing.avatar_key,
      patch.education_level ?? existing.education_level,
      patch.course ?? existing.course,
      patch.timezone ?? existing.timezone,
      userId,
    );
    return this.getProfile(userId);
  },

  markOnboardingComplete(userId: string): ProfileRow | undefined {
    const db = getDb();
    db.prepare(
      `UPDATE profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`,
    ).run(userId);
    return this.getProfile(userId);
  },

  requestDeletion(userId: string): ProfileRow | undefined {
    const db = getDb();
    db.prepare(
      `UPDATE profiles SET deletion_requested_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    ).run(userId);
    return this.getProfile(userId);
  },

  cancelDeletion(userId: string): ProfileRow | undefined {
    const db = getDb();
    db.prepare(
      `UPDATE profiles SET deletion_requested_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(userId);
    return this.getProfile(userId);
  },

  getPreferences(userId: string): PreferencesRow | undefined {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
      .get(userId) as
      | {
          user_id: string;
          interests: string;
          subjects_of_interest: string;
          goals: string;
          explanation_style: string;
          daily_goal_minutes: number;
          ai_daily_budget_override: number | null;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      ...row,
      interests: JSON.parse(row.interests),
      subjects_of_interest: JSON.parse(row.subjects_of_interest),
      goals: JSON.parse(row.goals),
    };
  },

  updatePreferences(
    userId: string,
    patch: Partial<Pick<PreferencesRow, 'interests' | 'subjects_of_interest' | 'goals' | 'explanation_style' | 'daily_goal_minutes'>>,
  ): PreferencesRow | undefined {
    const db = getDb();
    const existing = this.getPreferences(userId);
    if (!existing) return undefined;
    db.prepare(
      `UPDATE user_preferences
       SET interests = ?, subjects_of_interest = ?, goals = ?, explanation_style = ?, daily_goal_minutes = ?, updated_at = datetime('now')
       WHERE user_id = ?`,
    ).run(
      JSON.stringify(patch.interests ?? existing.interests),
      JSON.stringify(patch.subjects_of_interest ?? existing.subjects_of_interest),
      JSON.stringify(patch.goals ?? existing.goals),
      patch.explanation_style ?? existing.explanation_style,
      patch.daily_goal_minutes ?? existing.daily_goal_minutes,
      userId,
    );
    return this.getPreferences(userId);
  },

  getStats(userId: string): UserStatsRow | undefined {
    const db = getDb();
    return db.prepare('SELECT * FROM user_stats WHERE user_id = ?').get(userId) as
      | UserStatsRow
      | undefined;
  },

  listSubjects(userId: string): SubjectRow[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM subjects WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at ASC')
      .all(userId) as unknown as SubjectRow[];
  },

  createSubject(userId: string, name: string, color = '#8B5CF6', iconKey = 'book'): SubjectRow {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO subjects (id, user_id, name, color, icon_key)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, userId, name.trim(), color, iconKey);
    return db
      .prepare('SELECT * FROM subjects WHERE id = ? AND user_id = ?')
      .get(id, userId) as unknown as SubjectRow;
  },

  deleteSubject(userId: string, subjectId: string): boolean {
    const db = getDb();
    const res = db
      .prepare('DELETE FROM subjects WHERE id = ? AND user_id = ?')
      .run(subjectId, userId);
    return res.changes > 0;
  },
};
