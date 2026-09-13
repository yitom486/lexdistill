import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import {
  buildCardContext,
  renderCard,
  validateCardFormat,
  type AnkiCardFormat,
  type CardSourceEntry,
  type RenderedCard,
} from './render/index.js';

/**
 * M7-6 自 Gateway `flashcards/application/card-preview.ts` 迁入（行为不变）。
 *
 * 卡片预览应用用例：读取格式与词条 → 校验 → 构建上下文 → 渲染预览。
 * 只依赖最小读取 port、卡片核心逻辑与 Result/BusinessError 契约；
 * 不导入 Drizzle、Gateway 或 SQLite。模板问题只报告不拦截
 * （调用方决定是否拦截保存）；持久化/HTTP/Tool 仍归 Gateway。
 */

export interface PreviewCardRequest {
  /** 已存模板 id（与 inlineFormat 二选一；都不给则用内置 study-basic）。 */
  formatId?: string | undefined;
  /** 未保存的模板草稿（工作台实时预览用；只渲染不入库）。 */
  inlineFormat?: AnkiCardFormat | undefined;
  entry: CardSourceEntry;
}

export interface PreviewCardResult {
  format: AnkiCardFormat;
  rendered: RenderedCard;
  /** 模板问题（有问题也返回渲染结果，调用方决定是否拦截保存）。 */
  issues: string[];
}

/** 用例所需的最小读取能力（Gateway 用现有持久化/词典读取实现）。 */
export interface CardPreviewPorts {
  /** 按 id 读取已存模板（含内置回退由调用方决定；找不到返回 undefined）。 */
  loadFormat(formatId: string): Promise<AnkiCardFormat | undefined>;
  /** 收窄未保存的模板草稿；结构不正确返回 undefined（只渲染不入库）。 */
  narrowInlineFormat(draft: unknown): Promise<AnkiCardFormat | undefined>;
}

/** 信任边界收窄：条目输入（HTTP/Tool 入参）。 */
export function narrowCardSourceEntry(input: unknown): CardSourceEntry | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const v = input as Record<string, unknown>;
  if (typeof v['headword'] !== 'string' || v['headword'].trim().length === 0) return undefined;
  if (!Array.isArray(v['meanings'])) return undefined;
  const entry: CardSourceEntry = {
    headword: v['headword'].slice(0, 128),
    meanings: v['meanings']
      .filter((m): m is string => typeof m === 'string')
      .slice(0, 24)
      .map((m) => m.slice(0, 2000)),
  };
  if (typeof v['reading'] === 'string') entry.reading = v['reading'].slice(0, 128);
  if (typeof v['partOfSpeech'] === 'string') entry.partOfSpeech = v['partOfSpeech'].slice(0, 64);
  if (typeof v['pitchLabel'] === 'string') entry.pitchLabel = v['pitchLabel'].slice(0, 256);
  if (Array.isArray(v['pitchPositions'])) {
    const positions = v['pitchPositions'].filter(
      (p): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0
    ).slice(0, 8);
    if (positions.length > 0) entry.pitchPositions = positions;
  }
  if (typeof v['frequency'] === 'number') entry.frequency = v['frequency'];
  if (typeof v['sentence'] === 'string') entry.sentence = v['sentence'].slice(0, 1000);
  if (typeof v['sourceUrl'] === 'string') entry.sourceUrl = v['sourceUrl'].slice(0, 500);
  if (Array.isArray(v['tags'])) {
    entry.tags = v['tags']
      .filter((t): t is string => typeof t === 'string')
      .slice(0, 16)
      .map((t) => t.slice(0, 64));
  }
  return entry;
}

export async function previewCard(
  ports: CardPreviewPorts,
  request: PreviewCardRequest
): Promise<Result<PreviewCardResult, BusinessError>> {
  try {
    let format: AnkiCardFormat | undefined;
    if (request.inlineFormat) {
      format = await ports.narrowInlineFormat(request.inlineFormat);
      if (!format) {
        return err(
          new BusinessError('E_INVALID_INPUT', '模板草稿结构不正确，请检查字段后重试', 'VALIDATION', false)
        );
      }
    } else {
      format = await ports.loadFormat(request.formatId ?? 'study-basic');
      if (!format) {
        return err(
          new BusinessError('E_INVALID_INPUT', '找不到该卡片模板，请先选择或恢复内置模板', 'VALIDATION', false)
        );
      }
    }
    const issues = validateCardFormat(format);
    const rendered = renderCard(format, buildCardContext(request.entry));
    return ok({ format, rendered, issues });
  } catch (e) {
    return err(translateToBusinessError(e, 'previewCard'));
  }
}
