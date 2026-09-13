import {
  ok,
  err,
  isOk,
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
} from '@study-studio/flashcards';
import {
  getCardFormat,
  narrowSaveCardFormatInput,
} from '../persistence/card-formats.js';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * 卡片预览领域命令（HTTP `POST /api/flashcards/preview` 与 `flashcards.render` Tool 共用）。
 * 同一份渲染链路服务三处：设置页实时预览、AI 生成卡片前验算、未来导出前检查。
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
  deps: RepoDeps,
  request: PreviewCardRequest
): Promise<Result<PreviewCardResult, BusinessError>> {
  try {
    let format: AnkiCardFormat | undefined;
    if (request.inlineFormat) {
      const narrowed = narrowSaveCardFormatInput(request.inlineFormat);
      if (!narrowed) {
        return err(
          new BusinessError('E_INVALID_INPUT', '模板草稿结构不正确，请检查字段后重试', 'VALIDATION', false)
        );
      }
      format = {
        id: narrowed.id,
        name: narrowed.name,
        entryType: narrowed.entryType ?? 'term',
        fields: narrowed.fields,
        frontTemplate: narrowed.frontTemplate,
        backTemplate: narrowed.backTemplate,
        css: narrowed.css,
        templateVersion: 0,
        userModified: true,
        ...(narrowed.deckName ? { deckName: narrowed.deckName } : {}),
        ...(narrowed.modelName ? { modelName: narrowed.modelName } : {}),
      };
    } else {
      format = await getCardFormat(deps, request.formatId ?? 'study-basic');
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
