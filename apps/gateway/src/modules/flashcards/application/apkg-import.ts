import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
  translateToBusinessError,
  generateId,
  nowIso,
} from '@study-studio/shared';
import {
  analyzeParsedApkg,
  parseApkgEntries,
  extractMediaRefs,
  type ParsedApkg,
  type ApkgAnalysis,
} from '@study-studio/flashcards';

/** 分析类型兼容出口：定义已迁入 flashcards，此处重出以保持 Tool/测试链路不动。 */
export type { ApkgModelDraft, ApkgDeckSummary, ApkgAnalysis } from '@study-studio/flashcards';
// 跨模块复用（G5 已登记）：zip 安全解包（炸弹/加密守卫），不写盘、无路径穿越面。
import { extractZip, normalizeZipEntryPaths } from '../../library/public.js';
import { flashcards } from '../../../infrastructure/db/index.js';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import { storeMedia } from '../persistence/media-store.js';
import type { TrackLanguage } from '../../../infrastructure/persistence/language.js';
import { normalizeTrackLanguage } from '../../../infrastructure/persistence/language.js';

/**
 * `.apkg` 导入（Boltzmann 搬家 + 网上模板提取）。
 * 两条路径：① 笔记 → 用户 FSRS 卡（进度一律 NEW，如实告知重排）；
 * ② NoteType → 模板草稿（映射推测 + 兼容性分析，用户确认后经模板 PUT 入库）。
 * 媒体引用只计数不入库（媒体底座见 S4/D3）；`collection.anki2` 只作一次性只读源。
 */

const MAX_APKG_FILE_BYTES = 300 * 1024 * 1024;
const DEFAULT_MAX_NOTES = 5000;

export interface ApkgImportNotesOptions {
  userId: string;
  language: TrackLanguage;
  deckNames?: string[] | undefined;
  maxNotes?: number | undefined;
  /** 媒体根目录覆盖（单测注入临时目录；缺省用户媒体库）。 */
  mediaRoot?: string | undefined;
}

export interface ApkgImportNotesResult {
  created: number;
  skippedDuplicate: number;
  skippedEmpty: number;
  /** 引用了但包内无对应文件的媒体计数（S4 前全部落此；有文件则入库）。 */
  mediaSkipped: number;
  /** 已写入用户媒体库的文件数（内容寻址去重）。 */
  mediaStored: number;
  decks: string[];
  truncated: boolean;
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

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
    if (options.language !== 'ja' && options.language !== 'en' && options.language !== 'ko') {
      return err(new BusinessError('E_INVALID_INPUT', '导入语种须为 ja/en/ko（决定卡片归属，不可猜）', 'VALIDATION', false));
    }
    const language = normalizeTrackLanguage(options.language);
    const maxNotes = options.maxNotes ?? DEFAULT_MAX_NOTES;
    const deckFilter = options.deckNames && options.deckNames.length > 0 ? new Set(options.deckNames) : undefined;
    const parsed = await parseApkgBytes(bytes);
    // 去重集合经 sqlite 直查（front 无唯一约束，内存集合判定）。
    const seen = new Set<string>();
    const dupRows = deps.sqlite
      .query<{ front: string }, [string]>('SELECT front FROM flashcards WHERE user_id = ?')
      .all(options.userId);
    for (const r of dupRows) seen.add(r.front);
    const now = nowIso();
    let created = 0;
    let skippedDuplicate = 0;
    let skippedEmpty = 0;
    let mediaSkipped = 0;
    let mediaStored = 0;
    let truncated = false;
    const decks = new Set<string>();
    let processed = 0;
    for (const note of parsed.notes) {
      if (deckFilter && !deckFilter.has(note.deckName)) continue;
      if (processed >= maxNotes) {
        truncated = true;
        break;
      }
      processed += 1;
      const front = stripHtml(note.fields[0] ?? '');
      const back = stripHtml(note.fields.slice(1).join('\n'));
      if (!front) {
        skippedEmpty += 1;
        continue;
      }
      if (seen.has(front)) {
        skippedDuplicate += 1;
        continue;
      }
      seen.add(front);
      // 媒体：包内有文件则入库（内容寻址去重），缺失只计数（卡片正文不臆造引用）。
      for (const ref of extractMediaRefs(note.fields.join('\x1f'))) {
        const blob = parsed.mediaBlobs.get(ref);
        if (!blob) {
          mediaSkipped += 1;
          continue;
        }
        const stored = await storeMedia(deps, `apkg:${note.deckName}`, ref, blob, options.mediaRoot);
        if (isOk(stored)) mediaStored += 1;
        else mediaSkipped += 1;
      }
      const tags = [`Anki 导入：${note.deckName}`, ...note.tags].slice(0, 16);
      await deps.db.insert(flashcards).values({
        id: generateId('card_apkg'),
        userId: options.userId,
        language,
        type: 'VOCABULARY',
        front: front.slice(0, 2000),
        back: (back || front).slice(0, 8000),
        phonetic: null,
        audioUrl: null,
        sourceEntryId: null,
        tags: JSON.stringify(tags),
        fsrs: JSON.stringify({ stability: 1, difficulty: 5, reps: 0, lapses: 0, dueAt: now, state: 'NEW' }),
      });
      created += 1;
      decks.add(note.deckName);
    }
    return ok({
      created,
      skippedDuplicate,
      skippedEmpty,
      mediaSkipped,
      mediaStored,
      decks: [...decks],
      truncated,
    });
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'importApkgNotes'));
  }
}
