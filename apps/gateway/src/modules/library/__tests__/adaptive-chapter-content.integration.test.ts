import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import type { TextbookContentKind } from '@study-studio/document-model';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { requiredContent } from './textbook-pipeline-fixtures.js';
import { harnessInjection, type ChapterScript } from './agentpool-pipeline-harness.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });

// Controlled chapter content exercises the real HTTP/MCP-tool/SQLite path, not a textbook classification rule.
const cases: Array<{ kind: TextbookContentKind; title: string; content: unknown; table: string }> = [
  { kind: 'exercises', title: '复习', content: requiredContent.exercises, table: 'textbook_exercise_items' },
  { kind: 'grammar', title: '总结', content: requiredContent.grammar, table: 'textbook_knowledge' },
  { kind: 'vocabulary', title: '词汇', content: requiredContent.vocabulary, table: 'textbook_vocabulary' },
  { kind: 'articles', title: '阅读', content: { items: [{ text: '学校へ行きます。' }] }, table: 'textbook_articles' },
  { kind: 'sentences', title: '表达', content: { items: [{ text: 'こんにちは。' }] }, table: 'textbook_sentences' },
  { kind: 'material', title: '整理', content: { items: [{ text: '挨拶\nこんにちは。' }] }, table: 'textbook_materials' },
];

let rpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: TextbookContentKind, raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `adaptive-${++rpcSeq}`);
  if (!result.ok) throw result.error;
}

describe('按章节实际内容提交', () => {
  it('字段修正后统一保存；暂存期库里 0 行', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const exercise = { type: 'ORDERING', prompt: '排列词块组成句子。',
      answer: ['私', 'の', '日本語', 'の', '本', 'です'], difficultyTier: 1, difficultyReason: '基础名词短语词序' };
    const harness = harnessInjection(repo, new Map<string, ChapterScript>([['a', async (scope) => {
      const emptyField = await scope.submission.execute('vocabulary', { items: [{ word: '本', meaning: '书', level: 'N5', partOfSpeech: '' }] }, 'rpc-empty');
      expect(emptyField.ok ? '' : emptyField.error.code).toBe('E_CONTENT_FORMAT_INVALID');
      const noOptions = await scope.submission.execute('exercises', { items: [exercise] }, 'rpc-noopt');
      expect(noOptions.ok ? '' : noOptions.error.code).toBe('E_CONTENT_FORMAT_INVALID');
      expect((await scope.submission.execute('vocabulary', { items: [{ word: '本', meaning: '书', level: 'N5' }] }, 'rpc-v')).ok).toBe(true);
      expect((await scope.submission.execute('exercises', { items: [{ ...exercise, options: ['本', 'の', '私', 'です', '日本語', 'の'] }] }, 'rpc-e')).ok).toBe(true);
      const view = await scope.submission.execute('exercises', { action: 'read' }, 'rpc-read');
      if (!view.ok) throw view.error;
      const { items } = z.object({ items: z.array(z.object({ ref: z.string() }).passthrough()) }).parse(view.value);
      expect((await scope.submission.execute('exercises', { action: 'update', items: [{ ...exercise, options: ['本', 'の', '私', 'です', '日本語', 'の'],
        ref: items[0]!.ref, explanation: '名词之间用「の」连接。' }] }, 'rpc-upd')).ok).toBe(true);
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_exercise_items').get()).toEqual({ n: 0 });
    }]]));
    const result = await repo.executeTextbookPipeline({ userId: 'owner', documentId: 'book', title: '工具说明修正',
      tocEntries: [{ id: 'a', title: '当前课程', level: 'lesson', startPage: 1 }],
      lessonJobs: [{ lessonId: 'a', text: '私の日本語の本です。' }], poolSize: 1, modelRetries: 0, ...harness.extra });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    const content = await repo.readTextbookChapter({ userId: 'owner', documentId: 'book', chapterId: 'a' });
    expect(content.ok && content.value.exercises).toHaveLength(1);
    expect(content.ok && content.value.exercises[0]?.answer).toEqual(exercise.answer);
    expect(content.ok && content.value.vocabulary[0]?.partOfSpeech).toBeUndefined();
    expect(harness.driver.asks).toHaveLength(1);
  });

  for (const example of cases) it(`${example.title}章只提交 ${example.kind}，HTTP 完成后整章保存`, async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const harness = harnessInjection(repo, new Map<string, ChapterScript>([['a', async (scope) => {
      const result = await scope.submission.execute(example.kind, example.content, `rpc-${example.kind}`);
      expect(result.ok).toBe(true);
      expect(repo.getRawDb().query(`SELECT count(*) AS n FROM ${example.table}`).get()).toEqual({ n: 0 });
    }]]));
    const deps = { repo, server: {} } as GatewayDeps;
    const response = await createPdfImportRoutes(deps, { poolDriver: harness.driver, onChapterScope: harness.extra.onChapterScope }).request('/api/documents/owner/execute-textbook-pipeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        documentId: 'book', title: '按实际内容测试', language: 'ja', poolSize: 1, modelRetries: 0,
        tocEntries: [
          { id: 'a', title: example.title, level: 'lesson', startPage: 1 },
          { id: 'child', title: '参考小标题', level: 'section', parentId: 'a', startPage: 1 },
        ], lessonJobs: [{ lessonId: 'a', text: '当前章实际材料' }],
      }),
    });
    expect(response.status).toBe(200);
    const body = z.object({ allLessonsReady: z.boolean() }).passthrough().parse(await response.json());
    expect(body.allLessonsReady).toBe(true);
    for (const other of cases)
      expect(repo.getRawDb().query(`SELECT count(*) AS n FROM ${other.table}`).get()).toEqual({ n: other.kind === example.kind ? 1 : 0 });
    expect(repo.getRawDb().query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: example.kind === 'vocabulary' ? 1 : 0 });
    const stats = await repo.getTextbookAssetStats('book');
    expect(stats.ok && stats.value.readyLessons).toBe(1);
    expect(harness.driver.asks).toHaveLength(1);
    expect(harness.driver.finishes).toHaveLength(1);
  });

  it('存储层删空唯一内容会回滚，不把空章节标为完成', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    await repo.seedTextbookTocSkeleton({ userId: 'owner', documentId: 'book', title: '空内容回滚',
      entries: [{ id: 'a', title: '阅读', level: 'lesson', startPage: 1 }] });
    const scope = { userId: 'owner', documentId: 'book', chapterId: 'a' };
    expect((await repo.commitTextbookLesson(scope, [{ kind: 'articles', action: 'add', id: 'article',
      input: { items: [{ text: '保存的文章' }] } }])).ok).toBe(true);
    const result = await repo.commitTextbookLesson(scope, [{ kind: 'articles', action: 'delete', id: 'article' }]);
    expect(result.ok ? '' : result.error.code).toBe('E_CONTENT_MISSING');
    expect(repo.getRawDb().query('SELECT text FROM textbook_articles').all()).toEqual([{ text: '保存的文章' }]);
    const stats = await repo.getTextbookAssetStats('book');
    expect(stats.ok && stats.value.readyLessons).toBe(1);
  });
});
