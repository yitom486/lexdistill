import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  nowIso,
} from '@study-studio/shared';
import {
  analyzeParsedApkg,
  importParsedApkgNotes,
  parseApkgEntries,
  type ParsedApkg,
  type ApkgAnalysis,
  type ApkgImportNotesResult,
} from '@study-studio/flashcards';

/** 分析类型兼容出口：定义已迁入 flashcards，此处重出以保持 Tool/测试链路不动。 */
export type { ApkgModelDraft, ApkgDeckSummary, ApkgAnalysis, ApkgImportNotesResult } from '@study-studio/flashcards';
// 跨模块复用（G5 已登记）：zip 安全解包（炸弹/加密守卫），不写盘、无路径穿越面。
import { extractZip, normalizeZipEntryPaths } from '../../library/public.js';
import { flashcards } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { storeMedia } from '../persistence/media-store.js';
import type { TrackLanguage } from '../../../infrastructure/persistence/language.js';

/**
 * `.apkg` 导入（Boltzmann 搬家 + 网上模板提取）。
 * 两条路径：① 笔记 → 用户 FSRS 卡（进度一律 NEW，如实告知重排）；
 * ② NoteType → 模板草稿（映射推测 + 兼容性分析，用户确认后经模板 PUT 入库）。
 * 媒体引用只计数不入库（媒体底座见 S4/D3）；`collection.anki2` 只作一次性只读源。
 */

const MAX_APKG_FILE_BYTES = 300 * 1024 * 1024;

export interface ApkgImportNotesOptions {
  userId: string;
  language: TrackLanguage;
  deckNames?: string[] | undefined;
  maxNotes?: number | undefined;
  /** 媒体根目录覆盖（单测注入临时目录；缺省用户媒体库）。 */
  mediaRoot?: string | undefined;
}

/** zip → 解析：安全解包仍走 library 共享守卫，格式解析委托新包（M7-3）。 */
export async function parseApkgBytes(bytes: Uint8Array): Promise<ParsedApkg> {
  let entries;
  try {
    entries = extractZip(bytes);
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError('E_INVALID_INPUT', '不是有效的 .apkg 文件（zip 解析失败）', 'VALIDATION', false);
  }
  // 条目数上限与 collection 查找口径收归新包；此处只做解包归一化。
  return parseApkgEntries(normalizeZipEntryPaths(entries));
}

/** 本机 .apkg 直读（大包不走 HTTP 拷贝；上限 300MB 与解包器对齐）。 */
export async function readApkgFileBytes(filePath: string): Promise<Result<Uint8Array, BusinessError>> {
  try {
    const { promises: fsp } = await import('node:fs');
    const { default: path } = await import('node:path');
    if (!path.isAbsolute(filePath)) {
      return err(new BusinessError('E_INVALID_INPUT', '只接受本机 .apkg 绝对路径', 'VALIDATION', false));
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.apkg' && ext !== '.zip') {
      return err(new BusinessError('E_INVALID_INPUT', '只接受 .apkg 文件', 'VALIDATION', false));
    }
    const stat = await fsp.stat(filePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_APKG_FILE_BYTES) {
      return err(new BusinessError('E_INVALID_INPUT', '文件无效或过大（上限 300MB）', 'VALIDATION', false));
    }
    return ok(new Uint8Array(await fsp.readFile(filePath)));
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(new BusinessError('E_INVALID_INPUT', '本地文件不存在或无权读取', 'VALIDATION', false));
  }
}

/** 分析（只读）：解包后委托 flashcards 纯用例；信封与翻译口径不变。 */
export async function analyzeApkg(
  bytes: Uint8Array,
  fileLabel: string
): Promise<Result<ApkgAnalysis, BusinessError>> {
  try {
    const parsed = await parseApkgBytes(bytes);
    return analyzeParsedApkg(parsed, fileLabel);
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'analyzeApkg'));
  }
}

/** 搬家：笔记 → 用户 FSRS 卡（进度一律 NEW；同用户同正面去重；媒体只计数）。 */
export async function importApkgNotes(
  deps: RepoDeps,
  bytes: Uint8Array,
  options: ApkgImportNotesOptions
): Promise<Result<ApkgImportNotesResult, BusinessError>> {
  try {
    // 原始校验顺序：语种先行（非法直接拒，后续解包不再执行）。
    if (options.language !== 'ja' && options.language !== 'en' && options.language !== 'ko') {
      return err(new BusinessError('E_INVALID_INPUT', '导入语种须为 ja/en/ko（决定卡片归属，不可猜）', 'VALIDATION', false));
    }
    // 解包仍归 Gateway（安全守卫 + 归一化）；编排委托 flashcards 用例。
    const parsed = await parseApkgBytes(bytes);
    return await importParsedApkgNotes(
      {
        listExistingFronts: async (userId) =>
          deps.sqlite
            .query<{ front: string }, [string]>('SELECT front FROM flashcards WHERE user_id = ?')
            .all(userId)
            .map((r) => r.front),
        createCard: async (card) => {
          // 持久化方言在此收口：包内 tagsJson/fsrsJson → 表列 tags/fsrs。
          await deps.db.insert(flashcards).values({
            id: card.id,
            userId: card.userId,
            language: card.language,
            type: 'VOCABULARY',
            front: card.front,
            back: card.back,
            phonetic: null,
            audioUrl: null,
            sourceEntryId: null,
            tags: card.tagsJson,
            fsrs: card.fsrsJson,
          });
        },
        storeMediaFile: async ({ collection, filename, blob, mediaRoot }) => {
          const stored = await storeMedia(deps, collection, filename, blob, mediaRoot);
          return isOk(stored) ? ok(undefined) : err(stored.error);
        },
      },
      parsed,
      {
        userId: options.userId,
        language: options.language,
        ...(options.deckNames ? { deckNames: options.deckNames } : {}),
        ...(options.maxNotes !== undefined ? { maxNotes: options.maxNotes } : {}),
        ...(options.mediaRoot ? { mediaRoot: options.mediaRoot } : {}),
        now: nowIso(),
      }
    );
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'importApkgNotes'));
  }
}
