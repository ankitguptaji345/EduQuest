import crypto from 'node:crypto';
import { AppError } from '../../core/errors.ts';
import { assessmentRepo, type QuestionSecret } from '../../repositories/assessmentRepo.ts';
import { documentRepo } from '../../repositories/documentRepo.ts';
import { topicRepo } from '../../repositories/topicRepo.ts';
import { worldRepo } from '../../repositories/worldRepo.ts';
import { getAIProvider } from '../ai/provider.ts';
import { misconceptionService } from '../misconceptions/misconceptionService.ts';
import { updateTopicMastery } from './quizService.ts';
import { recommendationService } from '../progress/recommendationService.ts';
import { xpService } from '../progress/xpService.ts';

export const bossService = {
  async startBossBattle(userId: string, questId: string) {
    const quest = worldRepo.getQuest(userId, questId);
    if (!quest || quest.kind !== 'boss') {
      throw new AppError(404, 'BOSS_QUEST_NOT_FOUND', 'Boss quest not found.');
    }

    // Check prerequisites
    const completedIds = worldRepo.getCompletedQuestIds(userId);
    const reqs = quest.unlock_rule.requires_completed || [];
    if (!reqs.every((id) => completedIds.has(id))) {
      throw new AppError(403, 'QUEST_LOCKED', 'Complete prerequisite quests before challenging the Boss.');
    }

    const active = worldRepo.getActiveAttempt(userId, quest.id);
    if (active && active.assessment_id) {
      const questions = assessmentRepo.listQuestionsPublic(userId, active.assessment_id);
      const answers = assessmentRepo.listAnswersForAssessment(userId, active.assessment_id);
      return { quest, attempt: active, questions, answers };
    }

    const topics = quest.topic_ids
      .map((id) => topicRepo.getTopic(userId, id))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    const docIds = Array.from(new Set(topics.map((t) => t.document_id)));
    const chunks = documentRepo.listChunksForDocuments(userId, docIds);
    const excludedHashes = assessmentRepo.getPriorQuestionHashes(userId);
    const provider = getAIProvider();

    // Generate 3 escalating rounds (2 questions per round = 6 questions total)
    const rounds: Array<{ round: number; diff: string }> = [
      { round: 1, diff: 'beginner' },
      { round: 2, diff: 'intermediate' },
      { round: 3, diff: 'advanced' },
    ];

    const allQuestions: QuestionSecret[] = [];
    const assessmentId = crypto.randomUUID();
    let position = 1;

    for (const r of rounds) {
      const drafts = await provider.generateQuestions({
        topics,
        chunks,
        count: 2,
        difficulty: r.diff,
        kind: 'boss',
        excludedHashes,
        roundNo: r.round,
      });
      for (const d of drafts) {
        allQuestions.push({
          id: crypto.randomUUID(),
          assessment_id: assessmentId,
          user_id: userId,
          topic_id: d.topic_id,
          position: position++,
          round_no: r.round,
          type: d.type,
          difficulty: r.diff,
          prompt: d.prompt,
          options: d.options,
          answer_key: d.answer_key,
          rubric: d.rubric,
          explanation: d.explanation,
          hints: d.hints,
          hints_count: d.hints.length,
          source_refs: d.source_refs,
          question_hash: d.question_hash,
        });
      }
    }

    assessmentRepo.createAssessmentWithQuestions({
      assessment: {
        id: assessmentId,
        user_id: userId,
        subject_id: topics[0]?.subject_id || null,
        document_id: topics[0]?.document_id || null,
        topic_ids: quest.topic_ids,
        kind: 'boss',
        status: 'in_progress',
        config: { rounds: 3, mastery_threshold: quest.mastery_threshold },
        parent_assessment_id: null,
        model: provider.modelName,
        prompt_version: 'rule-based-v1',
      },
      questions: allQuestions,
    });

    const attempt = worldRepo.createAttempt({
      userId,
      questId: quest.id,
      assessmentId,
      progress: { boss_hp: 100, player_hp: 100, current_round: 1 },
    });

    return {
      quest,
      attempt,
      questions: assessmentRepo.listQuestionsPublic(userId, assessmentId),
      answers: [],
    };
  },

  async submitBossAnswer(params: {
    userId: string;
    attemptId: string;
    questionId: string;
    answer: string;
    timeTakenMs?: number;
    idempotencyKey: string;
  }) {
    const attempt = worldRepo.getAttemptById(params.userId, params.attemptId);
    if (!attempt || !attempt.assessment_id) {
      throw new AppError(404, 'ATTEMPT_NOT_FOUND', 'Boss battle attempt not found.');
    }

    const quest = worldRepo.getQuest(params.userId, attempt.quest_id);
    if (!quest) {
      throw new AppError(404, 'QUEST_NOT_FOUND', 'Boss quest not found.');
    }

    const question = assessmentRepo.getQuestionSecret(
      params.userId,
      attempt.assessment_id,
      params.questionId,
    );
    if (!question) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', 'Boss question not found.');
    }

    const provider = getAIProvider();
    const evaluation = await provider.evaluateAnswer({
      question,
      studentAnswer: params.answer,
    });

    const studentAnswer = assessmentRepo.upsertStudentAnswer({
      id: crypto.randomUUID(),
      user_id: params.userId,
      assessment_id: attempt.assessment_id,
      question_id: question.id,
      topic_id: question.topic_id,
      difficulty: question.difficulty,
      answer: { value: params.answer },
      is_correct: evaluation.is_correct,
      score: evaluation.score,
      grading_method: evaluation.grading_method,
      feedback: evaluation.feedback,
      hints_used: 0,
      time_taken_ms: params.timeTakenMs || 0,
    });

    updateTopicMastery(params.userId, question.topic_id);

    let diagnosis = null;
    if (!evaluation.is_correct) {
      diagnosis = await misconceptionService.handleIncorrectAnswer({
        userId: params.userId,
        question,
        studentAnswerRow: studentAnswer,
        studentAnswerText: params.answer,
      });
    }

    const allQuestions = assessmentRepo.listQuestionsSecret(params.userId, attempt.assessment_id);
    const allAnswers = assessmentRepo.listAnswersForAssessment(params.userId, attempt.assessment_id);

    const totalQ = Math.max(1, allQuestions.length);
    const totalScore = allAnswers.reduce((s, a) => s + a.score, 0);
    const wrongCount = allAnswers.filter((a) => !a.is_correct).length;
    const bossHp = Math.max(0, Math.round(100 - (totalScore / totalQ) * 100));
    const playerHp = Math.max(0, Math.round(100 - (wrongCount / totalQ) * 100));
    const currentRound = Math.min(
      3,
      Math.max(1, ...allQuestions.filter((q) => !allAnswers.some((a) => a.question_id === q.id)).map((q) => q.round_no)),
    );

    const isFinished = allAnswers.length >= allQuestions.length;
    let battleResult = null;

    if (isFinished) {
      const accuracy = totalScore / totalQ;
      const passed = accuracy >= quest.mastery_threshold;
      const roundStats = [1, 2, 3].map((r) => {
        const rQs = allQuestions.filter((q) => q.round_no === r);
        const rAns = allAnswers.filter((a) => rQs.some((q) => q.id === a.question_id));
        const rScore = rAns.reduce((s, a) => s + a.score, 0);
        return {
          round: r,
          total: rQs.length,
          correct: rAns.filter((a) => a.is_correct).length,
          accuracy: rQs.length > 0 ? Math.round((rScore / rQs.length) * 100) : 0,
        };
      });

      let xpAward = null;
      let newAchievements = [] as ReturnType<typeof xpService.evaluateAchievements>;
      if (passed) {
        xpAward = xpService.awardXp({
          userId: params.userId,
          amount: quest.xp_reward,
          sourceType: 'boss',
          sourceId: attempt.id,
          reason: `Defeated ${quest.title} (${Math.round(accuracy * 100)}%)`,
          idempotencyKey: params.idempotencyKey || `boss:${attempt.id}`,
        });
        newAchievements = xpService.evaluateAchievements(params.userId, 'boss_defeated');
      }

      assessmentRepo.markAssessmentStatus(
        params.userId,
        attempt.assessment_id,
        'evaluated',
        totalScore,
      );

      worldRepo.updateAttempt(params.userId, attempt.id, {
        status: passed ? 'completed' : 'failed',
        score: Math.round(accuracy * 100),
        passed,
        xpAwarded: xpAward?.amount || 0,
        progress: { boss_hp: passed ? 0 : bossHp, player_hp: playerHp, current_round: 3 },
      });

      recommendationService.recompute(params.userId);

      battleResult = {
        passed,
        accuracy_percent: Math.round(accuracy * 100),
        threshold_percent: Math.round(quest.mastery_threshold * 100),
        round_stats: roundStats,
        xp_award: xpAward,
        new_achievements: newAchievements,
      };
    } else {
      worldRepo.updateAttempt(params.userId, attempt.id, {
        progress: { boss_hp: bossHp, player_hp: playerHp, current_round: currentRound },
      });
    }

    return {
      evaluation: {
        ...evaluation,
        student_answer: studentAnswer,
        source_refs: question.source_refs,
      },
      diagnosis,
      boss_hp: battleResult?.passed ? 0 : bossHp,
      player_hp: playerHp,
      current_round: currentRound,
      battle_result: battleResult,
    };
  },
};
