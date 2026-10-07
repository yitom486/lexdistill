import { afterEach, describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import {
  VocabularyLearningContextTool,
  VocabularyLearningSubmitTool,
} from '../tools/vocabulary-learning-tools.js';
import { clearLearningTasksForTest } from '../application/learning-tasks.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); clearLearningTasksForTest(); });
const CTX = { userId: 'owner', sessionId: 'session-1' };
const CONTENT = {
  explanation: '学校是上学的地方。',
  scenarios: [{ title: '问路', dialogue: [{ speaker: 'A', text: '学校はどこですか。', translation: '学校在哪里？' }], note: '问路时用。' }],
  pitfalls: ['学校≠学院'],
  quiz: { prompt: '用学校造一个问路的句子', answer: '学校はどこですか。' },
  source: 'AI' as const,
};

async function seed() {
  const repo = new DrizzleLearnerRepository(':memory:');
  repos.push(repo);
  const scope = { userId: 'owner', documentId: 'book', chapterId: 'a' };
  const toc = await repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'book', title: '词汇书', language: 'ja', sourceFingerprint: 'fp',
    entries: [{ id: 'a', title: '第一课', level: 'lesson', startPage: 1 }] });
  if (!toc.ok) throw toc.error;
  const written = await repo.writeTextbookContent(scope, 'vocabulary', { items: [
    { word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5', usage: '学校へ行く', examples: [{ text: '学校へ行きます。', translation: '去学校。' }] },
    { word: '猫', reading: 'ねこ', meaning: '猫', level: 'N5' },
  ] });
  if (!written.ok) throw written.error;
  return { repo, scope };
}

function tools(repo: DrizzleLearnerRepository) {
  return {
    context: new VocabularyLearningContextTool(repo),
    submit: new VocabularyLearningSubmitTool(repo),
  };
}

async function wordId(repo: DrizzleLearnerRepository, word: string): Promise<string> {
  const listed = await repo.listVocabulary('owner', 'ja');
  if (!listed.ok) throw listed.error;
  const entry = listed.value.find(item => item.word === word);
  if (!entry) throw new Error(`missing word ${word}`);
  return entry.id;
}

describe('vocabulary.learning context/submit', () => {
  it('context 建任务 → submit 保存 → 读回可见；任务一次一用，覆盖靠新任务', async () => {
    const { repo } = await seed();
    const { context, submit } = tools(repo);
    const id = await wordId(repo, '学校');
    const ctx = await context.execute({ vocabularyId: id, language: 'ja' }, CTX);
    if (!ctx.ok) throw ctx.error;
    expect(ctx.value.task.taskId.startsWith('vl-')).toBe(true);
    expect(ctx.value.task.target).toEqual({ kind: 'global', vocabularyId: id });
    const first = await submit.execute({ taskId: ctx.value.task.taskId, content: CONTENT }, CTX);
    if (!first.ok) throw first.error;
    expect(first.value.version).toBe(1);
    expect(first.value.vocabularyId).toBe(id);
    const reuse = await submit.execute({ taskId: ctx.value.task.taskId, content: { ...CONTENT, explanation: '第二版讲解。' } }, CTX);
    expect(reuse.ok ? '' : reuse.error.code).toBe('E_TASK_INVALID');
    const ctx2 = await context.execute({ vocabularyId: id, language: 'ja' }, CTX);
    if (!ctx2.ok) throw ctx2.error;
    const second = await submit.execute({ taskId: ctx2.value.task.taskId, content: { ...CONTENT, explanation: '第二版讲解。' } }, CTX);
    if (!second.ok) throw second.error;
    expect(second.value.version).toBe(2);
    const db = repo.getRawDb();
    expect(db.query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 2 });
    expect(db.query('SELECT learning_version FROM global_vocabulary WHERE word=?').get('学校')).toEqual({ learning_version: 2 });
    const listed = await repo.listVocabulary('owner', 'ja');
    if (!listed.ok) throw listed.error;
    expect(listed.value.find(item => item.word === '学校')?.learning?.explanation).toBe('第二版讲解。');
  });

  it('无任务/过期任务/跨用户提交一律拒绝；任务只写绑定的行', async () => {
    const { repo } = await seed();
    const { context, submit } = tools(repo);
    const schoolId = await wordId(repo, '学校');
    const catId = await wordId(repo, '猫');
    const badTask = await submit.execute({ taskId: 'vl-nope', content: CONTENT }, CTX);
    expect(badTask.ok ? '' : badTask.error.code).toBe('E_TASK_INVALID');
    clearLearningTasksForTest();
    const ctx = await context.execute({ vocabularyId: schoolId, language: 'ja' }, CTX);
    if (!ctx.ok) throw ctx.error;
    clearLearningTasksForTest();
    const expired = await submit.execute({ taskId: ctx.value.task.taskId, content: CONTENT }, CTX);
    expect(expired.ok ? '' : expired.error.code).toBe('E_TASK_INVALID');
    const ctx2 = await context.execute({ vocabularyId: schoolId, language: 'ja' }, CTX);
    if (!ctx2.ok) throw ctx2.error;
    const foreign = await submit.execute({ taskId: ctx2.value.task.taskId, content: CONTENT }, { userId: 'intruder', sessionId: 'session-1' });
    expect(foreign.ok ? '' : foreign.error.code).toBe('E_TASK_MISMATCH');
    const okSubmit = await submit.execute({ taskId: ctx2.value.task.taskId, content: CONTENT }, CTX);
    expect(okSubmit.ok).toBe(true);
    const db = repo.getRawDb();
    expect(db.query('SELECT learning_version FROM global_vocabulary WHERE id=?').get(catId)).toEqual({ learning_version: 0 });
    expect(db.query('SELECT learning_version FROM global_vocabulary WHERE id=?').get(schoolId)).toEqual({ learning_version: 1 });
  });

  it('教材行目标只写本课行，全局行不动；保存不碰卡片与 FSRS', async () => {
    const { repo } = await seed();
    const { context, submit } = tools(repo);
    const schoolId = await wordId(repo, '学校');
    const row = repo.getRawDb().query('SELECT id FROM textbook_vocabulary WHERE vocabulary_id=?').get(schoolId) as { id: string };
    const ctx = await context.execute({ vocabularyId: schoolId, language: 'ja', textbookVocabularyId: row.id }, CTX);
    if (!ctx.ok) throw ctx.error;
    expect(ctx.value.task.target).toEqual({ kind: 'textbook', textbookVocabularyId: row.id });
    const badAnchor = await context.execute({ vocabularyId: schoolId, language: 'ja', textbookVocabularyId: 'row-nope' }, CTX);
    expect(badAnchor.ok ? '' : badAnchor.error.code).toBe('E_TASK_TARGET_INVALID');
    const collected = await repo.collectGlobalVocabulary('owner', schoolId, {});
    if (!collected.ok) throw collected.error;
    const before = repo.getRawDb().query('SELECT fsrs FROM flashcards').get() as { fsrs: string };
    const saved = await submit.execute({ taskId: ctx.value.task.taskId, content: CONTENT }, CTX);
    if (!saved.ok) throw saved.error;
    expect(saved.value.version).toBe(1);
    const db = repo.getRawDb();
    expect(db.query('SELECT learning_version FROM textbook_vocabulary WHERE id=?').get(row.id)).toEqual({ learning_version: 1 });
    expect(db.query('SELECT learning_version FROM global_vocabulary WHERE id=?').get(schoolId)).toEqual({ learning_version: 0 });
    expect(db.query('SELECT fsrs FROM flashcards').get()).toEqual(before);
  });
});
