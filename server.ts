import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { config } from './server/core/config.ts';
import { getDb } from './server/core/database.ts';
import { errorHandler } from './server/core/errors.ts';
import { jobWorker } from './server/core/jobQueue.ts';
import { rateLimit, requestIdMiddleware } from './server/core/security.ts';
import { assessmentsRouter } from './server/routes/assessments.ts';
import { authRouter } from './server/routes/auth.ts';
import { documentsRouter } from './server/routes/documents.ts';
import { healthRouter } from './server/routes/health.ts';
import { misconceptionsRouter } from './server/routes/misconceptions.ts';
import { profileRouter } from './server/routes/profile.ts';
import { progressRouter } from './server/routes/progress.ts';
import { tutorRouter } from './server/routes/tutor.ts';
import { worldsRouter } from './server/routes/worlds.ts';

export function createApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', rateLimit(180, 60_000));

  app.use('/', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', profileRouter);
  app.use('/api', documentsRouter);
  app.use('/api', tutorRouter);
  app.use('/api', assessmentsRouter);
  app.use('/api', misconceptionsRouter);
  app.use('/api', worldsRouter);
  app.use('/api', progressRouter);

  app.use(errorHandler);
  return app;
}

async function upgradeStaleDocuments() {
  const db = getDb();
  const staleDocs = db
    .prepare(
      `SELECT d.id, d.user_id
       FROM documents d
       LEFT JOIN document_analyses da ON da.document_id = d.id
       WHERE d.status = 'ready'
         AND (da.document_id IS NULL OR da.analysis_version != '2.0' OR da.study_notes IS NULL)`,
    )
    .all() as Array<{ id: string; user_id: string }>;

  if (staleDocs.length === 0) return;

  const { documentRepo } = await import('./server/repositories/documentRepo.ts');
  for (const row of staleDocs) {
    const existingActive = documentRepo.getLatestJobForDocument(row.user_id, row.id);
    if (!existingActive || (existingActive.status !== 'queued' && existingActive.status !== 'running')) {
      documentRepo.createReprocessJob(row.user_id, row.id, 'queued');
    }
  }
  setImmediate(() => {
    void jobWorker.tick();
  });
}

async function bootstrap() {
  getDb();
  jobWorker.start();
  await upgradeStaleDocuments();

  const app = createApp();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`EduQuest AI listening on http://localhost:${config.port} (AI_MODE=${config.aiProviderMode})`);
  });
}

// Start server only when executed directly (allows importing createApp in automated tests)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts');

if (isMainModule && process.env.NODE_ENV !== 'test') {
  void bootstrap();
}
