import { groundGrammarPoints, groundVocabularies } from '../application/pdf-import/vocab-enrich.js';
import type { TextbookGrammar, TextbookVocabulary } from '@study-studio/document-model';

const TEXT = 'ご飯を食べる。水を飲む。学校へ行く。先生に会う。';

/** 测试形词面 → 真实 grounding 输入（kana 必须与词面同接地，否则被丢弃）。 */
export function groundVocabsForTest(
  surfaces: string[],
  lessonId: string,
  lessonText: string = TEXT
): TextbookVocabulary[] {
  const kanaOf = (s: string): string => {
    if (s === '食べる') return 'たべる';
    if (s === '飲む') return 'のむ';
    if (s === '行く') return 'いく';
    if (s === '会う') return 'あう';
    if (s === '社員') return 'しゃいん';
    return 'かな';
  };
  const raw = surfaces.map((kanji) => ({ kanji, kana: kanaOf(kanji), chinese: '义' }));
  return groundVocabularies(structuredClone(raw), lessonText, lessonId).kept;
}

export function groundGrammarsForTest(titles: string[], lessonId: string): TextbookGrammar[] {
  const raw = titles.map((title) => ({
    title,
    connection: '接续',
    explanation: '说明',
    examples: [{ japanese: '食べる。', chinese: '吃。' }],
  }));
  return groundGrammarPoints(structuredClone(raw), lessonId).kept;
}

/** 真实 seed-repair 文法键迁移的最小复刻（id 逐字保留是断言目标，逻辑与生产一致）。 */
export function migrateGrammarForTest(item: Record<string, unknown>): { item: Record<string, unknown>; migrated: boolean } {
  const next: Record<string, unknown> = { ...item };
  let migrated = false;
  if (typeof next.structure === 'string' && typeof next.connection !== 'string') {
    next.connection = next.structure;
    delete next.structure;
    migrated = true;
  }
  if (Array.isArray(next.examples)) {
    next.examples = (next.examples as unknown[]).map((e) => {
      if (!e || typeof e !== 'object') return e;
      const er = { ...(e as Record<string, unknown>) };
      if (typeof er.ja === 'string' && typeof er.japanese !== 'string') {
        er.japanese = er.ja;
        delete er.ja;
        migrated = true;
      }
      if (typeof er.zh === 'string' && typeof er.chinese !== 'string') {
        er.chinese = er.zh;
        delete er.zh;
        migrated = true;
      }
      return er;
    });
  }
  return { item: next, migrated };
}
