import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  parseApkgEntries,
  extractMediaRefs,
  type ApkgZipEntry,
} from '../index.js';

/**
 * M7-3 APKG 解析测试（纯内存 SQLite 序列化，不碰业务库与文件；C5 起归属 flashcards/integrations）。
 * Gateway 的 `apkg-import.test.ts` 未动；此处覆盖包级格式解析与错误口径。
 */

// ---------- 最小 collection.anki2 构造器（纯内存 SQLite 序列化，无文件中转） ----------
function buildCollectionBytes(): Uint8Array {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE col (models TEXT, decks TEXT);
      CREATE TABLE cards (nid INTEGER, did INTEGER);
      CREATE TABLE notes (id INTEGER, mid INTEGER, tags TEXT, flds TEXT);`);
  const models = {
    '1': {
      name: 'Basic',
      flds: [{ name: 'Front' }, { name: 'Back' }],
      tmpls: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{Back}}' }],
      css: '.card {}',
    },
  };
  const decks = { '1': { name: 'Default' }, '2': { name: 'Greetings' } };
  db.prepare('INSERT INTO col (models, decks) VALUES (?, ?)').run(
    JSON.stringify(models),
    JSON.stringify(decks)
  );
  db.prepare('INSERT INTO cards (nid, did) VALUES (?, ?)').run(11, 2);
  db.prepare('INSERT INTO cards (nid, did) VALUES (?, ?)').run(12, 1);
  const note = db.prepare('INSERT INTO notes (id, mid, tags, flds) VALUES (?, ?, ?, ?)');
  note.run(11, 1, 'greeting', 'おはよう[sound:ohayo.mp3]\x1fgood morning');
  note.run(12, 1, '', 'ありがとう\x1fthank you');
  const bytes = new Uint8Array(db.serialize());
  db.close();
  return bytes;
}

function entriesWith(collection: Uint8Array): ApkgZipEntry[] {
  return [
    { path: 'collection.anki2', data: collection },
    { path: 'media', data: new TextEncoder().encode(JSON.stringify({ '0': 'ohayo.mp3' })) },
    { path: '0', data: new Uint8Array([1, 2, 3, 4]) },
  ];
}

describe('parseApkgEntries', () => {
  it('笔记/牌组/模板/媒体引用一次解析', async () => {
    const parsed = await parseApkgEntries(entriesWith(buildCollectionBytes()));
    expect(parsed.notes.length).toBe(2);
    expect(parsed.cardCount).toBe(2);
    // 首卡经 cards 映射到 Greetings 牌组
    expect(parsed.notes[0]?.deckName).toBe('Greetings');
    expect(parsed.notes[0]?.fields).toEqual(['おはよう[sound:ohayo.mp3]', 'good morning']);
    expect(parsed.notes[0]?.tags).toEqual(['greeting']);
    expect(parsed.notes[1]?.deckName).toBe('Default');
    expect(parsed.decks.get('Greetings')).toBe(1);
    expect(parsed.decks.get('Default')).toBe(1);
    const model = parsed.models.get('1');
    expect(model?.name).toBe('Basic');
    expect(model?.fields).toEqual(['Front', 'Back']);
    expect(model?.front).toBe('{{Front}}');
    // 媒体：1 个 [sound:] 引用 + 映射表 1 文件 + blob 落键
    expect(parsed.mediaRefCount).toBe(1);
    expect(parsed.mediaFileCount).toBe(1);
    expect(parsed.mediaBlobs.get('ohayo.mp3')).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('无 collection 报 E_INVALID_INPUT', async () => {
    const err = await parseApkgEntries([{ path: 'media', data: new Uint8Array() }]).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).not.toBeNull();
    expect((err as { code?: string }).code).toBe('E_INVALID_INPUT');
  });

  it('条目数超限拒绝', async () => {
    const many: ApkgZipEntry[] = Array.from({ length: 20001 }, (_, i) => ({
      path: `f${i}`,
      data: new Uint8Array(),
    }));
    const err = await parseApkgEntries(many).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as { code?: string } | null)?.code).toBe('E_INVALID_INPUT');
  });

  it('损坏的 collection 字节直接抛错（由 Gateway 翻译层收敛）', async () => {
    await expect(
      parseApkgEntries([{ path: 'collection.anki2', data: new Uint8Array([9, 9, 9]) }])
    ).rejects.toThrow();
  });
});

describe('extractMediaRefs', () => {
  it('提取 sound 与 img 引用', () => {
    expect(extractMediaRefs('a[sound:x.mp3]b<img src="y.png">c')).toEqual(['x.mp3', 'y.png']);
  });

  it('无引用返回空数组', () => {
    expect(extractMediaRefs('plain text')).toEqual([]);
  });
});
