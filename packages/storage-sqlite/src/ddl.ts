import type { Database } from 'bun:sqlite';
import { SCHEMA_MIGRATIONS } from './migrations/index.js';

export { SCHEMA_MIGRATIONS };

/**
 * 自动迁移/初始化数据表 DDL（P2-5 拆分：仅结构，不含种子数据）
 */
export function initSchema(sqlite: Database): void {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS learner_profiles (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      target_language TEXT NOT NULL DEFAULT 'en',
      study_goal TEXT NOT NULL DEFAULT 'CET6',
      learner_level TEXT NOT NULL DEFAULT 'BEGINNER',
      overall_level TEXT NOT NULL DEFAULT 'B1',
      overall_proficiency REAL NOT NULL DEFAULT 0,
      streak_days INTEGER NOT NULL DEFAULT 0,
      max_streak_days INTEGER NOT NULL DEFAULT 0,
      last_active_date TEXT,
      retention_rate REAL NOT NULL DEFAULT 0.85,
      daily_goal_quizzes INTEGER NOT NULL DEFAULT 5,
      daily_goal_cards INTEGER NOT NULL DEFAULT 10,
      total_study_minutes INTEGER NOT NULL DEFAULT 0,
      total_cards_reviewed INTEGER NOT NULL DEFAULT 0,
      total_quizzes_answered INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learner_language_profiles (
      user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      study_goal TEXT NOT NULL DEFAULT 'CET6',
      learner_level TEXT NOT NULL DEFAULT 'BEGINNER',
      overall_level TEXT NOT NULL DEFAULT 'B1',
      overall_proficiency REAL NOT NULL DEFAULT 0,
      streak_days INTEGER NOT NULL DEFAULT 0,
      max_streak_days INTEGER NOT NULL DEFAULT 0,
      last_active_date TEXT,
      retention_rate REAL NOT NULL DEFAULT 0.85,
      daily_goal_quizzes INTEGER NOT NULL DEFAULT 5,
      daily_goal_cards INTEGER NOT NULL DEFAULT 10,
      total_study_minutes INTEGER NOT NULL DEFAULT 0,
      total_cards_reviewed INTEGER NOT NULL DEFAULT 0,
      total_quizzes_answered INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, language)
    );

    CREATE TABLE IF NOT EXISTS study_activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      quizzes_count INTEGER NOT NULL DEFAULT 0,
      cards_reviewed_count INTEGER NOT NULL DEFAULT 0,
      listening_minutes INTEGER NOT NULL DEFAULT 0,
      mistakes_resolved_count INTEGER NOT NULL DEFAULT 0,
      reading_count INTEGER NOT NULL DEFAULT 0,
      is_goal_completed INTEGER NOT NULL DEFAULT 0,
      intensity_level INTEGER NOT NULL DEFAULT 0,
      is_overtime_burst INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_activity_user_date ON study_activity_logs(user_id, activity_date);

    CREATE TABLE IF NOT EXISTS skill_metrics (
      user_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      dimension TEXT NOT NULL,
      name TEXT NOT NULL,
      proficiency REAL NOT NULL,
      total_attempts INTEGER NOT NULL,
      correct_attempts INTEGER NOT NULL,
      consecutive_errors INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_practiced_at TEXT,
      PRIMARY KEY (user_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      type TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      phonetic TEXT,
      audio_url TEXT,
      source_entry_id TEXT,
      tags TEXT NOT NULL,
      fsrs TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      question_id TEXT NOT NULL,
      user_answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      score REAL NOT NULL,
      time_spent_ms INTEGER NOT NULL,
      tested_skill_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mistakes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      question_id TEXT NOT NULL,
      question TEXT NOT NULL,
      last_user_submission TEXT NOT NULL,
      last_grading TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      last_retried_at TEXT,
      retry_count INTEGER NOT NULL,
      consecutive_correct INTEGER NOT NULL,
      is_resolved INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      content TEXT NOT NULL,
      ast_json TEXT,
      topic TEXT,
      difficulty INTEGER,
      source_url TEXT,
      source_publisher TEXT,
      exam_tag TEXT,
      source_kind_detail TEXT,
      fetch_status TEXT,
      news_publisher TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, source_kind);

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      quote TEXT NOT NULL,
      note TEXT,
      start_offset INTEGER NOT NULL DEFAULT 0,
      end_offset INTEGER NOT NULL DEFAULT 0,
      page_number INTEGER,
      created_by TEXT NOT NULL DEFAULT 'USER',
      flashcard_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_annotations_doc_user ON annotations(document_id, user_id);

    CREATE TABLE IF NOT EXISTS curriculum_kana (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      hiragana TEXT NOT NULL,
      katakana TEXT NOT NULL,
      romaji TEXT NOT NULL,
      row TEXT NOT NULL,
      col TEXT NOT NULL,
      mnemonic TEXT,
      audio_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kana_type ON curriculum_kana(type, sort_order);

    CREATE TABLE IF NOT EXISTS curriculum_hangul (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      jamo TEXT NOT NULL,
      name TEXT NOT NULL,
      romanization TEXT NOT NULL,
      row TEXT NOT NULL,
      col TEXT NOT NULL,
      mnemonic TEXT,
      audio_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hangul_type ON curriculum_hangul(type, sort_order);

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default_user',
      language TEXT NOT NULL DEFAULT 'ja',
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      prompt TEXT NOT NULL,
      content TEXT NOT NULL,
      options TEXT,
      chunks TEXT,
      correct_answer TEXT NOT NULL,
      explanation TEXT NOT NULL,
      tested_skill_id TEXT NOT NULL,
      difficulty INTEGER NOT NULL DEFAULT 3,
      extras_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quiz_questions_user ON quiz_questions(user_id, created_at);

    CREATE TABLE IF NOT EXISTS practice_collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      title TEXT NOT NULL,
      intent TEXT NOT NULL DEFAULT 'GENERATE_QUIZ',
      layout_hint TEXT,
      source_ref TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_practice_collections_user ON practice_collections(user_id, created_at);

    CREATE TABLE IF NOT EXISTS practice_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      collection_id TEXT NOT NULL,
      question_json TEXT NOT NULL,
      skill_ids TEXT,
      source_ref TEXT,
      passage_document_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      collected_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_practice_items_collection ON practice_items(collection_id, sort_order);

    CREATE TABLE IF NOT EXISTS local_dictionary_entries (
      id TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      headword TEXT NOT NULL,
      reading TEXT,
      romanization TEXT,
      meanings_json TEXT NOT NULL,
      pronunciation_json TEXT,
      part_of_speech TEXT,
      source_id TEXT,
      source_label TEXT NOT NULL,
      license_note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_local_dictionary_language_headword
      ON local_dictionary_entries(language, headword);
    -- 课程路线按固定 id 前缀取词组；与 GLOB 前缀查询配套，避免扫描整包词典。
    CREATE INDEX IF NOT EXISTS idx_local_dictionary_language_id
      ON local_dictionary_entries(language, id);

    CREATE TABLE IF NOT EXISTS dictionary_sources (
      id TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      provider TEXT NOT NULL,
      version TEXT NOT NULL,
      source_url TEXT NOT NULL,
      license_name TEXT NOT NULL,
      license_url TEXT NOT NULL,
      attribution TEXT NOT NULL,
      entry_count INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dictionary_term_meta (
      term TEXT NOT NULL,
      reading TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL,
      pitch_json TEXT,
      freq_json TEXT,
      freq_value INTEGER,
      source_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (term, reading, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dictionary_term_meta_term_lang ON dictionary_term_meta(term, language);

    CREATE TABLE IF NOT EXISTS dictionary_search_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      query TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      top_entry_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dictionary_history_user_lang ON dictionary_search_history(user_id, language, created_at);
    -- 全文搜索（FTS5）：释义/词面/读音联合索引；经触发器与词条表同步。
    -- bun 内置 SQLite 含 FTS5；缺失时由 ensureDictionaryFts 回退纯 LIKE（读侧永不抛）。
    CREATE VIRTUAL TABLE IF NOT EXISTS local_dictionary_fts USING fts5(
      entry_id UNINDEXED,
      headword,
      reading,
      meanings,
      tokenize = 'unicode61 remove_diacritics 0'
    );
    CREATE TRIGGER IF NOT EXISTS trg_dict_fts_insert AFTER INSERT ON local_dictionary_entries
    BEGIN
      INSERT INTO local_dictionary_fts (entry_id, headword, reading, meanings)
      VALUES (NEW.id, NEW.headword, COALESCE(NEW.reading, ''), NEW.meanings_json);
    END;
    CREATE TRIGGER IF NOT EXISTS trg_dict_fts_delete AFTER DELETE ON local_dictionary_entries
    BEGIN
      DELETE FROM local_dictionary_fts WHERE entry_id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS learning_content_templates (
      id TEXT PRIMARY KEY,
      language TEXT NOT NULL,
      action TEXT NOT NULL,
      format TEXT,
      skill_id TEXT,
      difficulty INTEGER NOT NULL DEFAULT 2,
      topic TEXT,
      genre TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_templates_action_lang
      ON learning_content_templates(action, language, sort_order);
    CREATE INDEX IF NOT EXISTS idx_practice_items_user ON practice_items(user_id, collected_at);

    CREATE TABLE IF NOT EXISTS daily_study_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      plan_date TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      completed_step_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS practice_plan_templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 0,
      blocks_json TEXT NOT NULL,
      schedule_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_practice_templates_user_lang
      ON practice_plan_templates(user_id, language, enabled);

    CREATE TABLE IF NOT EXISTS practice_plan_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      template_id TEXT,
      template_revision INTEGER,
      blocks_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_practice_runs_user_status
      ON practice_plan_runs(user_id, status, created_at);

    CREATE TABLE IF NOT EXISTS practice_item_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      user_answer TEXT,
      grading_result_json TEXT,
      time_spent_ms INTEGER,
      submitted_at TEXT,
      graded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_practice_attempts_run
      ON practice_item_attempts(run_id, block_id, status);

    CREATE TABLE IF NOT EXISTS anki_card_formats (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entry_type TEXT NOT NULL DEFAULT 'term',
      deck_name TEXT,
      model_name TEXT,
      fields_json TEXT NOT NULL,
      front_template TEXT NOT NULL,
      back_template TEXT NOT NULL,
      css TEXT NOT NULL,
      template_version INTEGER NOT NULL DEFAULT 1,
      user_modified INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anki_settings (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      endpoint TEXT NOT NULL DEFAULT 'http://127.0.0.1:8765',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dictionary_media (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dictionary_media_hash ON dictionary_media(file_hash);
    CREATE INDEX IF NOT EXISTS idx_dictionary_media_source ON dictionary_media(source_id);

    CREATE TABLE IF NOT EXISTS document_imports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      document_id TEXT,
      lessons INTEGER,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_document_imports_user ON document_imports(user_id, created_at);

    CREATE TABLE IF NOT EXISTS toc_import_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_key TEXT NOT NULL,
      plan_fingerprint TEXT NOT NULL,
      pdf_sha256 TEXT NOT NULL,
      page_count INTEGER NOT NULL,
      lesson_count INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'prepared',
      doc_title TEXT NOT NULL DEFAULT '',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_toc_import_sessions_user_key ON toc_import_sessions(user_id, request_key);
    CREATE TABLE IF NOT EXISTS toc_import_chunks (
      session_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      lesson_index INTEGER NOT NULL,
      lesson_title TEXT NOT NULL DEFAULT '',
      physical_start INTEGER NOT NULL,
      physical_end INTEGER NOT NULL,
      chunk_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'prepared',
      document_id TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_toc_import_chunks_session ON toc_import_chunks(session_id, ordinal);
    CREATE TABLE IF NOT EXISTS review_schedule_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      language TEXT NOT NULL,
      algorithm_id TEXT NOT NULL,
      algorithm_version TEXT NOT NULL,
      rating TEXT NOT NULL,
      input_state_json TEXT NOT NULL,
      output_state_json TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_schedule_user_card_time ON review_schedule_events(user_id, card_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_review_schedule_card_time ON review_schedule_events(card_id, created_at);
    CREATE TABLE IF NOT EXISTS content_segments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL DEFAULT '',
      ord INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
        hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_segments_scope
        ON content_segments(document_id, lesson_id, ord);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_segments_hash ON content_segments(hash);
      CREATE INDEX IF NOT EXISTS idx_content_segments_doc ON content_segments(document_id, lesson_id, ord);
    CREATE TABLE IF NOT EXISTS content_sources (
      id TEXT PRIMARY KEY,
      format TEXT NOT NULL,
      origin TEXT NOT NULL,
      origin_ref TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      license TEXT,
      attribution TEXT,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_content_sources_identity
        ON content_sources(format, origin, origin_ref);
    CREATE TABLE IF NOT EXISTS selection_contexts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      document_id TEXT,
      segment_id TEXT,
      surface TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      surrounding_text TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_selection_ctx_user ON selection_contexts(user_id, language, created_at);
    CREATE TABLE IF NOT EXISTS ai_artifact_runs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      input_snapshot_hash TEXT NOT NULL,
      adapter TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ai_artifact_action_time ON ai_artifact_runs(action, created_at);
  `);

  // 增量列：已有库补字段
  const alterStatements = [
    'ALTER TABLE annotations ADD COLUMN page_number INTEGER',
    "ALTER TABLE study_activity_logs ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    "ALTER TABLE skill_metrics ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    "ALTER TABLE flashcards ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    'ALTER TABLE flashcards ADD COLUMN source_entry_id TEXT',
    "ALTER TABLE quiz_attempts ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    "ALTER TABLE mistakes ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    "ALTER TABLE quiz_questions ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    // P6-2：题型语料（仅 dictation；可空，旧行缺省无语料）
    'ALTER TABLE quiz_questions ADD COLUMN extras_json TEXT',
    "ALTER TABLE practice_collections ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    "ALTER TABLE practice_items ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'",
    'ALTER TABLE local_dictionary_entries ADD COLUMN source_id TEXT',
    'ALTER TABLE study_activity_logs ADD COLUMN reading_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE documents ADD COLUMN source_kind_detail TEXT',
    'ALTER TABLE documents ADD COLUMN fetch_status TEXT',
    'ALTER TABLE documents ADD COLUMN news_publisher TEXT',
    // P5：扩展 practice_collections 关联计划运行（可空，向后兼容）
    'ALTER TABLE practice_collections ADD COLUMN plan_run_id TEXT',
    'ALTER TABLE practice_collections ADD COLUMN block_id TEXT',
    'ALTER TABLE practice_collections ADD COLUMN grading_mode TEXT',
    // P6-1：模板排程（可空，缺省每日适用）
    'ALTER TABLE practice_plan_templates ADD COLUMN schedule_json TEXT',
    // 词典配置与词频：开关/优先级默认启用，词频列可空（旧行缺省无词频）
    'ALTER TABLE dictionary_sources ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE dictionary_sources ADD COLUMN priority INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE dictionary_term_meta ADD COLUMN freq_json TEXT',
    'ALTER TABLE dictionary_term_meta ADD COLUMN freq_value INTEGER',
    // v31：教材目录槽位与精读课文支持
    'ALTER TABLE textbook_lessons ADD COLUMN start_page INTEGER',
    'ALTER TABLE textbook_lessons ADD COLUMN end_page INTEGER',
    "ALTER TABLE textbook_lessons ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
    'ALTER TABLE textbook_lessons ADD COLUMN passage_md TEXT',
  ];
  for (const sql of alterStatements) {
    try {
      sqlite.run(sql);
    } catch {
      /* column already exists */
    }
  }

  try {
    sqlite.run(
      'CREATE INDEX IF NOT EXISTS idx_activity_user_date_lang ON study_activity_logs(user_id, activity_date, language)'
    );
    sqlite.run('CREATE INDEX IF NOT EXISTS idx_flashcards_user_lang ON flashcards(user_id, language)');
    sqlite.run(
      'CREATE INDEX IF NOT EXISTS idx_flashcards_user_source_entry ON flashcards(user_id, source_entry_id)'
    );
    sqlite.run(
      'CREATE INDEX IF NOT EXISTS idx_mistakes_user_lang_resolved ON mistakes(user_id, language, is_resolved)'
    );
    sqlite.run(
      'CREATE INDEX IF NOT EXISTS idx_quiz_questions_user_lang ON quiz_questions(user_id, language, created_at)'
    );
    sqlite.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_plans_user_lang_date ON daily_study_plans(user_id, language, plan_date)'
    );
  } catch {
    /* ignore */
  }

  ensureDictionaryFts(sqlite);
  runMigrations(sqlite);
}

/**
 * 版本化迁移（此前的裸 DDL/ALTER 视为基线 v1）。
 * - legacy DDL 幂等先行：上方 CREATE/ALTER 全是 IF NOT EXISTS / try-catch，
 *   存量库跑完即等价 v1，直接记基线；
 * - 升级步骤登记在 `migrations/`，禁止再往本文件追加裸 ALTER。
 */

export function runMigrations(sqlite: Database): { applied: number[] } {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  let rows = sqlite.query('SELECT version, name FROM schema_migrations').all() as Array<{
    version: number;
    name: string;
  }>;

  // b012cea 之前曾把五十音讲义误登记为 v4。修复登记而不删除课程或用户数据，
  // 释放 v4 让字母 drill 计数迁移正常执行；若列尚不存在，则交给正式 v5 迁移添加。
  const legacyKanaGuideV4 = rows.some(
    (row) => row.version === 4 && row.name === 'kana-learning-guides'
  );
  if (legacyKanaGuideV4) {
    const kanaColumns = sqlite
      .query<{ name: string }, []>('PRAGMA table_info(curriculum_kana)')
      .all();
    const hasLearningGuideColumn = kanaColumns.some((column) => column.name === 'learning_guide_json');

    sqlite.run('BEGIN');
    try {
      sqlite.query('DELETE FROM schema_migrations WHERE version = 4').run();
      if (hasLearningGuideColumn) {
        sqlite
          .query(
            'INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (5, ?, ?)'
          )
          .run('kana-learning-guides', new Date().toISOString());
      }
      sqlite.run('COMMIT');
    } catch (e) {
      try {
        sqlite.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }

    rows = sqlite.query('SELECT version, name FROM schema_migrations').all() as Array<{
      version: number;
      name: string;
    }>;
  }

  const applied = new Set(rows.map((r) => r.version));

  if (applied.size === 0) {
    // 上方 legacy DDL 已执行完毕，存量/新库此刻都等价 v1，直接记基线。
    sqlite
      .query('INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)')
      .run('legacy-baseline', new Date().toISOString());
    applied.add(1);
  }
  const done: number[] = [];
  for (const m of SCHEMA_MIGRATIONS) {
    if (applied.has(m.version)) continue;
    sqlite.run('BEGIN');
    try {
      sqlite.run(m.sql);
      sqlite
        .query('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
      sqlite.run('COMMIT');
      done.push(m.version);
    } catch (e) {
      try {
        sqlite.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
  return { applied: done };
}

/**
 * 词典 FTS 自检与回填（initSchema 末尾调用）。
 * - FTS 虚拟表 + 触发器由上方 DDL 常驻；稳态增删自动同步；
 * - 存量库（触发器建成前已有词条）按计数比对触发一次性重建；
 * - FTS5 不可用时静默跳过，查询侧回退 LIKE（读侧永不抛）。
 */
export function ensureDictionaryFts(sqlite: Database): { enabled: boolean; rebuilt: number } {
  let entryCount = 0;
  try {
    entryCount = (
      sqlite.query('SELECT COUNT(*) AS n FROM local_dictionary_entries').get() as { n: number }
    ).n;
  } catch {
    return { enabled: false, rebuilt: 0 };
  }
  let ftsCount = -1;
  try {
    ftsCount = (
      sqlite.query('SELECT COUNT(*) AS n FROM local_dictionary_fts').get() as { n: number }
    ).n;
  } catch {
    return { enabled: false, rebuilt: 0 };
  }
  if (ftsCount === entryCount) return { enabled: true, rebuilt: 0 };
  try {
    sqlite.run('DELETE FROM local_dictionary_fts');
    const rows = sqlite.query(
      'SELECT id, headword, reading, meanings_json FROM local_dictionary_entries'
    ).all() as Array<{ id: string; headword: string; reading: string | null; meanings_json: string }>;
    const insert = sqlite.prepare(
      'INSERT INTO local_dictionary_fts (entry_id, headword, reading, meanings) VALUES (?, ?, ?, ?)'
    );
    const tx = sqlite.transaction((list: typeof rows) => {
      for (const r of list) {
        insert.run(r.id, r.headword, r.reading ?? '', r.meanings_json);
      }
    });
    tx(rows);
    return { enabled: true, rebuilt: rows.length };
  } catch {
    return { enabled: false, rebuilt: 0 };
  }
}
