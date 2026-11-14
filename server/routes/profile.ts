import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { identityRepo } from '../repositories/identityRepo.ts';

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get('/profile', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const profile = identityRepo.getProfile(userId);
    const preferences = identityRepo.getPreferences(userId);
    const stats = identityRepo.getStats(userId);
    const subjects = identityRepo.listSubjects(userId);
    res.json({ profile, preferences, stats, subjects });
  } catch (err) {
    next(err);
  }
});

profileRouter.patch('/profile', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { full_name, avatar_key, education_level, course, timezone } = req.body || {};
    const allowedLevels = ['school', 'undergraduate', 'postgraduate', 'exam_prep', 'self_learner'];
    if (education_level && !allowedLevels.includes(education_level)) {
      throw new AppError(422, 'INVALID_EDUCATION_LEVEL', 'Invalid education level.');
    }
    const updated = identityRepo.updateProfile(userId, {
      full_name,
      avatar_key,
      education_level,
      course,
      timezone,
    });
    res.json({ profile: updated });
  } catch (err) {
    next(err);
  }
});

profileRouter.put('/profile/preferences', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { interests, subjects_of_interest, goals, explanation_style, daily_goal_minutes } =
      req.body || {};
    const allowedStyles = [
      'beginner',
      'academic',
      'example_based',
      'step_by_step',
      'exam_oriented',
    ];
    if (explanation_style && !allowedStyles.includes(explanation_style)) {
      throw new AppError(422, 'INVALID_STYLE', 'Invalid explanation style.');
    }
    if (
      daily_goal_minutes !== undefined &&
      (Number(daily_goal_minutes) < 5 || Number(daily_goal_minutes) > 240)
    ) {
      throw new AppError(422, 'INVALID_DAILY_GOAL', 'Daily goal must be between 5 and 240 minutes.');
    }
    const updated = identityRepo.updatePreferences(userId, {
      interests,
      subjects_of_interest,
      goals,
      explanation_style,
      daily_goal_minutes: daily_goal_minutes !== undefined ? Number(daily_goal_minutes) : undefined,
    });
    res.json({ preferences: updated });
  } catch (err) {
    next(err);
  }
});

profileRouter.post('/profile/onboarding-complete', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const updated = identityRepo.markOnboardingComplete(userId);
    res.json({ profile: updated });
  } catch (err) {
    next(err);
  }
});

profileRouter.delete('/profile', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const updated = identityRepo.requestDeletion(userId);
    res.json({
      profile: updated,
      message: 'Account deletion scheduled with a 7-day grace period. You can cancel anytime before then.',
    });
  } catch (err) {
    next(err);
  }
});

profileRouter.post('/profile/cancel-deletion', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const updated = identityRepo.cancelDeletion(userId);
    res.json({ profile: updated });
  } catch (err) {
    next(err);
  }
});

// Subjects endpoints
profileRouter.get('/subjects', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    res.json({ items: identityRepo.listSubjects(userId) });
  } catch (err) {
    next(err);
  }
});

profileRouter.post('/subjects', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { name, color, icon_key } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError(422, 'INVALID_SUBJECT', 'Subject name is required.');
    }
    const existing = identityRepo
      .listSubjects(userId)
      .find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (existing) {
      res.status(200).json({ subject: existing });
      return;
    }
    const subject = identityRepo.createSubject(userId, name, color, icon_key);
    res.status(201).json({ subject });
  } catch (err) {
    next(err);
  }
});

profileRouter.delete('/subjects/:id', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const deleted = identityRepo.deleteSubject(userId, req.params.id);
    if (!deleted) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found.');
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
