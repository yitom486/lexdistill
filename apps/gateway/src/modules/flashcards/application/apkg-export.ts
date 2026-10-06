import { eq, and } from 'drizzle-orm';
import { Database } from 'bun:sqlite';
import {
  ok,
  err,
  type Result,
  BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';
import { buildCardContext, renderCard } from '@study-studio/learner-core';
import { flashcards, readCardExamples } from '@study-studio/storage-sqlite';
import type { RepoDeps } from '../../../infrastructure/persistence/repo-context.js';
import type { TrackLanguage } from '@study-studio/shared';
import { getCardFormat } from '@study-studio/storage-sqlite';
import { resolveCardSourceEntry } from './card-source.js';

/**
 * `.apkg` 导出（自研卡 → Anki 包，移动端同步通道）。
 * 模型/正反面/CSS 全按所选模板生成；复习进度不导出（Anki 侧重排，FSRS 权威仍在 learner-core）。
 * 音频：仅当卡片自带 audioUrl 时原样写入 Audio 字段文本（不下载、不伪造 [sound:]）。
 */

const DEFAULT_MAX_CARDS = 10000;

export interface ApkgExportOptions {
  userId: string;
  language?: TrackLanguage | undefined;
  deckName?: string | undefined;
  formatId?: string | undefined;
  maxCards?: number | undefined;
}

export interface ApkgExportResult {
  filename: string;
  bytes: Uint8Array;
  noteCount: number;
  truncated: boolean;
}

/** 最小 stored-zip 写出器（自研；apkg 不要求压缩，stored 即可被 Anki 读取）。 */
export function buildStoredZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n: number) =>
    new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  const concat = (parts: Uint8Array[]) => {
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  };
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const lh = concat([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(0), u32(f.data.length), u32(f.data.length),
      u16(nameBytes.length), u16(0),
      nameBytes,
    ]);
    chunks.push(lh, f.data);
    central.push(
      concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(0), u32(f.data.length), u32(f.data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset),
        nameBytes,
      ])
    );
    offset += lh.length + f.data.length;
  }
  const cd = concat(central);
  const end = concat([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0), u16(central.length), u16(central.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return concat([...chunks, cd, end]);
}

function sanitizeFilename(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80);
  return clean || 'Lingua Studio';
}

export async function exportApkgFromCards(
  deps: RepoDeps,
  options: ApkgExportOptions
): Promise<Result<ApkgExportResult, BusinessError>> {
  try {
    if (options.language !== undefined && options.language !== 'ja' && options.language !== 'en' && options.language !== 'ko') {
      return err(new BusinessError('E_INVALID_INPUT', '导出语种须为 ja/en/ko（决定卡片范围，不可猜）', 'VALIDATION', false));
    }
    const maxCards = options.maxCards ?? DEFAULT_MAX_CARDS;
    const format = await getCardFormat(deps, options.formatId ?? 'study-basic');
    if (!format) {
      return err(
        new BusinessError('E_INVALID_INPUT', '找不到该卡片模板，请先选择或恢复内置模板', 'VALIDATION', false)
      );
    }
    const deckName = options.deckName ?? format.deckName ?? 'Lingua Studio';
    const modelName = format.modelName ?? 'Lingua Basic';
    const rows = await deps.db
      .select()
      .from(flashcards)
      .where(
        options.language
          ? and(eq(flashcards.userId, options.userId), eq(flashcards.language, options.language))
          : eq(flashcards.userId, options.userId)
      );
    const fieldOrder = Object.keys(format.fields);
    const notes: Array<{ id: number; guid: string; mod: number; tags: string; flds: string }> = [];
    let truncated = false;
    let processed = 0;
    const now = Math.floor(Date.now() / 1000);
    for (const card of rows) {
      if (processed >= maxCards) {
        truncated = true;
        break;
      }
      processed += 1;
      const { source } = await resolveCardSourceEntry(deps, {
        front: card.front,
        back: card.back,
        phonetic: card.phonetic,
        sourceEntryId: card.sourceEntryId,
        vocabularyId: card.vocabularyId,
        partOfSpeech: card.partOfSpeech,
        examples: readCardExamples(card.examplesJson),
      });
      const ctx = buildCardContext(source);
      ctx.deckName = deckName;
      const rendered = renderCard(format, ctx);
      const values = fieldOrder.map((name) => {
        let v = rendered.fields[name] ?? '';
        if (name === 'Audio' && !v && card.audioUrl) v = card.audioUrl;
        return v.replace(/\x1f/g, ' ');
      });
      const guid = `ss${card.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || processed}`;
      const tags = `lingua-studio${card.sourceEntryId ? '' : ' custom'}`;
      notes.push({ id: processed, guid, mod: now, tags, flds: values.join('\x1f') });
    }
    const models = {
      '1': {
        id: 1,
        name: modelName,
        flds: fieldOrder.map((name, ord) => ({ name, ord, font: 'Arial', size: 20 })),
        tmpls: [{ name: 'Card 1', ord: 0, qfmt: format.frontTemplate, afmt: format.backTemplate }],
        css: format.css,
      },
    };
    const decks = { '1': { id: 1, name: deckName } };
    const colSql = [
      'CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT);',
      'CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);',
      'CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);',
    ];
    // collection 经内存 SQLite 组装（与单测同一技术路线，无文件中转）。
    const db = new Database(':memory:');
    try {
      // Bun Database.run intentionally accepts this fixed semicolon-separated DDL batch.
      // Parameterized single-row writes below use prepare(...).run(...) instead.
      db.run(colSql.join('\n'));
      db.prepare('INSERT INTO col (id, crt, mod, models, decks, conf, dconf, tags) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(
        now,
        now,
        JSON.stringify(models),
        JSON.stringify(decks),
        '{}',
        '{}',
        '{}'
      );
      const insertNote = db.prepare(
        'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, 1, ?, -1, ?, ?, ?, 0, 0, ?)'
      );
      const insertCard = db.prepare(
        'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, 1, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?)'
      );
      let nid = 0;
      for (const n of notes) {
        nid += 1;
        insertNote.run(n.id, n.guid, n.mod, n.tags, n.flds, n.flds.split('\x1f')[0] ?? '', '{}');
        insertCard.run(nid, n.id, n.mod, nid, '{}');
      }
      const collectionBytes = new Uint8Array(db.serialize());
      const mediaBytes = new TextEncoder().encode('{}');
      const bytes = buildStoredZip([
        { name: 'collection.anki2', data: collectionBytes },
        { name: 'media', data: mediaBytes },
      ]);
      return ok({
        filename: `${sanitizeFilename(deckName)}.apkg`,
        bytes,
        noteCount: nid,
        truncated,
      });
    } finally {
      db.close();
    }
  } catch (e) {
    if (e instanceof BusinessError) return err(e);
    return err(translateToBusinessError(e, 'exportApkgFromCards'));
  }
}
