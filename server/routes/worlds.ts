import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { idempotent } from '../core/idempotency.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { assessmentRepo } from '../repositories/assessmentRepo.ts';
import { documentRepo } from '../repositories/documentRepo.ts';
import { identityRepo } from '../repositories/identityRepo.ts';
import { topicRepo } from '../repositories/topicRepo.ts';
import { worldRepo } from '../repositories/worldRepo.ts';
import { getAIProvider } from '../services/ai/provider.ts';
import { bossService } from '../services/assessments/bossService.ts';
import { quizService } from '../services/assessments/quizService.ts';
import { recommendationService } from '../services/progress/recommendationService.ts';
import { xpService } from '../services/progress/xpService.ts';
import { worldService } from '../services/worlds/worldService.ts';

export const worldsRouter = Router();
worldsRouter.use(requireAuth);

worldsRouter.get('/worlds', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    res.json({ items: worldService.listWorldsWithProgress(userId) });
  } catch (err) {
    next(err);
  }
});

worldsRouter.post('/worlds/generate', async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { document_id } = req.body || {};
    if (!document_id) {
      throw new AppError(422, 'VALIDATION_ERROR', 'document_id is required.');
    }
    const result = await worldService.generateWorldForDocument(userId, String(document_id));
    if (!result) {
      throw new AppError(
        422,
        'WORLD_GENERATION_FAILED',
        'Document must be ready with extracted topics before generating a world.',
      );
    }
    recommendationService.recompute(userId);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

worldsRouter.get('/quests/:id', async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const quest = worldRepo.getQuest(userId, req.params.id);
    if (!quest) {
      throw new AppError(404, 'QUEST_NOT_FOUND', 'Quest not found.');
    }
    const attempt = worldRepo.getActiveAttempt(userId, quest.id) || null;
    const questions = attempt?.assessment_id
      ? assessmentRepo.listQuestionsPublic(userId, attempt.assessment_id)
      : [];
    const answers = attempt?.assessment_id
      ? assessmentRepo.listAnswersForAssessment(userId, attempt.assessment_id)
      : [];
    res.json({ quest, attempt, questions, answers });
  } catch (err) {
    next(err);
  }
});

worldsRouter.post('/quests/:id/start', idempotent(true), async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const quest = worldRepo.getQuest(userId, req.params.id);
    if (!quest) {
      throw new AppError(404, 'QUEST_NOT_FOUND', 'Quest not found.');
    }

    if (quest.kind === 'boss') {
      const bossData = await bossService.startBossBattle(userId, quest.id);
      res.json(bossData);
      return;
    }

    // Check prerequisites server-side (Blueprint C9)
    const completedIds = worldRepo.getCompletedQuestIds(userId);
    const reqs = quest.unlock_rule.requires_completed || [];
    if (!reqs.every((id) => completedIds.has(id))) {
      throw new AppError(403, 'QUEST_LOCKED', 'Complete prerequisite quests first.');
    }

    // Lazily generate grounded lesson_markdown on first start
    if (!quest.lesson_markdown && quest.topic_ids.length > 0) {
      const topic = topicRepo.getTopic(userId, quest.topic_ids[0]);
      if (topic) {
        const chunks = documentRepo.listChunksForDocument(userId, topic.document_id);
        const style = identityRepo.getPreferences(userId)?.explanation_style || 'step_by_step';
        const provider = getAIProvider();
        const markdown = await provider.generateQuestLesson({ topic, chunks, style });
        worldRepo.setQuestLessonMarkdown(userId, quest.id, markdown);
        quest.lesson_markdown = markdown;
      }
    }

    let attempt = worldRepo.getActiveAttempt(userId, quest.id);
    if (attempt && attempt.status === 'paused') {
      attempt = worldRepo.updateAttempt(userId, attempt.id, { status: 'in_progress' })!;
    }

    if (!attempt) {
      const checkAssessment = await quizService.createAssessment({
        userId,
        kind: 'quest_check',
        topicIds: quest.topic_ids,
        questionCount: Math.max(2, quest.completion_rules.min_items || 2),
      });
      attempt = worldRepo.createAttempt({
        userId,
        questId: quest.id,
        assessmentId: checkAssessment.assessment.id,
        progress: { lesson_viewed: true },
      });
    }

    const questions = attempt.assessment_id
      ? assessmentRepo.listQuestionsPublic(userId, attempt.assessment_id)
      : [];
    const answers = attempt.assessment_id
      ? assessmentRepo.listAnswersForAssessment(userId, attempt.assessment_id)
      : [];

    res.json({ quest, attempt, questions, answers });
  } catch (err) {
    next(err);
  }
});

worldsRouter.post('/quests/:id/pause', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const active = worldRepo.getActiveAttempt(userId, req.params.id);
    if (!active) {
      throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'No active quest attempt to pause.');
    }
    const updated = worldRepo.updateAttempt(userId, active.id, { status: 'paused' });
    res.json({ attempt: updated });
  } catch (err) {
    next(err);
  }
});

worldsRouter.post('/quests/:id/abandon', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const active = worldRepo.getActiveAttempt(userId, req.params.id);
    if (!active) {
      throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'No active quest attempt to abandon.');
    }
    const updated = worldRepo.updateAttempt(userId, active.id, { status: 'abandoned', passed: false });
    res.json({ attempt: updated });
  } catch (err) {
    next(err);
  }
});

worldsRouter.post('/quests/:id/complete', idempotent(true), (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const quest = worldRepo.getQuest(userId, req.params.id);
    if (!quest) {
      throw new AppError(404, 'QUEST_NOT_FOUND', 'Quest not found.');
    }
    const attempt = worldRepo.getActiveAttempt(userId, quest.id);
    if (!attempt || !attempt.assessment_id) {
      throw new AppError(400, 'QUEST_NOT_STARTED', 'Start this quest before attempting completion.');
    }

    // Server-side completion_rules check (Blueprint C9)
    const questions = assessmentRepo.listQuestionsSecret(userId, attempt.assessment_id);
    const answers = assessmentRepo.listAnswersForAssessment(userId, attempt.assessment_id);
    const minItems = Math.min(questions.length, quest.completion_rules.min_items || 1);

    if (answers.length < minItems) {
      throw new AppError(
        422,
        'QUEST_REQUIREMENTS_NOT_MET',
        `Answer all ${minItems} quest check questions before completing this quest (${answers.length}/${minItems} answered).`,
      );
    }

    const totalScore = answers.reduce((s, a) => s + a.score, 0);
    const accuracy = totalScore / Math.max(1, questions.length);
    const minAccuracy = quest.completion_rules.min_accuracy ?? 0.5;
    const passed = accuracy >= minAccuracy;

    assessmentRepo.markAssessmentStatus(userId, attempt.assessment_id, 'evaluated', totalScore);

    let xpAward = null;
    let newAchievements = [] as ReturnType<typeof xpService.evaluateAchievements>;
    if (passed) {
      const key = String(req.headers['idempotency-key'] || `quest:${attempt.id}`);
      xpAward = xpService.awardXp({
        userId,
        amount: quest.xp_reward,
        sourceType: quest.kind === 'lesson' ? 'lesson' : 'challenge',
        sourceId: attempt.id,
        reason: `Completed quest: ${quest.title}`,
        idempotencyKey: key,
      });
      newAchievements = xpService.evaluateAchievements(userId, 'quest_completed');
    }

    const updatedAttempt = worldRepo.updateAttempt(userId, attempt.id, {
      status: passed ? 'completed' : 'failed',
      score: Math.round(accuracy * 100),
      passed,
      xpAwarded: xpAward?.amount || 0,
      progress: { accuracy_percent: Math.round(accuracy * 100), passed },
    });

    recommendationService.recompute(userId);

    res.json({
      attempt: updatedAttempt,
      passed,
      accuracy_percent: Math.round(accuracy * 100),
      required_percent: Math.round(minAccuracy * 100),
      xp_award: xpAward,
      new_achievements: newAchievements,
    });
  } catch (err) {
    next(err);
  }
});

worldsRouter.post('/boss/:attemptId/round-answer', idempotent(true), async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { question_id, answer, time_taken_ms } = req.body || {};
    if (!question_id || answer === undefined) {
      throw new AppError(422, 'VALIDATION_ERROR', 'question_id and answer are required.');
    }
    const key = String(req.headers['idempotency-key'] || '');
    const result = await bossService.submitBossAnswer({
      userId,
      attemptId: req.params.attemptId,
      questionId: String(question_id),
      answer: String(answer),
      timeTakenMs: Number(time_taken_ms || 0),
      idempotencyKey: key,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
