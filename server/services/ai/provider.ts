import { config } from '../../core/config.ts';
import { AppError } from '../../core/errors.ts';
import type { DocumentChunkRow } from '../../repositories/documentRepo.ts';
import type { QuestionSecret, QuestionType } from '../../repositories/assessmentRepo.ts';
import type { CauseClass } from '../../repositories/misconceptionRepo.ts';
import type { SourceRef, TopicRow } from '../../repositories/topicRepo.ts';
import type { TutorCitation, TutorMessageRow } from '../../repositories/tutorRepo.ts';
import type { StructuredStudyNotes } from '../documents/cleaner.ts';
import type { ExtractedUnit } from '../documents/extractors.ts';
import { ruleBasedProvider } from './ruleBasedProvider.ts';
import { geminiProvider } from './geminiProvider.ts';
import { fakeProvider } from './fakeProvider.ts';

export interface AnalyzedTopicDraft {
  id: string;
  parent_id: string | null;
  kind: 'topic' | 'subtopic' | 'concept';
  name: string;
  slug: string;
  summary: string;
  definition: string | null;
  formulas: string[];
  examples: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  source_refs: SourceRef[];
  grounded: boolean;
  order_index: number;
}

export interface AnalyzedRelationDraft {
  id: string;
  from_topic_id: string;
  to_topic_id: string;
  relation: 'prerequisite_of' | 'part_of' | 'related_to' | 'contrasts_with';
  source_refs: SourceRef[];
}

export interface DocumentAnalysisOutput {
  summary: string;
  learningObjectives: string[];
  examQuestions: Array<{ prompt: string; topic: string; difficulty: string }>;
  studyNotes?: StructuredStudyNotes | null;
  topics: AnalyzedTopicDraft[];
  relations: AnalyzedRelationDraft[];
  model: string;
  promptVersion: string;
}

export interface TutorResponseOutput {
  content: string;
  citations: TutorCitation[];
  grounding: 'document' | 'mixed' | 'general' | 'not_in_document';
  followUps: string[];
  model: string;
  providerLabel: string;
}

export interface GeneratedQuestionDraft {
  topic_id: string | null;
  type: QuestionType;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  round_no: number;
  prompt: string;
  options: string[];
  answer_key: { correct: string; keywords?: string[]; code_trace?: string };
  rubric: Record<string, unknown>;
  explanation: string;
  hints: string[];
  source_refs: SourceRef[];
  question_hash: string;
}

export interface EvaluationOutput {
  is_correct: boolean;
  score: number;
  grading_method: 'deterministic' | 'ai';
  feedback: string;
  correct_answer: string;
  explanation: string;
}

export interface MisconceptionDiagnosisOutput {
  cause_class: CauseClass;
  misconception_key: string;
  label: string;
  concept: string;
  confidence: number;
  explanation: string;
  recommended_action: string;
  corrective_lesson: string;
  follow_up_question: GeneratedQuestionDraft;
  model: string;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  readonly modelName: string;

  analyzeDocument(params: {
    documentTitle: string;
    chunks: DocumentChunkRow[];
    units?: ExtractedUnit[];
    unsuitableReason?: string | null;
  }): Promise<DocumentAnalysisOutput>;

  answerTutor(params: {
    query: string;
    chunks: DocumentChunkRow[];
    topics: TopicRow[];
    explanationStyle: string;
    history: TutorMessageRow[];
  }): Promise<TutorResponseOutput>;

  generateQuestions(params: {
    topics: TopicRow[];
    chunks: DocumentChunkRow[];
    count: number;
    difficulty?: string;
    kind: 'diagnostic' | 'practice' | 'quest_check' | 'boss' | 'corrective';
    excludedHashes: Set<string>;
    roundNo?: number;
  }): Promise<GeneratedQuestionDraft[]>;

  evaluateAnswer(params: {
    question: QuestionSecret;
    studentAnswer: string;
  }): Promise<EvaluationOutput>;

  diagnoseMisconception(params: {
    question: QuestionSecret;
    studentAnswer: string;
    topic: TopicRow | undefined;
    allUserTopics: TopicRow[];
    topicChunks: DocumentChunkRow[];
    priorTopicScore: number;
  }): Promise<MisconceptionDiagnosisOutput>;

  generateQuestLesson(params: {
    topic: TopicRow;
    chunks: DocumentChunkRow[];
    style: string;
  }): Promise<string>;
}

export function getAIProvider(): AIProvider {
  if (config.aiProviderMode === 'gemini') {
    if (!config.geminiApiKey) {
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        'Gemini provider is selected, but GEMINI_API_KEY is not configured.',
      );
    }
    return geminiProvider;
  }

  if (config.aiProviderMode === 'fake') {
    if (config.nodeEnv !== 'test') {
      throw new AppError(
        500,
        'FAKE_PROVIDER_FORBIDDEN',
        'FakeProvider is strictly restricted to automated tests (NODE_ENV=test).',
      );
    }
    return fakeProvider;
  }

  return ruleBasedProvider;
}
