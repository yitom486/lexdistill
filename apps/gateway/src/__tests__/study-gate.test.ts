import { describe, expect, it, beforeEach } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import { assemblePracticeRun } from '../modules/practice/application/practice-assembly.js';

const UID = 'study_gate_01';

function seedCard(
  repo: DrizzleLearnerRepository,
  row: { id: string; front: string; studied: boolean }
) {
  repo
    .getRawDb()
    .prepare(
      `INSERT INTO flashcards (id, user_id, language, type, front, back, tags, fsrs, studied_at)
       VALUES (?, ?, 'ja', 'VOCABULARY', ?, ?, '[]', ?, ?)`
    )
    .run(
      row.id,
      UID,
      row.front,
      `释义-${row.front}`,
      JSON.stringify({
        stability: 1,
        difficulty: 5,
        reps: 0,
        lapses: 0,
        dueAt: new Date().toISOString(),
        state: 'NEW',
      }),
      row.studied ? new Date().toISOString() : null
    );
}

describe('studied 标记管道（M2 学习门）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    await repo.updateLearnerProfile(UID, { targetLanguage: 'ja' });
  });

  it('saveCard 透传 studiedAt；更新不带不清除', async () => {
    await repo.saveCard({
      id: 'sg1',
      userId: UID,
      type: 'VOCABULARY',
      front: '曖昧',
      back: '含糊',
      tags: [],
      studiedAt: '2026-09-07T00:00:00.000Z',
      fsrs: { stability: 1, difficulty: 5, reps: 0, lapses: 0, dueAt: new Date().toISOString(), state: 'NEW' },
    });
    const cards = await repo.getDueCards(UID, 10, { language: 'ja' });
    expect(isOk(cards)).toBe(true);
    if (!isOk(cards)) return;
    expect(cards.value.find((c) => c.id === 'sg1')?.studiedAt).toBe('2026-09-07T00:00:00.000Z');
    // 更新不带 studiedAt：不清零（讲透只升不降）
    await repo.saveCard({
      id: 'sg1',
      userId: UID,
      type: 'VOCABULARY',
      front: '曖昧',
      back: '含糊',
      tags: [],
      fsrs: { stability: 1, difficulty: 5, reps: 0, lapses: 0, dueAt: new Date().toISOString(), state: 'NEW' },
    });
    const again = await repo.getDueCards(UID, 10, { language: 'ja' });
    if (!isOk(again)) return;
    expect(again.value.find((c) => c.id === 'sg1')?.studiedAt).toBe('2026-09-07T00:00:00.000Z');
  });

  it('markCardStudied 标记+幂等+404', async () => {
    seedCard(repo, { id: 'sg2', front: '躊躇', studied: false });
    const marked = await repo.markCardStudied(UID, 'sg2');
    expect(isOk(marked)).toBe(true);
    const again = await repo.markCardStudied(UID, 'sg2');
    expect(isOk(again)).toBe(true);
    const missing = await repo.markCardStudied(UID, 'nope');
    expect(isOk(missing)).toBe(false);
    const other = await repo.markCardStudied('someone_else', 'sg2');
    expect(isOk(other)).toBe(false);
  });

  it('迁移 v7 落库', () => {
    const rows = repo
      .getRawDb()
      .query<{ version: number }, []>(
        'SELECT version AS version FROM schema_migrations ORDER BY version'
      )
      .all();
    expect(rows.map((r) => r.version)).toContain(7);
  });
});

describe('VOCAB_NEW 装配门（没讲透不进练习池）', () => {
  let repo: DrizzleLearnerRepository;
  beforeEach(async () => {
    repo = new DrizzleLearnerRepository(':memory:');
    await repo.updateLearnerProfile(UID, { targetLanguage: 'ja' });
  });

  async function startVocabNewRun() {
    const started = await repo.startPracticePlanRun(UID, {
      language: 'ja',
      blocks: [{ id: 'b1', kind: 'VOCAB_NEW', count: 5, gradingMode: 'AUTO_IMMEDIATE' }],
    });
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) throw new Error('run start failed');
    return started.value.id;
  }

  it('全没讲透：整块跳过并报 NEED_STUDY', async () => {
    seedCard(repo, { id: 'n1', front: 'w1', studied: false });
    seedCard(repo, { id: 'n2', front: 'w2', studied: false });
    seedCard(repo, { id: 'n3', front: 'w3', studied: false });
    const runId = await startVocabNewRun();
    const res = await assemblePracticeRun(repo, UID, runId);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.totalItems).toBe(0);
    expect(res.value.skippedBlocks).toEqual([{ blockId: 'b1', kind: 'VOCAB_NEW', reason: 'NEED_STUDY' }]);
  });

  it('只装讲透的：未讲透的不混入', async () => {
    seedCard(repo, { id: 's1', front: 'a1', studied: true });
    seedCard(repo, { id: 's2', front: 'a2', studied: true });
    seedCard(repo, { id: 's3', front: 'a3', studied: true });
    seedCard(repo, { id: 'u1', front: 'b1', studied: false });
    const runId = await startVocabNewRun();
    const res = await assemblePracticeRun(repo, UID, runId);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.totalItems).toBeGreaterThan(0);
    expect(res.value.skippedBlocks).toEqual([]);
    const items = await repo.getPracticeRunItems(UID, runId);
    if (!isOk(items)) return;
    const contents = items.value.map((it) =>
      'content' in it.question ? String(it.question.content) : ''
    );
    expect(contents.some((t) => t.includes('b1'))).toBe(false);
    expect(contents.some((t) => t.includes('a1'))).toBe(true);
  });
});
