/**
 * 语言形态注册表（clean-room）。
 *
 * 各语种的词形还原实现（日语活用 / 英语屈折 / 韩语活用）在此登记，
 * 查词主链路只认注册表，不再写 if (language === ...) 分支。
 * 新增语种 = 登记一项（含该语种的前置字符门控），不动调用方。
 * 分析器本身是纯函数；存在性过滤永远由调用方完成。
 */

import type { CoarsePos } from './part-of-speech.js';
import { deinflectJa } from './deinflect.js';
import { stemEn } from './en-stem.js';
import { deinflectKo } from './ko-deinflect.js';

/**
 * 语种键（'ja' | 'en' | 'ko'，与 protocol TargetLanguageCode /
 * infra TrackLanguage 同构；本包零依赖，故用内联字面量，M-lexicon 再收敛）。
 */
export type DictionaryLanguage = 'ja' | 'en' | 'ko';

export interface MorphCandidate {
  base: string;
  note: string;
  depth: number;
  pos: CoarsePos;
}

export interface MorphAnalyzer {
  /** 该分析器是否接管此查询（如日语要求含假名/汉字，避免纯英文误入）。 */
  supports: (normalized: string) => boolean;
  analyze: (normalized: string) => MorphCandidate[];
  /** 注记动词（日语/韩语“活用自”，英语“还原为”）。 */
  verb: string;
}

const JA_ANALYZER: MorphAnalyzer = {
  supports: (text) => /[぀-ヿｦ-ﾟ一-鿿]/.test(text),
  analyze: (text) => deinflectJa(text),
  verb: '活用自',
};

const EN_ANALYZER: MorphAnalyzer = {
  supports: (text) => /^[a-zA-Z][a-zA-Z'’-]*$/.test(text),
  analyze: (text) => stemEn(text),
  verb: '还原为',
};

const KO_ANALYZER: MorphAnalyzer = {
  supports: (text) => /[가-힣]/.test(text),
  analyze: (text) => deinflectKo(text),
  verb: '活用自',
};

const MORPH_ANALYZERS: Record<DictionaryLanguage, MorphAnalyzer | undefined> = {
  ja: JA_ANALYZER,
  en: EN_ANALYZER,
  ko: KO_ANALYZER,
};

/** 取某语种的形态分析器（无登记返回 undefined，不抛）。 */
export function getMorphAnalyzer(language: DictionaryLanguage): MorphAnalyzer | undefined {
  return MORPH_ANALYZERS[language];
}
