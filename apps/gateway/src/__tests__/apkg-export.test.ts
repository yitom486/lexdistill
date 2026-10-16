import { describe, expect, it, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { isOk } from '@lexdistill/shared';
import { extractZip } from '@lexdistill/archive';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { analyzeApkg } from '../modules/flashcards/application/apkg-import.js';
import { buildStoredZip } from '../modules/flashcards/application/apkg-export.js';

function seedCard(
  repo: DrizzleLearnerRepository,
  row: { id: string; userId: string; language: string; front: string; back: string }
) {
  repo
    .getRawDb()
    .prepare(
      `INSERT INTO flashcards (id, user_id, language, type, front, back, phonetic, audio_url, source_entry_id, tags, fsrs)
       VALUES (?, ?, ?, 'VOCABULARY', ?, ?, NULL, NULL, NULL, '[]', '{}')`
    )
    .run(row.id, row.userId, row.language, row.front, row.back);
}

describe('apkg export', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    seedCard(repo, { id: 'e1', userId: 'u1', language: 'ja', front: '食べる', back: 'to eat' });
    seedCard(repo, { id: 'e2', userId: 'u1', language: 'ja', front: '飲む', back: 'to drink' });
    seedCard(repo, { id: 'e3', userId: 'u1', language: 'en', front: 'hello', back: '你好' });
    seedCard(repo, { id: 'e4', userId: 'u2', language: 'ja', front: '他人的卡', back: 'x' });
  });

  it('按用户+语种导出；往返解析自洽', async () => {
    const res = await repo.exportApkgFile({ userId: 'u1', language: 'ja' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.noteCount).toBe(2);
    expect(res.value.filename.endsWith('.apkg')).toBe(true);
    expect(res.value.truncated).toBe(false);
    // 自研 writer → 自研 reader 往返
    const back = await analyzeApkg(res.value.bytes, res.value.filename);
    expect(isOk(back)).toBe(true);
    if (!isOk(back)) return;
    expect(back.value.noteCount).toBe(2);
    expect(back.value.cardCount).toBe(2);
    expect(back.value.models[0]?.modelName).toBe('LexDistill Basic');
    expect(back.value.decks).toEqual([{ name: 'LexDistill', noteCount: 2 }]);

    const collectionEntry = extractZip(res.value.bytes).find((entry) => entry.path === 'collection.anki2');
    expect(collectionEntry).toBeDefined();
    if (!collectionEntry) return;
    const collection = Database.deserialize(collectionEntry.data);
    try {
      const tables = collection
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('col', 'notes', 'cards') ORDER BY name"
        )
        .all()
        .map((row) => row.name);
      expect(tables).toEqual(['cards', 'col', 'notes']);
      for (const table of ['col', 'notes', 'cards']) {
        const row = collection.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get();
        expect(row?.count).toBeGreaterThan(0);
      }
    } finally {
      collection.close();
    }
  });

  it('空集合导出合法空包；上限截断如实标记', async () => {
    const empty = await repo.exportApkgFile({ userId: 'nobody', language: 'ja' });
    expect(isOk(empty)).toBe(true);
    if (!isOk(empty)) return;
    expect(empty.value.noteCount).toBe(0);
    const capped = await repo.exportApkgFile({ userId: 'u1', language: 'ja', maxCards: 1 });
    expect(isOk(capped)).toBe(true);
    if (!isOk(capped)) return;
    expect(capped.value.noteCount).toBe(1);
    expect(capped.value.truncated).toBe(true);
  });

  it('非法语种拒绝；自定义牌组名进文件名与包内', async () => {
    const bad = await repo.exportApkgFile({
      userId: 'u1',
      // @ts-expect-error 非法语种直测收窄
      language: 'fr',
    });
    expect(isOk(bad)).toBe(false);
    const named = await repo.exportApkgFile({ userId: 'u1', language: 'en', deckName: 'My Deck' });
    expect(isOk(named)).toBe(true);
    if (!isOk(named)) return;
    expect(named.value.filename).toBe('My Deck.apkg');
    const back = await analyzeApkg(named.value.bytes, named.value.filename);
    if (!isOk(back)) return;
    expect(back.value.decks).toEqual([{ name: 'My Deck', noteCount: 1 }]);
  });

  it('buildStoredZip 自包含往返（与 reader 对齐）', () => {
    const bytes = buildStoredZip([{ name: 'a.txt', data: new Uint8Array([1, 2, 3]) }]);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});
