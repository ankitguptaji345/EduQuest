import crypto from 'node:crypto';
import multer from 'multer';
import { Router } from 'express';
import { config } from '../core/config.ts';
import { AppError } from '../core/errors.ts';
import { requireAuth, type AuthenticatedRequest } from '../core/security.ts';
import { storage } from '../core/storage.ts';
import { documentRepo } from '../repositories/documentRepo.ts';
import { topicRepo } from '../repositories/topicRepo.ts';
import { validateUploadBuffer } from '../services/documents/validator.ts';
import { jobWorker } from '../core/jobQueue.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

documentsRouter.post('/documents/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const file = req.file;
    if (!file) {
      throw new AppError(400, 'MISSING_FILE', 'Multipart field "file" is required.');
    }

    const validated = await validateUploadBuffer({
      originalFilename: file.originalname,
      declaredMime: file.mimetype,
      buffer: file.buffer,
    });

    const duplicate = documentRepo.findBySha256(userId, validated.sha256);
    const documentId = crypto.randomUUID();
    const storagePath = storage.getStoragePath(userId, documentId, validated.ext);

    await storage.saveFile(storagePath, validated.buffer);

    const rawTitle = typeof req.body?.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : file.originalname.replace(/\.[^.]+$/, '');
    const subjectId =
      typeof req.body?.subject_id === 'string' && req.body.subject_id.trim()
        ? req.body.subject_id.trim()
        : null;

    const { document, job } = documentRepo.createDocumentWithJob({
      id: documentId,
      userId,
      subjectId,
      title: rawTitle,
      originalFilename: file.originalname,
      fileExt: validated.ext,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      storagePath,
      sha256: validated.sha256,
    });

    // Kick worker immediately in background without blocking 202 response (Blueprint C6)
    setImmediate(() => {
      void jobWorker.tick();
    });

    res.status(202).json({
      document,
      job,
      duplicate_warning: duplicate
        ? {
            existing_document_id: duplicate.id,
            existing_title: duplicate.title,
            message: `This file matches "${duplicate.title}" already in your library.`,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/documents', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const subjectId = typeof req.query.subject_id === 'string' ? req.query.subject_id : null;
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const docs = documentRepo.listDocuments(userId, subjectId, status);
    const enriched = docs.map((d) => ({
      ...d,
      latest_job: documentRepo.getLatestJobForDocument(userId, d.id) || null,
    }));
    res.json({ items: enriched });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/documents/:id', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const doc = documentRepo.getDocument(userId, req.params.id);
    if (!doc) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Study material not found.');
    }
    const job = documentRepo.getLatestJobForDocument(userId, doc.id) || null;
    const analysis = documentRepo.getAnalysis(userId, doc.id) || null;
    const topics = topicRepo.listTopics(userId, { documentId: doc.id });
    const chunks = documentRepo.listChunksForDocument(userId, doc.id).map((c) => ({
      id: c.id,
      chunk_index: c.chunk_index,
      source_kind: c.source_kind,
      source_start: c.source_start,
      heading_path: c.heading_path,
      token_estimate: c.token_estimate,
      preview: c.content.slice(0, 180),
    }));
    res.json({ document: doc, job, analysis, topics, chunks });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/documents/:id/job', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const doc = documentRepo.getDocument(userId, req.params.id);
    if (!doc) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Study material not found.');
    }
    const job = documentRepo.getLatestJobForDocument(userId, doc.id);
    res.json({ document_status: doc.status, job });
  } catch (err) {
    next(err);
  }
});

documentsRouter.post('/documents/:id/reprocess', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const doc = documentRepo.getDocument(userId, req.params.id);
    if (!doc) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Study material not found.');
    }
    const existingActive = documentRepo.getLatestJobForDocument(userId, doc.id);
    if (existingActive && (existingActive.status === 'queued' || existingActive.status === 'running')) {
      res.status(202).json({ document: doc, job: existingActive });
      return;
    }
    const job = documentRepo.createReprocessJob(userId, doc.id, doc.failed_stage || 'queued');
    setImmediate(() => {
      void jobWorker.tick();
    });
    res.status(202).json({ document: doc, job });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/documents/:id/chunks/:chunkId', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const chunk = documentRepo.getChunk(userId, req.params.id, req.params.chunkId);
    if (!chunk) {
      throw new AppError(404, 'CHUNK_NOT_FOUND', 'Document excerpt not found.');
    }
    const doc = documentRepo.getDocument(userId, req.params.id);
    res.json({
      chunk,
      document_title: doc?.title || 'Study Material',
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/documents/:id/file', async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const doc = documentRepo.getDocument(userId, req.params.id);
    if (!doc) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Study material not found.');
    }
    const buffer = await storage.readFile(doc.storage_path);
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.original_filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete('/documents/:id', async (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const deleted = documentRepo.deleteDocument(userId, req.params.id);
    if (!deleted) {
      throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Study material not found.');
    }
    await storage.deleteFile(deleted.storage_path);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Topics & Mastery endpoints
documentsRouter.get('/topics', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const documentId = typeof req.query.document_id === 'string' ? req.query.document_id : undefined;
    const subjectId = typeof req.query.subject_id === 'string' ? req.query.subject_id : undefined;
    const topics = topicRepo.listTopics(userId, { documentId, subjectId });
    const masteryMap = new Map(
      topicRepo.listMastery(userId).map((m) => [m.topic_id, m]),
    );
    res.json({
      items: topics.map((t) => ({
        ...t,
        mastery: masteryMap.get(t.id) || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/topics/:id', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const topic = topicRepo.getTopic(userId, req.params.id);
    if (!topic) {
      throw new AppError(404, 'TOPIC_NOT_FOUND', 'Topic not found.');
    }
    const relations = topicRepo.listRelationsForTopic(userId, topic.id);
    const mastery = topicRepo.getMasteryForTopic(userId, topic.id) || null;
    res.json({ topic, relations, mastery });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/mastery', (req, res, next) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    res.json({ items: topicRepo.listMastery(userId) });
  } catch (err) {
    next(err);
  }
});
