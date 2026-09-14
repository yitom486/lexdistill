import { describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningContentTool } from '../transport/tools/learning-content-tool.js';
import { isOk } from '@study-studio/shared';
import { app } from '../index.js';

describe('practice collections / collect', () => {
  it('persists generated quiz into practice_collections and practice_items', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const tool = new LearningContentTool(repo);

    const res = await tool.execute(
      {
        action: 'generate_quiz',
        count: 2,
        skillIds: ['jp.particle.ni_vs_de'],
        collect: true,
        collectionTitle: '今日助词专练',
      },
      { userId: 'student_web_01', sessionId: 's1' }
    );

    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;

    expect(res.value.collectionId).toBeTruthy();
    expect(res.value.questions?.length).toBe(2);

    const cols = await repo.listPracticeCollections('student_web_01');
    expect(isOk(cols)).toBe(true);
    if (!isOk(cols)) return;
    expect(cols.value.length).toBe(1);
    expect(cols.value[0]!.title).toBe('今日助词专练');

    const items = await repo.listPracticeItems('student_web_01', cols.value[0]!.id);
    expect(isOk(items)).toBe(true);
    if (!isOk(items)) return;
    expect(items.value.length).toBe(2);
    expect(items.value[0]!.question.testedSkillId).toBe('jp.particle.ni_vs_de');
  });

  it('converts selected practice items into FSRS cards without auto-convert on collect', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const tool = new LearningContentTool(repo);
    const userId = 'student_pq_01';

    const gen = await tool.execute(
      {
        action: 'generate_quiz',
        count: 3,
        skillIds: ['en.vocab.collocation'],
        language: 'en',
        collect: true,
        collectionTitle: 'CET collocations',
      },
      { userId, sessionId: 's2' }
    );
    expect(isOk(gen)).toBe(true);
    if (!isOk(gen)) return;

    const itemsRes = await repo.listPracticeItems(userId, gen.value.collectionId!);
    expect(isOk(itemsRes)).toBe(true);
    if (!isOk(itemsRes)) return;
    expect(itemsRes.value.length).toBe(3);

    // collect 本身不应自动建卡
    const before = await repo.getDueCards(userId);
    expect(isOk(before)).toBe(true);
    if (!isOk(before)) return;
    expect(before.value.every((c) => !c.id.startsWith('card_pq_'))).toBe(true);

    const pick = itemsRes.value.slice(0, 2).map((i) => i.id);
    const conv = await repo.convertPracticeItemsToCards(userId, pick);
    expect(isOk(conv)).toBe(true);
    if (!isOk(conv)) return;
    expect(conv.value.createdCount).toBe(2);
    expect(conv.value.cardIds.length).toBe(2);
    expect(conv.value.skippedItemIds).toEqual([]);

    const after = await repo.getDueCards(userId);
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) return;
    const pqCards = after.value.filter((c) => c.id.startsWith('card_pq_'));
    expect(pqCards.length).toBe(2);
    expect(pqCards[0]!.tags).toContain('练习队列');
    expect(pqCards[0]!.front.length).toBeGreaterThan(0);
    expect(pqCards[0]!.back.length).toBeGreaterThan(0);
    // M6：转卡 NEW 初始化与旧字面量语义一致（canonical initFsrsState 形状）
    expect(pqCards[0]!.fsrs.stability).toBe(1);
    expect(pqCards[0]!.fsrs.difficulty).toBe(5);
    expect(pqCards[0]!.fsrs.reps).toBe(0);
    expect(pqCards[0]!.fsrs.lapses).toBe(0);
    expect(pqCards[0]!.fsrs.state).toBe('NEW');
    expect(Number.isFinite(Date.parse(pqCards[0]!.fsrs.dueAt))).toBe(true);
  });

  it('rejects empty to-cards HTTP body with validation error', async () => {
    const res = await app.request('/api/practice/items/student_web_01/to-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: [] }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
