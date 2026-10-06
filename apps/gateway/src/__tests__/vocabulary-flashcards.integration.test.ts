import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { VocabularyCollectionSchema, VocabularyEntrySchema, FlashcardSchema } from '@study-studio/protocol';
import { z } from 'zod';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { GatewayServer } from '../runtime/gateway-runtime.js';
import { createDictionaryRoutes } from '../modules/dictionary/http/dictionary-routes.js';
import { createReviewRoutes } from '../modules/review/http/review-routes.js';

describe('教材词汇 → 词汇库 → 复习：真实数据库与 HTTP', () => {
  let repo: DrizzleLearnerRepository;
  let app: Hono;
  const userId = 'vocabulary-owner';
  const scope = { documentId: 'vocabulary-book', chapterId: 'chapter-1' };
  const request = (url: string, body: unknown) => app.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const count = () => repo.getRawDb().query<{ n: number }, [string]>('SELECT count(*) AS n FROM flashcards WHERE user_id=?').get(userId)!.n;

  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    const deps = { repo, server: new GatewayServer(repo), port: 0 };
    app = new Hono().route('/', createDictionaryRoutes(deps)).route('/', createReviewRoutes(deps));
    expect((await repo.seedTextbookTocSkeleton({ documentId: scope.documentId, userId, title: '实际教材', language: 'ja', sourceFingerprint: 'test-source',
      entries: [{ id: scope.chapterId, title: '第一课', level: 'lesson', startPage: 1 }, { id: 'chapter-2', title: '第二课', level: 'lesson', startPage: 3 }] })).ok).toBe(true);
    for (const [chapterId, meaning] of [[scope.chapterId, '吃（第一课）'], ['chapter-2', '用餐（第二课）']] as const) {
      expect((await repo.writeTextbookContent({ userId, documentId: scope.documentId, chapterId }, 'vocabulary', { items: [{ word: '食べる', reading: 'たべる', meaning, partOfSpeech: '动词', level: 'N5', examples: [{ text: 'ご飯を食べる。', translation: '吃饭。' }] }] })).ok).toBe(true);
    }
  });
  afterEach(() => repo.getRawDb().close());

  async function vocabularyId() {
    const response = await app.request(`/api/vocabulary/${userId}?lang=ja`);
    expect(response.status).toBe(200);
    const words = z.array(VocabularyEntrySchema).parse(await response.json());
    expect(words).toHaveLength(1);
    return words[0]!.id;
  }
  async function collect(id: string, source: object = scope) {
    const response = await request(`/api/vocabulary/${userId}/${id}/collect`, source);
    expect(response.status).toBe(200);
    return VocabularyCollectionSchema.parse(await response.json());
  }

  it('导入立即可查、按章节收藏、复习落库；再次收藏不重建也不覆盖用户修改', async () => {
    const id = await vocabularyId();
    const before = await repo.listVocabulary(userId, 'ja');
    expect(before.ok && before.value[0]!.collected).toBe(false);
    expect(before.ok && before.value[0]!.sources.map(source => source.chapterTitle)).toEqual(['第一课', '第二课']);
    expect(count()).toBe(0);
    const first = await collect(id, { ...scope, chapterId: 'chapter-2' });
    expect(first.created).toBe(true);
    expect(first.card.back).toBe('用餐（第二课）');
    expect(first.card.examples).toEqual([{ text: 'ご飯を食べる。', translation: '吃饭。' }]);
    expect(first.card.partOfSpeech).toBe('动词');
    expect(first.card.tags).toEqual(['教材生词']);
    const wordlists = await repo.listWordlists(userId, 'ja');
    expect(wordlists.ok && wordlists.value.flatMap(group => group.words).find(word => word.entryId === 'n5_ja_taberu')?.collected).toBe(true);
    expect(first.card.sourceEntryId).toBeUndefined();
    const reviewed = await request(`/api/cards/${userId}/${first.card.id}/review`, { rating: 'GOOD' });
    expect(reviewed.status).toBe(200);
    const state = repo.getRawDb().query<{ fsrs: string }, [string]>('SELECT fsrs FROM flashcards WHERE id=?').get(first.card.id)!.fsrs;
    repo.getRawDb().query('UPDATE flashcards SET back=? WHERE id=?').run('我的词义笔记', first.card.id);
    const repeated = await collect(id);
    expect(repeated.created).toBe(false);
    expect(repeated.card.id).toBe(first.card.id);
    expect(repeated.card.back).toBe('我的词义笔记');
    expect(JSON.stringify(repeated.card.fsrs)).toBe(state);
    expect(count()).toBe(1);
    const cards = z.array(FlashcardSchema).parse(await (await app.request(`/api/cards/${userId}?lang=ja`)).json());
    expect(cards[0]!.vocabularyId).toBe(id);
    expect(cards[0]!.fsrs.reps).toBe(1);
    expect(repo.getRawDb().query<{ n: number }, [string]>('SELECT count(*) AS n FROM review_schedule_events WHERE card_id=?').get(first.card.id)!.n).toBe(1);
    const saved = await repo.listVocabulary(userId, 'ja', scope);
    expect(saved.ok && saved.value[0]!.collected).toBe(true);
  });

  it('教材、词典和已接受的词汇草稿复用卡片，词典出处仍独立保存', async () => {
    const id = await vocabularyId(), first = await collect(id);
    const dictionary = await repo.collectDictionaryEntry(userId, 'n5_ja_taberu');
    expect(dictionary.ok && dictionary.value.created).toBe(false);
    expect(dictionary.ok && dictionary.value.card.id).toBe(first.card.id);
    expect(dictionary.ok && dictionary.value.card.vocabularyId).toBe(id);
    expect(dictionary.ok && dictionary.value.card.sourceEntryId).toBe('n5_ja_taberu');
    const proposed = await repo.proposeCardDrafts([{ userId, language: 'ja', headword: '食べる', reading: 'たべる', meanings: ['不同草稿释义'], source: 'agent' }]);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const accepted = await repo.acceptCardDraft(userId, proposed.value[0]!.id);
    expect(accepted.ok && accepted.value.cardId).toBe(first.card.id);
    expect(count()).toBe(1);
    const after = await repo.getFlashcard(userId, first.card.id);
    expect(after.ok && after.value.back).toBe('吃（第一课）');
    expect((await repo.listVocabulary(userId, 'ja')).ok).toBe(true);
  });

  it('旧卡片无读音也能准确关联，保留旧卡 ID 与复习状态', async () => {
    const fsrs = { stability: 8, difficulty: 4, reps: 7, lapses: 1, state: 'REVIEW' as const, dueAt: '2030-01-01T00:00:00.000Z' };
    repo.getRawDb().query(`INSERT INTO flashcards(id,user_id,language,type,front,back,tags,fsrs) VALUES ('legacy-null',?,'en','VOCABULARY','apple','旧释义','[]',?)`).run(userId, JSON.stringify(fsrs));
    const proposed = await repo.proposeCardDrafts([{ userId, language: 'en', headword: 'apple', meanings: ['苹果'], source: 'agent' }]);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const accepted = await repo.acceptCardDraft(userId, proposed.value[0]!.id);
    expect(accepted.ok && accepted.value.cardId).toBe('legacy-null');
    const linked = await repo.getFlashcard(userId, 'legacy-null');
    expect(linked.ok && linked.value.fsrs).toEqual(fsrs);
    expect(linked.ok && linked.value.back).toBe('旧释义');
    expect(linked.ok && linked.value.vocabularyId).toBeTruthy();
  });

  it('跨用户、错误教材章节、非法语种被拒绝，不产生卡片或修改词条', async () => {
    const id = await vocabularyId();
    expect((await request(`/api/vocabulary/intruder/${id}/collect`, {})).ok).toBe(false);
    expect((await request(`/api/vocabulary/${userId}/${id}/collect`, { ...scope, chapterId: 'missing' })).ok).toBe(false);
    expect((await request(`/api/vocabulary/${userId}/${id}/collect`, { documentId: 'someone-elses-book' })).ok).toBe(false);
    expect((await request(`/api/vocabulary/${userId}/${id}/collect`, { chapterId: scope.chapterId })).status).toBe(400);
    expect((await app.request(`/api/vocabulary/${userId}?lang=unknown`)).status).toBe(400);
    expect(await (await app.request('/api/vocabulary/intruder?lang=ja')).json()).toEqual([]);
    expect(await (await app.request(`/api/vocabulary/${userId}?lang=en`)).json()).toEqual([]);
    expect(count()).toBe(0);
  });

  it('词汇草稿接受失败时回滚词条与卡片；HTTP 写入失败不会返回成功', async () => {
    const proposed = await repo.proposeCardDrafts([{ userId, language: 'ja', headword: '新しい', reading: 'あたらしい', meanings: ['新的'], source: 'agent' }]);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    repo.getRawDb().run(`CREATE TRIGGER fail_accept BEFORE UPDATE ON card_drafts WHEN NEW.status='accepted' BEGIN SELECT RAISE(ABORT,'test rollback'); END`);
    expect((await repo.acceptCardDraft(userId, proposed.value[0]!.id)).ok).toBe(false);
    expect(count()).toBe(0);
    expect(repo.getRawDb().query<{ n: number }, [string]>('SELECT count(*) AS n FROM global_vocabulary WHERE user_id=?').get(userId)!.n).toBe(1);
    const pending = await repo.listCardDrafts(userId, 'ja');
    expect(pending.ok && pending.value[0]!.status).toBe('pending');
    const first = await collect(await vocabularyId());
    expect((await request(`/api/cards/intruder`, first.card)).status).toBe(400);
    expect((await request(`/api/cards/${userId}`, { ...first.card, id: 'duplicate-linked-card' })).ok).toBe(false);
    expect(count()).toBe(1);
  });

  it('复习直接读取所属单卡，超过200张卡、不同语种仍可复习，跨用户仍拒绝', async () => {
    const first = await collect(await vocabularyId());
    const sqlite = repo.getRawDb();
    sqlite.transaction(() => { for (let i = 0; i < 205; i++) sqlite.query('INSERT INTO flashcards(id,user_id,language,type,front,back,tags,fsrs) VALUES (?,?,?,?,?,?,?,?)').run(`earlier-${i}`, userId, 'en', 'VOCABULARY', `word-${i}`, 'meaning', '[]', JSON.stringify(first.card.fsrs)); })();
    expect((await request(`/api/cards/${userId}/earlier-204/review`, { rating: 'GOOD' })).status).toBe(200);
    expect((await request('/api/cards/intruder/earlier-204/review', { rating: 'GOOD' })).ok).toBe(false);
  });
});
