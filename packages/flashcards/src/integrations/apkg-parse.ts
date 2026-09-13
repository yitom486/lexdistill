import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessError } from '@study-studio/shared';

/**
 * M7-3 自 Gateway `flashcards/application/apkg-import.ts` 迁入（逻辑字节一致）。
 *
 * 外部 APKG 文件格式纯解析：已解包条目 → collection 解析 → 笔记/模板/
 * 媒体引用的纯解析结果。调用方（Gateway）负责 zip 安全解包与条目归一化，
 * 本包只做格式解析。
 *
 * 运行时说明：collection.anki2 是随包内嵌的 SQLite 文件（非业务库），
 * 经系统临时目录中转只读打开、用后即删；`bun:sqlite`/`node:os`/`node:path`/
 * `node:fs` 是解析所必需的运行时能力。本包不连业务 SQLite、不读 Gateway
 * Repository、不写用户数据。
 */

/** 调用方传入的已解包条目（须已归一化路径分隔符；与解包器输出结构兼容）。 */
export interface ApkgZipEntry {
  path: string;
  data: Uint8Array;
}

export interface ParsedApkgNote {
  mid: string;
  tags: string[];
  fields: string[];
  deckName: string;
}

export interface ParsedApkgModel {
  name: string;
  fields: string[];
  front: string;
  back: string;
  css: string;
}

export interface ParsedApkg {
  notes: ParsedApkgNote[];
  cardCount: number;
  decks: Map<string, number>;
  models: Map<string, ParsedApkgModel>;
  mediaRefCount: number;
  mediaFileCount: number;
  /** 媒体映射文件名 → 字节（供导入入库；键为包内原始文件名）。 */
  mediaBlobs: Map<string, Uint8Array>;
}

/** 条目数上限（zip 炸弹守卫；与 Gateway 解包器口径对齐）。 */
export const MAX_APKG_ZIP_ENTRIES = 20000;
/** 内嵌牌组库上限。 */
export const MAX_APKG_COLLECTION_BYTES = 200 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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
      const models = new Map<string, ParsedApkgModel>();
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
      const notes: ParsedApkgNote[] = [];
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

/**
 * 已解包条目 → 纯解析结果（collection 查找、媒体映射、blob 登记；条目数上限防炸弹）。
 * 条目路径须已归一化；官方导出固定叫 collection.anki2，兼容改名包时回退任一 *.anki2。
 */
export async function parseApkgEntries(entries: ApkgZipEntry[]): Promise<ParsedApkg> {
  if (entries.length > MAX_APKG_ZIP_ENTRIES) {
    throw new BusinessError('E_INVALID_INPUT', '压缩包内文件过多，拒绝解析', 'VALIDATION', false);
  }
  const collection =
    entries.find((e) => e.path === 'collection.anki2' || e.path.endsWith('/collection.anki2')) ??
    entries.find((e) => e.path.toLowerCase().endsWith('.anki2'));
  if (!collection) {
    throw new BusinessError('E_INVALID_INPUT', '压缩包内没有 collection.anki2，不是有效的 Anki 包', 'VALIDATION', false);
  }
  if (collection.data.length > MAX_APKG_COLLECTION_BYTES) {
    throw new BusinessError('E_INVALID_INPUT', '牌组数据库过大（>200MB），拒绝解析', 'VALIDATION', false);
  }
  const parsed = await parseApkgCollection(collection.data);
  const mediaEntry = entries.find((e) => e.path === 'media');
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
    for (const e of entries) {
      const original = mediaNameByIndex.get(e.path);
      if (original) parsed.mediaBlobs.set(original, e.data);
    }
  }
  return parsed;
}
