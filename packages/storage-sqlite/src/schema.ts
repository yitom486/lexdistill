import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const textbookImportEvents = sqliteTable('textbook_import_events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(), traceId: text('trace_id').notNull(),
  documentId: text('document_id'), jobId: text('job_id'), nodeId: text('node_id'),
  sessionId: text('session_id'), threadId: text('thread_id'), attemptId: text('attempt_id'), callId: text('call_id'),
  category: text('category').notNull(), name: text('name').notNull(), occurredAt: text('occurred_at').notNull(), detailJson: text('detail_json').notNull(),
}, table => [index('idx_textbook_import_events_trace').on(table.userId, table.traceId, table.sequence)]);

/**
 * 学习者档案表 (Learner Profiles)
 * displayName + 当前激活轨道 target_language；其余学情字段为「当前轨道镜像」，
 * 权威按语种数据在 learner_language_profiles。
 */
export const learnerProfiles = sqliteTable('learner_profiles', {
  userId: text('user_id').primaryKey(),
  displayName: text('display_name').notNull().default(''),
  targetLanguage: text('target_language').notNull().default('en'),
  studyGoal: text('study_goal').notNull().default('CET6'),
  learnerLevel: text('learner_level').notNull().default('BEGINNER'),
  overallLevel: text('overall_level').notNull().default('B1'),
  overallProficiency: real('overall_proficiency').notNull().default(0),
  streakDays: integer('streak_days').notNull().default(0),
  maxStreakDays: integer('max_streak_days').notNull().default(0),
  lastActiveDate: text('last_active_date'),
  retentionRate: real('retention_rate').notNull().default(0.85),
  dailyGoalQuizzes: integer('daily_goal_quizzes').notNull().default(5),
  dailyGoalCards: integer('daily_goal_cards').notNull().default(10),
  totalStudyMinutes: integer('total_study_minutes').notNull().default(0),
  totalCardsReviewed: integer('total_cards_reviewed').notNull().default(0),
  totalQuizzesAnswered: integer('total_quizzes_answered').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 按目标语种隔离的学情档案（ja / en / ko）
 * 切换设置中的语种时换行，不覆盖另一语种的目标与连胜。
 */
export const learnerLanguageProfiles = sqliteTable(
  'learner_language_profiles',
  {
    userId: text('user_id').notNull(),
    language: text('language').notNull(), // 'ja' | 'en' | 'ko'
    studyGoal: text('study_goal').notNull().default('CET6'),
    learnerLevel: text('learner_level').notNull().default('BEGINNER'),
    overallLevel: text('overall_level').notNull().default('B1'),
    overallProficiency: real('overall_proficiency').notNull().default(0),
    streakDays: integer('streak_days').notNull().default(0),
    maxStreakDays: integer('max_streak_days').notNull().default(0),
    lastActiveDate: text('last_active_date'),
    retentionRate: real('retention_rate').notNull().default(0.85),
    dailyGoalQuizzes: integer('daily_goal_quizzes').notNull().default(5),
    dailyGoalCards: integer('daily_goal_cards').notNull().default(10),
    totalStudyMinutes: integer('total_study_minutes').notNull().default(0),
    totalCardsReviewed: integer('total_cards_reviewed').notNull().default(0),
    totalQuizzesAnswered: integer('total_quizzes_answered').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.language] })]
);

/**
 * 每日打卡与学情足迹表 (Study Activity Logs) — 按语种分区
 */
export const studyActivityLogs = sqliteTable(
  'study_activity_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    activityDate: text('activity_date').notNull(), // 'YYYY-MM-DD'
    language: text('language').notNull().default('ja'),
    quizzesCount: integer('quizzes_count').notNull().default(0),
    cardsReviewedCount: integer('cards_reviewed_count').notNull().default(0),
    listeningMinutes: integer('listening_minutes').notNull().default(0),
    mistakesResolvedCount: integer('mistakes_resolved_count').notNull().default(0),
    readingCount: integer('reading_count').notNull().default(0),
    /** v4：字母 drill 当日计数（带路按天判定；与 quizzesCount 分离，假名练习不再冒充自适应做题） */
    kanaCount: integer('kana_count').notNull().default(0),
    hangulCount: integer('hangul_count').notNull().default(0),
    isGoalCompleted: integer('is_goal_completed', { mode: 'boolean' }).notNull().default(false),
    intensityLevel: integer('intensity_level').notNull().default(0), // 0 ~ 4
    isOvertimeBurst: integer('is_overtime_burst', { mode: 'boolean' }).notNull().default(false),
    completedAt: text('completed_at'),
  },
  (table) => [
    index('idx_activity_user_date_lang').on(table.userId, table.activityDate, table.language),
  ]
);

/**
 * 技能掌握度雷达表 (Skill Metrics) — 显式 language + skillId 前缀双保险
 */
export const skillMetrics = sqliteTable(
  'skill_metrics',
  {
    userId: text('user_id').notNull(),
    skillId: text('skill_id').notNull(),
    language: text('language').notNull().default('ja'),
    dimension: text('dimension').notNull(),
    name: text('name').notNull(),
    proficiency: real('proficiency').notNull(),
    totalAttempts: integer('total_attempts').notNull(),
    correctAttempts: integer('correct_attempts').notNull(),
    consecutiveErrors: integer('consecutive_errors').notNull(),
    status: text('status').notNull(),
    lastPracticedAt: text('last_practiced_at'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.skillId] })]
);

/**
 * 记忆卡片表 (Flashcards)
 */
export const flashcards = sqliteTable(
  'flashcards',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    language: text('language').notNull().default('ja'),
    type: text('type').notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    phonetic: text('phonetic'),
    audioUrl: text('audio_url'),
    /** 词典来源条目；用于用户生词本去重，不替代词典包本身。 */
    sourceEntryId: text('source_entry_id'),
    tags: text('tags').notNull(),
    fsrs: text('fsrs').notNull(),
    /** v7：讲透时间（M2 学习门；NULL=没讲透，不进练习池 NEW 块）。 */
    studiedAt: text('studied_at'),
  },
  (table) => [
    index('idx_flashcards_user_lang').on(table.userId, table.language),
    index('idx_flashcards_user_source_entry').on(table.userId, table.sourceEntryId),
  ]
);

/**
 * 做题尝试历史表 (Quiz Attempts)
 */
export const quizAttempts = sqliteTable('quiz_attempts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  language: text('language').notNull().default('ja'),
  questionId: text('question_id').notNull(),
  userAnswer: text('user_answer').notNull(),
  isCorrect: integer('is_correct', { mode: 'boolean' }).notNull(),
  score: real('score').notNull(),
  timeSpentMs: integer('time_spent_ms').notNull(),
  testedSkillId: text('tested_skill_id').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * 错题本记录表 (Mistakes)
 */
export const mistakes = sqliteTable(
  'mistakes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    language: text('language').notNull().default('ja'),
    questionId: text('question_id').notNull(),
    question: text('question').notNull(),
    lastUserSubmission: text('last_user_submission').notNull(),
    lastGrading: text('last_grading').notNull(),
    recordedAt: text('recorded_at').notNull(),
    lastRetriedAt: text('last_retried_at'),
    retryCount: integer('retry_count').notNull(),
    consecutiveCorrect: integer('consecutive_correct').notNull(),
    isResolved: integer('is_resolved', { mode: 'boolean' }).notNull(),
  },
  (table) => [
    index('idx_mistakes_user_lang_resolved').on(table.userId, table.language, table.isResolved),
  ]
);

/**
 * 教材与导入文档表 (Documents)
 */
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  sourceKind: text('source_kind').notNull(), // 'user_import' | 'system' | 'ai_generated' | 'news'
  language: text('language').notNull().default('ja'),
  content: text('content').notNull(),
  astJson: text('ast_json'),
  topic: text('topic'),
  difficulty: integer('difficulty'),
  sourceUrl: text('source_url'),
  sourcePublisher: text('source_publisher'),
  examTag: text('exam_tag'),
  /** P3-B 细粒度来源类型：full_text | rss_summary | offline_template | ai | user_import */
  sourceKindDetail: text('source_kind_detail'),
  /** P3-B 抓取状态：ok | network_failed | empty | timeout（仅 news 有意义） */
  fetchStatus: text('fetch_status'),
  /** P3-B 命中的 RSS 发布方（BBC News / NHK ONE / 연합뉴스 等） */
  newsPublisher: text('news_publisher'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 划线批注与重点表 (Annotations)
 */
export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(), // 'KEY_POINT' | 'VOCAB' | 'GRAMMAR' | 'EXAM_TRAP' | 'PARAPHRASE'
  quote: text('quote').notNull(),
  note: text('note'),
  startOffset: integer('start_offset').notNull().default(0),
  endOffset: integer('end_offset').notNull().default(0),
  /** PDF 页码（1-based），纯文本批注可空 */
  pageNumber: integer('page_number'),
  createdBy: text('created_by').notNull().default('USER'), // 'USER' | 'AGENT'
  flashcardId: text('flashcard_id'),
  createdAt: text('created_at').notNull(),
});

/**
 * 五十音/假名课程底座表 (Curriculum Kana) — 日语专属
 */
export const curriculumKana = sqliteTable('curriculum_kana', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'SEION' | 'DAKUON' | 'HANDAKUON' | 'YOON' | 'SPECIAL'
  hiragana: text('hiragana').notNull(),
  katakana: text('katakana').notNull(),
  romaji: text('romaji').notNull(),
  row: text('row').notNull(),
  col: text('col').notNull(),
  mnemonic: text('mnemonic'),
  learningGuideJson: text('learning_guide_json'),
  audioText: text('audio_text').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

/**
 * 假名逐项复习状态：与聚合 skill_metrics 分离，供自适应题队列使用。
 * 同一假名的平假名、片假名和罗马字练习分别计算间隔。
 */
export const kanaPracticeStates = sqliteTable(
  'kana_practice_states',
  {
    userId: text('user_id').notNull(),
    kanaId: text('kana_id').notNull(),
    scriptType: text('script_type').notNull(),
    fsrsJson: text('fsrs_json').notNull(),
    consecutiveErrors: integer('consecutive_errors').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kanaId, table.scriptType] }),
    index('idx_kana_practice_states_user_script').on(table.userId, table.scriptType, table.updatedAt),
  ]
);

/**
 * 谚文字母课程底座表 (Curriculum Hangul) — 韩语专属（v1：14 子音 + 10 母音）
 */
export const curriculumHangul = sqliteTable('curriculum_hangul', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'CONSONANT' | 'VOWEL'
  jamo: text('jamo').notNull(),
  name: text('name').notNull(),
  romanization: text('romanization').notNull(),
  row: text('row').notNull(),
  col: text('col').notNull(),
  mnemonic: text('mnemonic'),
  audioText: text('audio_text').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

/**
 * 自适应题库表 (Quiz Questions)
 */
export const quizQuestions = sqliteTable(
  'quiz_questions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().default('default_user'),
    language: text('language').notNull().default('ja'),
    type: text('type').notNull(), // 'CHOICE' | 'FILL_BLANK' | 'REORDER'
    category: text('category').notNull(),
    prompt: text('prompt').notNull(),
    content: text('content').notNull(),
    options: text('options'), // JSON string of options [{ key, text, note }]
    chunks: text('chunks'), // JSON string of chunks ['a', 'b']
    correctAnswer: text('correct_answer').notNull(),
    explanation: text('explanation').notNull(),
    testedSkillId: text('tested_skill_id').notNull(),
    difficulty: integer('difficulty').notNull().default(3),
    /**
     * P6-2：题型语料 JSON（仅 dictation 子结构；reading 正文不入库，仍随 run 携带）。
     * 可空；旧行缺省无语料，向后兼容。
     */
    extrasJson: text('extras_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_quiz_questions_user_lang').on(table.userId, table.language, table.createdAt),
  ]
);

/**
 * 一次「出 N 道 / 阅读套题」练习会话（≠ FSRS 卡）
 */
export const practiceCollections = sqliteTable('practice_collections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  language: text('language').notNull().default('ja'),
  title: text('title').notNull(),
  intent: text('intent').notNull().default('GENERATE_QUIZ'),
  layoutHint: text('layout_hint'), // 'SPLIT_PASSAGE_QUESTIONS' | 'SINGLE_COLUMN' | null
  sourceRef: text('source_ref'),
  // P5：关联练习运行/块/批改模式
  planRunId: text('plan_run_id'),
  blockId: text('block_id'),
  gradingMode: text('grading_mode'),
  createdAt: text('created_at').notNull(),
});

/**
 * 练习队列条目（可映射 GeneratedQuestion JSON）
 */
export const practiceItems = sqliteTable('practice_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  language: text('language').notNull().default('ja'),
  collectionId: text('collection_id').notNull(),
  questionJson: text('question_json').notNull(),
  skillIds: text('skill_ids'), // JSON string array
  sourceRef: text('source_ref'),
  passageDocumentId: text('passage_document_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  collectedAt: text('collected_at').notNull(),
});

/**
 * 本地词典条目：仅收录本项目自有或已明确获授权再分发的数据。
 * 未命中时由 Gateway 返回外部词典链接；不缓存、不抓取第三方页面内容。
 */
export const localDictionaryEntries = sqliteTable(
  'local_dictionary_entries',
  {
    id: text('id').primaryKey(),
    language: text('language').notNull(), // 'ja' | 'en' | 'ko'
    headword: text('headword').notNull(),
    reading: text('reading'),
    romanization: text('romanization'),
    meaningsJson: text('meanings_json').notNull(),
    pronunciationJson: text('pronunciation_json'),
    partOfSpeech: text('part_of_speech'),
    sourceId: text('source_id'),
    sourceLabel: text('source_label').notNull(),
    licenseNote: text('license_note').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_local_dictionary_language_headword').on(table.language, table.headword)]
);

/** 每个已安装词典包的版本、来源与署名信息。 */
export const dictionarySources = sqliteTable('dictionary_sources', {
  id: text('id').primaryKey(),
  language: text('language').notNull(),
  provider: text('provider').notNull(),
  version: text('version').notNull(),
  sourceUrl: text('source_url').notNull(),
  licenseName: text('license_name').notNull(),
  licenseUrl: text('license_url').notNull(),
  attribution: text('attribution').notNull(),
  entryCount: integer('entry_count').notNull().default(0),
  importedAt: text('imported_at').notNull(),
  /** 用户开关（0=禁用，查词时过滤）；默认启用 */
  enabled: integer('enabled').notNull().default(1),
  /** 排序权重（越大越前；默认 0） */
  priority: integer('priority').notNull().default(0),
});

/**
 * 词条级元数据覆盖层（如 Yomitan term_meta_bank 声调）。
 * 与词条表分离：meta 包可独立安装/重装；词条安装时自动回填 pronunciation。
 */export const dictionaryTermMeta = sqliteTable(
  'dictionary_term_meta',
  {
    term: text('term').notNull(),
    reading: text('reading').notNull().default(''),
    language: text('language').notNull(),
    pitchJson: text('pitch_json'),
    /** 词频（数字越小越常用；Yomitan freq 覆盖层） */
    freqJson: text('freq_json'),
    /** 词频数值（专供排序，NULL 表未知） */
    freqValue: integer('freq_value'),
    sourceId: text('source_id').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.term, table.reading, table.sourceId] }),
    index('idx_dictionary_term_meta_term_lang').on(table.term, table.language),
  ]
);

/** 查词历史（用户学习资产：画像“查过什么”信号源；按用户+语种隔离，保留最近 200 条）。 */
export const dictionarySearchHistory = sqliteTable(
  'dictionary_search_history',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    language: text('language').notNull(),
    query: text('query').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    topEntryId: text('top_entry_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_dictionary_history_user_lang').on(table.userId, table.language, table.createdAt),
  ]
);

/**
 * learning.content 离线/冷启动内容模板库（工具运行时只读，不在 TS 内硬编码题干）
 */
export const learningContentTemplates = sqliteTable(
  'learning_content_templates',
  {
    id: text('id').primaryKey(),
    language: text('language').notNull(),
    action: text('action').notNull(),
    format: text('format'),
    skillId: text('skill_id'),
    difficulty: integer('difficulty').notNull().default(2),
    topic: text('topic'),
    genre: text('genre'),
    sortOrder: integer('sort_order').notNull().default(0),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_content_templates_action_lang').on(table.action, table.language, table.sortOrder),
  ]
);

/**
 * 当日学习计划：步骤顺序按日冻结，完成态由打卡日志实时叠加
 */
export const dailyStudyPlans = sqliteTable(
  'daily_study_plans',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    language: text('language').notNull(),
    planDate: text('plan_date').notNull(), // YYYY-MM-DD
    stepsJson: text('steps_json').notNull(),
    completedStepIdsJson: text('completed_step_ids_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_daily_plans_user_lang_date').on(table.userId, table.language, table.planDate),
  ]
);

/**
 * P5：用户练习计划模板（长期配置，不等于今天的进度）。
 * 每天从模板冻结一次不可变的 practice_plan_runs。
 */
export const practicePlanTemplates = sqliteTable('practice_plan_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  language: text('language').notNull(),
  name: text('name').notNull(),
  enabled: integer('enabled').notNull().default(1),
  revision: integer('revision').notNull().default(0),
  blocksJson: text('blocks_json').notNull(),
  /** P6-1：排程 JSON（daily/weekly），可空；缺省 = 每日适用，向后兼容 */
  scheduleJson: text('schedule_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * P5：练习计划执行会话（冻结快照）。
 * 记录当时模板 revision 与块规格副本，改模板后旧 run 不变。
 */
export const practicePlanRuns = sqliteTable('practice_plan_runs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  language: text('language').notNull(),
  templateId: text('template_id'),
  templateRevision: integer('template_revision'),
  blocksJson: text('blocks_json').notNull(),
  status: text('status').notNull().default('IN_PROGRESS'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
});

/**
 * P5：单题尝试（草稿/已提交/已批改）。
 * 完成批改后由领域服务原子写入既有 quiz_attempts/错题/打卡；本表只存计划运行态。
 */
export const practiceItemAttempts = sqliteTable('practice_item_attempts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  blockId: text('block_id').notNull(),
  itemId: text('item_id').notNull(),
  status: text('status').notNull().default('PENDING'),
  userAnswer: text('user_answer'),
  gradingResultJson: text('grading_result_json'),
  timeSpentMs: integer('time_spent_ms'),
  submittedAt: text('submitted_at'),
  gradedAt: text('graded_at'),
});

/**
 * Anki 卡片模板包（统一交换格式；用户模板优先，内置升级不覆盖 user_modified=1 的行）。
 * 模板本身是呈现资产；FSRS 调度仍由 flashcards + learner-core 掌控。
 */
export const ankiCardFormats = sqliteTable('anki_card_formats', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  entryType: text('entry_type').notNull().default('term'),
  deckName: text('deck_name'),
  modelName: text('model_name'),
  fieldsJson: text('fields_json').notNull(),
  frontTemplate: text('front_template').notNull(),
  backTemplate: text('back_template').notNull(),
  css: text('css').notNull(),
  templateVersion: integer('template_version').notNull().default(1),
  userModified: integer('user_modified').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

/**
 * AnkiConnect 推送开关（EXTERNAL 桥接，默认关闭；endpoint 仅本机回环）。
 * TTS 凭证永不落盘：推送时由调用方随请求携带，用完即弃。
 */
export const ankiSettings = sqliteTable('anki_settings', {
  id: text('id').primaryKey(),
  enabled: integer('enabled').notNull().default(0),
  endpoint: text('endpoint').notNull().default('http://127.0.0.1:8765'),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 用户媒体库（词典/Anki 图片音频落盘；小文件亦落盘，SQLite 只存路径/哈希/类型）。
 * 内容寻址（file_hash 去重）；path 相对媒体根目录，永不存绝对路径。
 */export const dictionaryMedia = sqliteTable('dictionary_media', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  path: text('path').notNull(),
  mediaType: text('media_type').notNull(),
  fileHash: text('file_hash').notNull(),
  fileSize: integer('file_size').notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * 文档导入任务（LinguaCafe 式 raw/processed 分离的轻量实现）。
 * 原文不进库（大文件走本机路径引用）；任务行记录状态机 processing→done/failed，
 * 失败可重试、解析器升级后可重跑（调用方重发同一输入即可）。
 */
export const documentImports = sqliteTable('document_imports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sourceKind: text('source_kind').notNull(),
  filename: text('filename').notNull(),
  status: text('status').notNull().default('processing'),
  documentId: text('document_id'),
  lessons: integer('lessons'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 整书目录导入 session（v19 建表，v20 加 document_id，v21 加 ast_fingerprint；
 * 与 ddl.ts 建表 SQL 一字对齐，SSOT 是 ddl.ts）。
 * - 一行 = 一次“用户确认的整书计划”，计划 immutable（无 entries/anchors 更新路径）；
 * - request_key 由服务端重算（user + PDF SHA-256 + canonical plan fingerprint），
 *   同 user/key 唯一，重试复用同一 session；
 * - D2A 只写 prepared 行，不建 documents、不调 converter/shred；
 * - target document 关系在 session 层（v20 document_id，可空）：
 *   D2B 首个成功 chunk 在同一事务创建文档并绑定；后续 chunk 只更新同一文档；
 *   chunk 层 document_id 已废弃（invariant 恒 NULL，见 doctor 规则）；


/**
 * 复习排程事件（v22；只追加、不更新不删除）。
 * - 一行 = 一次排程计算：身份（user/card/language）+ 算法版本 + 评分 +
 *   输入/输出 FSRS 快照（JSON）+ evaluatedAt（输入 now，非 wall-clock）；
 * - 与 ddl.ts 的建表 SQL 一字对齐，SSOT 是 ddl.ts；
 * - 写入与同事务提交留给后续任务，本文件只定形状。
 */
export const reviewScheduleEvents = sqliteTable(
  'review_schedule_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    cardId: text('card_id').notNull(),
    language: text('language').notNull(),
    algorithmId: text('algorithm_id').notNull(),
    algorithmVersion: text('algorithm_version').notNull(),
    rating: text('rating').notNull(),
    inputStateJson: text('input_state_json').notNull(),
    outputStateJson: text('output_state_json').notNull(),
    evaluatedAt: text('evaluated_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_review_schedule_user_card_time').on(table.userId, table.cardId, table.createdAt),
    index('idx_review_schedule_card_time').on(table.cardId, table.createdAt),
  ]
);

/**
 * 教材 shred 行表（v14/v16/v17；与 ddl.ts 的建表 SQL 一字对齐，SSOT 是 ddl.ts）。
 * - 查询面：组卷/检索/统计读这里，不读 ast_json；
 * - 底稿 documents.ast_json 改后由 shredDocument 同事务全删全插重建；
 * - FTS 虚表 drizzle 无一等支持，保持原生 SQL（见 textbook-shred.ts），故不在此声明。
 * - v17 语义：lesson_id=冻结的 positional identity；sort_order=canonical 顺序唯一 truth
 *   （最终 AST lessons[] index+1，1-based 连续）；lesson_number=legacy compatibility
 *   （可 gap，不排序，不展示）；title=raw parser/OCR heading candidate。
 * - DB 列 sort_order 保持 nullable（SQLite 不支持事后加 NOT NULL）：invariant 由
 *   shred 全写 + doctor FAIL 规则锁，读侧必须收窄后使用。
 */
export const textbookLessons = sqliteTable(
  'textbook_lessons',
  {
    documentId: text('document_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    lessonNumber: integer('lesson_number').notNull(),
    title: text('title').notNull(),
    sortOrder: integer('sort_order'),
    /** v30 章层级：'lesson' | 'chapter'；章经 parent_id 挂课（可空即顶层）。 */
    kind: text('kind').notNull().default('lesson'),
    parentId: text('parent_id'),
    /** v31 目录识别页码与槽位生命周期支持 */
    startPage: integer('start_page'),
    endPage: integer('end_page'),
    status: text('status').notNull().default('pending'),
    /** v31 整篇精读课文/对话 Markdown（取代旧行级碎片表 textbook_lines） */
    passageMd: text('passage_md'),
    /** v33 AI 教学增强字段：预习导学与课后总结 */
    previewJson: text('preview_json'),
    summaryJson: text('summary_json'),
    contentJson: text('content_json'),
    submissionId: text('submission_id'),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.lessonId] })]
);

export const textbookVocab = sqliteTable(
  'textbook_vocab',
  {
    documentId: text('document_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    ord: integer('ord').notNull(),
    surface: text('surface').notNull(),
    reading: text('reading'),
    pos: text('pos'),
    glossZh: text('gloss_zh'),
    pitch: text('pitch'),
    exampleJa: text('example_ja'),
    exampleZh: text('example_zh'),
    source: text('source'),
    tocId: text('toc_id'),
    fieldSourcesJson: text('field_sources_json'),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.lessonId, table.ord] })]
);

export const textbookGrammar = sqliteTable(
  'textbook_grammar',
  {
    documentId: text('document_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    ord: integer('ord').notNull(),
    title: text('title').notNull(),
    connection: text('connection'),
    explanation: text('explanation'),
    examplesJson: text('examples_json').notNull().default('[]'),
    source: text('source'),
    tocId: text('toc_id'),
    aiExplanation: text('ai_explanation'),
    fieldSourcesJson: text('field_sources_json'),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.lessonId, table.ord] })]
);

export const textbookLines = sqliteTable(
  'textbook_lines',
  {
    documentId: text('document_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    ord: integer('ord').notNull(),
    speaker: text('speaker'),
    ja: text('ja').notNull(),
    zh: text('zh'),
    blockId: text('block_id'),
    kind: text('kind'),
    source: text('source'),
    tocId: text('toc_id'),
    fieldSourcesJson: text('field_sources_json'),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.lessonId, table.ord] })]
);

export const textbookExercises = sqliteTable(
  'textbook_exercises',
  {
    documentId: text('document_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    ord: integer('ord').notNull(),
    exerciseId: text('exercise_id'),
    type: text('type').notNull(),
    prompt: text('prompt').notNull(),
    optionsJson: text('options_json').notNull().default('[]'),
    answer: text('answer').notNull().default(''),
    explanation: text('explanation'),
    source: text('source'),
    tocId: text('toc_id'),
    answerJson: text('answer_json'),
    contentJson: text('content_json'),
    fieldSourcesJson: text('field_sources_json'),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.lessonId, table.ord] })]
);

/**
 * 蒸馏知识点（v30；目录挂载，可悬空原文）。
 * - lesson_id 锚目录节点（含章 kind）；concept 为归一概念（跨书去重键由应用层定）；
 * - source_refs_json 指回原文行 id 数组（可空＝悬空知识点，照常可学可考）；
 * - 与 content_segments 同性质：幂等投影、可重建，写入口收归领域命令（未接线前只建表）。
 */
export const knowledgePoints = sqliteTable(
  'knowledge_points',
  {
    id: text('id').notNull(),
    documentId: text('document_id').notNull(),
    lessonId: text('lesson_id').notNull(),
    kind: text('kind').notNull().default('concept'),
    ord: integer('ord').notNull().default(0),
    concept: text('concept').notNull(),
    explanationMd: text('explanation_md').notNull().default(''),
    sourceRefsJson: text('source_refs_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index('idx_knowledge_points_lesson').on(table.documentId, table.lessonId, table.ord),
  ]
);

/**
 * Seed materialization state（v18 P1-D1；startup gating 专用持久状态）。
 * - 只有 atomic materialize 成功才写入/更新（与 shred 同一事务，rollback 联动）；
 * - fingerprint 语义见 seed-materialization.ts（AST + mapping 切片 + materializer 版本）；
 * - 用户文档永不进此表（种子专用）。
 */
export const seedMaterialization = sqliteTable('seed_materialization', {
  documentId: text('document_id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  materializerVersion: integer('materializer_version').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 阅读位置（每用户每文档一条；locator 为不透明 JSON）。
 * 与 ddl.ts 对齐；upsert 语义由调用方经 onConflictDoUpdate 表达。
 */
export const readingPositions = sqliteTable(
  'reading_positions',
  {
    userId: text('user_id').notNull(),
    documentId: text('document_id').notNull(),
    locator: text('locator').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.documentId] })]
);

/**
 * 文档结构分类结果（一文档一行，后跑覆盖先跑；与 ddl.ts v15 对齐）。
 */
export const documentStructures = sqliteTable('document_structure', {
  documentId: text('document_id').primaryKey(),
  userId: text('user_id').notNull(),
  headingsJson: text('headings_json').notNull().default('[]'),
  classesJson: text('classes_json').notNull().default('[]'),
  model: text('model').notNull().default(''),
  effort: text('effort').notNull().default(''),
  dropped: integer('dropped').notNull().default(0),
  createdAt: text('created_at').notNull(),
});

/**
 * 内容段地址（v23；与 ddl.ts 建表 SQL 一字对齐，SSOT 是 ddl.ts）。
 * - lesson_id='' 即文档直属段，明确无外键（与真实 lesson_id 互斥）；
 * - hash 为作用域身份（document/lesson/ord/text），UNIQUE(hash) 保并发投影零重复；
 * - 用户隔离经 documents 行继承，查询一律带 document 归属。
 */
export const contentSegments = sqliteTable(
  'content_segments',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    lessonId: text('lesson_id').notNull().default(''),
    ord: integer('ord').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    hash: text('hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_content_segments_scope').on(table.documentId, table.lessonId, table.ord),
    uniqueIndex('idx_content_segments_hash').on(table.hash),
    index('idx_content_segments_doc').on(table.documentId, table.lessonId, table.ord),
  ]
);

/**
 * 统一来源登记（v24；SSOT 是 ddl.ts）。
 * display_name 可变展示列，不进唯一键；身份＝(format, origin, origin_ref)。
 */
export const contentSources = sqliteTable(
  'content_sources',
  {
    id: text('id').primaryKey(),
    format: text('format').notNull(),
    origin: text('origin').notNull(),
    originRef: text('origin_ref').notNull().default(''),
    displayName: text('display_name').notNull(),
    license: text('license'),
    attribution: text('attribution'),
    capabilitiesJson: text('capabilities_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_content_sources_identity').on(table.format, table.origin, table.originRef)]
);

/**
 * 选区上下文（v25；SSOT 是 ddl.ts）。
 * SI-1/SI-2/SI-3 由 Repository 层执行，本表保持列可空以容纳自由文本选区。
 */
export const selectionContexts = sqliteTable(
  'selection_contexts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    language: text('language').notNull(),
    documentId: text('document_id'),
    segmentId: text('segment_id'),
    surface: text('surface').notNull(),
    normalizedText: text('normalized_text').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    surroundingText: text('surrounding_text'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_selection_ctx_user').on(table.userId, table.language, table.createdAt)]
);

/**
 * AI 运行审计（v28；只插不改；SSOT 是 ddl.ts）。
 * 输入只存快照 hash（不存原文/作答），读口另批。
 */
export const aiArtifactRuns = sqliteTable(
  'ai_artifact_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().default(''),
    action: text('action').notNull(),
    inputSnapshotHash: text('input_snapshot_hash').notNull(),
    adapter: text('adapter').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    schemaVersion: text('schema_version').notNull(),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [index('idx_ai_artifact_action_time').on(table.action, table.createdAt)]
);
