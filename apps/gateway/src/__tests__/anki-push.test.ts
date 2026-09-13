import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { FlashcardsAnkiPushTool } from '../modules/flashcards/tools/flashcards-anki-push-tool.js';

/** M7-1：transport 用例已迁入 flashcards（C5 起实现内聚）；此处仅保留设置/推送命令/Tool 测试。 */

describe('anki settings', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('默认关闭；开关可写；非法端点拒绝', async () => {
    expect(await repo.getAnkiPushSettings()).toEqual({
      enabled: false,
      endpoint: 'http://127.0.0.1:8765',
    });
    const saved = await repo.saveAnkiPushSettings({ enabled: true });
    expect(isOk(saved)).toBe(true);
    expect((await repo.getAnkiPushSettings()).enabled).toBe(true);
    const bad = await repo.saveAnkiPushSettings({ endpoint: 'http://example.com/' });
    expect(isOk(bad)).toBe(false);
  });
});

function seedCard(repo: DrizzleLearnerRepository, row: { id: string; sourceEntryId?: string }) {
  repo
    .getRawDb()
    .prepare(
      `INSERT INTO flashcards (id, user_id, language, type, front, back, phonetic, audio_url, source_entry_id, tags, fsrs)
       VALUES (?, 'default_user', 'ja', 'VOCABULARY', '食べる', 'to eat', 'たべる', NULL, ?, '[]', '{}')`
    )
    .run(row.id, row.sourceEntryId ?? null);
}

function seedEntry(repo: DrizzleLearnerRepository) {
  repo
    .getRawDb()
    .prepare(
      `INSERT INTO local_dictionary_entries (id, language, headword, reading, romanization, meanings_json, pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at)
       VALUES ('entry-1', 'ja', '食べる', 'たべる', NULL, '["to eat"]', '{"pitch":{"reading":"たべる","positions":[0],"label":"⓪"}}', '動詞', 'seed', 'seed', 'seed', '2026-09-07')`
    )
    .run();
}

describe('pushCardToAnki', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('未启用直接拒绝（不碰网络）', async () => {
    seedCard(repo, { id: 'card-0' });
    const res = await repo.pushCardToAnki({ userId: 'default_user', cardId: 'card-0' });
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) expect(res.error.code).toBe('E_ANKI_DISABLED');
  });

  it('未知卡片/他人卡片拒绝（未启用检查之后、网络之前）', async () => {
    await repo.saveAnkiPushSettings({ enabled: true });
    const res = await repo.pushCardToAnki({ userId: 'default_user', cardId: 'missing' });
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) expect(res.error.code).toBe('E_NOT_FOUND');
  });
});

describe('pushCardToAnki end-to-end (stub AnkiConnect over loopback HTTP)', () => {
  let repo: DrizzleLearnerRepository;
  const calls: string[] = [];
  let noteFields: Record<string, string> | undefined;
  let mediaFiles: Array<{ filename: string; data: string }> = [];
  let server: ReturnType<typeof Bun.serve> | undefined;

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    calls.length = 0;
    noteFields = undefined;
    mediaFiles = [];
  });

  function startStub(extra: { failVersion?: boolean } = {}) {
    server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === '/tts') {
          calls.push('TTS:synthesize');
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }
        const body = (await req.json()) as { action: string; params: Record<string, unknown> };
        calls.push(`anki:${body.action}`);
        if (extra.failVersion && body.action === 'version') {
          return new Response('down', { status: 502 });
        }
        const okResult = (result: unknown) =>
          Response.json({ result, error: null });
        switch (body.action) {
          case 'version':
            return okResult(6);
          case 'deckNames':
            return okResult([]);
          case 'createDeck':
            return okResult(1);
          case 'modelNames':
            return okResult([]);
          case 'createModel':
            return okResult(null);
          case 'storeMediaFile': {
            const p = body.params as { filename: string; data: string };
            mediaFiles.push({ filename: p.filename, data: p.data });
            return okResult(p.filename);
          }
          case 'addNote': {
            const note = (body.params as { note: { fields: Record<string, string> } }).note;
            noteFields = note.fields;
            return okResult(42);
          }
          default:
            return okResult(null);
        }
      },
    });
    return `http://127.0.0.1:${server.port}`;
  }

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  // bun:test 的 afterEach 需显式导入
  it('全链路（无 TTS）：建牌组建模型 addNote，音频留空并明说', async () => {
    const endpoint = startStub();
    await repo.saveAnkiPushSettings({ enabled: true, endpoint });
    seedCard(repo, { id: 'card-1' });
    const res = await repo.pushCardToAnki({ userId: 'default_user', cardId: 'card-1' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.noteId).toBe(42);
    expect(res.value.deckName).toBe('Lingua Studio');
    expect(res.value.modelName).toBe('Lingua Basic');
    expect(res.value.audioStored).toBe(false);
    expect(res.value.audioSkippedReason).toContain('TTS');
    expect(calls).toContain('anki:createDeck');
    expect(calls).toContain('anki:createModel');
    expect(noteFields?.['Expression']).toBe('食べる');
    expect(noteFields?.['Audio']).toBeUndefined();
  });

  it('来源词条 enrichment + TTS 音频入库 [sound:]', async () => {
    const endpoint = startStub();
    await repo.saveAnkiPushSettings({ enabled: true, endpoint });
    seedEntry(repo);
    seedCard(repo, { id: 'card-2', sourceEntryId: 'entry-1' });
    const res = await repo.pushCardToAnki({
      userId: 'default_user',
      cardId: 'card-2',
      tts: { provider: 'openai-compatible', baseUrl: `${endpoint}/tts` },
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.audioStored).toBe(true);
    expect(res.value.audioSkippedReason).toBeUndefined();
    expect(calls).toContain('TTS:synthesize');
    expect(mediaFiles.length).toBe(1);
    expect(mediaFiles[0]?.filename).toMatch(/^ss-card2\.mp3$/);
    expect(noteFields?.['Reading']).toBe('たべる');
    expect(noteFields?.['Meaning']).toContain('to eat');
    expect(noteFields?.['Audio']).toBe(`[sound:${mediaFiles[0]?.filename}]`);
    // 声调阶梯图随 Pitch 字段推送
    expect(noteFields?.['Pitch']).toContain('⓪');
    expect(noteFields?.['Pitch']).toContain('<svg');
  });

  it('Anki 未打开 → E_ANKI_UNREACHABLE（可重试中文错）', async () => {
    const endpoint = startStub({ failVersion: true });
    await repo.saveAnkiPushSettings({ enabled: true, endpoint });
    seedCard(repo, { id: 'card-3' });
    const res = await repo.pushCardToAnki({ userId: 'default_user', cardId: 'card-3' });
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_ANKI_UNREACHABLE');
    expect(res.error.retryable).toBe(true);
    expect(res.error.userMessage).toContain('AnkiConnect');
  });
});

describe('FlashcardsAnkiPushTool', () => {
  it('未启用时友好拒绝（不碰网络）', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const tool = new FlashcardsAnkiPushTool(repo);
    expect(tool.name).toBe('flashcards.anki_push');
    const res = await tool.execute(
      { userId: 'default_user', cardId: 'card-x' },
      { userId: 'default_user', sessionId: 's1' }
    );
    expect(isOk(res)).toBe(false);
    if (!isOk(res)) expect(res.error.code).toBe('E_ANKI_DISABLED');
  });
});
