import os from 'node:os';
import { getDb } from './database.ts';
import { runDocumentPipeline } from '../services/documents/pipeline.ts';

const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;

class DocumentJobWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  public start(): void {
    this.reclaimExpiredLeases();
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public reclaimExpiredLeases(): void {
    const db = getDb();
    db.prepare(
      `UPDATE document_jobs
       SET status = 'queued', locked_by = NULL, locked_until = NULL
       WHERE status = 'running' AND locked_until IS NOT NULL AND locked_until < datetime('now')`,
    ).run();
  }

  public async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const jobId = this.claimNextJob();
      if (jobId) {
        await runDocumentPipeline(jobId);
      }
    } catch (err) {
      console.error('[JobQueue] Tick error:', err);
    } finally {
      this.processing = false;
    }
  }

  private claimNextJob(): string | null {
    const db = getDb();
    const candidate = db
      .prepare(
        `SELECT id FROM document_jobs
         WHERE status = 'queued' AND run_after <= datetime('now')
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get() as { id: string } | undefined;

    if (!candidate) return null;

    const res = db
      .prepare(
        `UPDATE document_jobs
         SET status = 'running', attempts = attempts + 1, locked_by = ?, locked_until = datetime('now', '+5 minutes'), started_at = COALESCE(started_at, datetime('now'))
         WHERE id = ? AND status = 'queued'`,
      )
      .run(WORKER_ID, candidate.id);

    return res.changes > 0 ? candidate.id : null;
  }
}

export const jobWorker = new DocumentJobWorker();
