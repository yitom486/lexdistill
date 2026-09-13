import type { ToolExecutionContext } from '@study-studio/tool-core';
import { err, generateId, isOk, ok, type Result, BusinessError } from '@study-studio/shared';
import type { LexiconRepository } from '../../../modules/dictionary/ports.js';
import type { LearningContentInput, LearningContentOutput } from '../learning-content-tool.js';

export interface HangulWord {
  id: string;
  /** 词典条目 id（可直接调收集接口转 FSRS 生词卡）。 */
  entryId: string;
  /** 韩语表层形（听写播报与选项用；Kengdic 条目即 headword）。 */
  korean: string;
  /** 英文释义（词义回想选项用，取前 3）。 */
  meanings: string[];
  /** TTS 朗读文本（即 korean）。 */
  audioText: string;
  sourceLabel: string;
}

/** 韩语表层形（音节块 + 字母 + 空格/中点；拉丁/汉字混入一律排除）。 */
const KOREAN_SURFACE_RE = /^[\uAC00-\uD7A3\u3130-\u318F\s·・]+$/;

/**
 * 韩语单词动作：从本地词典随机抽取韩语词语，供听写选词/词义回想。
 * 系统随机出题（零成本即时）；词池唯一来源为已安装的韩语词典包，未安装报 E_CONTENT_EMPTY。
 */
export async function handleHangulWordsAction(
  repo: LexiconRepository,
  context: ToolExecutionContext,
  input: LearningContentInput
): Promise<Result<LearningContentOutput, BusinessError>> {
  void context;
  const language = input.language ?? 'ko';
  if (language !== 'ko') {
    return err(
      new BusinessError('E_INVALID_INPUT', '韩语单词听写暂仅支持韩语。', 'VALIDATION', false)
    );
  }
  const count = Math.min(Math.max(input.count ?? 5, 1), 20);

  const sampledRes = await repo.sampleLocalDictionaryEntries('ko', count * 4 + 5);
  if (!isOk(sampledRes)) return sampledRes;
  const picked = sampledRes.value
    .filter((e) => KOREAN_SURFACE_RE.test(e.headword) && e.meanings.length > 0)
    .slice(0, count);

  if (picked.length === 0) {
    return err(
      new BusinessError(
        'E_CONTENT_EMPTY',
        '本地词典中暂无可用韩语词语，请先安装韩语词典包。',
        'TOOL_EXECUTION',
        false
      )
    );
  }

  const words: HangulWord[] = picked.map((e) => ({
    id: generateId('hw'),
    entryId: e.id,
    korean: e.headword,
    meanings: e.meanings.slice(0, 3),
    audioText: e.headword,
    sourceLabel: e.sourceLabel,
  }));
  return ok({
    action: input.action,
    language: 'ko',
    summary: `已从本地词典抽出 ${words.length} 个韩语词语。`,
    hangulWords: words,
  });
}
