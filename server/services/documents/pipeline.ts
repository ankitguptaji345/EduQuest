import crypto from 'node:crypto';
import { getDb } from '../../core/database.ts';
import { storage } from '../../core/storage.ts';
import { documentRepo } from '../../repositories/documentRepo.ts';
import { topicRepo, type TopicRelationRow, type TopicRow } from '../../repositories/topicRepo.ts';
import { progressRepo } from '../../repositories/progressRepo.ts';
import { getAIProvider } from '../ai/provider.ts';
import { chunkExtractedUnits } from './chunker.ts';
import { DocumentExtractionError, extractDocument } from './extractors.ts';
import { xpService } from '../progress/xpService.ts';
import { recommendationService } from '../progress/recommendationService.ts';
import { worldService } from '../worlds/worldService.ts';

function updateJobStage(
  jobId: string,
  stage: string,
  progressCurrent: number,
  progressTotal: number,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE document_jobs SET stage = ?, progress_current = ?, progress_total = ?, locked_until = datetime('now', '+5 minutes')
     WHERE id = ?`,
  ).run(stage, progressCurrent, progressTotal, jobId);
}

export async function runDocumentPipeline(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.prepare('SELECT * FROM document_jobs WHERE id = ?').get(jobId) as
    | { id: string; user_id: string; document_id: string | null; stage: string }
    | undefined;

  if (!job || !job.document_id) return;

  const userId = job.user_id;
  const documentId = job.document_id;
  const doc = documentRepo.getDocument(userId, documentId);
  if (!doc) return;

  let currentStage = 'extracting';
  try {
    documentRepo.updateDocumentProcessing(userId, documentId, {
      status: 'processing',
      failedStage: null,
      errorCode: null,
      errorMessageSafe: null,
    });

    // Stage 1: Extracting
    currentStage = 'extracting';
    updateJobStage(jobId, 'extracting', 0, 1);
    const fileBuffer = await storage.readFile(doc.storage_path);
    const extraction = await extractDocument(fileBuffer, doc.file_ext);

    documentRepo.updateDocumentProcessing(userId, documentId, {
      pageCount: extraction.pageCount,
      textCharCount: extraction.totalChars,
      ocrUsed: extraction.ocrUsed ? 1 : 0,
    });
    updateJobStage(jobId, 'extracting', extraction.pageCount, extraction.pageCount);

    // Stage 2: Chunking
    currentStage = 'chunking';
    updateJobStage(jobId, 'chunking', 0, extraction.units.length);
    const chunkDrafts = chunkExtractedUnits(extraction.units);
    documentRepo.replaceChunks(userId, documentId, chunkDrafts);
    updateJobStage(jobId, 'chunking', chunkDrafts.length, chunkDrafts.length);

    // Stage 3: Embedding (Layer A records none-fts-only; Layer B computes 768-d vectors)
    currentStage = 'embedding';
    const chunks = documentRepo.listChunksForDocument(userId, documentId);
    updateJobStage(jobId, 'embedding', chunks.length, chunks.length);

    // Stage 4: Analyzing & Topic Mapping
    currentStage = 'analyzing';
    updateJobStage(jobId, 'analyzing', 0, 1);
    const t0 = Date.now();
    const provider = getAIProvider();
    const analysis = await provider.analyzeDocument({
      documentTitle: doc.title,
      chunks,
    });
    const latency = Date.now() - t0;

    documentRepo.upsertAnalysis({
      documentId,
      userId,
      summary: analysis.summary,
      learningObjectives: analysis.learningObjectives,
      examQuestions: analysis.examQuestions,
      model: analysis.model,
      promptVersion: analysis.promptVersion,
    });

    const topicRows: TopicRow[] = analysis.topics.map((t) => ({
      ...t,
      user_id: userId,
      document_id: documentId,
      subject_id: doc.subject_id,
    }));
    const relationRows: TopicRelationRow[] = analysis.relations.map((r) => ({
      ...r,
      user_id: userId,
    }));

    topicRepo.replaceDocumentTopics(userId, documentId, topicRows, relationRows);

    // Initialize unassessed topic_mastery rows for extracted topics
    for (const t of topicRows) {
      if (t.kind === 'topic' || t.kind === 'subtopic') {
        const existing = topicRepo.getMasteryForTopic(userId, t.id);
        if (!existing) {
          topicRepo.upsertMastery({
            id: crypto.randomUUID(),
            user_id: userId,
            topic_id: t.id,
            topic_name_snapshot: t.name,
            score: 0,
            confidence: 0,
            band: 'unassessed',
            evidence_count: 0,
            correct_count: 0,
            last_practiced_at: null,
            next_review_at: null,
            breakdown: { source: 'initial_extraction' },
            updated_at: new Date().toISOString(),
          });
        }
      }
    }

    progressRepo.logAiUsage({
      userId,
      feature: 'document_analysis',
      model: analysis.model,
      tokensIn: Math.ceil(extraction.totalChars / 4),
      tokensOut: Math.ceil(analysis.summary.length / 4),
      latencyMs: latency,
      status: 'succeeded',
    });

    // Generate grounded Learning World from extracted topics
    await worldService.generateWorldForDocument(userId, documentId);

    // Stage 5: Ready
    documentRepo.updateDocumentProcessing(userId, documentId, { status: 'ready' });
    db.prepare(
      `UPDATE document_jobs
       SET status = 'succeeded', stage = 'ready', progress_current = 1, progress_total = 1, finished_at = datetime('now'), locked_by = NULL, locked_until = NULL
       WHERE id = ?`,
    ).run(jobId);

    xpService.evaluateAchievements(userId, 'document_ready');
    recommendationService.recompute(userId);
  } catch (err) {
    const isPermanent = err instanceof DocumentExtractionError;
    const errorCode = isPermanent ? err.errorCode : 'PROCESSING_FAILED';
    const messageSafe =
      err instanceof Error ? err.message : 'Document processing failed unexpectedly.';

    documentRepo.updateDocumentProcessing(userId, documentId, {
      status: 'failed',
      failedStage: currentStage,
      errorCode,
      errorMessageSafe: messageSafe,
    });

    db.prepare(
      `UPDATE document_jobs
       SET status = 'failed', stage = 'failed', last_error_code = ?, last_error_safe = ?, finished_at = datetime('now'), locked_by = NULL, locked_until = NULL
       WHERE id = ?`,
    ).run(errorCode, messageSafe, jobId);
  }
}
