import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { identityRepo } from '../repositories/identityRepo.ts';
import { tutorRepo } from '../repositories/tutorRepo.ts';
import { tutorService } from '../services/tutor/tutorService.ts';

export const tutorRouter = Router();
tutorRouter.use(requireAuth);

tutorRouter.get('/tutor/conversations', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    res.json({ items: tutorRepo.listConversations(userId) });
  } catch (err) {
    next(err);
  }
});

tutorRouter.post('/tutor/conversations', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { title, document_ids, topic_id, explanation_style } = req.body || {};
    const prefs = identityRepo.getPreferences(userId);
    const conv = tutorRepo.createConversation({
      userId,
      title: typeof title === 'string' && title.trim() ? title.trim() : 'Study Session',
      documentIds: Array.isArray(document_ids) ? document_ids : [],
      topicId: topic_id || null,
      explanationStyle: explanation_style || prefs?.explanation_style || 'step_by_step',
    });
    res.status(201).json({ conversation: conv });
  } catch (err) {
    next(err);
  }
});

tutorRouter.get('/tutor/conversations/:id', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const conv = tutorRepo.getConversation(userId, req.params.id);
    if (!conv) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Tutor conversation not found.');
    }
    const messages = tutorRepo.listMessages(userId, conv.id);
    res.json({ conversation: conv, messages });
  } catch (err) {
    next(err);
  }
});

tutorRouter.delete('/tutor/conversations/:id', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const deleted = tutorRepo.deleteConversation(userId, req.params.id);
    if (!deleted) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Tutor conversation not found.');
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

tutorRouter.post('/tutor/chat', async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { conversation_id, message, explanation_style } = req.body || {};
    const result = await tutorService.sendMessage({
      userId,
      conversationId: String(conversation_id || ''),
      message: String(message || ''),
      explanationStyle: explanation_style,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

tutorRouter.post('/tutor/chat/stream', async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const { conversation_id, message, explanation_style } = req.body || {};
    const result = await tutorService.sendMessage({
      userId,
      conversationId: String(conversation_id || ''),
      message: String(message || ''),
      explanationStyle: explanation_style,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('meta', {
      grounding: result.assistant_message.grounding,
      model: result.assistant_message.model,
      provider_label: result.provider_label,
    });

    const words = result.assistant_message.content.split(' ');
    for (let i = 0; i < words.length; i += 6) {
      sendEvent('delta', { text: words.slice(i, i + 6).join(' ') + (i + 6 < words.length ? ' ' : '') });
    }

    sendEvent('citations', { sources: result.assistant_message.sources });
    sendEvent('done', result);
    res.end();
  } catch (err) {
    next(err);
  }
});
