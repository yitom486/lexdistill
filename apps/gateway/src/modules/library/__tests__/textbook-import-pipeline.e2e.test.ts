import { afterEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { harnessInjection, type ChapterScript } from './agentpool-pipeline-harness.js';
import { TextbookMcpRegistry } from '../mcp/textbook-mcp-server.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
function setup() {
  const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
  return { repo, db: drizzle(repo.getRawDb(), { schema }) };
}
const word = { word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5', examples: [{ text: '学校へ行きます。', translation: '去学校。' }] };
const toc = [{ id: 'a', title: '第一课', level: 'lesson' as const, startPage: 1, endPage: 1 }, { id: 'b', title: '第二课', level: 'lesson' as const, startPage: 2, endPage: 2 }];

let rpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: 'grammar' | 'vocabulary' | 'exercises' | 'articles' | 'sentences' | 'material', raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `e2e-${++rpcSeq}`);
  if (!result.ok) throw result.error;
}

describe('教材简单内容工具 → 实际 SQLite → 查询回执', () => {
  it('五类内容和整理材料先暂存、整课一次保存；系统生成身份，全球词汇一次新增、重复复用且等级不覆盖', async () => {
    const env = setup();
    let turn = 0;
    const scripts = new Map<string, ChapterScript>([
      ['a', async (scope) => { turn++; await chapterContent(scope, turn); }],
      ['b', async (scope) => { turn++; await chapterContent(scope, turn); }],
    ]);
    async function chapterContent(scope: McpChapterScope, attemptTurn: number) {
      const vocab = await scope.submission.execute('vocabulary', { items: [{ ...word, level: attemptTurn === 1 ? 'N5' : 'N1', meaning: attemptTurn === 1 ? '学校' : '第二课语境' }] }, `e2e-v${attemptTurn}`);
      expect(vocab.ok).toBe(true);
      expect(env.db.select().from(schema.textbookVocabulary).all()).toHaveLength(attemptTurn - 1);
      expect((await scope.submission.execute('grammar', { items: [{ title: '助词へ', explanation: '表示方向', examples: [{ text: '学校へ行く。' }], aiExplanation: '目的地也可以用に。' }] }, `e2e-g${attemptTurn}`)).ok).toBe(true);
      expect((await scope.submission.execute('articles', { items: [{ title: '上学', text: '学校へ行きます。\n先生に会います。', translation: '去学校，见老师。' }] }, `e2e-a${attemptTurn}`)).ok).toBe(true);
      expect((await scope.submission.execute('sentences', { items: [{ text: '学校はどこですか。', translation: '学校在哪里？' }] }, `e2e-s${attemptTurn}`)).ok).toBe(true);
      expect((await scope.submission.execute('exercises', { items: [{ type: 'CHOICE', difficultyTier: 1, difficultyReason: '单一助词识别', prompt: '表示方向的助词？', options: ['へ', 'を'], answer: 'へ', explanation: 'へ表示方向。' }] }, `e2e-e${attemptTurn}`)).ok).toBe(true);
      expect((await scope.submission.execute('material', { items: [{ text: '本课整理材料' }] }, `e2e-m${attemptTurn}`)).ok).toBe(true);
      const material = await scope.submission.execute('material', { action: 'read' }, `e2e-mr${attemptTurn}`);
      expect(material.ok && material.value).toMatchObject({ kind: 'material', status: 'view', items: [{ text: '本课整理材料' }] });
    }
    const harness = harnessInjection(env.repo, scripts);
    const result = await env.repo.executeTextbookPipeline({ userId: 'owner', documentId: 'book', title: '教材', language: 'ja', tocEntries: toc, lessonJobs: [{ lessonId: 'a', text: '一' }, { lessonId: 'b', text: '二' }], poolSize: 1, modelRetries: 0, ...harness.extra });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(harness.driver.asks).toHaveLength(2);
    expect(harness.driver.asks[0]).toContain('write_vocabulary');
    expect(harness.driver.asks[0]).not.toContain('tocId');
    expect(harness.driver.asks[0]).not.toContain('sourceRefs');
    const globals = env.db.select().from(schema.globalVocabulary).all(); expect(globals).toHaveLength(1); expect(globals[0]).toMatchObject({ jlptLevel: 'N5', meaning: '学校', levelSource: 'MODEL_ESTIMATE' });
    const words = env.db.select().from(schema.textbookVocabulary).all(); expect(words).toHaveLength(2); expect(words[0]!.vocabularyId).toBe(words[1]!.vocabularyId);
    expect(env.db.select().from(schema.textbookKnowledge).all()).toHaveLength(2);
    expect(env.db.select().from(schema.textbookArticles).all()).toHaveLength(2);
    expect(env.db.select().from(schema.textbookSentences).all()).toHaveLength(2);
    expect(env.db.select().from(schema.textbookExerciseItems).all()).toHaveLength(2);
    const view = await env.repo.readTextbookChapter({ userId: 'owner', documentId: 'book', chapterId: 'a' });
    if (!view.ok) throw view.error;
    expect(view.value.grammar[0]!.aiExplanation).toBe('目的地也可以用に。');
    expect(view.value.vocabulary[0]!.examples).toEqual(word.examples);
    expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM flashcards WHERE user_id=?').get('owner')).toEqual({ n: 0 });
    expect(env.repo.getRawDb().query("SELECT name FROM sqlite_master WHERE name IN ('textbook_lessons','textbook_lines')").all()).toEqual([]);
  });
  it('三类内容齐备时无文章也能完成、不要求小目录齐全', async () => {
    const env = setup();
    const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([['intro', async (scope) => {
      expect((await scope.submission.execute('grammar', { items: [{ kind: 'PRONUNCIATION', title: '长音', explanation: '长音占两拍。' }] }, 'rpc-g')).ok).toBe(true);
      await submitScope(scope, 'vocabulary', requiredWord());
      await submitScope(scope, 'exercises', requiredExercise());
    }]]));
    function requiredWord() { return { items: [{ word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5' }] }; }
    function requiredExercise() { return { items: [{ type: 'CHOICE', prompt: '方向助词？', options: ['へ', 'を'], answer: 'へ', difficultyTier: 1, difficultyReason: '单一助词识别' }] }; }
    const result = await env.repo.executeTextbookPipeline({ userId: 'owner', documentId: 'book', title: '发音', tocEntries: [{ id: 'intro', title: '发音', level: 'section', startPage: 1 }, { id: 'child', parentId: 'intro', title: '小目录', level: 'section', startPage: 1 }], lessonJobs: [{ lessonId: 'intro', text: '长音' }], poolSize: 1, modelRetries: 0, ...harness.extra });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    const slots = await env.repo.listTextbookLessonSlots('book'); expect(slots.ok && slots.value.map(item => item.lessonId)).toEqual(['intro']);
    expect(harness.driver.asks[0]).toContain('  - 小目录');
  });
  it('多个内容批次追加顺序、完全相同的重试不重复写，跨用户和章节写入被拒绝', async () => {
    const env = setup(); await env.repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'book', title: '教材', language: 'ja', entries: toc });
    const scoped = new TextbookMcpRegistry({ repo: env.repo });
    const { taskToken } = scoped.createTask('owner', 'book', 1);
    const scope = scoped.setChapter(taskToken, 0, { userId: 'owner', documentId: 'book', lessonId: 'a', assignmentId: 'attempt', signal: new AbortController().signal, allowAiExercises: true });
    if (!scope) throw new Error('no scope');
    let n = 0;
    const tool = async (raw: unknown, kind: 'articles' = 'articles') => scope.submission.execute(kind, raw, `e2e-batch-${++n}`);
    expect((await tool({ items: [{ text: '第一段' }] })).ok).toBe(true);
    expect((await tool({ items: [{ text: '第二段' }] })).ok).toBe(true);
    expect((await tool({ items: [{ text: '第一段' }] })).ok).toBe(true);
    expect(env.db.select().from(schema.textbookArticles).all()).toHaveLength(0);
    const foreign = scoped.setChapter(taskToken, 0, { userId: 'other', documentId: 'book', lessonId: 'a', assignmentId: 'attempt', signal: new AbortController().signal, allowAiExercises: true });
    expect(foreign).toBeUndefined();
    scoped.revokeTask(taskToken);
    expect((await tool({ items: [{ text: '迟到' }] })).ok).toBe(false);
  });
  it('一批词汇有非法等级时整批撤回；已有全局词与其他用户的同词互不覆盖', async () => {
    const env = setup(); for (const userId of ['owner', 'other']) await env.repo.seedTextbookTocSkeleton({ userId, documentId: userId, title: '词汇', language: 'ja', entries: [toc[0]!] });
    const scope = { userId: 'owner', documentId: 'owner', chapterId: 'a' };
    expect((await env.repo.writeTextbookContent(scope, 'vocabulary', { items: [word, { ...word, word: '未知', level: 'N0' }] })).ok).toBe(false); expect(env.db.select().from(schema.globalVocabulary).all()).toHaveLength(0);
    expect((await env.repo.writeTextbookContent(scope, 'vocabulary', { items: [word] })).ok).toBe(true);
    expect((await env.repo.writeTextbookContent({ userId: 'other', documentId: 'other', chapterId: 'a' }, 'vocabulary', { items: [{ ...word, level: 'N2' }] })).ok).toBe(true);
    expect(env.db.select().from(schema.globalVocabulary).all().map(row => row.jlptLevel)).toEqual(['N5', 'N2']);
    expect((await env.repo.writeTextbookContent({ ...scope, chapterId: 'foreign' }, 'vocabulary', { items: [word] })).ok).toBe(false);
  });
});
