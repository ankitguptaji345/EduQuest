export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_key: string;
  education_level: 'school' | 'undergraduate' | 'postgraduate' | 'exam_prep' | 'self_learner';
  course: string;
  timezone: string;
  onboarding_completed_at: string | null;
  deletion_requested_at: string | null;
  created_at: string;
}

export interface UserPreferences {
  user_id: string;
  interests: string[];
  subjects_of_interest: string[];
  goals: string[];
  explanation_style: 'beginner' | 'academic' | 'example_based' | 'step_by_step' | 'exam_oriented';
  daily_goal_minutes: number;
}

export interface UserStats {
  user_id: string;
  total_xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  last_active_local_date: string | null;
  current_level_xp?: number;
  next_level_xp?: number;
  xp_to_next_level?: number;
}

export interface Subject {
  id: string;
  name: string;
  color: string;
  icon_key: string;
}

export interface SourceRef {
  kind: 'page' | 'slide' | 'section';
  number: number;
  label: string;
  chunk_id?: string;
}

export interface DocumentJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  stage: string;
  progress_current: number;
  progress_total: number;
  last_error_code: string | null;
  last_error_safe: string | null;
}

export interface StudyDocument {
  id: string;
  subject_id: string | null;
  title: string;
  original_filename: string;
  file_ext: 'pdf' | 'docx' | 'pptx' | 'txt';
  size_bytes: number;
  page_count: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed' | 'deleting';
  failed_stage: string | null;
  error_code: string | null;
  error_message_safe: string | null;
  text_char_count: number;
  created_at: string;
  latest_job?: DocumentJob | null;
}

export interface Topic {
  id: string;
  document_id: string;
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
  mastery?: TopicMastery | null;
}

export interface TopicMastery {
  id: string;
  topic_id: string | null;
  topic_name_snapshot: string;
  score: number;
  confidence: number;
  band: 'unassessed' | 'weak' | 'needs_practice' | 'developing' | 'strong';
  evidence_count: number;
  correct_count: number;
  last_practiced_at: string | null;
  breakdown: Record<string, unknown>;
}

export interface TutorCitation extends SourceRef {
  document_id: string;
  excerpt: string;
}

export interface TutorConversation {
  id: string;
  title: string;
  document_ids: string[];
  topic_id: string | null;
  explanation_style: string;
  message_count: number;
  updated_at: string;
}

export interface TutorMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: TutorCitation[];
  grounding: 'document' | 'mixed' | 'general' | 'not_in_document';
  model: string;
  created_at: string;
}

export interface QuestionPublic {
  id: string;
  assessment_id: string;
  topic_id: string | null;
  position: number;
  round_no: number;
  type: string;
  difficulty: string;
  prompt: string;
  options: string[];
  hints_count: number;
  source_refs: SourceRef[];
}

export interface Assessment {
  id: string;
  document_id: string | null;
  topic_ids: string[];
  kind: 'diagnostic' | 'practice' | 'quest_check' | 'boss' | 'corrective';
  status: 'generated' | 'in_progress' | 'submitted' | 'evaluated' | 'expired';
  started_at: string;
  submitted_at: string | null;
  score: number | null;
  max_score: number | null;
  model: string;
}

export interface MisconceptionThread {
  id: string;
  topic_id: string | null;
  topic_name_snapshot: string;
  misconception_key: string;
  label: string;
  status: 'suspected' | 'confirmed' | 'improving' | 'resolved' | 'persistent' | 'dismissed';
  occurrences: number;
  confidence_agg: number;
  corrective_lesson: string;
  follow_up_assessment_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface Quest {
  id: string;
  world_id: string;
  position: number;
  kind: 'lesson' | 'practice' | 'checkpoint' | 'boss';
  title: string;
  intro: string;
  objective: string;
  topic_ids: string[];
  lesson_markdown: string | null;
  xp_reward: number;
  mastery_threshold: number;
  source_refs: SourceRef[];
  is_unlocked?: boolean;
  is_completed?: boolean;
  best_score?: number | null;
}

export interface LearningWorld {
  id: string;
  document_id: string | null;
  title: string;
  theme_key: string;
  description: string;
  quests: Quest[];
  completed_count: number;
  total_quests: number;
  progress_percent: number;
}

export interface Recommendation {
  id: string;
  kind: 'practice_topic' | 'resolve_misconception' | 'review' | 'take_quest' | 'take_boss' | 'upload_material';
  target_type: string;
  target_id: string | null;
  title: string;
  reason: string;
  evidence: Record<string, unknown>;
  priority: number;
}
