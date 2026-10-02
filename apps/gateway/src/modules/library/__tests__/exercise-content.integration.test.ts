import { afterEach, expect, it } from 'bun:test';
import { TextbookASTSchema } from '@study-studio/document-model';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';

let repo: DrizzleLearnerRepository;
afterEach(() => repo?.getRawDb().close());
it('native exercise tool persists all eight shapes, actual difficulty and optional writing reference; rejects invalid batches atomically', async () => {
  repo = new DrizzleLearnerRepository(':memory:');
  await repo.seedTextbookTocSkeleton({ userId: 'u', documentId: 'b', title: 'Book', language: 'ja', entries: [{ id: 'c', title: 'Chapter', level: 'lesson', startPage: 1 }] });
  const tools = new TextbookContentTools(repo);
  tools.bind('s', { userId: 'u', documentId: 'b', lessonId: 'c', assignmentId: 'a', signal: new AbortController().signal, allowAiExercises: true });
  tools.startTurn('s', 'a', 't');
  const tool = tools.tools.find(tool => tool.kind === 'exercises')!;
  const context = { userId: 'u', sessionId: 's', turnId: 't' };
  const items = [
    { type: 'CHOICE', prompt: 'Choose', options: ['a', 'b'], answer: 'a' },
    { type: 'MULTI_CHOICE', prompt: 'Select', options: ['a', 'b', 'c'], answer: ['a', 'c'] },
    { type: 'FILL_BLANK', prompt: 'Two blanks', answer: ['の', 'は'] },
    { type: 'ORDERING', prompt: 'Repeated words', options: ['a', 'b', 'a'], answer: ['a', 'a', 'b'] },
    { type: 'MATCHING', prompt: 'Reuse right', left: ['a', 'b'], right: ['x'], answer: [{ left: 'a', right: 'x' }, { left: 'b', right: 'x' }] },
    { type: 'TRANSLATION', prompt: 'Translate', answer: '参考表达', gradingNotes: 'Evaluate equivalent expressions' },
    { type: 'SHORT_ANSWER', prompt: 'Explain', gradingNotes: 'Explain the distinction' },
    { type: 'WRITING', prompt: 'Introduce yourself', gradingNotes: 'Identity, interests and coherence' },
  ].map((item, index) => ({ ...item, difficultyTier: index % 5 + 1, difficultyReason: `Controlled estimate for ${item.type}` }));
  const saved = await tool.execute({ items, source: 'AI' }, context);
  expect(saved.ok && saved.value).toEqual({ kind: 'exercises', saved: 8, vocabularyAdded: 0 });
  expect((await tool.execute({ items, source: 'AI' }, context)).ok).toBe(true);
  const rows = repo.getRawDb().query<{ type: string; answer_json: string | null; difficulty_tier: number }, []>('SELECT type,answer_json,difficulty_tier FROM textbook_exercise_items ORDER BY ord').all();
  expect(rows).toHaveLength(8);
  expect(rows[2]!.answer_json).toBe('["の","は"]');
  expect(rows[3]!.answer_json).toBe('["a","a","b"]');
  expect(rows[7]!.answer_json).toBeNull();
  const doc = await repo.getDocumentById('b'); if (!doc.ok) throw doc.error;
  const read = TextbookASTSchema.parse(JSON.parse(doc.value!.astJson!)).lessons[0]!.learningContent!.exercises;
  expect(read[7]).toMatchObject({ type: 'WRITING', difficultyTier: 3, gradingNotes: 'Identity, interests and coherence' });
  expect(read[7]!.answer).toBeUndefined();
  for (const invalid of [
    { ...items[0], difficultyTier: 0 }, { ...items[0], difficultyTier: 2.5 },
    { ...items[0], difficultyReason: '' }, { ...items[0], difficultyTier: undefined },
    { ...items[3], answer: ['a', 'b', 'b'] }, { ...items[2], answer: undefined },
    { ...items[7], gradingNotes: undefined }, { ...items[7], id: 'model-id' },
  ]) {
    expect((await tool.execute({ items: [{ ...items[0], prompt: 'Must roll back' }, invalid] }, context)).ok).toBe(false);
    expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_exercise_items').get()).toEqual({ n: 8 });
  }
  expect((await tool.execute({ items }, { ...context, userId: 'other' })).ok).toBe(false);
  tools.end('s');
});
