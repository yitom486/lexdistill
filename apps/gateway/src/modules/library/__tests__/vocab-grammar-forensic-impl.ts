import { groundGrammarPoints, groundVocabularies } from '../application/pdf-import/vocab-enrich.js';
import type { TextbookGrammar, TextbookVocabulary } from '@lexdistill/document-model';

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
