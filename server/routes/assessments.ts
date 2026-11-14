import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { idempotent } from '../core/idempotency.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { assessmentRepo } from '../repositories/assessmentRepo.ts';
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
    const questions = assessmentRepo.listQuestionsPublic(userId, assessment.id);
    const answers = assessmentRepo.listAnswersForAssessment(userId, assessment.id);

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

    res.json({ assessment, questions, answers, review });
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
