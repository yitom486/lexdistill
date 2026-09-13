import type { ToolExecutionContext } from '@study-studio/tool-core';
import { err, generateId, isOk, ok, type Result, BusinessError } from '@study-studio/shared';
import type { LexiconRepository } from '../../../modules/dictionary/ports.js';
import type { LearningContentInput, LearningContentOutput } from '../learning-content-tool.js';

export interface KanaWord {
  id: string;
  /** 词典条目 id（可直接调收集接口转 FSRS 生词卡）。 */
  entryId: string;
  headword: string;
  /** 假名读音（听写播报与作答比对用）。 */
  kana: string;
  meanings: string[];
  /** TTS 朗读文本（即 kana）。 */
  audioText: string;
  sourceLabel: string;
}

/** 假名读音（含 ー・长音与中点；汉字/拉丁混入一律排除）。 */
const KANA_READING_RE = /^[\u3040-\u30FFー・\s]+$/;
const KATAKANA_RE = /[\u30A0-\u30FF]/;
const HIRAGANA_RE = /[\u3040-\u309F]/;

/**
 * 假名单词动作：从本地词典随机抽取带假名读音的词语，供听写/词义巩固。
 * 系统随机出题（零成本即时）；主观写作批改仍走 learning.assess。
 */
export async function handleKanaWordsAction(
  repo: LexiconRepository,
  context: ToolExecutionContext,
  input: LearningContentInput
): Promise<Result<LearningContentOutput, BusinessError>> {
  void context;
  const language = input.language ?? 'ja';
  if (language !== 'ja') {
    return err(
      new BusinessError('E_INVALID_INPUT', '假名单词听写暂仅支持日语。', 'VALIDATION', false)
    );
  }
  const count = Math.min(Math.max(input.count ?? 5, 1), 20);
  const script = input.script ?? 'HIRAGANA';

  const sampledRes = await repo.sampleLocalDictionaryEntries('ja', count * 4 + 5);
  if (!isOk(sampledRes)) return sampledRes;
  const entries = sampledRes.value.filter(
    (e) => e.reading && KANA_READING_RE.test(e.reading) && e.meanings.length > 0
  );
  // 首选目标书写体，不足时用另一书写体补齐（保证有题可练）。
  const preferred = entries.filter((e) =>
    script === 'KATAKANA' ? KATAKANA_RE.test(e.reading ?? '') : HIRAGANA_RE.test(e.reading ?? '')
  );
  const rest = entries.filter((e) => !preferred.includes(e));
  const picked = [...preferred, ...rest].slice(0, count);

  if (picked.length === 0) {
    return err(
      new BusinessError(
        'E_CONTENT_EMPTY',
        '本地词典中暂无可用假名词语，请先安装日语词典包。',
        'TOOL_EXECUTION',
        false
      )
    );
  }

  const words: KanaWord[] = picked.map((e) => ({
    id: generateId('kw'),
    entryId: e.id,
    headword: e.headword,
    kana: e.reading ?? '',
    meanings: e.meanings.slice(0, 3),
    audioText: e.reading ?? '',
    sourceLabel: e.sourceLabel,
  }));
  return ok({
    action: input.action,
    language: 'ja',
    summary: `已从本地词典抽出 ${words.length} 个假名词语。`,
    kanaWords: words,
  });
}
