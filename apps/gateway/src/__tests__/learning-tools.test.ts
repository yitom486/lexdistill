import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { MistakesListTool } from '../modules/learning-progress/tools/mistakes-list-tool.js';
import { MistakesResolveTool } from '../modules/learning-progress/tools/mistakes-resolve-tool.js';
import { FlashcardsDueTool } from '../modules/flashcards/tools/flashcards-due-tool.js';
import { FlashcardsCollectTool } from '../modules/flashcards/tools/flashcards-collect-tool.js';

const CTX = { userId: 'u1', sessionId: 's1' };

function seedMistake(repo: DrizzleLearnerRepository, row: { id: string; userId: string; resolved?: boolean }) {
  return repo.saveMistake({
    id: row.id,
    userId: row.userId,
    questionId: 'q1',
    question: {
      id: 'q1',
      type: 'MULTIPLE_CHOICE',
      prompt: 'pick',
      content: 'a ___ b',
      correctAnswer: 'x',
      explanation: 'why',
      testedSkillId: 'en.vocab',
      difficultyTier: 2,
    },
    lastUserSubmission: 'y',
    lastGrading: {
      isCorrect: false,
      score: 0,
      explanation: 'wrong',
      correctAnswer: 'x',
      questionId: 'q1',
      userSubmission: 'y',
      mistakeRecorded: true,
    },
    isResolved: row.resolved ?? false,
    recordedAt: new Date().toISOString(),
    retryCount: 0,
    consecutiveCorrect: 0,
  });
}

function seedCard(
  repo: DrizzleLearnerRepository,
  row: { id: string; userId: string; front: string; dueAt: string }
) {
  repo
    .getRawDb()
    .prepare(
      `INSERT INTO flashcards (id, user_id, language, type, front, back, phonetic, audio_url, source_entry_id, tags, fsrs)
       VALUES (?, ?, 'en', 'VOCABULARY', ?, 'back', NULL, NULL, NULL, '[]', ?)`
    )
    .run(
      row.id,
      row.userId,
      row.front,
      JSON.stringify({ stability: 2, difficulty: 5, reps: 1, lapses: 0, dueAt: row.dueAt, state: 'REVIEW' })
    );
}

function seedEntry(repo: DrizzleLearnerRepository) {
  repo
    .getRawDb()
    .prepare(
      `INSERT INTO local_dictionary_entries (id, language, headword, reading, romanization, meanings_json, pronunciation_json, part_of_speech, source_id, source_label, license_note, created_at)
       VALUES ('entry-t1', 'en', 'resilient', NULL, NULL, '["坚韧的"]', NULL, 'adjective', 'seed', 'seed', 'seed', ?)`
    )
    .run(new Date().toISOString());
}

describe('mistakes tools', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    await seedMistake(repo, { id: 'm-open', userId: 'u1' });
    await seedMistake(repo, { id: 'm-done', userId: 'u1', resolved: true });
    await seedMistake(repo, { id: 'm-other', userId: 'u2' });
  });

  it('mistakes.list 按用户隔离；resolved 过滤；limit 截断', async () => {
    const tool = new MistakesListTool(repo);
    expect(tool.name).toBe('mistakes.list');
    const all = await tool.execute({ userId: 'u1' }, CTX);
    expect(isOk(all)).toBe(true);
    if (!isOk(all)) return;
    expect(all.value.map((m) => m.id).sort()).toEqual(['m-done', 'm-open']);
    const open = await tool.execute({ userId: 'u1', resolved: false }, CTX);
    if (!isOk(open)) return;
    expect(open.value.map((m) => m.id)).toEqual(['m-open']);
    const capped = await tool.execute({ userId: 'u1', limit: 1 }, CTX);
    if (!isOk(capped)) return;
    expect(capped.value.length).toBe(1);
  });

  it('mistakes.resolve 攻克；他人/未知拒绝', async () => {
    const tool = new MistakesResolveTool(repo);
    expect(tool.permission).toBe('WRITE');
    const okRes = await tool.execute({ userId: 'u1', mistakeId: 'm-open' }, CTX);
    expect(isOk(okRes)).toBe(true);
    if (!isOk(okRes)) return;
    expect(okRes.value).toEqual({ mistakeId: 'm-open', resolved: true });
    const foreign = await tool.execute({ userId: 'u1', mistakeId: 'm-other' }, CTX);
    expect(isOk(foreign)).toBe(false);
    if (isOk(foreign)) return;
    expect(foreign.error.code).toBe('E_NOT_FOUND');
    const missing = await tool.execute({ userId: 'u1', mistakeId: 'nope' }, CTX);
    expect(isOk(missing)).toBe(false);
  });
});

describe('flashcards tools', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
    seedCard(repo, { id: 'c-due', userId: 'u1', front: 'due-word', dueAt: '2020-01-01T00:00:00.000Z' });
    seedCard(repo, { id: 'c-future', userId: 'u1', front: 'future-word', dueAt: '2999-01-01T00:00:00.000Z' });
    seedCard(repo, { id: 'c-other', userId: 'u2', front: 'other-word', dueAt: '2020-01-01T00:00:00.000Z' });
    seedEntry(repo);
  });

  it('flashcards.due 只返到期（精简字段）；按用户隔离', async () => {
    const tool = new FlashcardsDueTool(repo);
    expect(tool.name).toBe('flashcards.due');
    const res = await tool.execute({ userId: 'u1' }, CTX);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.map((c) => c.id)).toEqual(['c-due']);
    expect(res.value[0]?.front).toBe('due-word');
    expect(res.value[0]?.state).toBe('REVIEW');
  });

  it('flashcards.collect 建卡去重；未知条目拒绝', async () => {
    const tool = new FlashcardsCollectTool(repo);
    expect(tool.permission).toBe('WRITE');
    const first = await tool.execute({ userId: 'u1', entryId: 'entry-t1' }, CTX);
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.created).toBe(true);
    expect(first.value.card.front).toBe('resilient');
    const again = await tool.execute({ userId: 'u1', entryId: 'entry-t1' }, CTX);
    expect(isOk(again)).toBe(true);
    if (!isOk(again)) return;
    expect(again.value.created).toBe(false);
    const missing = await tool.execute({ userId: 'u1', entryId: 'nope' }, CTX);
    expect(isOk(missing)).toBe(false);
  });
});
