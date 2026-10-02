import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import type { TextbookContentKind } from '@study-studio/document-model';
import { ToolRegistry } from '@study-studio/tool-core';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { pipelineModel, requiredContent } from './textbook-pipeline-fixtures.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });

// Controlled chapter content exercises the real HTTP/tool/SQLite path, not a textbook classification rule.
const cases: Array<{ kind: TextbookContentKind; title: string; content: unknown; table: string }> = [
  { kind: 'exercises', title: '复习', content: requiredContent.exercises, table: 'textbook_exercise_items' },
  { kind: 'grammar', title: '总结', content: requiredContent.grammar, table: 'textbook_knowledge' },
  { kind: 'vocabulary', title: '词汇', content: requiredContent.vocabulary, table: 'textbook_vocabulary' },
  { kind: 'articles', title: '阅读', content: { items: [{ text: '学校へ行きます。' }] }, table: 'textbook_articles' },
  { kind: 'sentences', title: '表达', content: { items: [{ text: 'こんにちは。' }] }, table: 'textbook_sentences' },
  { kind: 'material', title: '整理', content: { items: [{ text: '挨拶\nこんにちは。' }] }, table: 'textbook_materials' },
];

describe('按章节实际内容提交', () => {
  for (const example of cases) it(`${example.title}章只提交 ${example.kind}，HTTP 完成后整章保存`, async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const tools = new TextbookContentTools(repo), registry = new ToolRegistry();
    for (const tool of tools.tools) {
      registry.register(tool);
      expect(tool.description).not.toContain('本课必需');
    }
    const model = pipelineModel(tools, async ({ sessionId, turnId, input }) => {
      expect(input.message).toContain('视情况选择');
      expect(input.message).not.toContain('必须分别提交');
      expect(input.message).toContain(`章节: ${example.title}`);
      expect(input.message).toContain(`- ${example.title}\n  - 参考小标题`);
      expect(input.message).toContain('本章内容:\n当前章实际材料');
      const tool = tools.tools.find(item => item.kind === example.kind)!;
      const result = await registry.get(tool.name)!.execute(example.content,
        { userId: 'owner', sessionId, turnId, callId: 'only-content' });
      expect(result.ok).toBe(true);
      expect(repo.getRawDb().query(`SELECT count(*) AS n FROM ${example.table}`).get()).toEqual({ n: 0 });
    });
    // The HTTP routes consume these dependencies; unused server capabilities are never invoked.
    const deps = { repo, server: { toolRegistry: registry, agentAdapter: model.adapter } } as GatewayDeps;
    const response = await createPdfImportRoutes(deps).request('/api/documents/owner/execute-textbook-pipeline', {
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
    expect(model.inputs).toHaveLength(1);
    expect(model.closed).toHaveLength(1);
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
