import { describe, expect, it, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import {
  readApkgFileBytes,
  analyzeApkg,
  type ApkgAnalysis,
} from '../modules/flashcards/application/apkg-import.js';
import { FlashcardsApkgAnalyzeTool } from '../modules/flashcards/tools/flashcards-apkg-analyze-tool.js';

// ---------- 最小 stored-zip 构造器（单测自包含，不提交二进制） ----------
function buildStoredZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
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
      u32(0), u32(0), u32(f.data.length),
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

// ---------- 最小 collection.anki2 构造器（纯内存 SQLite 序列化，无文件中转） ----------
function buildCollectionBytes(): Uint8Array {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT);
      CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);
      CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);`);
    const models = {
      '1': {
        name: 'Basic',
        flds: [{ name: 'Front' }, { name: 'Back' }, { name: 'Extra' }],
        tmpls: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' }],
        css: '.card {}',
      },
      '2': {
        name: 'Japanese',
        flds: [{ name: 'Word' }, { name: 'Meaning' }, { name: 'Sound' }],
        tmpls: [{ name: 'C1', qfmt: '<div>{{Word}}</div>', afmt: '{{Meaning}}' }],
        css: '',
      },
    };
    const decks = { '1': { name: 'Default' }, '2': { name: 'Japanese::N5' } };
    db.prepare('INSERT INTO col (id, models, decks) VALUES (1, ?, ?)').run(
      JSON.stringify(models),
      JSON.stringify(decks)
    );
    const note = db.prepare(
      'INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, 0, 0, ?, ?, ?, 0, 0, ?)'
    );
    note.run(1, 'g1', 1, 'tag1', 'hello\x1fworld', 'hello', '{}');
    note.run(2, 'g2', 2, '', '食べる\x1fto eat\x1f[sound:t.mp3]', '食べる', '{}');
    note.run(3, 'g3', 1, '', '\x1fempty front', '', '{}');
    const card = db.prepare('INSERT INTO cards (id, nid, did, ord) VALUES (?, ?, ?, 0)');
    card.run(11, 1, 1);
    card.run(12, 2, 2);
    card.run(13, 3, 1);
    const bytes = new Uint8Array(db.serialize());
    db.close();
    return bytes;
}

function buildApkgBytes(): Uint8Array {
  const collection = buildCollectionBytes();
  const media = new TextEncoder().encode(JSON.stringify({ '0': 't.mp3' }));
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02]);
  return buildStoredZip([
    { name: 'collection.anki2', data: collection },
    { name: 'media', data: media },
    { name: '0', data: mp3 },
  ]);
}

describe('apkg analyze', () => {
  it('牌组/笔记/模板草稿/映射推测/媒体计数', async () => {
    const res = await analyzeApkg(buildApkgBytes(), 'test.apkg');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const a: ApkgAnalysis = res.value;
    expect(a.noteCount).toBe(3);
    expect(a.cardCount).toBe(3);
    expect(a.decks).toEqual([
      { name: 'Default', noteCount: 2 },
      { name: 'Japanese::N5', noteCount: 1 },
    ]);
    expect(a.mediaFileCount).toBe(1);
    expect(a.mediaRefCount).toBe(1);
    const basic = a.models.find((m) => m.modelName === 'Basic');
    expect(basic?.ankiFields).toEqual(['Front', 'Back', 'Extra']);
    expect(basic?.fieldMapping['Front']).toBe('expression');
    expect(basic?.fieldMapping['Back']).toBe('glossary');
    expect(basic?.fieldMapping['Extra']).toBeNull();
    expect(basic?.compatIssues).toEqual([]);
    const jp = a.models.find((m) => m.modelName === 'Japanese');
    expect(jp?.fieldMapping['Word']).toBe('expression');
    expect(jp?.fieldMapping['Sound']).toBe('audio');
    expect(jp?.exampleNoteCount).toBe(1);
  });

  it('坏包/缺 collection 友好拒绝', async () => {
    const bad = await analyzeApkg(new Uint8Array([1, 2, 3]), 'bad.apkg');
    expect(isOk(bad)).toBe(false);
    const noCol = await analyzeApkg(buildStoredZip([{ name: 'x', data: new Uint8Array([9]) }]), 'x.apkg');
    expect(isOk(noCol)).toBe(false);
    if (!isOk(noCol)) expect(noCol.error.code).toBe('E_INVALID_INPUT');
  });

  it('Windows 产包反斜杠路径归一化', async () => {
    const { normalizeZipEntryPaths } = await import('@study-studio/archive');
    const normed = normalizeZipEntryPaths([
      { path: 'sub\\collection.anki2', data: new Uint8Array([1]) },
      { path: 'ok/media', data: new Uint8Array([2]) },
    ]);
    expect(normed.map((e) => e.path)).toEqual(['sub/collection.anki2', 'ok/media']);
    // 同一归一化同时服务 EPUB（Windows 压缩的 META-INF\container.xml）：
    // 反斜杠包能定位到 collection（内容非法则报库错而非“找不到包”）
    const res = await analyzeApkg(
      buildStoredZip([
        { name: 'x\\collection.anki2', data: new Uint8Array([1, 2, 3]) },
      ]),
      'win.apkg'
    );
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) expect(res.error.code).not.toBe('E_INVALID_INPUT');
  });
});

describe('apkg import notes', () => {
  let repo: DrizzleLearnerRepository;
  let mediaRoot: string;
  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    mediaRoot = await fsp.mkdtemp(join(tmpdir(), 'ss-apkg-media-'));
  });

  it('搬家：去重/空正面/媒体入库/牌组标签', async () => {
    const bytes = buildApkgBytes();
    const res = await repo.importApkgNotes(bytes, { userId: 'u1', language: 'ja', mediaRoot });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.created).toBe(2);
    expect(res.value.skippedEmpty).toBe(1);
    expect(res.value.skippedDuplicate).toBe(0);
    // t.mp3 包内有文件 → 入库而非跳过
    expect(res.value.mediaStored).toBe(1);
    expect(res.value.mediaSkipped).toBe(0);
    const mediaRows = repo
      .getRawDb()
      .query<{ file_hash: string; media_type: string }, []>(
        'SELECT file_hash, media_type FROM dictionary_media'
      )
      .all();
    expect(mediaRows.length).toBe(1);
    expect(mediaRows[0]?.media_type).toBe('audio/mpeg');
    expect(res.value.decks.sort()).toEqual(['Default', 'Japanese::N5']);
    const rows = repo
      .getRawDb()
      .query<{ front: string; back: string; tags: string; language: string }, [string]>(
        'SELECT front, back, tags, language FROM flashcards WHERE user_id = ?'
      )
      .all('u1');
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.language === 'ja')).toBe(true);
    const hello = rows.find((r) => r.front === 'hello');
    expect(hello?.back).toBe('world');
    expect(hello?.tags).toContain('Anki 导入：Default');
    // 重复导入：全去重
    const again = await repo.importApkgNotes(bytes, { userId: 'u1', language: 'ja' });
    expect(isOk(again)).toBe(true);
    if (!isOk(again)) return;
    expect(again.value.created).toBe(0);
    expect(again.value.skippedDuplicate).toBe(2);
  });

  it('牌组过滤 + 语种必填（不可猜）', async () => {
    const bytes = buildApkgBytes();
    const filtered = await repo.importApkgNotes(bytes, {
      userId: 'u1',
      language: 'ja',
      deckNames: ['Default'],
      mediaRoot,
    });
    expect(isOk(filtered)).toBe(true);
    if (!isOk(filtered)) return;
    expect(filtered.value.created).toBe(1);
    const badLang = await repo.importApkgNotes(bytes, {
      userId: 'u1',
      // @ts-expect-error 非法语种直测收窄
      language: 'fr',
    });
    expect(isOk(badLang)).toBe(false);
  });
});

describe('readApkgFileBytes + analyze tool', () => {
  it('相对路径/非 apkg/不存在拒绝；真实文件往返', async () => {
    expect(isOk(await readApkgFileBytes('relative/path.apkg'))).toBe(false);
    expect(isOk(await readApkgFileBytes('C:\\x.txt'))).toBe(false);
    const dir = await fsp.mkdtemp(join(tmpdir(), 'ss-apkg-path-'));
    try {
      const file = join(dir, 't.apkg');
      await fsp.writeFile(file, buildApkgBytes());
      const back = await readApkgFileBytes(file);
      expect(isOk(back)).toBe(true);
      const tool = new FlashcardsApkgAnalyzeTool();
      expect(tool.name).toBe('flashcards.apkg_analyze');
      const analyzed = await tool.execute({ filePath: file }, { userId: 'u', sessionId: 's' });
      expect(isOk(analyzed)).toBe(true);
      if (isOk(analyzed)) expect(analyzed.value.models.length).toBe(2);
      const missing = await tool.execute({ filePath: join(dir, 'no.apkg') }, { userId: 'u', sessionId: 's' });
      expect(isOk(missing)).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
