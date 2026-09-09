import type { Database } from 'bun:sqlite';

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
  ];
  for (const sql of alterStatements) {
    try {
      sqlite.exec(sql);
    } catch {
      /* column already exists */
    }
  }

  try {
    sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_activity_user_date_lang ON study_activity_logs(user_id, activity_date, language)'
    );
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_flashcards_user_lang ON flashcards(user_id, language)');
    sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_flashcards_user_source_entry ON flashcards(user_id, source_entry_id)'
    );
    sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_mistakes_user_lang_resolved ON mistakes(user_id, language, is_resolved)'
    );
    sqlite.exec(
      'CREATE INDEX IF NOT EXISTS idx_quiz_questions_user_lang ON quiz_questions(user_id, language, created_at)'
    );
    sqlite.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_plans_user_lang_date ON daily_study_plans(user_id, language, plan_date)'
    );
  } catch {
    /* ignore */
  }

  ensureDictionaryFts(sqlite);
  runMigrations(sqlite);
}

/**
 * 版本化迁移（2026-09 新增；此前的裸 DDL/ALTER 视为基线 v1）。
 * - legacy DDL 幂等先行：上方 CREATE/ALTER 全是 IF NOT EXISTS / try-catch，
 *   存量库跑完即等价 v1，直接记基线；
 * - 此后所有结构变更必须追加 MIGRATIONS 条目，禁止再加裸 ALTER。
 */
interface SchemaMigration {
  version: number;
  name: string;
  sql: string;
}

const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    version: 2,
    name: 'encountered-terms',
    sql: `
      CREATE TABLE IF NOT EXISTS encountered_terms (
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        headword TEXT NOT NULL,
        reading TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        exposure_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        flashcard_id TEXT,
        PRIMARY KEY (user_id, language, term_key)
      );
      CREATE TABLE IF NOT EXISTS term_occurrences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        source TEXT NOT NULL,
        document_id TEXT,
        quote TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_term_occurrences_user_term
        ON term_occurrences(user_id, language, term_key, created_at);
      CREATE INDEX IF NOT EXISTS idx_encountered_terms_user_lang
        ON encountered_terms(user_id, language, last_seen_at);
    `,
  },
  {
    version: 3,
    name: 'card-drafts-reading-positions',
    sql: `
      CREATE TABLE IF NOT EXISTS card_drafts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        headword TEXT NOT NULL,
        reading TEXT,
        meanings_json TEXT NOT NULL,
        part_of_speech TEXT,
        source TEXT NOT NULL,
        source_ref TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        edited_fields_json TEXT NOT NULL DEFAULT '[]',
        flashcard_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_card_drafts_user_lang_status
        ON card_drafts(user_id, language, status, updated_at);
      CREATE TABLE IF NOT EXISTS reading_positions (
        user_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        locator TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, document_id)
      );
    `,
  },
  {
    // v4：打卡日志加字母 drill 当日计数（带路按天判定的数据源；全新列，版本门保证只执行一次，原子提交）。
    version: 4,
    name: 'activity-alphabet-counts',
    sql: `
      ALTER TABLE study_activity_logs ADD COLUMN kana_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE study_activity_logs ADD COLUMN hangul_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // v5：五十音讲义资产；旧版数据库可能已误将该变更登记为 v4。
    version: 5,
    name: 'kana-learning-guides',
    sql: `
      ALTER TABLE curriculum_kana ADD COLUMN learning_guide_json TEXT;
    `,
  },
  {
    // v6：定级考记录表（跳级通道；自动升降级不依赖它，通过行仅用于当日掉级豁免）。
    version: 6,
    name: 'placement-exams',
    sql: `
      CREATE TABLE IF NOT EXISTS placement_exams (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        language TEXT NOT NULL,
        target_level TEXT NOT NULL,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        accuracy REAL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_placement_user_lang
        ON placement_exams(user_id, language, created_at);
    `,
  },
  {
    // v7：闪卡讲透时间（M2 学习门；存量 NULL=没讲透，不挡复习，只挡练习池 NEW 块）。
    version: 7,
    name: 'flashcards-studied-at',
    sql: `
      ALTER TABLE flashcards ADD COLUMN studied_at TEXT;
    `,
  },
  {
    // v8：假名逐项 FSRS 状态，用于按用户历史动态组建短练习队列。
    version: 8,
    name: 'kana-practice-states',
    sql: `
      CREATE TABLE IF NOT EXISTS kana_practice_states (
        user_id TEXT NOT NULL,
        kana_id TEXT NOT NULL,
        script_type TEXT NOT NULL,
        fsrs_json TEXT NOT NULL,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, kana_id, script_type)
      );
      CREATE INDEX IF NOT EXISTS idx_kana_practice_states_user_script
        ON kana_practice_states(user_id, script_type, updated_at);
    `,
  },
  {
    // v9：草稿句子类型（kind/card_type；存量行读侧默认 word/VOCABULARY）。
    version: 9,
    name: 'card-drafts-kind',
    sql: `
      ALTER TABLE card_drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'word';
      ALTER TABLE card_drafts ADD COLUMN card_type TEXT;
    `,
  },
  {
    // v10：词条例句缓存（AI 按需生成 + 永久缓存，供讲透卡/练习复用）。
    version: 10,
    name: 'term-examples',
    sql: `
      CREATE TABLE IF NOT EXISTS term_examples (
        id TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        term_key TEXT NOT NULL,
        headword TEXT NOT NULL,
        sentence TEXT NOT NULL,
        translation TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'ai',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_term_examples_unique
        ON term_examples(language, term_key, sentence);
    `,
  },
  {
    // v11：语法讲义（先讲后测）：课程公共资产 + 用户学完进度。
    // curriculum_lessons.id 即技能 id（= quiz testedSkillId），有讲义且未学完的技能，
    // 系统代选出题时不出（NEED_LESSON）；用户自选/课内小测/定级考/自家卡豁免。
    version: 11,
    name: 'curriculum-lessons',
    sql: `
      CREATE TABLE IF NOT EXISTS curriculum_lessons (
        id TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        min_level TEXT NOT NULL DEFAULT 'NOVICE',
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        body_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_lessons_lang ON curriculum_lessons(language, sort_order);
      CREATE TABLE IF NOT EXISTS lesson_progress (
        user_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (user_id, skill_id)
      );
    `,
  },
  {
    // v12：课程单元掌握记录（只记 mastered，不过渡态；已记录永不自动收回）。
    // 证据全部来自既有表（做题/假名/讲义/生词/测评），本表只存结论 + 快照。
    version: 12,
    name: 'unit-progress',
    sql: `
      CREATE TABLE IF NOT EXISTS unit_progress (
        user_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'mastered',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, unit_id)
      );
    `,
  },
  {
    // v13：阶段测评蓝图版本 + 分项成绩（蓝图v1：技能组/题数/答对线/机动题）。
    version: 13,
    name: 'placement-blueprint',
    sql: `
      ALTER TABLE placement_exams ADD COLUMN blueprint_version TEXT;
      ALTER TABLE placement_exams ADD COLUMN blueprint_json TEXT;
      ALTER TABLE placement_exams ADD COLUMN subscores_json TEXT;
    `,
  },
  {
    // v14：教材 shred——AST 大绳拆成关系行 + FTS + 知识映射（只建表，不写数据）。
    // - 四张行表与 documents.ast_json 同源（底稿保留），落库/enrich 时同事务全删全插；
    // - textbook_term_map 只记精确匹配（skill_id/entry_id 为空=未映射，可统计覆盖率，绝不臆造边）；
    // - FTS 为 contentless 手工同步（shred 时同事务重建），不设触发器。
    version: 14,
    name: 'textbook-shred',
    sql: `
      CREATE TABLE IF NOT EXISTS textbook_lessons (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        lesson_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        PRIMARY KEY (document_id, lesson_id)
      );
      CREATE TABLE IF NOT EXISTS textbook_vocab (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        surface TEXT NOT NULL,
        reading TEXT,
        pos TEXT,
        gloss_zh TEXT,
        pitch TEXT,
        example_ja TEXT,
        example_zh TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_vocab_surface
        ON textbook_vocab(document_id, surface);
      CREATE TABLE IF NOT EXISTS textbook_grammar (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        title TEXT NOT NULL,
        connection TEXT,
        explanation TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE TABLE IF NOT EXISTS textbook_lines (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        speaker TEXT,
        ja TEXT NOT NULL,
        zh TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_lines_lesson
        ON textbook_lines(document_id, lesson_id, ord);
      CREATE VIRTUAL TABLE IF NOT EXISTS textbook_fts USING fts5(
        surface, reading, gloss, ja, zh,
        document_id UNINDEXED, lesson_id UNINDEXED, kind UNINDEXED, ref UNINDEXED
      );
      CREATE TABLE IF NOT EXISTS textbook_term_map (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ref_text TEXT NOT NULL,
        skill_id TEXT,
        entry_id TEXT,
        PRIMARY KEY (document_id, lesson_id, kind, ref_text)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_term_map_skill
        ON textbook_term_map(skill_id);
      CREATE INDEX IF NOT EXISTS idx_textbook_term_map_entry
        ON textbook_term_map(entry_id);
    `,
  },
  {
    // v15：文档结构分类结果（mini 模型判选 + 接地校验；观测先行，不影响导入主流程）。
    // 一文档一行（后跑覆盖先跑）；headings 为输入候选，classes 为校验后输出。
    version: 15,
    name: 'document-structure',
    sql: `
      CREATE TABLE IF NOT EXISTS document_structure (
        document_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        headings_json TEXT NOT NULL DEFAULT '[]',
        classes_json TEXT NOT NULL DEFAULT '[]',
        model TEXT NOT NULL DEFAULT '',
        effort TEXT NOT NULL DEFAULT '',
        dropped INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    // v16：教材六层补齐——自带习题拆行 + 文法例句落列（读路径切换的前置）。
    // - textbook_exercises：AST exercises 同源拆行（ord 保序，exercise_id 透传 AST 原 id）；
    // - textbook_grammar.examples_json：[{japanese, chinese}] 全量存（此前只在 AST，查询面够不着）；
    // - 只建结构不写数据：存量书的习题/例句随下一次 enrich/append/shred 回填（全删全插天然覆盖）。
    version: 16,
    name: 'textbook-exercises-grammar-examples',
    sql: `
      CREATE TABLE IF NOT EXISTS textbook_exercises (
        document_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        exercise_id TEXT,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        options_json TEXT NOT NULL DEFAULT '[]',
        answer TEXT NOT NULL DEFAULT '',
        explanation TEXT,
        PRIMARY KEY (document_id, lesson_id, ord)
      );
      CREATE INDEX IF NOT EXISTS idx_textbook_exercises_lesson
        ON textbook_exercises(document_id, lesson_id, ord);
      ALTER TABLE textbook_grammar ADD COLUMN examples_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
];

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
      sqlite.exec(m.sql);
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
