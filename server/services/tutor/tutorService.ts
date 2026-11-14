import { AppError } from '../../core/errors.ts';
import { documentRepo } from '../../repositories/documentRepo.ts';
import { identityRepo } from '../../repositories/identityRepo.ts';
import { progressRepo } from '../../repositories/progressRepo.ts';
import { topicRepo } from '../../repositories/topicRepo.ts';
import { tutorRepo } from '../../repositories/tutorRepo.ts';
import { getAIProvider } from '../ai/provider.ts';
import { xpService } from '../progress/xpService.ts';

export const tutorService = {
  async sendMessage(params: {
    userId: string;
    conversationId: string;
    message: string;
    explanationStyle?: string;
  }) {
    const conv = tutorRepo.getConversation(params.userId, params.conversationId);
    if (!conv) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Tutor conversation not found.');
    }

    const cleanMessage = params.message.trim();
    if (!cleanMessage) {
      throw new AppError(422, 'EMPTY_MESSAGE', 'Message cannot be empty.');
    }

    const style =
      params.explanationStyle ||
      conv.explanation_style ||
      identityRepo.getPreferences(params.userId)?.explanation_style ||
      'step_by_step';

    if (params.explanationStyle && params.explanationStyle !== conv.explanation_style) {
      tutorRepo.updateConversationStyle(params.userId, conv.id, style);
    }

    const userMsg = tutorRepo.appendMessage({
      userId: params.userId,
      conversationId: conv.id,
      role: 'user',
      content: cleanMessage,
      grounding: 'document',
    });

    const chunks = documentRepo.listChunksForDocuments(params.userId, conv.document_ids);
    const topics = topicRepo.listTopics(
      params.userId,
      conv.document_ids.length === 1 ? { documentId: conv.document_ids[0] } : undefined,
    );
    const history = tutorRepo.listMessages(params.userId, conv.id);

    const t0 = Date.now();
    const provider = getAIProvider();
    const reply = await provider.answerTutor({
      query: cleanMessage,
      chunks,
      topics,
      explanationStyle: style,
      history,
    });
    const latency = Date.now() - t0;

    const assistantMsg = tutorRepo.appendMessage({
      userId: params.userId,
      conversationId: conv.id,
      role: 'assistant',
      content: reply.content,
      sources: reply.citations,
      grounding: reply.grounding,
      model: reply.model,
      promptVersion: 'rule-based-v1',
    });

    progressRepo.logAiUsage({
      userId: params.userId,
      feature: 'tutor_chat',
      model: reply.model,
      tokensIn: Math.ceil(cleanMessage.length / 4),
      tokensOut: Math.ceil(reply.content.length / 4),
      latencyMs: latency,
      status: 'succeeded',
    });

    if (reply.citations.length > 0) {
      xpService.evaluateAchievements(params.userId, 'tutor_citation');
    }

    return {
      user_message: userMsg,
      assistant_message: assistantMsg,
      follow_ups: reply.followUps,
      provider_label: reply.providerLabel,
    };
  },
};
