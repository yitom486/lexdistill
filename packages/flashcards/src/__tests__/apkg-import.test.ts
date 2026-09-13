import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, isErr, BusinessError } from '@study-studio/shared';
import {
  importParsedApkgNotes,
  type ApkgImportPorts,
  type ApkgImportCardInput,
  type ImportParsedApkgNotesOptions,
} from '../index.js';
import type { ParsedApkg } from '@study-studio/flashcard-integrations';

/** M7-13 导入编排测试（fake ports，无数据库）。 */
const NOW = '2026-09-07T12:00:00.000Z';

function note(mid: string, deckName: string, fields: string[], tags: string[] = []) {
  return { mid, tags, fields, deckName };
}

function parsedWith(notes: ReturnType<typeof note>[], blobs: Record<string, number[]> = {}): ParsedApkg {
  const mediaBlobs = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(blobs)) mediaBlobs.set(name, new Uint8Array(bytes));
  return { notes, cardCount: notes.length, decks: new Map(), models: new Map(), mediaRefCount: 0, mediaFileCount: 0, mediaBlobs };
}

interface FakeDb {
  created: ApkgImportCardInput[];
  storedMedia: { collection: string; filename: string }[];
}

function fakePorts(db: FakeDb, opts: { existing?: string[]; storeFail?: boolean } = {}): ApkgImportPorts {
  return {
    listExistingFronts: async () => opts.existing ?? [],
    createCard: async (card) => {
      db.created.push(card);
    },
    storeMediaFile: async ({ collection, filename }) => {
      if (opts.storeFail) return err(new BusinessError('E_MEDIA', '存失败', 'TOOL_EXECUTION', false));
      db.storedMedia.push({ collection, filename });
      return ok(undefined);
    },
  };
}

function options(over: Partial<ImportParsedApkgNotesOptions> = {}): ImportParsedApkgNotesOptions {
  return { userId: 'u1', language: 'ja', now: NOW, ...over };
}

describe('importParsedApkgNotes', () => {
  it('正常创建与完整结果统计（含媒体入库与形状）', async () => {
    const db: FakeDb = { created: [], storedMedia: [] };
    const parsed = parsedWith(
      [note('1', 'D1', ['<b>食べる</b>', 'to eat [sound:a.mp3]'], ['t1'])],
      { 'a.mp3': [1, 2, 3] }
    );
    const res = await importParsedApkgNotes(fakePorts(db), parsed, options());
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toEqual({
      created: 1,
      skippedDuplicate: 0,
      skippedEmpty: 0,
      mediaSkipped: 0,
      mediaStored: 1,
      decks: ['D1'],
      truncated: false,
    });
    expect(db.created.length).toBe(1);
    const card = db.created[0]!;
    expect(card.id.startsWith('card_apkg')).toBe(true);
    expect(card.userId).toBe('u1');
    expect(card.language).toBe('ja');
    expect(card.front).toBe('食べる');
    expect(card.back).toBe('to eat [sound:a.mp3]');
    expect(JSON.parse(card.tagsJson)).toEqual(['Anki 导入：D1', 't1']);
    const fsrs = JSON.parse(card.fsrsJson) as Record<string, unknown>;
    expect(fsrs).toMatchObject({ stability: 1, difficulty: 5, reps: 0, lapses: 0, dueAt: NOW, state: 'NEW' });
    expect(db.storedMedia).toEqual([{ collection: 'apkg:D1', filename: 'a.mp3' }]);
  });

  it('既有重复、批内重复与空 front', async () => {
    const db: FakeDb = { created: [], storedMedia: [] };
    const parsed = parsedWith([
      note('1', 'D1', ['dup', 'x']),
      note('1', 'D1', ['dup', 'y']),
      note('1', 'D1', ['   ', 'empty front']),
      note('1', 'D1', ['new', 'z']),
    ]);
    const res = await importParsedApkgNotes(fakePorts(db, { existing: ['dup'] }), parsed, options());
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.created).toBe(1);
    expect(res.value.skippedDuplicate).toBe(2);
    expect(res.value.skippedEmpty).toBe(1);
    expect(db.created.map((c) => c.front)).toEqual(['new']);
  });

  it('deck 过滤、maxNotes 截断、非法 language', async () => {
    const db: FakeDb = { created: [], storedMedia: [] };
    const parsed = parsedWith([
      note('1', 'Keep', ['k1', 'x']),
      note('1', 'Drop', ['d1', 'x']),
      note('1', 'Keep', ['k2', 'x']),
    ]);
    const filtered = await importParsedApkgNotes(fakePorts(db), parsed, options({ deckNames: ['Keep'] }));
    expect(isOk(filtered)).toBe(true);
    if (!isOk(filtered)) return;
    expect(filtered.value.created).toBe(2);
    expect(db.created.every((c) => c.front.startsWith('k'))).toBe(true);

    const db2: FakeDb = { created: [], storedMedia: [] };
    const truncated = await importParsedApkgNotes(fakePorts(db2), parsed, options({ maxNotes: 1 }));
    expect(isOk(truncated)).toBe(true);
    if (!isOk(truncated)) return;
    expect(truncated.value.created).toBe(1);
    expect(truncated.value.truncated).toBe(true);

    const badLang = await importParsedApkgNotes(fakePorts(db2), parsed, options({ language: 'fr' }));
    expect(isErr(badLang)).toBe(true);
    if (isErr(badLang)) {
      expect(badLang.error.code).toBe('E_INVALID_INPUT');
      expect(badLang.error.userMessage).toContain('ja/en/ko');
    }
  });

  it('媒体缺失只计数、存储失败计入 skipped（均不阻断）', async () => {
    const db: FakeDb = { created: [], storedMedia: [] };
    const parsed = parsedWith([note('1', 'D1', ['w', 'x [sound:missing.mp3]'])]);
    const missing = await importParsedApkgNotes(fakePorts(db), parsed, options());
    expect(isOk(missing)).toBe(true);
    if (!isOk(missing)) return;
    expect(missing.value.mediaSkipped).toBe(1);
    expect(missing.value.mediaStored).toBe(0);
    expect(missing.value.created).toBe(1);

    const db2: FakeDb = { created: [], storedMedia: [] };
    const parsed2 = parsedWith([note('1', 'D1', ['w', 'x [sound:a.mp3]'])], { 'a.mp3': [9] });
    const failed = await importParsedApkgNotes(fakePorts(db2, { storeFail: true }), parsed2, options());
    expect(isOk(failed)).toBe(true);
    if (!isOk(failed)) return;
    expect(failed.value.mediaSkipped).toBe(1);
    expect(failed.value.mediaStored).toBe(0);
    expect(failed.value.created).toBe(1);
  });
});
