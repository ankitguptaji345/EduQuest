import crypto from 'node:crypto';
import { AppError } from '../../core/errors.ts';
import {
  assessmentRepo,
  type QuestionSecret,
  type StudentAnswerRow,
} from '../../repositories/assessmentRepo.ts';
import { documentRepo } from '../../repositories/documentRepo.ts';
import { misconceptionRepo } from '../../repositories/misconceptionRepo.ts';
import { topicRepo } from '../../repositories/topicRepo.ts';
import { getAIProvider } from '../ai/provider.ts';
import { updateTopicMastery } from '../assessments/quizService.ts';
import { recommendationService } from '../progress/recommendationService.ts';
import { xpService } from '../progress/xpService.ts';

export const misconceptionService = {
  async handleIncorrectAnswer(params: {
    userId: string;
    question: QuestionSecret;
    studentAnswerRow: StudentAnswerRow;
    studentAnswerText: string;
  }) {
    const topic = params.question.topic_id
      ? topicRepo.getTopic(params.userId, params.question.topic_id)
      : undefined;
    const allUserTopics = topicRepo.listTopics(params.userId);
    const topicChunks = topic
      ? documentRepo.listChunksForDocument(params.userId, topic.document_id)
      : [];
    const priorMastery = params.question.topic_id
      ? topicRepo.getMasteryForTopic(params.userId, params.question.topic_id)?.score || 0
      : 0;

    const provider = getAIProvider();
    const diagnosis = await provider.diagnoseMisconception({
      question: params.question,
      studentAnswer: params.studentAnswerText,
      topic,
      allUserTopics,
      topicChunks,
      priorTopicScore: priorMastery,
    });

    // Create corrective follow-up assessment & question (answer_key stays server-side!)
    const followUpAssessmentId = crypto.randomUUID();
    const followUpQuestionId = crypto.randomUUID();
    const fq = diagnosis.follow_up_question;

    assessmentRepo.createAssessmentWithQuestions({
      assessment: {
        id: followUpAssessmentId,
        user_id: params.userId,
        subject_id: topic?.subject_id || null,
        document_id: topic?.document_id || null,
        topic_ids: topic ? [topic.id] : [],
        kind: 'corrective',
        status: 'in_progress',
        config: { misconception_key: diagnosis.misconception_key },
        parent_assessment_id: params.question.assessment_id,
        model: diagnosis.model,
        prompt_version: 'rule-based-v1',
      },
      questions: [
        {
          id: followUpQuestionId,
          assessment_id: followUpAssessmentId,
          user_id: params.userId,
          topic_id: fq.topic_id,
          position: 1,
          round_no: 1,
          type: fq.type,
          difficulty: fq.difficulty,
          prompt: fq.prompt,
          options: fq.options,
          answer_key: fq.answer_key,
          rubric: fq.rubric,
          explanation: fq.explanation,
          hints: fq.hints,
          hints_count: fq.hints.length,
          source_refs: fq.source_refs,
          question_hash: fq.question_hash,
        },
      ],
    });

    const { thread, record } = misconceptionRepo.upsertThreadAndRecord({
      userId: params.userId,
      topicId: params.question.topic_id,
      topicName: topic?.name || 'Core Concept',
      misconceptionKey: diagnosis.misconception_key,
      label: diagnosis.label,
      causeClass: diagnosis.cause_class,
      confidence: diagnosis.confidence,
      explanation: diagnosis.explanation,
      recommendedAction: diagnosis.recommended_action,
      correctiveLesson: diagnosis.corrective_lesson,
      followUpAssessmentId,
      followUpQuestionId,
      answerId: params.studentAnswerRow.id,
      questionId: params.question.id,
      concept: diagnosis.concept,
      model: diagnosis.model,
    });

    return { thread, record };
  },

  getThreadDetail(userId: string, threadId: string) {
    const thread = misconceptionRepo.getThread(userId, threadId);
    if (!thread) {
      throw new AppError(404, 'MISCONCEPTION_NOT_FOUND', 'Misconception thread not found.');
    }

    const records = misconceptionRepo.listRecordsForThread(userId, thread.id);
    const followUpQuestions = thread.follow_up_assessment_id
      ? assessmentRepo.listQuestionsPublic(userId, thread.follow_up_assessment_id)
      : [];

    return {
      thread,
      records,
      follow_up_assessment_id: thread.follow_up_assessment_id,
      follow_up_question: followUpQuestions[0] || null,
    };
  },

  async submitCorrectiveAnswer(params: {
    userId: string;
    threadId: string;
    questionId: string;
    answer: string;
    idempotencyKey: string;
  }) {
    const thread = misconceptionRepo.getThread(params.userId, params.threadId);
    if (!thread || !thread.follow_up_assessment_id) {
      throw new AppError(404, 'MISCONCEPTION_NOT_FOUND', 'Corrective follow-up not found.');
    }

    const question = assessmentRepo.getQuestionSecret(
      params.userId,
      thread.follow_up_assessment_id,
      params.questionId,
    );
    if (!question) {
      throw new AppError(404, 'QUESTION_NOT_FOUND', 'Follow-up verification question not found.');
    }

    const provider = getAIProvider();
    const evaluation = await provider.evaluateAnswer({
      question,
      studentAnswer: params.answer,
    });

    assessmentRepo.upsertStudentAnswer({
      id: crypto.randomUUID(),
      user_id: params.userId,
      assessment_id: thread.follow_up_assessment_id,
      question_id: question.id,
      topic_id: thread.topic_id,
      difficulty: question.difficulty,
      answer: { value: params.answer },
      is_correct: evaluation.is_correct,
      score: evaluation.score,
      grading_method: evaluation.grading_method,
      feedback: evaluation.feedback,
      hints_used: 0,
      time_taken_ms: 0,
    });

    updateTopicMastery(params.userId, thread.topic_id);

    let nextStatus = thread.status;
    let xpAward = null;
    let newAchievements = [] as ReturnType<typeof xpService.evaluateAchievements>;

    if (evaluation.is_correct) {
      // Transition: suspected/confirmed -> improving -> resolved
      nextStatus = thread.status === 'confirmed' || thread.status === 'persistent'
        ? 'resolved'
        : thread.status === 'improving'
          ? 'resolved'
          : 'resolved';

      misconceptionRepo.updateThreadStatus(params.userId, thread.id, nextStatus);
      assessmentRepo.markAssessmentStatus(
        params.userId,
        thread.follow_up_assessment_id,
        'evaluated',
        evaluation.score,
      );

      xpAward = xpService.awardXp({
        userId: params.userId,
        amount: 35,
        sourceType: 'improvement',
        sourceId: thread.id,
        reason: `Resolved misconception: ${thread.label}`,
        idempotencyKey: params.idempotencyKey || `misconception:${thread.id}:resolved`,
      });
      newAchievements = xpService.evaluateAchievements(params.userId, 'misconception_resolved');
    } else {
      misconceptionRepo.updateThreadStatus(params.userId, thread.id, 'confirmed');
    }

    recommendationService.recompute(params.userId);

    return {
      is_correct: evaluation.is_correct,
      feedback: evaluation.feedback,
      correct_answer: evaluation.correct_answer,
      explanation: evaluation.explanation,
      thread: misconceptionRepo.getThread(params.userId, thread.id)!,
      xp_award: xpAward,
      new_achievements: newAchievements,
    };
  },
};
