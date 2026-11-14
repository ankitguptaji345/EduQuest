import { config } from '../../core/config.ts';
import { AppError } from '../../core/errors.ts';
import type { AIProvider } from './provider.ts';
import { ruleBasedProvider } from './ruleBasedProvider.ts';

function assertTestEnv(): void {
  if (config.nodeEnv !== 'test') {
    throw new AppError(
      500,
      'FAKE_PROVIDER_FORBIDDEN',
      'FakeProvider may only be used when NODE_ENV=test.',
    );
  }
}

export const fakeProvider: AIProvider = {
  id: 'fake',
  label: 'Test FakeProvider',
  modelName: 'fake-test-v1',

  async analyzeDocument(params) {
    assertTestEnv();
    return ruleBasedProvider.analyzeDocument(params);
  },
  async answerTutor(params) {
    assertTestEnv();
    return ruleBasedProvider.answerTutor(params);
  },
  async generateQuestions(params) {
    assertTestEnv();
    return ruleBasedProvider.generateQuestions(params);
  },
  async evaluateAnswer(params) {
    assertTestEnv();
    return ruleBasedProvider.evaluateAnswer(params);
  },
  async diagnoseMisconception(params) {
    assertTestEnv();
    return ruleBasedProvider.diagnoseMisconception(params);
  },
  async generateQuestLesson(params) {
    assertTestEnv();
    return ruleBasedProvider.generateQuestLesson(params);
  },
};
