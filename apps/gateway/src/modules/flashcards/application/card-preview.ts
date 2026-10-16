import { type Result, type BusinessError } from '@lexdistill/shared';
import {
  previewCard as previewCardUseCase,
  narrowCardSourceEntry,
  type PreviewCardRequest as PreviewCardRequestIn,
  type PreviewCardResult as PreviewCardResultOut,
  type AnkiCardFormat,
} from '@lexdistill/flashcards';
import {
  getCardFormat,
  narrowSaveCardFormatInput,
} from '@lexdistill/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';

/**
 * M7-6 卡片预览薄组合层：领域渲染实现已迁入 `@lexdistill/flashcards`，
 * 此处只做三件事——
 * 1. 用现有持久化能力实现最小读取 port（已存模板直读、草稿收窄复用
 *    `narrowSaveCardFormatInput`，只渲染不入库）；
 * 2. 保持原 `previewCard(deps, request)` 签名，HTTP/Tool/仓储调用方零改动；
 * 3. 重出条目收窄与请求/结果类型，调用方 import 路径不变。
 */
export {
  narrowCardSourceEntry,
  type PreviewCardRequest,
  type PreviewCardResult,
} from '@lexdistill/flashcards';

export async function previewCard(
  deps: RepoDeps,
  request: PreviewCardRequestIn
): Promise<Result<PreviewCardResultOut, BusinessError>> {
  return previewCardUseCase(
    {
      loadFormat: (formatId) => getCardFormat(deps, formatId),
      narrowInlineFormat: async (draft: unknown): Promise<AnkiCardFormat | undefined> => {
        const narrowed = narrowSaveCardFormatInput(draft);
        if (!narrowed) return undefined;
        return {
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
      },
    },
    request
  );
}
