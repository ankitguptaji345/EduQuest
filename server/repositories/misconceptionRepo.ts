import crypto from 'node:crypto';
import { getDb } from '../core/database.ts';

export type CauseClass =
  | 'misconception'
  | 'knowledge_gap'
  | 'careless_slip'
  | 'ambiguous_question'
  | 'uncertain';

export type ThreadStatus =
  | 'suspected'
  | 'confirmed'
  | 'improving'
  | 'resolved'
  | 'persistent'
  | 'dismissed';

export interface MisconceptionThreadRow {
  id: string;
  user_id: string;
  topic_id: string | null;
  topic_name_snapshot: string;
  misconception_key: string;
  label: string;
  status: ThreadStatus;
  occurrences: number;
  confidence_agg: number;
  corrective_lesson: string;
  follow_up_assessment_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface MisconceptionRecordRow {
  id: string;
  user_id: string;
  thread_id: string;
  answer_id: string;
  question_id: string;
  topic_id: string | null;
  concept: string;
  cause_class: CauseClass;
  misconception_key: string;
  label: string;
  is_correct: boolean;
  misconception_detected: boolean;
  confidence: number;
  explanation: string;
  recommended_action: string;
  follow_up_question_id: string | null;
  model: string;
  prompt_version: string;
  created_at: string;
}

export const misconceptionRepo = {
  listThreads(userId: string, status?: string): MisconceptionThreadRow[] {
    const db = getDb();
    let sql = 'SELECT * FROM misconception_threads WHERE user_id = ?';
    const args: string[] = [userId];
    if (status) {
      sql += ' AND status = ?';
      args.push(status);
    }
    sql += ' ORDER BY last_seen_at DESC';
    return db.prepare(sql).all(...args) as unknown as MisconceptionThreadRow[];
  },

  getThread(userId: string, threadId: string): MisconceptionThreadRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM misconception_threads WHERE id = ? AND user_id = ?')
      .get(threadId, userId) as unknown as MisconceptionThreadRow | undefined;
  },

  findThreadByKey(
    userId: string,
    topicId: string | null,
    misconceptionKey: string,
  ): MisconceptionThreadRow | undefined {
    const db = getDb();
    if (topicId === null) {
      return db
        .prepare(
          'SELECT * FROM misconception_threads WHERE user_id = ? AND topic_id IS NULL AND misconception_key = ?',
        )
        .get(userId, misconceptionKey) as unknown as MisconceptionThreadRow | undefined;
    }
    return db
      .prepare(
        'SELECT * FROM misconception_threads WHERE user_id = ? AND topic_id = ? AND misconception_key = ?',
      )
      .get(userId, topicId, misconceptionKey) as unknown as MisconceptionThreadRow | undefined;
  },

  upsertThreadAndRecord(params: {
    userId: string;
    topicId: string | null;
    topicName: string;
    misconceptionKey: string;
    label: string;
    causeClass: CauseClass;
    confidence: number;
    explanation: string;
    recommendedAction: string;
    correctiveLesson: string;
    followUpAssessmentId: string | null;
    followUpQuestionId: string | null;
    answerId: string;
    questionId: string;
    concept: string;
    model: string;
  }): { thread: MisconceptionThreadRow; record: MisconceptionRecordRow } {
    const db = getDb();
    const existing = this.findThreadByKey(params.userId, params.topicId, params.misconceptionKey);
    const recordId = crypto.randomUUID();
    let threadId: string;

    db.exec('BEGIN IMMEDIATE');
    try {
      if (existing) {
        threadId = existing.id;
        const nextOccurrences = existing.occurrences + 1;
        // Evidence threshold: never confirm from 1 error; confirm when >= 2 observations (for misconception/knowledge_gap)
        let nextStatus: ThreadStatus = existing.status;
        if (existing.status === 'resolved' || existing.status === 'dismissed') {
          nextStatus = nextOccurrences >= 2 ? 'persistent' : 'suspected';
        } else if (nextOccurrences >= 2 && (params.causeClass === 'misconception' || params.causeClass === 'knowledge_gap')) {
          nextStatus = 'confirmed';
        }
        const nextConf = Number(
          Math.min(0.99, (existing.confidence_agg * existing.occurrences + params.confidence) / nextOccurrences).toFixed(2),
        );

        db.prepare(
          `UPDATE misconception_threads
           SET status = ?, occurrences = ?, confidence_agg = ?, corrective_lesson = COALESCE(NULLIF(?, ''), corrective_lesson),
               follow_up_assessment_id = COALESCE(?, follow_up_assessment_id),
               last_seen_at = datetime('now'), resolved_at = NULL
           WHERE id = ? AND user_id = ?`,
        ).run(
          nextStatus,
          nextOccurrences,
          nextConf,
          params.correctiveLesson,
          params.followUpAssessmentId,
          threadId,
          params.userId,
        );
      } else {
        threadId = crypto.randomUUID();
        // Single error MUST stay 'suspected' (never 'confirmed' on 1 occurrence!)
        db.prepare(
          `INSERT INTO misconception_threads
           (id, user_id, topic_id, topic_name_snapshot, misconception_key, label, status, occurrences, confidence_agg, corrective_lesson, follow_up_assessment_id)
           VALUES (?, ?, ?, ?, ?, ?, 'suspected', 1, ?, ?, ?)`,
        ).run(
          threadId,
          params.userId,
          params.topicId,
          params.topicName,
          params.misconceptionKey,
          params.label,
          params.confidence,
          params.correctiveLesson,
          params.followUpAssessmentId,
        );
      }

      db.prepare(
        `INSERT INTO misconception_records
         (id, user_id, thread_id, answer_id, question_id, topic_id, concept, cause_class, misconception_key, label, is_correct, misconception_detected, confidence, explanation, recommended_action, follow_up_question_id, model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      ).run(
        recordId,
        params.userId,
        threadId,
        params.answerId,
        params.questionId,
        params.topicId,
        params.concept,
        params.causeClass,
        params.misconceptionKey,
        params.label,
        params.causeClass === 'misconception' ? 1 : 0,
        params.confidence,
        params.explanation,
        params.recommendedAction,
        params.followUpQuestionId,
        params.model,
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return {
      thread: this.getThread(params.userId, threadId)!,
      record: this.getRecord(params.userId, recordId)!,
    };
  },

  updateThreadStatus(userId: string, threadId: string, status: ThreadStatus): MisconceptionThreadRow | undefined {
    const db = getDb();
    db.prepare(
      `UPDATE misconception_threads
       SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END,
           last_seen_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(status, status, threadId, userId);
    return this.getThread(userId, threadId);
  },

  setFollowUpAssessment(userId: string, threadId: string, assessmentId: string): void {
    const db = getDb();
    db.prepare(
      'UPDATE misconception_threads SET follow_up_assessment_id = ? WHERE id = ? AND user_id = ?',
    ).run(assessmentId, threadId, userId);
  },

  getRecord(userId: string, recordId: string): MisconceptionRecordRow | undefined {
    const db = getDb();
    const r = db
      .prepare('SELECT * FROM misconception_records WHERE id = ? AND user_id = ?')
      .get(recordId, userId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      ...(r as unknown as MisconceptionRecordRow),
      is_correct: Boolean(r.is_correct),
      misconception_detected: Boolean(r.misconception_detected),
      confidence: Number(r.confidence),
    };
  },

  listRecordsForThread(userId: string, threadId: string): MisconceptionRecordRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM misconception_records WHERE user_id = ? AND thread_id = ? ORDER BY created_at DESC')
      .all(userId, threadId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      ...(r as unknown as MisconceptionRecordRow),
      is_correct: Boolean(r.is_correct),
      misconception_detected: Boolean(r.misconception_detected),
      confidence: Number(r.confidence),
    }));
  },
};
