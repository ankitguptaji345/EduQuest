import { GoogleGenAI } from '@google/genai';
import { config } from '../../core/config.ts';
import { AppError } from '../../core/errors.ts';
import type { AIProvider } from './provider.ts';

function ensureGeminiClient(): GoogleGenAI {
  if (!config.geminiApiKey) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Gemini AI mode is enabled, but GEMINI_API_KEY is not configured.',
    );
  }
  return new GoogleGenAI({
    apiKey: config.geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Layer B Future Integration: Never active unless AI_PROVIDER_MODE=gemini AND GEMINI_API_KEY is set.
export const geminiProvider: AIProvider = {
  id: 'gemini',
  label: 'Gemini AI',
  modelName: config.geminiModel,

  async analyzeDocument() {
    ensureGeminiClient();
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Gemini structured analysis pipeline is scaffolded for Layer B activation.',
    );
  },

  async answerTutor() {
    ensureGeminiClient();
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Gemini RAG tutor pipeline is scaffolded for Layer B activation.',
    );
  },

  async generateQuestions() {
    ensureGeminiClient();
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Gemini question generation is scaffolded for Layer B activation.',
    );
  },

  async evaluateAnswer() {
    ensureGeminiClient();
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Gemini rubric grading is scaffolded for Layer B activation.',
    );
  },

  async diagnoseMisconception() {
    ensureGeminiClient();
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Gemini misconception analyzer is scaffolded for Layer B activation.',
    );
  },

  async generateQuestLesson() {
    ensureGeminiClient();
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Gemini quest lesson generator is scaffolded for Layer B activation.',
    );
  },
};
