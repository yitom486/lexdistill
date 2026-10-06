/**
 * 学习域核心前端类型契约。
 * 注意：所有历史硬编码 Mock 数据均已迁移至 SQLite 数据库作为唯一事实源 (SSOT)，
 * 本目录只保留展示层类型，禁止内置任何题库 / 卡片 / 错题内容数据。
 */

export interface QuizQuestionItem {
  id: string;
  type: 'CHOICE' | 'FILL_BLANK' | 'REORDER';
  category: string;
  prompt: string;
  content: string;
  options?: { key: string; text: string; note?: string }[];
  chunks?: string[]; // for reorder type
  reading?: { setId: string; title: string; body: string };
  correctAnswer: string;
  explanation: string;
  testedSkill: string;
}

export interface StudyCardItem {
  id: string;
  type: 'VOCAB' | 'GRAMMAR' | 'CONFUSION' | 'SENTENCE';
  frontWord: string;
  reading: string;
  tag: string;
  pos: string;
  backMeaning: string;
  exampleJp: string;
  exampleHighlight: string;
  exampleZh: string;
  note?: string;
  stability: number;
  reps: number;
  /** 完整 FSRS 快照；用于下一次排程，不能在前端重置为默认值。 */
  difficulty?: number;
  lapses?: number;
  state?: 'NEW' | 'LEARNING' | 'REVIEW' | 'RELEARNING';
  lastReviewedAt?: string;
  /** FSRS 到期时间（ISO）；缺省视为待复习 */
  dueAt?: string;
  /** 讲透时间（M2 学习门；缺省=没讲透，不进练习池 NEW 块） */
  studiedAt?: string;
  /** 词典来源条目 id（词典收藏卡才有；卡面点词弹窗凭此精确回查） */
  sourceEntryId?: string;
  vocabularyId?: string;
}

export interface MistakeNotebookItem {
  id: string;
  categoryTag: string;
  prompt: string;
  sentence: string;
  userWrongAnswer: string;
  correctAnswer: string;
  testedSkillId: string;
  reviewNote: string;
  consecutiveCorrect: number; // 0/2 or 1/2
  isResolved: boolean;
}
