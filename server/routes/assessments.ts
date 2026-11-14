import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { idempotent } from '../core/idempotency.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { assessmentRepo } from '../repositories/assessmentRepo.ts';
import { documentRepo } from '../repositories/documentRepo.ts';
import { topicRepo } from '../repositories/topicRepo.ts';
import { quizService } from '../services/assessments/quizService.ts';

export const assessmentsRouter = Router();
assessmentsRouter.use(requireAuth);

assessmentsRouter.post('/assessments', async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { kind, document_id, topic_ids, question_count, difficulty } = req.body || {};
    const validKinds = ['diagnostic', 'practice', 'quest_check'];
    const resolvedKind = validKinds.includes(kind) ? kind : 'diagnostic';
    const result = await quizService.createAssessment({
      userId,
      kind: resolvedKind,
      documentId: document_id || null,
      topicIds: Array.isArray(topic_ids) ? topic_ids : undefined,
      questionCount: Number(question_count || 5),
      difficulty,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

assessmentsRouter.get('/assessments', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    res.json({ items: assessmentRepo.listAssessments(userId) });
  } catch (err) {
    next(err);
  }
});

assessmentsRouter.get('/assessments/:id', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const assessment = assessmentRepo.getAssessment(userId, req.params.id);
    if (!assessment) {
      throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found.');
    }
    // Strictly return public questions WITHOUT answer_key or rubric
    const rawQuestions = assessmentRepo.listQuestionsPublic(userId, assessment.id);
    const answers = assessmentRepo.listAnswersForAssessment(userId, assessment.id);
    const userTopics = topicRepo.listTopics(userId);
    const topicMap = new Map(userTopics.map((t) => [t.id, t]));

    const questions = rawQuestions.map((q) => ({
      ...q,
      topic_name: q.topic_id ? topicMap.get(q.topic_id)?.name || null : null,
    }));

    // Only expose explanations/correct answers for already-answered questions or evaluated assessments
    const answeredIds = new Set(answers.map((a) => a.question_id));
    const review =
      assessment.status === 'evaluated'
        ? assessmentRepo.listQuestionsSecret(userId, assessment.id).map((q) => ({
            question_id: q.id,
            correct_answer: q.answer_key.correct,
            explanation: q.explanation,
          }))
        : assessmentRepo
            .listQuestionsSecret(userId, assessment.id)
            .filter((q) => answeredIds.has(q.id))
            .map((q) => ({
              question_id: q.id,
              correct_answer: q.answer_key.correct,
              explanation: q.explanation,
            }));

    let analytics_summary: {
      document_id: string | null;
      document_title: string | null;
      per_topic: Array<{
        topic_id: string | null;
        topic_name: string;
        correct: number;
        total: number;
        accuracy: number;
        source_ref: string | null;
      }>;
      weak_topics: Array<{ topic_id: string | null; topic_name: string; accuracy: number; source_ref: string | null }>;
      recommendations: Array<{ title: string; reason: string; action_path: string; action_label: string }>;
    } | null = null;

    if (assessment.status === 'evaluated') {
      const doc = assessment.document_id ? documentRepo.getDocument(userId, assessment.document_id) : undefined;
      const answerMap = new Map(answers.map((a) => [a.question_id, a]));
      const topicBuckets = new Map<
        string,
        { topic_id: string | null; topic_name: string; correct: number; total: number; source_ref: string | null }
      >();

      for (const q of questions) {
        const key = q.topic_id || 'general';
        const tName = q.topic_name || 'Core Material';
        const bucket = topicBuckets.get(key) || {
          topic_id: q.topic_id,
          topic_name: tName,
          correct: 0,
          total: 0,
          source_ref: q.source_refs[0]?.label || null,
        };
        bucket.total += 1;
        if (answerMap.get(q.id)?.is_correct) {
          bucket.correct += 1;
        }
        topicBuckets.set(key, bucket);
      }

      const perTopic = Array.from(topicBuckets.values()).map((b) => ({
        ...b,
        accuracy: Math.round((b.correct / Math.max(1, b.total)) * 100),
      }));

      const weakTopics = perTopic
        .filter((t) => t.accuracy < 70)
        .map((t) => ({
          topic_id: t.topic_id,
          topic_name: t.topic_name,
          accuracy: t.accuracy,
          source_ref: t.source_ref,
        }));

      const recommendations: Array<{
        title: string;
        reason: string;
        action_path: string;
        action_label: string;
      }> = [];

      for (const wt of weakTopics.slice(0, 3)) {
        recommendations.push({
          title: `Review "${wt.topic_name}"`,
          reason: `Scored ${wt.accuracy}% on questions covering this topic${wt.source_ref ? ` (${wt.source_ref})` : ''}. Revisit the structured notes and retry practice.`,
          action_path: assessment.document_id ? `/documents/${assessment.document_id}` : '/documents',
          action_label: 'Open Study Notes',
        });
      }

      if (weakTopics.length > 0) {
        recommendations.push({
          title: 'Resolve Flagged Misconceptions',
          reason: 'Complete targeted corrective mini-lessons for the questions you missed to boost mastery.',
          action_path: '/misconceptions',
          action_label: 'Open Misconceptions',
        });
      } else {
        recommendations.push({
          title: 'Advance in Your Learning World',
          reason: 'Strong performance across all tested topics! Continue to the next quest or Boss Challenge.',
          action_path: '/worlds',
          action_label: 'Open Learning Worlds',
        });
      }

      analytics_summary = {
        document_id: assessment.document_id,
        document_title: doc?.title || null,
        per_topic: perTopic,
        weak_topics: weakTopics,
        recommendations,
      };
    }

    res.json({ assessment, questions, answers, review, analytics_summary });
  } catch (err) {
    next(err);
  }
});

assessmentsRouter.post('/assessments/:id/questions/:qid/hint', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const q = assessmentRepo.getQuestionSecret(userId, req.params.id, req.params.qid);
    if (!q) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', 'Question not found.');
    }
    const hintIdx = Math.max(0, Math.min(q.hints.length - 1, Number(req.body?.hint_index || 0)));
    const hint = q.hints[hintIdx] || 'Review the referenced section in your study material.';
    res.json({
      hint,
      hint_index: hintIdx,
      hints_remaining: Math.max(0, q.hints.length - hintIdx - 1),
    });
  } catch (err) {
    next(err);
  }
});

assessmentsRouter.post('/assessments/:id/answers', idempotent(true), async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { question_id, answer, hints_used, time_taken_ms } = req.body || {};
    if (!question_id || answer === undefined) {
      throw new AppError(422, 'VALIDATION_ERROR', 'question_id and answer are required.');
    }
    const result = await quizService.submitAnswer({
      userId,
      assessmentId: req.params.id,
      questionId: String(question_id),
      answer: String(answer),
      hintsUsed: Number(hints_used || 0),
      timeTakenMs: Number(time_taken_ms || 0),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

assessmentsRouter.post('/assessments/:id/complete', idempotent(true), (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const key = String(req.headers['idempotency-key'] || '');
    const result = quizService.completeAssessment({
      userId,
      assessmentId: req.params.id,
      idempotencyKey: key,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
