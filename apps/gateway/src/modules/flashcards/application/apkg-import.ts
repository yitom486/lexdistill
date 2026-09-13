import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  guessFieldMapping,
  analyzeTemplateCompat,
  type FieldMarker,
} from '@study-studio/flashcard-core';
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
const MAX_ZIP_ENTRIES = 20000;
const MAX_COLLECTION_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_NOTES = 5000;

export interface ApkgModelDraft {
  modelName: string;
  ankiFields: string[];
  front: string;
  back: string;
  css: string;
  fieldMapping: Record<string, FieldMarker | null>;
  compatIssues: string[];
  exampleNoteCount: number;
}

export interface ApkgDeckSummary {
  name: string;
  noteCount: number;
}

export interface ApkgAnalysis {
  fileLabel: string;
  noteCount: number;
  cardCount: number;
  decks: ApkgDeckSummary[];
  models: ApkgModelDraft[];
  mediaFileCount: number;
  mediaRefCount: number;
  truncated: boolean;
}

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

interface ParsedNote {
  mid: string;
  tags: string[];
  fields: string[];
  deckName: string;
}

interface ParsedApkg {
  notes: ParsedNote[];
  cardCount: number;
  decks: Map<string, number>;
  models: Map<string, { name: string; fields: string[]; front: string; back: string; css: string }>;
  mediaRefCount: number;
  mediaFileCount: number;
  /** 媒体映射文件名 → 字节（供导入入库；键为包内原始文件名）。 */
  mediaBlobs: Map<string, Uint8Array>;
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

function countMediaRefs(rawFields: string): number {
  const sound = rawFields.match(/\[sound:[^\]]+\]/g);
  const img = rawFields.match(/<img[^>]+src=/gi);
  return (sound?.length ?? 0) + (img?.length ?? 0);
}

/** 字段原文中的媒体引用文件名（[sound:x] 与 <img src="x">）。 */
export function extractMediaRefs(rawFields: string): string[] {
  const refs: string[] = [];
  for (const m of rawFields.matchAll(/\[sound:([^\]]+)\]/g)) {
    if (m[1]) refs.push(m[1]);
  }
  for (const m of rawFields.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
    if (m[1]) refs.push(m[1]);
  }
  return refs;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** collection.anki2 只读解析（经系统临时目录中转，用后即删）。 */
async function parseApkgCollection(collectionBytes: Uint8Array): Promise<ParsedApkg> {
  const { promises: fsp } = await import('node:fs');
  const dir = join(tmpdir(), `ss-apkg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`);
  const file = join(dir, 'collection.anki2');
  const empty: ParsedApkg = {
    notes: [],
    cardCount: 0,
    decks: new Map(),
    models: new Map(),
    mediaRefCount: 0,
    mediaFileCount: 0,
    mediaBlobs: new Map(),
  };
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, collectionBytes);
    const db = new Database(file, { readonly: true });
    try {
      const colRows = db.query<{ models: string; decks: string }, []>(
        'SELECT models, decks FROM col LIMIT 1'
      ).all();
      const col = colRows[0];
      if (!col) return empty;
      const modelsJson = asRecord(JSON.parse(col.models));
      const decksJson = asRecord(JSON.parse(col.decks));
      const models = new Map<string, { name: string; fields: string[]; front: string; back: string; css: string }>();
      if (modelsJson) {
        for (const [mid, raw] of Object.entries(modelsJson)) {
          const m = asRecord(raw);
          if (!m) continue;
          const flds = Array.isArray(m['flds']) ? m['flds'] : [];
          const tmpls = Array.isArray(m['tmpls']) ? m['tmpls'] : [];
          const first = asRecord(tmpls[0]);
          models.set(String(mid), {
            name: typeof m['name'] === 'string' ? (m['name'] as string) : `Model ${mid}`,
            fields: flds
              .map((f) => asRecord(f)?.['name'])
              .filter((n): n is string => typeof n === 'string'),
            front: typeof first?.['qfmt'] === 'string' ? (first['qfmt'] as string) : '',
            back: typeof first?.['afmt'] === 'string' ? (first['afmt'] as string) : '',
            css: typeof m['css'] === 'string' ? (m['css'] as string) : '',
          });
        }
      }
      const deckNames = new Map<string, string>();
      if (decksJson) {
        for (const [did, raw] of Object.entries(decksJson)) {
          const d = asRecord(raw);
          if (d && typeof d['name'] === 'string') deckNames.set(String(did), d['name'] as string);
        }
      }
      const cardRows = db.query<{ nid: number; did: number }, []>('SELECT nid, did FROM cards').all();
      const noteDeck = new Map<number, string>();
      for (const c of cardRows) {
        if (!noteDeck.has(c.nid)) {
          noteDeck.set(c.nid, deckNames.get(String(c.did)) ?? 'Default');
        }
      }
      const noteRows = db.query<{ id: number; mid: number; tags: string; flds: string }, []>(
        'SELECT id, mid, tags, flds FROM notes'
      ).all();
      const notes: ParsedNote[] = [];
      const deckCounts = new Map<string, number>();
      let mediaRefCount = 0;
      for (const n of noteRows) {
        const deckName = noteDeck.get(n.id) ?? 'Default';
        mediaRefCount += countMediaRefs(n.flds);
        notes.push({
          mid: String(n.mid),
          tags: n.tags.trim() ? n.tags.trim().split(/\s+/) : [],
          fields: n.flds.split('\x1f'),
          deckName,
        });
        deckCounts.set(deckName, (deckCounts.get(deckName) ?? 0) + 1);
      }
      return {
        notes,
        cardCount: cardRows.length,
        decks: deckCounts,
        models,
        mediaRefCount,
        mediaFileCount: 0,
        mediaBlobs: new Map(),
      };
    } finally {
      db.close();
    }
  } finally {
    // Windows 下 SQLite 句柄释放有延迟，rm 重试防 EBUSY。
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

/** zip → 解析（media 映射计数；条目数上限防炸弹）。 */
export async function parseApkgBytes(bytes: Uint8Array): Promise<ParsedApkg> {
  let entries;
  try {
    entries = extractZip(bytes);
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError('E_INVALID_INPUT', '不是有效的 .apkg 文件（zip 解析失败）', 'VALIDATION', false);
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new BusinessError('E_INVALID_INPUT', '压缩包内文件过多，拒绝解析', 'VALIDATION', false);
  }
  // 官方导出固定叫 collection.anki2；兼容改名包时回退任一 *.anki2（取第一个）。
  const norm = normalizeZipEntryPaths(entries);
  const collection =
    norm.find((e) => e.path === 'collection.anki2' || e.path.endsWith('/collection.anki2')) ??
    norm.find((e) => e.path.toLowerCase().endsWith('.anki2'));
  if (!collection) {
    throw new BusinessError('E_INVALID_INPUT', '压缩包内没有 collection.anki2，不是有效的 Anki 包', 'VALIDATION', false);
  }
  if (collection.data.length > MAX_COLLECTION_BYTES) {
    throw new BusinessError('E_INVALID_INPUT', '牌组数据库过大（>200MB），拒绝解析', 'VALIDATION', false);
  }
  const parsed = await parseApkgCollection(collection.data);
  const mediaEntry = norm.find((e) => e.path === 'media');
  const mediaNameByIndex = new Map<string, string>();
  if (mediaEntry) {
    try {
      const text = Buffer.from(mediaEntry.data).toString('utf8');
      const map = asRecord(JSON.parse(text));
      if (map) {
        for (const [index, name] of Object.entries(map)) {
          if (typeof name === 'string') mediaNameByIndex.set(index, name);
        }
        parsed.mediaFileCount = mediaNameByIndex.size;
      }
    } catch {
      parsed.mediaFileCount = 0;
    }
  }
  // 包内媒体文件以序号命名（"0"/"1"…），经映射表还原原始文件名后登记字节。
  if (mediaNameByIndex.size > 0) {
    for (const e of norm) {
      const original = mediaNameByIndex.get(e.path);
      if (original) parsed.mediaBlobs.set(original, e.data);
    }
  }
  return parsed;
}

/** 分析（只读：牌组/笔记计数 + 模板草稿 + 映射推测 + 兼容性；不写库）。 */
export async function analyzeApkg(
  bytes: Uint8Array,
  fileLabel: string
): Promise<Result<ApkgAnalysis, BusinessError>> {
  try {
    const parsed = await parseApkgBytes(bytes);
    const modelNoteCounts = new Map<string, number>();
    for (const n of parsed.notes) {
      modelNoteCounts.set(n.mid, (modelNoteCounts.get(n.mid) ?? 0) + 1);
    }
    const models: ApkgModelDraft[] = [];
    for (const [mid, m] of parsed.models) {
      models.push({
        modelName: m.name,
        ankiFields: m.fields,
        front: m.front,
        back: m.back,
        css: m.css,
        fieldMapping: guessFieldMapping(m.fields),
        compatIssues: analyzeTemplateCompat(m.front, m.back, m.css),
        exampleNoteCount: modelNoteCounts.get(mid) ?? 0,
      });
    }
    models.sort((a, b) => b.exampleNoteCount - a.exampleNoteCount);
    return ok({
      fileLabel,
      noteCount: parsed.notes.length,
      cardCount: parsed.cardCount,
      decks: [...parsed.decks.entries()]
        .map(([name, noteCount]) => ({ name, noteCount }))
        .sort((a, b) => b.noteCount - a.noteCount),
      models,
      mediaFileCount: parsed.mediaFileCount,
      mediaRefCount: parsed.mediaRefCount,
      truncated: false,
    });
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
