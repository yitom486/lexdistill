import { describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningContentTool } from '../transport/tools/learning-content-tool.js';
import { maybeCollect } from '../transport/tools/learning-content/shared.js';
import type { GeneratedQuestion } from '@study-studio/protocol';
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

  it('P4-2 sourceRef 补链：模板 id 去重保序附后，缺省回退 skill 旧形', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    const q: GeneratedQuestion = {
      id: 'q1',
      type: 'MULTIPLE_CHOICE',
      prompt: 'p',
      content: 'c',
      correctAnswer: 'a',
      explanation: 'e',
      testedSkillId: 'jp.test',
      difficultyTier: 2,
    };
    const ctx = { userId: 'u-src', sessionId: 's' };
    const withIds = await maybeCollect(
      repo,
      ctx,
      { action: 'generate_quiz', skillIds: ['jp.test'], collect: true },
      'ja',
      [q],
      's',
      undefined,
      ['tmpl_2', 'tmpl_1', 'tmpl_2']
    );
    expect(isOk(withIds)).toBe(true);
    if (!isOk(withIds)) return;
    expect(withIds.value.collectionId).toBeTruthy();
    const cols = await repo.listPracticeCollections('u-src');
    expect(isOk(cols)).toBe(true);
    if (!isOk(cols)) return;
    // skill 保留＋模板 id 去重保序。
    expect(cols.value[0]!.sourceRef).toBe('jp.test;template:tmpl_2,tmpl_1');
    const items = await repo.listPracticeItems('u-src', cols.value[0]!.id);
    expect(isOk(items)).toBe(true);
    if (!isOk(items)) return;
    expect(items.value[0]!.sourceRef).toBe('jp.test;template:tmpl_2,tmpl_1');
    // 旧形：无模板 id 即纯 skill（其他动作路径不变）。
    const legacy = await maybeCollect(
      repo,
      ctx,
      { action: 'generate_quiz', skillIds: ['jp.test'], collect: true },
      'ja',
      [{ ...q, id: 'q2' }],
      's'
    );
    expect(isOk(legacy)).toBe(true);
    if (!isOk(legacy)) return;
    const cols2 = await repo.listPracticeCollections('u-src');
    if (!isOk(cols2)) return;
    expect(cols2.value.find((c) => c.id !== cols.value[0]!.id)?.sourceRef).toBe('jp.test');
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
