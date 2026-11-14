import crypto from 'node:crypto';
import { getDb } from '../core/database.ts';

export interface DocumentRow {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  original_filename: string;
  file_ext: 'pdf' | 'docx' | 'pptx' | 'txt';
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  sha256: string;
  page_count: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed' | 'deleting';
  failed_stage: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  ocr_used: number;
  text_char_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentJobRow {
  id: string;
  user_id: string;
  document_id: string | null;
  kind: 'process_document' | 'reprocess_document' | 'purge_account';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  stage: string;
  progress_current: number;
  progress_total: number;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  last_error_code: string | null;
  last_error_safe: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface DocumentChunkRow {
  id: string;
  user_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_estimate: number;
  source_kind: 'page' | 'slide' | 'section';
  source_start: number;
  source_end: number;
  heading_path: string;
  embedding: string | null;
  embedding_model: string | null;
  embedding_dim: number | null;
}

export interface DocumentAnalysisRow {
  document_id: string;
  user_id: string;
  summary: string;
  learning_objectives: string[];
  exam_questions: Array<{ prompt: string; topic: string; difficulty: string }>;
  analysis_version: string;
  model: string;
  prompt_version: string;
  created_at: string;
}

export const documentRepo = {
  findBySha256(userId: string, sha256: string): DocumentRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM documents WHERE user_id = ? AND sha256 = ? ORDER BY created_at DESC LIMIT 1')
      .get(userId, sha256) as unknown as DocumentRow | undefined;
  },

  createDocumentWithJob(params: {
    id: string;
    userId: string;
    subjectId: string | null;
    title: string;
    originalFilename: string;
    fileExt: 'pdf' | 'docx' | 'pptx' | 'txt';
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    sha256: string;
  }): { document: DocumentRow; job: DocumentJobRow } {
    const db = getDb();
    const jobId = crypto.randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO documents
         (id, user_id, subject_id, title, original_filename, file_ext, mime_type, size_bytes, storage_path, sha256, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`,
      ).run(
        params.id,
        params.userId,
        params.subjectId,
        params.title,
        params.originalFilename,
        params.fileExt,
        params.mimeType,
        params.sizeBytes,
        params.storagePath,
        params.sha256,
      );

      db.prepare(
        `INSERT INTO document_jobs (id, user_id, document_id, kind, status, stage)
         VALUES (?, ?, ?, 'process_document', 'queued', 'queued')`,
      ).run(jobId, params.userId, params.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    return {
      document: this.getDocument(params.userId, params.id)!,
      job: this.getJob(params.userId, jobId)!,
    };
  },

  listDocuments(userId: string, subjectId?: string | null, status?: string | null): DocumentRow[] {
    const db = getDb();
    let sql = 'SELECT * FROM documents WHERE user_id = ?';
    const args: Array<string> = [userId];
    if (subjectId) {
      sql += ' AND subject_id = ?';
      args.push(subjectId);
    }
    if (status) {
      sql += ' AND status = ?';
      args.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    return db.prepare(sql).all(...args) as unknown as DocumentRow[];
  },

  getDocument(userId: string, documentId: string): DocumentRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
      .get(documentId, userId) as unknown as DocumentRow | undefined;
  },

  getJob(userId: string, jobId: string): DocumentJobRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM document_jobs WHERE id = ? AND user_id = ?')
      .get(jobId, userId) as unknown as DocumentJobRow | undefined;
  },

  getLatestJobForDocument(userId: string, documentId: string): DocumentJobRow | undefined {
    const db = getDb();
    return db
      .prepare(
        'SELECT * FROM document_jobs WHERE document_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(documentId, userId) as unknown as DocumentJobRow | undefined;
  },

  createReprocessJob(userId: string, documentId: string, resumeStage = 'queued'): DocumentJobRow {
    const db = getDb();
    const jobId = crypto.randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE documents SET status = 'uploaded', failed_stage = NULL, error_code = NULL, error_message_safe = NULL, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      ).run(documentId, userId);

      db.prepare(
        `INSERT INTO document_jobs (id, user_id, document_id, kind, status, stage)
         VALUES (?, ?, ?, 'reprocess_document', 'queued', ?)`,
      ).run(jobId, userId, documentId, resumeStage);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return this.getJob(userId, jobId)!;
  },

  updateDocumentProcessing(
    userId: string,
    documentId: string,
    patch: {
      status?: DocumentRow['status'];
      pageCount?: number;
      textCharCount?: number;
      ocrUsed?: number;
      failedStage?: string | null;
      errorCode?: string | null;
      errorMessageSafe?: string | null;
    },
  ): void {
    const db = getDb();
    const doc = this.getDocument(userId, documentId);
    if (!doc) return;
    db.prepare(
      `UPDATE documents
       SET status = ?, page_count = ?, text_char_count = ?, ocr_used = ?, failed_stage = ?, error_code = ?, error_message_safe = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    ).run(
      patch.status ?? doc.status,
      patch.pageCount ?? doc.page_count,
      patch.textCharCount ?? doc.text_char_count,
      patch.ocrUsed ?? doc.ocr_used,
      patch.failedStage !== undefined ? patch.failedStage : doc.failed_stage,
      patch.errorCode !== undefined ? patch.errorCode : doc.error_code,
      patch.errorMessageSafe !== undefined ? patch.errorMessageSafe : doc.error_message_safe,
      documentId,
      userId,
    );
  },

  replaceChunks(
    userId: string,
    documentId: string,
    chunks: Array<{
      id: string;
      chunkIndex: number;
      content: string;
      tokenEstimate: number;
      sourceKind: 'page' | 'slide' | 'section';
      sourceStart: number;
      sourceEnd: number;
      headingPath: string;
    }>,
  ): void {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM document_chunks WHERE document_id = ? AND user_id = ?').run(
        documentId,
        userId,
      );
      const stmt = db.prepare(
        `INSERT INTO document_chunks
         (id, user_id, document_id, chunk_index, content, token_estimate, source_kind, source_start, source_end, heading_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of chunks) {
        stmt.run(
          c.id,
          userId,
          documentId,
          c.chunkIndex,
          c.content,
          c.tokenEstimate,
          c.sourceKind,
          c.sourceStart,
          c.sourceEnd,
          c.headingPath,
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  listChunksForDocument(userId: string, documentId: string): DocumentChunkRow[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM document_chunks WHERE user_id = ? AND document_id = ? ORDER BY chunk_index ASC')
      .all(userId, documentId) as unknown as DocumentChunkRow[];
  },

  listChunksForDocuments(userId: string, documentIds: string[]): DocumentChunkRow[] {
    const db = getDb();
    if (documentIds.length === 0) {
      return db
        .prepare('SELECT * FROM document_chunks WHERE user_id = ? ORDER BY chunk_index ASC')
        .all(userId) as unknown as DocumentChunkRow[];
    }
    const placeholders = documentIds.map(() => '?').join(',');
    return db
      .prepare(
        `SELECT * FROM document_chunks WHERE user_id = ? AND document_id IN (${placeholders}) ORDER BY chunk_index ASC`,
      )
      .all(userId, ...documentIds) as unknown as DocumentChunkRow[];
  },

  getChunk(userId: string, documentId: string, chunkId: string): DocumentChunkRow | undefined {
    const db = getDb();
    return db
      .prepare('SELECT * FROM document_chunks WHERE id = ? AND document_id = ? AND user_id = ?')
      .get(chunkId, documentId, userId) as unknown as DocumentChunkRow | undefined;
  },

  upsertAnalysis(params: {
    documentId: string;
    userId: string;
    summary: string;
    learningObjectives: string[];
    examQuestions: Array<{ prompt: string; topic: string; difficulty: string }>;
    model: string;
    promptVersion: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO document_analyses
       (document_id, user_id, summary, learning_objectives, exam_questions, analysis_version, model, prompt_version)
       VALUES (?, ?, ?, ?, ?, '1.0', ?, ?)`,
    ).run(
      params.documentId,
      params.userId,
      params.summary,
      JSON.stringify(params.learningObjectives),
      JSON.stringify(params.examQuestions),
      params.model,
      params.promptVersion,
    );
  },

  getAnalysis(userId: string, documentId: string): DocumentAnalysisRow | undefined {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM document_analyses WHERE document_id = ? AND user_id = ?')
      .get(documentId, userId) as
      | {
          document_id: string;
          user_id: string;
          summary: string;
          learning_objectives: string;
          exam_questions: string;
          analysis_version: string;
          model: string;
          prompt_version: string;
          created_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      ...row,
      learning_objectives: JSON.parse(row.learning_objectives),
      exam_questions: JSON.parse(row.exam_questions),
    };
  },

  deleteDocument(userId: string, documentId: string): DocumentRow | undefined {
    const db = getDb();
    const existing = this.getDocument(userId, documentId);
    if (!existing) return undefined;
    db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(documentId, userId);
    return existing;
  },
};
