import crypto from 'node:crypto';
import { getDb } from '../core/database.ts';
import type { SourceRef } from './topicRepo.ts';

export interface TutorCitation extends SourceRef {
  document_id: string;
  excerpt: string;
}

export interface TutorConversationRow {
  id: string;
  user_id: string;
  title: string;
  document_ids: string[];
  topic_id: string | null;
  explanation_style: string;
  message_count: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TutorMessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: TutorCitation[];
  grounding: 'document' | 'mixed' | 'general' | 'not_in_document';
  status: 'complete' | 'partial' | 'error';
  model: string;
  prompt_version: string;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
}

function hydrateConv(r: Record<string, unknown>): TutorConversationRow {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    title: String(r.title),
    document_ids: JSON.parse(String(r.document_ids || '[]')),
    topic_id: r.topic_id ? String(r.topic_id) : null,
    explanation_style: String(r.explanation_style),
    message_count: Number(r.message_count || 0),
    archived_at: r.archived_at ? String(r.archived_at) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function hydrateMsg(r: Record<string, unknown>): TutorMessageRow {
  return {
    id: String(r.id),
    conversation_id: String(r.conversation_id),
    user_id: String(r.user_id),
    role: r.role as 'user' | 'assistant',
    content: String(r.content),
    sources: JSON.parse(String(r.sources || '[]')),
    grounding: r.grounding as TutorMessageRow['grounding'],
    status: r.status as TutorMessageRow['status'],
    model: String(r.model),
    prompt_version: String(r.prompt_version),
    tokens_in: Number(r.tokens_in || 0),
    tokens_out: Number(r.tokens_out || 0),
    created_at: String(r.created_at),
  };
}

export const tutorRepo = {
  listConversations(userId: string): TutorConversationRow[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM tutor_conversations
         WHERE user_id = ? AND archived_at IS NULL
         ORDER BY updated_at DESC`,
      )
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map(hydrateConv);
  },

  getConversation(userId: string, conversationId: string): TutorConversationRow | undefined {
    const db = getDb();
    const r = db
      .prepare('SELECT * FROM tutor_conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId) as Record<string, unknown> | undefined;
    return r ? hydrateConv(r) : undefined;
  },

  createConversation(params: {
    userId: string;
    title: string;
    documentIds: string[];
    topicId?: string | null;
    explanationStyle: string;
  }): TutorConversationRow {
    const db = getDb();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO tutor_conversations (id, user_id, title, document_ids, topic_id, explanation_style)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      params.userId,
      params.title,
      JSON.stringify(params.documentIds),
      params.topicId ?? null,
      params.explanationStyle,
    );
    return this.getConversation(params.userId, id)!;
  },

  updateConversationStyle(userId: string, conversationId: string, style: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE tutor_conversations SET explanation_style = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).run(style, conversationId, userId);
  },

  deleteConversation(userId: string, conversationId: string): boolean {
    const db = getDb();
    const res = db
      .prepare('DELETE FROM tutor_conversations WHERE id = ? AND user_id = ?')
      .run(conversationId, userId);
    return res.changes > 0;
  },

  listMessages(userId: string, conversationId: string): TutorMessageRow[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM tutor_messages
         WHERE user_id = ? AND conversation_id = ?
         ORDER BY created_at ASC`,
      )
      .all(userId, conversationId) as Array<Record<string, unknown>>;
    return rows.map(hydrateMsg);
  },

  appendMessage(params: {
    userId: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: TutorCitation[];
    grounding?: TutorMessageRow['grounding'];
    model?: string;
    promptVersion?: string;
  }): TutorMessageRow {
    const db = getDb();
    const id = crypto.randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO tutor_messages
         (id, conversation_id, user_id, role, content, sources, grounding, status, model, prompt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?)`,
      ).run(
        id,
        params.conversationId,
        params.userId,
        params.role,
        params.content,
        JSON.stringify(params.sources || []),
        params.grounding || 'document',
        params.model || 'rule-based-v1',
        params.promptVersion || 'rule-based-v1',
      );
      db.prepare(
        `UPDATE tutor_conversations
         SET message_count = message_count + 1, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      ).run(params.conversationId, params.userId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const row = db
      .prepare('SELECT * FROM tutor_messages WHERE id = ? AND user_id = ?')
      .get(id, params.userId) as Record<string, unknown>;
    return hydrateMsg(row);
  },
};
