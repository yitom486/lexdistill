import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import type { TextbookContentKind } from '@study-studio/document-model';
import { ToolRegistry } from '@study-studio/tool-core';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { pipelineModel, requiredContent } from './textbook-pipeline-fixtures.js';
import { toolsToDynamicSpecs } from '../../../../../../packages/agent-runtime/src/adapters/codex/tools-bridge.js';

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
  it('原生工具说明提示排序选项、可选字段省略和重试引用；实际错误修正后统一保存', async () => {
    const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
    const tools = new TextbookContentTools(repo);
    const exercise = { type: 'ORDERING', prompt: '排列词块组成句子。',
      answer: ['私', 'の', '日本語', 'の', '本', 'です'], difficultyTier: 1, difficultyReason: '基础名词短语词序' };
    const model = pipelineModel(tools, async ({ submit }) => {
      const emptyField = await submit({ items: [{ word: '本', meaning: '书', level: 'N5', partOfSpeech: '' }] }, 'vocabulary');
      expect(emptyField.ok ? '' : emptyField.error.code).toBe('E_CONTENT_FORMAT_INVALID');
      const noOptions = await submit({ items: [exercise] }, 'exercises');
      expect(noOptions.ok ? '' : noOptions.error.code).toBe('E_CONTENT_FORMAT_INVALID');
      expect((await submit({ items: [{ word: '本', meaning: '书', level: 'N5' }] }, 'vocabulary')).ok).toBe(true);
      expect((await submit({ items: [{ ...exercise, options: ['本', 'の', '私', 'です', '日本語', 'の'] }] }, 'exercises')).ok).toBe(true);
      const view = await submit({ action: 'read' }, 'exercises');
      if (!view.ok) throw view.error;
      const { items } = z.object({ items: z.array(z.object({ ref: z.string() }).passthrough()) }).parse(view.value);
      expect((await submit({ action: 'update', items: [{ ...exercise, options: ['本', 'の', '私', 'です', '日本語', 'の'],
        ref: items[0]!.ref, explanation: '名词之间用「の」连接。' }] }, 'exercises')).ok).toBe(true);
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_exercise_items').get()).toEqual({ n: 0 });
    });
    const create = model.adapter.createSession;
    model.adapter.createSession = async options => {
      const { specs } = toolsToDynamicSpecs(options.tools ?? []);
      expect(specs).toHaveLength(6);
      const exerciseSpec = specs.find(spec => spec.name === 'library_exercises')!;
      expect(exerciseSpec.description).toContain('选择题和排序题均需 options');
      expect(exerciseSpec.description).toContain('重复词块的次数与 options 一致');
      for (const spec of specs) {
        expect(spec.description).toContain('可选字段没有值就省略');
        expect(spec.description).toContain('已有相同内容先 read 后 update');
        expect(spec.description).toContain('重试后先 read 获取新 ref');
      }
      return create(options);
    };
    const result = await repo.executeTextbookPipeline({ userId: 'owner', documentId: 'book', title: '工具说明修正',
      tocEntries: [{ id: 'a', title: '当前课程', level: 'lesson', startPage: 1 }],
      lessonJobs: [{ lessonId: 'a', text: '私の日本語の本です。' }], adapter: model.adapter, submissionTool: tools,
      poolSize: 1, modelRetries: 0 });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    const content = await repo.readTextbookChapter({ userId: 'owner', documentId: 'book', chapterId: 'a' });
    expect(content.ok && content.value.exercises).toHaveLength(1);
    expect(content.ok && content.value.exercises[0]?.answer).toEqual(exercise.answer);
    expect(content.ok && content.value.vocabulary[0]?.partOfSpeech).toBeUndefined();
    expect(model.inputs).toHaveLength(1);
  });

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
