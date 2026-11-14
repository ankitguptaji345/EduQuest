import { Router } from 'express';
import { config } from '../core/config.ts';
import { getDb } from '../core/database.ts';
import { storage } from '../core/storage.ts';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'eduquest-ai' });
});

healthRouter.get('/health/ready', async (_req, res) => {
  let dbOk = false;
  let storageOk = false;

  try {
    getDb().prepare('SELECT 1').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  try {
    storageOk = await storage.healthCheck();
  } catch {
    storageOk = false;
  }

  const aiConfigured =
    config.aiProviderMode === 'rule_based' ||
    (config.aiProviderMode === 'gemini' && Boolean(config.geminiApiKey));

  const ready = dbOk && storageOk;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'degraded',
    database: dbOk,
    storage: storageOk,
    ai_mode: config.aiProviderMode,
    ai_configured: aiConfigured,
    ocr_enabled: config.ocrEnabled,
  });
});
