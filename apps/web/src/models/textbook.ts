import type { LessonContent, TextbookLearningContent, TextbookAST, ContentDirectoryNode } from '@lexdistill/document-model';
/**
 * 教材前端类型契约。
 * 教材内容 SSOT 在 Gateway SQLite（documents.ast_json），
 * 本文件只保留展示层类型，禁止内置任何教材内容数据。
 */

export interface FuriganaWord {
  surface: string;
  reading?: string;
  romaji?: string;
  meaning?: string;
  pos?: string;
  pitchAccent?: string; // e.g. "⓪ 平板型"
}

export interface TextbookSentence {
  id: string;
  speaker: string;
  speakerAvatar?: string;
  japanese: string;
  furiganaTokens: FuriganaWord[];
  chinese: string;
  grammarNotes?: string[];
}

export interface TextbookVocabulary {
  id: string;
  kanji: string;
  kana: string;
  romaji: string;
  chinese: string;
  pos: string; // 词性: 名词, 动词I类, 形容词 等
  pitchAccent: string; // 声调: ⓪ ① ② 等
  pitchType: '平板型' | '头高型' | '中高型' | '尾高型' | '';
  exampleSentence: string;
  exampleTranslation: string;
}

export interface TextbookGrammarPoint {
  id: string;
  title: string;
  structure: string; // 接续方式: 名词 + は + 名词 + です
  explanation: string;
  contrast?: string; // 易混淆辨析
  examples: {
    ja: string;
    zh: string;
  }[];
}

export interface TextbookLesson {
  directory?: ContentDirectoryNode[];
  kind?: 'lesson' | 'section';
  content?: LessonContent;
  learningContent?: TextbookLearningContent;
  id: string;
  bookId: string;
  lessonNumber: number;
  title: string;
  subTitle: string;
  targetLevel: string;
  scene: string; // 场景: 见面初次寒暄, 购物问路等
  dialogues: TextbookSentence[];
  vocabularies: TextbookVocabulary[];
  grammarPoints: TextbookGrammarPoint[];
  associatedQuizTag: string; // 关联题库标签
}

export interface TextbookBook {
  canonicalAst?: TextbookAST;
  id: string;
  /** Gateway documents 行 id（已入库教材才有；未入库的新导入 AST 为空） */
  documentId?: string;
  language?: 'JA' | 'EN' | 'KO';
  title: string;
  shortTitle: string;
  publisher: string;
  totalLessons: number;
  level: string;
  lessons: TextbookLesson[];
}
