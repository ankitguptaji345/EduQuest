import { getDb } from '../core/database.ts';
import type { SourceRef } from './topicRepo.ts';

export type QuestionType =
  | 'mcq'
  | 'true_false'
  | 'short_answer'
  | 'code_output'
  | 'conceptual'
  | 'error_identification'
  | 'coding'
  | 'application';

export interface AssessmentRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  document_id: string | null;
  topic_ids: string[];
  kind: 'diagnostic' | 'practice' | 'quest_check' | 'boss' | 'corrective';
  status: 'generated' | 'in_progress' | 'submitted' | 'evaluated' | 'expired';
  config: Record<string, unknown>;
  parent_assessment_id: string | null;
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  model: string;
  prompt_version: string;
}

export interface QuestionPublic {
  id: string;
  assessment_id: string;
  topic_id: string | null;
  position: number;
  round_no: number;
  type: QuestionType;
  difficulty: string;
  prompt: string;
  options: string[];
  hints_count: number;
  source_refs: SourceRef[];
}

export interface QuestionSecret extends QuestionPublic {
  user_id: string;
  answer_key: { correct: string; keywords?: string[]; code_trace?: string };
  rubric: Record<string, unknown>;
  explanation: string;
  hints: string[];
  question_hash: string;
}

export interface StudentAnswerRow {
  id: string;
  user_id: string;
  assessment_id: string;
  question_id: string;
  topic_id: string | null;
  difficulty: string;
  answer: { value: string };
  is_correct: boolean | null;
  score: number;
  grading_method: 'deterministic' | 'ai';
  feedback: string;
  hints_used: number;
  time_taken_ms: number;
  answered_at: string;
}

function hydrateAssessment(r: Record<string, unknown>): AssessmentRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    subject_id: r.subject_id ? String(r.subject_id) : null,
    document_id: r.document_id ? String(r.document_id) : null,
    topic_ids: JSON.parse(String(r.topic_ids || '[]')),
    kind: r.kind as AssessmentRow['kind'],
    status: r.status as AssessmentRow['status'],
    config: JSON.parse(String(r.config || '{}')),
    parent_assessment_id: r.parent_assessment_id ? String(r.parent_assessment_id) : null,
    started_at: String(r.started_at),
    submitted_at: r.submitted_at ? String(r.submitted_at) : null,
    score: r.score !== null && r.score !== undefined ? Number(r.score) : null,
    max_score: r.max_score !== null && r.max_score !== undefined ? Number(r.max_score) : null,
    model: String(r.model),
    prompt_version: String(r.prompt_version),
  };
}

function toPublicQuestion(r: Record<string, unknown>): QuestionPublic {
  const hints = JSON.parse(String(r.hints || '[]')) as string[];
  return {
    id: String(r.id),
    assessment_id: String(r.assessment_id),
    topic_id: r.topic_id ? String(r.topic_id) : null,
    position: Number(r.position),
    round_no: Number(r.round_no || 1),
    type: r.type as QuestionType,
    difficulty: String(r.difficulty),
    prompt: String(r.prompt),
    options: JSON.parse(String(r.options || '[]')),
    hints_count: hints.length,
    source_refs: JSON.parse(String(r.source_refs || '[]')),
  };
}

function toSecretQuestion(r: Record<string, unknown>): QuestionSecret {
  const hints = JSON.parse(String(r.hints || '[]')) as string[];
  return {
    ...toPublicQuestion(r),
    user_id: String(r.user_id),
    answer_key: JSON.parse(String(r.answer_key)),
    rubric: JSON.parse(String(r.rubric || '{}')),
    explanation: String(r.explanation || ''),
    hints,
    question_hash: String(r.question_hash),
  };
}

export const assessmentRepo = {
  createAssessmentWithQuestions(params: {
    assessment: Omit<AssessmentRow, 'started_at' | 'submitted_at' | 'score' | 'max_score'>;
    questions: QuestionSecret[];
  }): AssessmentRow {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO assessments
         (id, user_id, subject_id, document_id, topic_ids, kind, status, config, parent_assessment_id, max_score, model, prompt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        params.assessment.id,
        params.assessment.user_id,
        params.assessment.subject_id,
        params.assessment.document_id,
        JSON.stringify(params.assessment.topic_ids),
        params.assessment.kind,
        params.assessment.status,
        JSON.stringify(params.assessment.config),
        params.assessment.parent_assessment_id,
        params.questions.length,
        params.assessment.model,
        params.assessment.prompt_version,
      );

      const qStmt = db.prepare(
        `INSERT INTO questions
         (id, assessment_id, user_id, topic_id, position, round_no, type, difficulty, prompt, options, answer_key, rubric, explanation, hints, source_refs, question_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const q of params.questions) {
        qStmt.run(
          q.id,
          params.assessment.id,
          params.assessment.user_id,
          q.topic_id,
          q.position,
          q.round_no,
          q.type,
          q.difficulty,
          q.prompt,
          JSON.stringify(q.options),
          JSON.stringify(q.answer_key),
          JSON.stringify(q.rubric),
          q.explanation,
          JSON.stringify(q.hints),
          JSON.stringify(q.source_refs),
          q.question_hash,
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return this.getAssessment(params.assessment.user_id, params.assessment.id)!;
  },

  listAssessments(userId: string): AssessmentRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM assessments WHERE user_id = ? ORDER BY started_at DESC')
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map(hydrateAssessment);
  },

  getAssessment(userId: string, assessmentId: string): AssessmentRow | undefined {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM assessments WHERE id = ? AND user_id = ?')
      .get(assessmentId, userId) as Record<string, unknown> | undefined;
    return row ? hydrateAssessment(row) : undefined;
  },

  listQuestionsPublic(userId: string, assessmentId: string): QuestionPublic[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, assessment_id, topic_id, position, round_no, type, difficulty, prompt, options, hints, source_refs
         FROM questions WHERE assessment_id = ? AND user_id = ? ORDER BY position ASC`,
      )
      .all(assessmentId, userId) as Array<Record<string, unknown>>;
    return rows.map(toPublicQuestion);
  },

  // Strictly server-side only: NEVER serialize directly to API responses!
  getQuestionSecret(userId: string, assessmentId: string, questionId: string): QuestionSecret | undefined {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM questions WHERE id = ? AND assessment_id = ? AND user_id = ?')
      .get(questionId, assessmentId, userId) as Record<string, unknown> | undefined;
    return row ? toSecretQuestion(row) : undefined;
  },

  getQuestionSecretById(userId: string, questionId: string): QuestionSecret | undefined {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM questions WHERE id = ? AND user_id = ?')
      .get(questionId, userId) as Record<string, unknown> | undefined;
    return row ? toSecretQuestion(row) : undefined;
  },

  listQuestionsSecret(userId: string, assessmentId: string): QuestionSecret[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM questions WHERE assessment_id = ? AND user_id = ? ORDER BY position ASC')
      .all(assessmentId, userId) as Array<Record<string, unknown>>;
    return rows.map(toSecretQuestion);
  },

  getPriorQuestionHashes(userId: string): Set<string> {
    const db = getDb();
    const rows = db
      .prepare('SELECT question_hash FROM questions WHERE user_id = ?')
      .all(userId) as Array<{ question_hash: string }>;
    return new Set(rows.map((r) => r.question_hash));
  },

  upsertStudentAnswer(row: Omit<StudentAnswerRow, 'answered_at'>): StudentAnswerRow {
    const db = getDb();
    db.prepare(
      `INSERT INTO student_answers
       (id, user_id, assessment_id, question_id, topic_id, difficulty, answer, is_correct, score, grading_method, feedback, hints_used, time_taken_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(assessment_id, question_id, user_id) DO NOTHING`,
    ).run(
      row.id,
      row.user_id,
      row.assessment_id,
      row.question_id,
      row.topic_id,
      row.difficulty,
      JSON.stringify(row.answer),
      row.is_correct === null ? null : row.is_correct ? 1 : 0,
      row.score,
      row.grading_method,
      row.feedback,
      row.hints_used,
      row.time_taken_ms,
    );
    return this.getStudentAnswer(row.user_id, row.assessment_id, row.question_id)!;
  },

  getStudentAnswer(userId: string, assessmentId: string, questionId: string): StudentAnswerRow | undefined {
    const db = getDb();
    const r = db
      .prepare(
        `SELECT * FROM student_answers WHERE user_id = ? AND assessment_id = ? AND question_id = ?`,
      )
      .get(userId, assessmentId, questionId) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      id: String(r.id),
      user_id: String(r.user_id),
      assessment_id: String(r.assessment_id),
      question_id: String(r.question_id),
      topic_id: r.topic_id ? String(r.topic_id) : null,
      difficulty: String(r.difficulty),
      answer: JSON.parse(String(r.answer)),
      is_correct: r.is_correct === null ? null : Boolean(r.is_correct),
      score: Number(r.score),
      grading_method: r.grading_method as 'deterministic' | 'ai',
      feedback: String(r.feedback),
      hints_used: Number(r.hints_used),
      time_taken_ms: Number(r.time_taken_ms),
      answered_at: String(r.answered_at),
    };
  },

  listAnswersForAssessment(userId: string, assessmentId: string): StudentAnswerRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM student_answers WHERE user_id = ? AND assessment_id = ? ORDER BY answered_at ASC')
      .all(userId, assessmentId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      assessment_id: String(r.assessment_id),
      question_id: String(r.question_id),
      topic_id: r.topic_id ? String(r.topic_id) : null,
      difficulty: String(r.difficulty),
      answer: JSON.parse(String(r.answer)),
      is_correct: r.is_correct === null ? null : Boolean(r.is_correct),
      score: Number(r.score),
      grading_method: r.grading_method as 'deterministic' | 'ai',
      feedback: String(r.feedback),
      hints_used: Number(r.hints_used),
      time_taken_ms: Number(r.time_taken_ms),
      answered_at: String(r.answered_at),
    }));
  },

  listAnswersForTopic(userId: string, topicId: string): StudentAnswerRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM student_answers WHERE user_id = ? AND topic_id = ? ORDER BY answered_at DESC LIMIT 30')
      .all(userId, topicId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      assessment_id: String(r.assessment_id),
      question_id: String(r.question_id),
      topic_id: r.topic_id ? String(r.topic_id) : null,
      difficulty: String(r.difficulty),
      answer: JSON.parse(String(r.answer)),
      is_correct: r.is_correct === null ? null : Boolean(r.is_correct),
      score: Number(r.score),
      grading_method: r.grading_method as 'deterministic' | 'ai',
      feedback: String(r.feedback),
      hints_used: Number(r.hints_used),
      time_taken_ms: Number(r.time_taken_ms),
      answered_at: String(r.answered_at),
    }));
  },

  markAssessmentStatus(
    userId: string,
    assessmentId: string,
    status: AssessmentRow['status'],
    score?: number,
  ): AssessmentRow | undefined {
    const db = getDb();
    if (score !== undefined) {
      db.prepare(
        `UPDATE assessments SET status = ?, score = ?, submitted_at = COALESCE(submitted_at, datetime('now'))
         WHERE id = ? AND user_id = ?`,
      ).run(status, score, assessmentId, userId);
    } else {
      db.prepare(`UPDATE assessments SET status = ? WHERE id = ? AND user_id = ?`).run(
        status,
        assessmentId,
        userId,
      );
    }
    return this.getAssessment(userId, assessmentId);
  },
};
