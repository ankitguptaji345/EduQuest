import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { identityRepo } from '../repositories/identityRepo.ts';
import { progressRepo } from '../repositories/progressRepo.ts';
import { analyticsService } from '../services/progress/analyticsService.ts';
import { recommendationService } from '../services/progress/recommendationService.ts';
import { getLocalDateString, xpThresholdForLevel } from '../services/progress/xpService.ts';

export const progressRouter = Router();
progressRouter.use(requireAuth);

progressRouter.get('/progress/stats', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const stats = identityRepo.getStats(userId)!;
    const currentThreshold = xpThresholdForLevel(stats.level);
    const nextThreshold = xpThresholdForLevel(stats.level + 1);
    const transactions = progressRepo.listXpTransactions(userId, 50);
    res.json({
      stats: {
        ...stats,
        current_level_xp: currentThreshold,
        next_level_xp: nextThreshold,
      },
      transactions,
    });
  } catch (err) {
    next(err);
  }
});

progressRouter.get('/progress/achievements', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const all = progressRepo.listAchievements();
    const unlocked = progressRepo.listUserAchievements(userId);
    const unlockedMap = new Map(unlocked.map((u) => [u.achievement_code, u]));
    res.json({
      items: all.map((a) => ({
        ...a,
        unlocked: unlockedMap.has(a.code),
        unlocked_at: unlockedMap.get(a.code)?.unlocked_at || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

progressRouter.get('/recommendations', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const items = recommendationService.recompute(userId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

progressRouter.post('/recommendations/:id/dismiss', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const ok = progressRepo.dismissRecommendation(userId, req.params.id);
    if (!ok) {
      throw new AppError(404, 'RECOMMENDATION_NOT_FOUND', 'Recommendation not found.');
    }
    res.json({ status: 'dismissed' });
  } catch (err) {
    next(err);
  }
});

progressRouter.get('/analytics/overview', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    res.json(analyticsService.getOverview(userId));
  } catch (err) {
    next(err);
  }
});

progressRouter.post('/sessions/start', (req, res, next) => {
  try {
    const { userId, userTimezone } = req as AuthenticatedRequest;
    const { activity, subject_id, document_id } = req.body || {};
    const valid = ['reading', 'tutor', 'assessment', 'quest', 'boss'];
    const act = valid.includes(activity) ? activity : 'reading';
    const session = progressRepo.startSession({
      userId,
      activity: act,
      subjectId: subject_id || null,
      documentId: document_id || null,
      localDate: getLocalDateString(userTimezone),
    });
    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
});

progressRouter.post('/sessions/:id/heartbeat', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const session = progressRepo.heartbeatSession(userId, req.params.id);
    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Learning session not found.');
    }
    res.json({ session });
  } catch (err) {
    next(err);
  }
});

progressRouter.post('/sessions/:id/end', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const session = progressRepo.endSession(userId, req.params.id);
    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Learning session not found.');
    }
    res.json({ session });
  } catch (err) {
    next(err);
  }
});
