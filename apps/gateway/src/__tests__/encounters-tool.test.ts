import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { LearningEncountersTool } from '../modules/dictionary/tools/learning-encounters-tool.js';
import { selectTurnTools } from '../runtime/router/turn-tools.js';

const CTX = { userId: 'u1', sessionId: 's1' };

async function seedExposure(
  repo: DrizzleLearnerRepository,
  userId: string,
  headword: string,
  times: number,
  collected = false
) {
  for (let i = 0; i < times; i++) {
    await repo.recordTermExposure({
      userId,
      language: 'ja',
      headword,
      source: 'lookup',
    });
  }
  if (collected) {
    await repo.recordTermExposure({
      userId,
      language: 'ja',
      headword,
      source: 'collect',
      markCollected: true,
      flashcardId: `card_${headword}`,
    });
  }
}

describe('learning.encounters（相遇词信号 Tool）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  it('热词过滤：≥阈值未收藏进 hot，已收藏/低频不进', async () => {
    await seedExposure(repo, 'u1', '曖昧', 5);
    await seedExposure(repo, 'u1', '躊躇', 2);
    await seedExposure(repo, 'u1', '明確', 4, true);
    const tool = new LearningEncountersTool(repo);
    const res = await tool.execute({ userId: 'u1', language: 'ja' }, CTX);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.seen).toBe(3);
    expect(res.value.collected).toBe(1);
    expect(res.value.uncollectedHot).toBe(1);
    expect(res.value.hot.map((h) => h.headword)).toEqual(['曖昧']);
    expect(res.value.hot[0]?.exposureCount).toBe(5);
  });

  it('阈值与条数可调；用户隔离', async () => {
    await seedExposure(repo, 'u1', '曖昧', 5);
    await seedExposure(repo, 'u1', '躊躇', 4);
    await seedExposure(repo, 'u2', '他人の词', 9);
    const tool = new LearningEncountersTool(repo);
    const strict = await tool.execute({ userId: 'u1', language: 'ja', minExposures: 5 }, CTX);
    if (!isOk(strict)) return;
    expect(strict.value.hot.map((h) => h.headword)).toEqual(['曖昧']);
    const capped = await tool.execute({ userId: 'u1', language: 'ja', limit: 1 }, CTX);
    if (!isOk(capped)) return;
    expect(capped.value.hot.length).toBe(1);
    expect(capped.value.uncollectedHot).toBe(2);
  });

  it('空信号返回零值不报错', async () => {
    const tool = new LearningEncountersTool(repo);
    const res = await tool.execute({ userId: 'nobody', language: 'ja' }, CTX);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toEqual({ seen: 0, collected: 0, uncollectedHot: 0, hot: [] });
  });
});

describe('turn-tools 接线 encounters', () => {
  it('FREE_COACH 意图自带 learning.encounters', () => {
    const tools = selectTurnTools({ intent: 'FREE_COACH', userPrompt: '今天学点什么' });
    expect(tools.includes('learning.encounters')).toBe(true);
  });

  it('GRADE 意图不带（READ 按意图，最小暴露）', () => {
    const tools = selectTurnTools({ intent: 'GRADE', userPrompt: '批改一下' });
    expect(tools.includes('learning.encounters')).toBe(false);
  });

  it('提示词“总见到”按 hint 补上', () => {
    const tools = selectTurnTools({ intent: 'GRADE', userPrompt: '这个词总见到就是记不住' });
    expect(tools.includes('learning.encounters')).toBe(true);
  });
});
