import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export type AIProviderMode = 'rule_based' | 'gemini' | 'fake';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  aiProviderMode: AIProviderMode;
  ocrEnabled: boolean;
  ocrMaxPages: number;
  maxUploadMb: number;
  maxUploadBytes: number;
  localStorageDir: string;
  sqliteDbPath: string;
  jwtSecret: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiFastModel: string;
  geminiEmbeddingModel: string;
  embeddingDim: number;
  supabaseUrl: string;
  supabaseSecretKey: string;
}

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 20);

export const config: AppConfig = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  aiProviderMode: (process.env.AI_PROVIDER_MODE as AIProviderMode) || 'rule_based',
  ocrEnabled: process.env.OCR_ENABLED === 'true',
  ocrMaxPages: Number(process.env.OCR_MAX_PAGES || 10),
  maxUploadMb,
  maxUploadBytes: maxUploadMb * 1024 * 1024,
  localStorageDir: path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || './.local_storage'),
  sqliteDbPath: path.resolve(process.cwd(), process.env.SQLITE_DB_PATH || './eduquest.db'),
  jwtSecret: process.env.JWT_SECRET || 'eduquest-local-dev-jwt-secret-do-not-use-in-prod',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-4-hydrogen',
  geminiFastModel: process.env.GEMINI_FAST_MODEL || 'gemini-3.1-flash-lite',
  geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
  embeddingDim: Number(process.env.EMBEDDING_DIM || 768),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
};
