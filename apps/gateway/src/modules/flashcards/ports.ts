import type { Result, BusinessError } from '@study-studio/shared';
import type { AnkiCardFormat } from '@study-studio/flashcards';
import type {
  CardDraft,
  CardDraftStatus,
  ProposeCardDraftInput,
  UpdateCardDraftPatch,
} from './persistence/card-drafts.js';
import type { SaveCardFormatInput } from '@study-studio/storage-sqlite';
import type { PreviewCardRequest, PreviewCardResult } from './application/card-preview.js';
import type { AnkiPushSettings } from '@study-studio/storage-sqlite';
import type { AnkiPushRequest, AnkiPushResult } from './application/anki-push.js';
import type {
  ApkgImportNotesOptions,
  ApkgImportNotesResult,
} from './application/apkg-import.js';
import type { ApkgExportOptions, ApkgExportResult } from './application/apkg-export.js';
import type { StoredMedia } from '@study-studio/storage-sqlite';

/**
 * M1-2 卡片（flashcards）领域仓储能力契约。
 *
 * - 方法签名与 DrizzleLearnerRepository 实现逐字对齐（`implements` 编译期锁定）；
 * - 只收上层（工具/路由/应用函数）实际消费的高层方法，不含 raw 句柄与 drizzle 直连；
 * - 媒体写入与草稿/模板/Anki/APKG 同属本域能力。
 */
export interface FlashcardsRepository {
  proposeCardDrafts(
    inputs: ProposeCardDraftInput[]
  ): Promise<Result<CardDraft[], BusinessError>>;
  listCardDrafts(
    userId: string,
    language: string,
    status?: CardDraftStatus,
    limit?: number
  ): Promise<Result<CardDraft[], BusinessError>>;
  updateCardDraft(
    userId: string,
    draftId: string,
    patch: UpdateCardDraftPatch
  ): Promise<Result<CardDraft, BusinessError>>;
  acceptCardDraft(
    userId: string,
    draftId: string
  ): Promise<Result<{ draft: CardDraft; cardId: string }, BusinessError>>;
  dismissCardDraft(
    userId: string,
    draftId: string
  ): Promise<Result<CardDraft, BusinessError>>;
  listCardFormats(): Promise<Result<AnkiCardFormat[], BusinessError>>;
  saveCardFormat(
    input: SaveCardFormatInput
  ): Promise<Result<AnkiCardFormat, BusinessError>>;
  resetCardFormat(id: string): Promise<Result<AnkiCardFormat, BusinessError>>;
  previewCardFormat(
    request: PreviewCardRequest
  ): Promise<Result<PreviewCardResult, BusinessError>>;
  getAnkiPushSettings(): Promise<AnkiPushSettings>;
  saveAnkiPushSettings(
    patch: { enabled?: boolean; endpoint?: string }
  ): Promise<Result<AnkiPushSettings, BusinessError>>;
  pushCardToAnki(
    request: AnkiPushRequest
  ): Promise<Result<AnkiPushResult, BusinessError>>;
  importApkgNotes(
    bytes: Uint8Array,
    options: ApkgImportNotesOptions
  ): Promise<Result<ApkgImportNotesResult, BusinessError>>;
  exportApkgFile(
    options: ApkgExportOptions
  ): Promise<Result<ApkgExportResult, BusinessError>>;
  readMediaFile(
    fileHash: string,
    mediaRoot?: string
  ): Promise<Result<{ bytes: Uint8Array; mediaType: string }, BusinessError>>;
  storeMediaFile(
    sourceId: string,
    filename: string,
    bytes: Uint8Array,
    mediaRoot?: string
  ): Promise<Result<StoredMedia, BusinessError>>;
}
