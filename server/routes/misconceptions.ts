import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { idempotent } from '../core/idempotency.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { misconceptionRepo } from '../repositories/misconceptionRepo.ts';
import { misconceptionService } from '../services/misconceptions/misconceptionService.ts';
import { recommendationService } from '../services/progress/recommendationService.ts';

export const misconceptionsRouter = Router();
misconceptionsRouter.use(requireAuth);

misconceptionsRouter.get('/misconceptions', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const threads = misconceptionRepo.listThreads(userId, status);
    res.json({ items: threads });
  } catch (err) {
    next(err);
  }
});

misconceptionsRouter.get('/misconceptions/:threadId', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const detail = misconceptionService.getThreadDetail(userId, req.params.threadId);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

misconceptionsRouter.post(
  '/misconceptions/:threadId/corrective-answer',
  idempotent(true),
  async (req, res, next) => {
    try {
      const { userId } = req as AuthenticatedRequest;
      const { question_id, answer } = req.body || {};
      if (!question_id || answer === undefined) {
        throw new AppError(422, 'VALIDATION_ERROR', 'question_id and answer are required.');
      }
      const key = String(req.headers['idempotency-key'] || '');
      const result = await misconceptionService.submitCorrectiveAnswer({
        userId,
        threadId: req.params.threadId,
        questionId: String(question_id),
        answer: String(answer),
        idempotencyKey: key,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

misconceptionsRouter.post('/misconceptions/:threadId/dismiss', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const updated = misconceptionRepo.updateThreadStatus(userId, req.params.threadId, 'dismissed');
    if (!updated) {
      throw new AppError(404, 'MISCONCEPTION_NOT_FOUND', 'Misconception thread not found.');
    }
    recommendationService.recompute(userId);
    res.json({ thread: updated });
  } catch (err) {
    next(err);
  }
});
