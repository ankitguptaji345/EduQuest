import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = initDatabase(config.sqliteDbPath);
  }
  return dbInstance;
}

export function setTestDb(db: DatabaseSync): void {
  dbInstance = db;
}

export function initDatabase(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  runMigrations(db);
  seedAchievements(db);
  return db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    -- 1. Identity & Preferences
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      avatar_key TEXT NOT NULL DEFAULT 'scholar_1',
      education_level TEXT NOT NULL DEFAULT 'undergraduate' CHECK (education_level IN ('school','undergraduate','postgraduate','exam_prep','self_learner')),
      course TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      onboarding_completed_at TEXT NULL,
      deletion_requested_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      interests TEXT NOT NULL DEFAULT '[]',
      subjects_of_interest TEXT NOT NULL DEFAULT '[]',
      goals TEXT NOT NULL DEFAULT '[]',
      explanation_style TEXT NOT NULL DEFAULT 'step_by_step' CHECK (explanation_style IN ('beginner','academic','example_based','step_by_step','exam_oriented')),
      daily_goal_minutes INTEGER NOT NULL DEFAULT 20 CHECK (daily_goal_minutes BETWEEN 5 AND 240),
      ai_daily_budget_override INTEGER NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_stats (
      user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
      total_xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      last_active_local_date TEXT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8B5CF6',
      icon_key TEXT NOT NULL DEFAULT 'book',
      archived_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_user_name ON subjects(user_id, lower(name));

    -- 2. Documents & Retrieval
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      subject_id TEXT NULL REFERENCES subjects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_ext TEXT NOT NULL CHECK (file_ext IN ('pdf','docx','pptx','txt')),
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','ready','failed','deleting')),
      failed_stage TEXT NULL,
      error_code TEXT NULL,
      error_message_safe TEXT NULL,
      ocr_used INTEGER NOT NULL DEFAULT 0,
      text_char_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_user_subject ON documents(user_id, subject_id);
    CREATE INDEX IF NOT EXISTS idx_documents_user_sha256 ON documents(user_id, sha256);

    CREATE TABLE IF NOT EXISTS document_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      document_id TEXT NULL REFERENCES documents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('process_document','reprocess_document','purge_account')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
      stage TEXT NOT NULL DEFAULT 'queued',
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_after TEXT NOT NULL DEFAULT (datetime('now')),
      locked_by TEXT NULL,
      locked_until TEXT NULL,
      last_error_code TEXT NULL,
      last_error_safe TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT NULL,
      finished_at TEXT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_document_jobs_status_run ON document_jobs(status, run_after);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_jobs_active_doc
      ON document_jobs(document_id) WHERE status IN ('queued','running') AND document_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('page','slide','section')),
      source_start INTEGER NOT NULL,
      source_end INTEGER NOT NULL,
      heading_path TEXT NOT NULL DEFAULT '',
      embedding TEXT NULL,
      embedding_model TEXT NULL,
      embedding_dim INTEGER NULL,
      UNIQUE(document_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_user_doc ON document_chunks(user_id, document_id);

    CREATE TABLE IF NOT EXISTS document_analyses (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      learning_objectives TEXT NOT NULL DEFAULT '[]',
      exam_questions TEXT NOT NULL DEFAULT '[]',
      study_notes TEXT NULL,
      analysis_version TEXT NOT NULL DEFAULT '1.0',
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL DEFAULT 'rule-based-v1',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 3. Knowledge Model
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      subject_id TEXT NULL REFERENCES subjects(id) ON DELETE SET NULL,
      parent_id TEXT NULL REFERENCES topics(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('topic','subtopic','concept')),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      definition TEXT NULL,
      formulas TEXT NOT NULL DEFAULT '[]',
      examples TEXT NOT NULL DEFAULT '[]',
      difficulty TEXT NOT NULL DEFAULT 'intermediate' CHECK (difficulty IN ('beginner','intermediate','advanced')),
      source_refs TEXT NOT NULL DEFAULT '[]',
      grounded INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      UNIQUE(document_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_topics_user_doc ON topics(user_id, document_id);

    CREATE TABLE IF NOT EXISTS topic_relations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      from_topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      to_topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK (relation IN ('prerequisite_of','part_of','related_to','contrasts_with')),
      source_refs TEXT NOT NULL DEFAULT '[]',
      UNIQUE(from_topic_id, to_topic_id, relation)
    );

    CREATE TABLE IF NOT EXISTS topic_mastery (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      topic_id TEXT NULL REFERENCES topics(id) ON DELETE SET NULL,
      topic_name_snapshot TEXT NOT NULL DEFAULT '',
      score REAL NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
      confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
      band TEXT NOT NULL DEFAULT 'unassessed' CHECK (band IN ('unassessed','weak','needs_practice','developing','strong')),
      evidence_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      last_practiced_at TEXT NULL,
      next_review_at TEXT NULL,
      breakdown TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, topic_id)
    );

    -- 4. Tutor
    CREATE TABLE IF NOT EXISTS tutor_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      document_ids TEXT NOT NULL DEFAULT '[]',
      topic_id TEXT NULL REFERENCES topics(id) ON DELETE SET NULL,
      explanation_style TEXT NOT NULL DEFAULT 'step_by_step',
      message_count INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tutor_conv_user_updated ON tutor_conversations(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS tutor_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      sources TEXT NOT NULL DEFAULT '[]',
      grounding TEXT NOT NULL DEFAULT 'document' CHECK (grounding IN ('document','mixed','general','not_in_document')),
      status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','partial','error')),
      model TEXT NOT NULL DEFAULT 'rule-based-v1',
      prompt_version TEXT NOT NULL DEFAULT 'rule-based-v1',
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tutor_msg_conv_created ON tutor_messages(conversation_id, created_at ASC);

    -- 5. Assessments, Evidence & Misconceptions
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      subject_id TEXT NULL REFERENCES subjects(id) ON DELETE SET NULL,
      document_id TEXT NULL REFERENCES documents(id) ON DELETE SET NULL,
      topic_ids TEXT NOT NULL DEFAULT '[]',
      kind TEXT NOT NULL CHECK (kind IN ('diagnostic','practice','quest_check','boss','corrective')),
      status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','in_progress','submitted','evaluated','expired')),
      config TEXT NOT NULL DEFAULT '{}',
      parent_assessment_id TEXT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT NULL,
      score REAL NULL,
      max_score REAL NULL,
      model TEXT NOT NULL DEFAULT 'rule-based-v1',
      prompt_version TEXT NOT NULL DEFAULT 'rule-based-v1'
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      topic_id TEXT NULL REFERENCES topics(id) ON DELETE SET NULL,
      position INTEGER NOT NULL,
      round_no INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL CHECK (type IN ('mcq','true_false','short_answer','code_output','conceptual','error_identification','coding','application')),
      difficulty TEXT NOT NULL DEFAULT 'intermediate',
      prompt TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      answer_key TEXT NOT NULL,
      rubric TEXT NOT NULL DEFAULT '{}',
      explanation TEXT NOT NULL DEFAULT '',
      hints TEXT NOT NULL DEFAULT '[]',
      source_refs TEXT NOT NULL DEFAULT '[]',
      question_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_questions_assessment_pos ON questions(assessment_id, position);

    CREATE TABLE IF NOT EXISTS student_answers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      topic_id TEXT NULL REFERENCES topics(id) ON DELETE SET NULL,
      difficulty TEXT NOT NULL DEFAULT 'intermediate',
      answer TEXT NOT NULL,
      is_correct INTEGER NULL,
      score REAL NOT NULL DEFAULT 0,
      grading_method TEXT NOT NULL DEFAULT 'deterministic' CHECK (grading_method IN ('deterministic','ai')),
      feedback TEXT NOT NULL DEFAULT '',
      hints_used INTEGER NOT NULL DEFAULT 0,
      time_taken_ms INTEGER NOT NULL DEFAULT 0,
      answered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(assessment_id, question_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_student_answers_user_topic ON student_answers(user_id, topic_id, answered_at DESC);

    CREATE TABLE IF NOT EXISTS misconception_threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      topic_id TEXT NULL REFERENCES topics(id) ON DELETE SET NULL,
      topic_name_snapshot TEXT NOT NULL DEFAULT '',
      misconception_key TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'suspected' CHECK (status IN ('suspected','confirmed','improving','resolved','persistent','dismissed')),
      occurrences INTEGER NOT NULL DEFAULT 1,
      confidence_agg REAL NOT NULL DEFAULT 0.5,
      corrective_lesson TEXT NOT NULL DEFAULT '',
      follow_up_assessment_id TEXT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT NULL,
      UNIQUE(user_id, topic_id, misconception_key)
    );

    CREATE TABLE IF NOT EXISTS misconception_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES misconception_threads(id) ON DELETE CASCADE,
      answer_id TEXT NOT NULL REFERENCES student_answers(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      topic_id TEXT NULL REFERENCES topics(id) ON DELETE SET NULL,
      concept TEXT NOT NULL,
      cause_class TEXT NOT NULL CHECK (cause_class IN ('misconception','knowledge_gap','careless_slip','ambiguous_question','uncertain')),
      misconception_key TEXT NOT NULL,
      label TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      misconception_detected INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.5,
      explanation TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      follow_up_question_id TEXT NULL,
      model TEXT NOT NULL DEFAULT 'rule-based-v1',
      prompt_version TEXT NOT NULL DEFAULT 'rule-based-v1',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 6. Game World & Rewards
    CREATE TABLE IF NOT EXISTS learning_worlds (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      subject_id TEXT NULL REFERENCES subjects(id) ON DELETE SET NULL,
      document_id TEXT NULL REFERENCES documents(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      theme_key TEXT NOT NULL DEFAULT 'nebula_core',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('generating','ready','failed')),
      model TEXT NOT NULL DEFAULT 'rule-based-v1',
      prompt_version TEXT NOT NULL DEFAULT 'rule-based-v1'
    );

    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      world_id TEXT NOT NULL REFERENCES learning_worlds(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('lesson','practice','checkpoint','boss')),
      title TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      objective TEXT NOT NULL DEFAULT '',
      topic_ids TEXT NOT NULL DEFAULT '[]',
      lesson_markdown TEXT NULL,
      completion_rules TEXT NOT NULL DEFAULT '{}',
      mastery_threshold REAL NOT NULL DEFAULT 0.75,
      xp_reward INTEGER NOT NULL DEFAULT 50,
      unlock_rule TEXT NOT NULL DEFAULT '{}',
      source_refs TEXT NOT NULL DEFAULT '[]',
      UNIQUE(world_id, position)
    );

    CREATE TABLE IF NOT EXISTS quest_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      quest_id TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','paused','completed','failed','abandoned')),
      progress TEXT NOT NULL DEFAULT '{}',
      assessment_id TEXT NULL REFERENCES assessments(id) ON DELETE SET NULL,
      score REAL NULL,
      passed INTEGER NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      paused_at TEXT NULL,
      resumed_at TEXT NULL,
      completed_at TEXT NULL,
      xp_awarded INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_attempts_active
      ON quest_attempts(user_id, quest_id) WHERE status IN ('in_progress','paused');

    CREATE TABLE IF NOT EXISTS xp_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL CHECK (amount > 0),
      source_type TEXT NOT NULL CHECK (source_type IN ('lesson','challenge','assessment','improvement','boss','daily_goal','achievement')),
      source_id TEXT NULL,
      reason TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, idempotency_key),
      UNIQUE(user_id, source_type, source_id, reason)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      icon_key TEXT NOT NULL,
      xp_bonus INTEGER NOT NULL DEFAULT 25,
      rule_version TEXT NOT NULL DEFAULT '1.0'
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      achievement_code TEXT NOT NULL REFERENCES achievements(code) ON DELETE CASCADE,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      context TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(user_id, achievement_code)
    );

    -- 7. Activity, Guidance & Operations
    CREATE TABLE IF NOT EXISTS learning_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT NULL,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      activity TEXT NOT NULL CHECK (activity IN ('reading','tutor','assessment','quest','boss')),
      subject_id TEXT NULL REFERENCES subjects(id) ON DELETE SET NULL,
      document_id TEXT NULL REFERENCES documents(id) ON DELETE SET NULL,
      local_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('practice_topic','resolve_misconception','review','take_quest','take_boss','upload_material')),
      target_type TEXT NOT NULL,
      target_id TEXT NULL,
      title TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '{}',
      priority INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dismissed','completed','expired')),
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NULL,
      rules_version TEXT NOT NULL DEFAULT '1.0'
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      feature TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage(user_id, created_at);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      PRIMARY KEY(user_id, key)
    );
  `);

  const analysisCols = db
    .prepare(`PRAGMA table_info(document_analyses)`)
    .all() as Array<{ name: string }>;
  if (!analysisCols.some((c) => c.name === 'study_notes')) {
    db.exec(`ALTER TABLE document_analyses ADD COLUMN study_notes TEXT NULL;`);
  }
}

function seedAchievements(db: DatabaseSync): void {
  const achievements = [
    ['first_upload', 'Knowledge Seeder', 'Upload and process your first study material.', 'documents', 'upload', 30],
    ['first_diagnostic', 'Signal Finder', 'Complete your first diagnostic or practice quiz.', 'assessment', 'target', 35],
    ['curious_scholar', 'Grounded Inquiry', 'Ask your study tutor a question and inspect a source.', 'tutor', 'message-square', 25],
    ['misconception_buster', 'Mental Model Fixer', 'Confirm and resolve your first learning misconception.', 'misconceptions', 'lightbulb', 60],
    ['quest_pioneer', 'World Explorer', 'Complete your first adaptive quest.', 'worlds', 'compass', 40],
    ['boss_slayer', 'Boss Conqueror', 'Defeat a topic Boss Battle with 75%+ mastery.', 'boss', 'shield', 100],
    ['perfect_round', 'Precision Strike', 'Score 100% on a diagnostic or checkpoint quiz.', 'assessment', 'award', 50],
    ['streak_3', 'Three-Day Momentum', 'Maintain a 3-day learning streak.', 'consistency', 'flame', 45],
    ['level_3', 'Rising Scholar', 'Reach Level 3 through real study activity.', 'progression', 'trending-up', 50],
    ['level_5', 'Mastery Architect', 'Reach Level 5 across your study worlds.', 'progression', 'crown', 100],
  ] as const;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO achievements (code, name, description, category, icon_key, xp_bonus, rule_version)
    VALUES (?, ?, ?, ?, ?, ?, '1.0')
  `);
  for (const row of achievements) {
    stmt.run(...row);
  }
}
