import crypto from 'node:crypto';
import { AppError } from '../../core/errors.ts';
import { assessmentRepo, type QuestionSecret } from '../../repositories/assessmentRepo.ts';
import { documentRepo } from '../../repositories/documentRepo.ts';
import { topicRepo } from '../../repositories/topicRepo.ts';
import { getAIProvider } from '../ai/provider.ts';
import { misconceptionService } from '../misconceptions/misconceptionService.ts';
import { recommendationService } from '../progress/recommendationService.ts';
import { xpService } from '../progress/xpService.ts';

export function updateTopicMastery(userId: string, topicId: string | null): void {
  if (!topicId) return;
  const topic = topicRepo.getTopic(userId, topicId);
  const answers = assessmentRepo.listAnswersForTopic(userId, topicId);
  if (answers.length === 0) return;

  const diffWeight: Record<string, number> = {
    beginner: 1.0,
    intermediate: 1.25,
    advanced: 1.5,
  };

  let weightedSum = 0;
  let weightTotal = 0;
  let correctCount = 0;
  let hintPenaltyTotal = 0;

  // Exponential recency decay (newest answers weighted higher)
  answers.forEach((ans, idx) => {
    const recencyWeight = Math.pow(0.88, idx);
    const dw = diffWeight[ans.difficulty] || 1.0;
    const w = recencyWeight * dw;
    const hintPenalty = Math.min(0.3, ans.hints_used * 0.1);
    hintPenaltyTotal += hintPenalty;
    const effective = Math.max(0, ans.score - hintPenalty);
    weightedSum += effective * w;
    weightTotal += w;
    if (ans.is_correct) correctCount += 1;
  });

  const score = Number(((weightedSum / Math.max(0.001, weightTotal)) * 100).toFixed(2));
  const evidenceCount = answers.length;
  const confidence = Number(Math.min(1, evidenceCount / 6).toFixed(2));

  let band: 'unassessed' | 'weak' | 'needs_practice' | 'developing' | 'strong' = 'developing';
  if (evidenceCount === 0) band = 'unassessed';
  else if (score < 45) band = 'weak';
  else if (score < 65) band = 'needs_practice';
  else if (score >= 80 && confidence >= 0.5) band = 'strong';
  else band = 'developing';

  const daysUntilReview = band === 'strong' ? 7 : band === 'developing' ? 3 : 1;
  const nextReview = new Date(Date.now() + daysUntilReview * 86400_000).toISOString();

  topicRepo.upsertMastery({
    id: topicRepo.getMasteryForTopic(userId, topicId)?.id || crypto.randomUUID(),
    user_id: userId,
    topic_id: topicId,
    topic_name_snapshot: topic?.name || 'Archived Topic',
    score,
    confidence,
    band,
    evidence_count: evidenceCount,
    correct_count: correctCount,
    last_practiced_at: new Date().toISOString(),
    next_review_at: nextReview,
    breakdown: {
      raw_accuracy: Number((correctCount / evidenceCount).toFixed(2)),
      difficulty_weighted_score: score,
      hint_penalty_total: Number(hintPenaltyTotal.toFixed(2)),
      last_5_outcomes: answers.slice(0, 5).map((a) => (a.is_correct ? 1 : 0)),
    },
    updated_at: new Date().toISOString(),
  });
}

export const quizService = {
  async createAssessment(params: {
    userId: string;
    kind: 'diagnostic' | 'practice' | 'quest_check' | 'boss' | 'corrective';
    documentId?: string | null;
    topicIds?: string[];
    questionCount?: number;
    difficulty?: string;
    roundNo?: number;
  }) {
    const count = Math.max(1, Math.min(20, params.questionCount || 5));
    const docId = params.documentId || null;
    let topics = params.topicIds?.length
      ? params.topicIds.map((id) => topicRepo.getTopic(params.userId, id)).filter((t): t is NonNullable<typeof t> => Boolean(t))
      : docId
        ? topicRepo.listTopics(params.userId, { documentId: docId })
        : topicRepo.listTopics(params.userId);

    if (topics.length === 0) {
      throw new AppError(
        422,
        'NO_TOPICS_AVAILABLE',
        'No extracted topics found. Please upload and process a study document first.',
      );
    }

    const docIds = Array.from(new Set(topics.map((t) => t.document_id)));
    const chunks = documentRepo.listChunksForDocuments(params.userId, docIds);
    const excludedHashes = assessmentRepo.getPriorQuestionHashes(params.userId);

    const provider = getAIProvider();
    const drafts = await provider.generateQuestions({
      topics,
      chunks,
      count,
      difficulty: params.difficulty,
      kind: params.kind,
      excludedHashes,
      roundNo: params.roundNo || 1,
    });

    if (drafts.length === 0) {
      throw new AppError(
        422,
        'INSUFFICIENT_EDUCATIONAL_CONTENT',
        'Could not generate meaningful educational questions from the selected study material. Ensure the document contains concepts, code, definitions, or theory beyond cover pages.',
      );
    }

    const assessmentId = crypto.randomUUID();
    const questions: QuestionSecret[] = drafts.map((d, idx) => ({
      id: crypto.randomUUID(),
      assessment_id: assessmentId,
      user_id: params.userId,
      topic_id: d.topic_id,
      position: idx + 1,
      round_no: d.round_no,
      type: d.type,
      difficulty: d.difficulty,
      prompt: d.prompt,
      options: d.options,
      answer_key: d.answer_key,
      rubric: d.rubric,
      explanation: d.explanation,
      hints: d.hints,
      hints_count: d.hints.length,
      source_refs: d.source_refs,
      question_hash: d.question_hash,
    }));

    const assessment = assessmentRepo.createAssessmentWithQuestions({
      assessment: {
        id: assessmentId,
        user_id: params.userId,
        subject_id: topics[0]?.subject_id || null,
        document_id: docId || topics[0]?.document_id || null,
        topic_ids: topics.map((t) => t.id),
        kind: params.kind,
        status: 'in_progress',
        config: { count: questions.length, difficulty: params.difficulty || 'mixed' },
        parent_assessment_id: null,
        model: provider.modelName,
        prompt_version: 'rule-based-v1',
      },
      questions,
    });

    const topicMap = new Map(topics.map((t) => [t.id, t]));
    return {
      assessment,
      questions: assessmentRepo.listQuestionsPublic(params.userId, assessment.id).map((q) => ({
        ...q,
        topic_name: q.topic_id ? topicMap.get(q.topic_id)?.name || null : null,
      })),
    };
  },

  async submitAnswer(params: {
    userId: string;
    assessmentId: string;
    questionId: string;
    answer: string;
    hintsUsed?: number;
    timeTakenMs?: number;
  }) {
    const assessment = assessmentRepo.getAssessment(params.userId, params.assessmentId);
    if (!assessment) {
      throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found.');
    }

    const question = assessmentRepo.getQuestionSecret(
      params.userId,
      params.assessmentId,
      params.questionId,
    );
    if (!question) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', 'Question not found in this assessment.');
    }

    const existing = assessmentRepo.getStudentAnswer(
      params.userId,
      params.assessmentId,
      params.questionId,
    );
    if (existing) {
      return {
        student_answer: existing,
        correct_answer: question.answer_key.correct,
        explanation: question.explanation,
        diagnosis: null,
      };
    }

    const provider = getAIProvider();
    const evaluation = await provider.evaluateAnswer({
      question,
      studentAnswer: params.answer,
    });

    const studentAnswer = assessmentRepo.upsertStudentAnswer({
      id: crypto.randomUUID(),
      user_id: params.userId,
      assessment_id: params.assessmentId,
      question_id: params.questionId,
      topic_id: question.topic_id,
      difficulty: question.difficulty,
      answer: { value: params.answer },
      is_correct: evaluation.is_correct,
      score: evaluation.score,
      grading_method: evaluation.grading_method,
      feedback: evaluation.feedback,
      hints_used: params.hintsUsed || 0,
      time_taken_ms: params.timeTakenMs || 0,
    });

    updateTopicMastery(params.userId, question.topic_id);

    let diagnosis: Awaited<ReturnType<typeof misconceptionService.handleIncorrectAnswer>> | null =
      null;
    if (!evaluation.is_correct || evaluation.score < 1) {
      diagnosis = await misconceptionService.handleIncorrectAnswer({
        userId: params.userId,
        question,
        studentAnswerRow: studentAnswer,
        studentAnswerText: params.answer,
      });
    }

    recommendationService.recompute(params.userId);

    return {
      student_answer: studentAnswer,
      correct_answer: evaluation.correct_answer,
      explanation: evaluation.explanation,
      source_refs: question.source_refs,
      diagnosis,
    };
  },

  completeAssessment(params: { userId: string; assessmentId: string; idempotencyKey: string }) {
    const assessment = assessmentRepo.getAssessment(params.userId, params.assessmentId);
    if (!assessment) {
      throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found.');
    }

    const questions = assessmentRepo.listQuestionsSecret(params.userId, assessment.id);
    const answers = assessmentRepo.listAnswersForAssessment(params.userId, assessment.id);
    const totalScore = answers.reduce((s, a) => s + a.score, 0);
    const maxScore = Math.max(1, questions.length);
    const percentage = Math.round((totalScore / maxScore) * 100);

    const updated = assessmentRepo.markAssessmentStatus(
      params.userId,
      assessment.id,
      'evaluated',
      totalScore,
    )!;

    const xpEarned = Math.max(15, Math.round(totalScore * 20));
    const xpAward = xpService.awardXp({
      userId: params.userId,
      amount: xpEarned,
      sourceType: 'assessment',
      sourceId: assessment.id,
      reason: `Completed ${assessment.kind} assessment (${percentage}%)`,
      idempotencyKey: params.idempotencyKey || `assess:${assessment.id}`,
    });

    const achievements = [
      ...xpService.evaluateAchievements(params.userId, 'assessment_completed'),
      ...(percentage === 100
        ? xpService.evaluateAchievements(params.userId, 'perfect_assessment')
        : []),
    ];

    recommendationService.recompute(params.userId);

    return {
      assessment: updated,
      percentage,
      xp_award: xpAward,
      new_achievements: achievements,
    };
  },
};
