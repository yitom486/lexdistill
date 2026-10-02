import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { pipelineModel, requiredContent, submitRequired, type ModelTurn } from './textbook-pipeline-fixtures.js';
import type { TextbookContentKind } from '@study-studio/document-model';
import type { BusinessError, Result } from '@study-studio/shared';
import { ToolRegistry } from '@study-studio/tool-core';
import { toolsToDynamicSpecs } from '../../../../../../packages/agent-runtime/src/adapters/codex/tools-bridge.js';
import { createPdfImportRoutes } from '../http/pdf-import-routes.js';
import type { GatewayDeps } from '../../../composition/gateway-deps.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
const toc = [{ id: 'a', title: '第一课', level: 'lesson' as const, startPage: 1 }];
function setup() {
  const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
  return { repo, tool: new TextbookContentTools(repo) };
}
function input(env: ReturnType<typeof setup>) {
  return { userId: 'owner', documentId: 'book', title: '事务验证', tocEntries: toc,
    lessonJobs: [{ lessonId: 'a', text: '本课材料' }], submissionTool: env.tool, poolSize: 1, modelRetries: 0 };
}
function items(result: Result<unknown, BusinessError>) {
  if (!result.ok) throw result.error;
  return z.object({ items: z.array(z.object({ ref: z.string() }).passthrough()) }).parse(result.value).items;
}
async function bind(env: ReturnType<typeof setup>, sessionId: string, lessonId = 'a') {
  const binding = env.tool.bind(sessionId, { userId: 'owner', documentId: 'book', lessonId, assignmentId: sessionId,
    signal: new AbortController().signal, allowAiExercises: true });
  env.tool.startTurn(sessionId, sessionId, 'turn:' + sessionId);
  let call = 0;
  const submit: ModelTurn['submit'] = (raw, kind = 'articles') => env.tool.tools.find(tool => tool.kind === kind)!.execute(raw,
    { userId: 'owner', sessionId, turnId: 'turn:' + sessionId, callId: `${sessionId}:${++call}` });
  return { binding, submit };
}

describe('原生课程 CRUD 暂存与整课事务', () => {
  it('HTTP 默认入口从真实注册表找到六个工具；Codex 原生注入保留 CRUD 与嵌套内容字段', async () => {
    const env = setup(), registry = new ToolRegistry();
    for (const tool of env.tool.tools) registry.register(tool);
    const model = pipelineModel(env.tool, async ({ sessionId, turnId }) => {
      let call = 0;
      const submit: ModelTurn['submit'] = (raw, kind = 'articles') => registry.get(env.tool.tools.find(tool => tool.kind === kind)!.name)!.execute(raw,
        { userId: 'owner', sessionId, turnId, callId: `native:${++call}` });
      await submitRequired(submit);
      expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 0 });
    });
    const create = model.adapter.createSession;
    model.adapter.createSession = async options => {
      const { specs } = toolsToDynamicSpecs(options.tools ?? []);
      expect(specs).toHaveLength(6);
      for (const spec of specs) {
        const schema = z.object({ type: z.literal('object'), properties: z.record(z.unknown()) }).parse(spec.inputSchema);
        expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['action', 'items', 'refs']));
        expect(schema.properties).not.toHaveProperty('id'); expect(schema.properties).not.toHaveProperty('chapterId');
        expect(schema.properties).not.toHaveProperty('coverage');
        const action = z.object({ enum: z.array(z.string()) }).parse(schema.properties['action']);
        expect(action.enum).toEqual(['add', 'read', 'update', 'delete']);
        const content = z.object({ items: z.object({ type: z.literal('object'), properties: z.record(z.unknown()) }) }).parse(schema.properties['items']);
        expect(content.items.properties).toHaveProperty('ref');
        if (spec.name === 'library_exercises') {
          expect(content.items.properties).toHaveProperty('prompt');
          expect(content.items.properties['difficultyTier']).toMatchObject({ minimum: 1, maximum: 5 });
          expect(content.items.properties['type']).toMatchObject({ enum: expect.arrayContaining(['WRITING', 'MATCHING', 'FILL_BLANK']) });
        }
      }
      return create(options);
    };
    // This route uses only these Gateway dependencies, provided by the real repository/registry.
    const deps = { repo: env.repo, server: { toolRegistry: registry, agentAdapter: model.adapter } } as GatewayDeps;
    const response = await createPdfImportRoutes(deps).request('/api/documents/owner/execute-textbook-pipeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        documentId: 'book', title: '原生入口', language: 'ja', tocEntries: toc, lessonJobs: [{ lessonId: 'a', text: '本课材料' }], poolSize: 1, modelRetries: 0,
      }),
    });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ allLessonsReady: true, successfulLessons: 1 });
    expect(model.inputs).toHaveLength(1); expect(registry.get('library.write_vocabulary')).toBeUndefined();
    expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 1 });
  });

  it('六类多次增查改删只保存最终视图；被删除的新词不进入全局表', async () => {
    const env = setup();
    const model = pipelineModel(env.tool, async ({ submit }) => {
      await submitRequired(submit);
      for (const [kind, value] of Object.entries({
        articles: { text: '第一版正文' }, sentences: { text: '第一版句子' }, material: { text: '第一版材料' },
      }) as Array<[TextbookContentKind, { text: string }]>) {
        const added = items(await submit({ items: [value] }, kind))[0]!;
        expect(added).not.toHaveProperty('id'); expect(added).not.toHaveProperty('documentId');
        expect((await submit({ action: 'update', items: [{ ref: added.ref, text: '最终' + kind }] }, kind)).ok).toBe(true);
        expect(items(await submit({ action: 'read' }, kind))[0]).toMatchObject({ ref: added.ref, text: '最终' + kind });
      }
      const abandoned = items(await submit({ items: [{ word: '废弃词', meaning: '不保存', level: 'N5' }] }, 'vocabulary'))[0]!;
      expect((await submit({ action: 'delete', refs: [abandoned.ref] }, 'vocabulary')).ok).toBe(true);
      const abandonedArticle = items(await submit({ items: [{ text: '废弃正文' }] }, 'articles'))[0]!;
      expect((await submit({ action: 'delete', refs: [abandonedArticle.ref] }, 'articles')).ok).toBe(true);
      expect(items(await submit({ action: 'read' }, 'articles'))).toHaveLength(1);
      for (const table of ['textbook_articles', 'textbook_knowledge', 'textbook_vocabulary', 'textbook_exercise_items', 'global_vocabulary', 'textbook_fts'])
        expect(env.repo.getRawDb().query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    });
    const result = await env.repo.executeTextbookPipeline({ ...input(env), adapter: model.adapter });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    const saved = await env.repo.readTextbookChapter({ userId: 'owner', documentId: 'book', chapterId: 'a' });
    if (!saved.ok) throw saved.error;
    expect(saved.value.articles.map(item => item.text)).toEqual(['最终articles']);
    expect(saved.value.sentences.map(item => item.text)).toEqual(['最终sentences']);
    expect(saved.value.material).toBe('最终material');
    expect(env.repo.getRawDb().query('SELECT word FROM global_vocabulary').all()).toEqual([{ word: '学校' }]);
    expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM textbook_fts').get()).toEqual({ n: 3 });
  });

  it('已有内容使用短引用修改并保留身份；删除章节词汇不会删全局词和其他课关联', async () => {
    const env = setup(), model = pipelineModel(env.tool);
    const entries = [...toc, { ...toc[0]!, id: 'b', title: '第二课', startPage: 2 }];
    const result = await env.repo.executeTextbookPipeline({ ...input(env), tocEntries: entries,
      lessonJobs: [{ lessonId: 'a', text: '甲' }, { lessonId: 'b', text: '乙' }], adapter: model.adapter });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    const db = env.repo.getRawDb();
    const before = db.query('SELECT id, ord FROM textbook_knowledge WHERE chapter_id=?').get('a');
    const globals = db.query('SELECT * FROM global_vocabulary').all();
    const { binding, submit } = await bind(env, 'editing');
    const knowledge = items(await submit({ action: 'read' }, 'grammar'))[0]!;
    expect(knowledge).not.toHaveProperty('id');
    expect((await submit({ action: 'update', items: [{ ...requiredContent.grammar.items[0]!, ref: knowledge.ref, explanation: '修正后的讲解' }] }, 'grammar')).ok).toBe(true);
    const word = items(await submit({ action: 'read' }, 'vocabulary'))[0]!;
    expect(word).not.toHaveProperty('vocabularyId');
    expect((await submit({ action: 'delete', refs: [word.ref] }, 'vocabulary')).ok).toBe(true);
    expect((await submit({ items: [{ word: '駅', meaning: '车站', level: 'N5' }] }, 'vocabulary')).ok).toBe(true);
    const exercise = items(await submit({ action: 'read' }, 'exercises'))[0]!;
    expect((await submit({ action: 'update', items: [{ ...requiredContent.exercises.items[0]!, ref: exercise.ref, difficultyTier: 2 }] }, 'exercises')).ok).toBe(true);
    expect(db.query('SELECT id, ord FROM textbook_knowledge WHERE chapter_id=?').get('a')).toEqual(before);
    expect((await binding.persist()).ok).toBe(true);
    expect(db.query('SELECT id, ord FROM textbook_knowledge WHERE chapter_id=?').get('a')).toEqual(before);
    expect(db.query('SELECT * FROM global_vocabulary WHERE word=?').all('学校')).toEqual(globals);
    expect(db.query('SELECT chapter_id FROM textbook_vocabulary ORDER BY chapter_id').all()).toEqual([{ chapter_id: 'a' }, { chapter_id: 'b' }]);
    expect((await binding.persist()).ok).toBe(true);
    expect(db.query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 2 });
  });

  it('事务中途真实 SQLite 故障回滚内容、全局词、索引与 ready；相同候选重试不重新调用模型', async () => {
    const env = setup(), db = env.repo.getRawDb(); let commits = 0;
    const commit = env.repo.commitTextbookLesson.bind(env.repo);
    env.repo.commitTextbookLesson = async (...args) => {
      commits++;
      const result = await commit(...args);
      if (commits === 1) {
        expect(result.ok).toBe(false);
        for (const table of ['textbook_knowledge', 'textbook_vocabulary', 'global_vocabulary', 'textbook_fts'])
          expect(db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
        const stats = await env.repo.getTextbookAssetStats('book'); expect(stats.ok && stats.value.readyLessons).toBe(0);
        // Fault injection uses DDL only; the production commit still runs a real SQLite transaction.
        db.run('DROP TRIGGER reject_ready');
      }
      return result;
    };
    const model = pipelineModel(env.tool, async ({ submit }) => {
      // Fail at the final ready update, after content/global words/FTS have already been written.
      db.run("CREATE TRIGGER reject_ready BEFORE UPDATE OF chapters_json ON documents BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY controlled fault'); END");
      await submitRequired(submit);
    });
    const result = await env.repo.executeTextbookPipeline({ ...input(env), adapter: model.adapter, storageRetries: 1 });
    expect(result.ok && result.value.allLessonsReady).toBe(true); expect(commits).toBe(2); expect(model.inputs).toHaveLength(1);
    expect(db.query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 1 });
    expect(db.query('SELECT count(*) AS n FROM textbook_knowledge').get()).toEqual({ n: 1 });
    expect(db.query('SELECT count(*) AS n FROM textbook_fts').get()).toEqual({ n: 1 });
  });

  it('删空暂存内容时不写库、不当数据库失败重试；模型新轮次获得反馈且不继承失败缓冲', async () => {
    const env = setup(); let commits = 0, attempts = 0, firstRef = '';
    const commit = env.repo.commitTextbookLesson.bind(env.repo);
    env.repo.commitTextbookLesson = (...args) => { commits++; return commit(...args); };
    const model = pipelineModel(env.tool, async ({ submit, input: turn }) => {
      if (++attempts === 1) {
        firstRef = items(await submit({ items: [{ text: '失败轮次正文' }] }))[0]!.ref;
        expect((await submit({ action: 'delete', refs: [firstRef] })).ok).toBe(true);
      } else {
        expect(turn.message).toContain('本章尚未提交有效学习内容');
        expect(items(await submit({ action: 'read' }))).toEqual([]);
        const foreign = await submit({ action: 'delete', refs: [firstRef] });
        expect(foreign.ok ? '' : foreign.error.code).toBe('E_CONTENT_REF_INVALID');
        const own = items(await submit({ items: [{ text: '本轮删除以修正反馈' }] }))[0]!;
        expect((await submit({ action: 'delete', refs: [own.ref] })).ok).toBe(true);
        expect((await submit(requiredContent.grammar, 'grammar')).ok).toBe(true);
      }
    });
    const result = await env.repo.executeTextbookPipeline({ ...input(env), adapter: model.adapter, modelRetries: 1, storageRetries: 3 });
    expect(result.ok && result.value.allLessonsReady).toBe(true); expect(commits).toBe(1); expect(model.inputs).toHaveLength(2);
    expect(env.repo.getRawDb().query('SELECT * FROM textbook_articles').all()).toEqual([]);
    expect(model.created).toHaveLength(1);
  });

  it('无正常 COMPLETED 事件的模型流不能提交，即使已经提交三类有效暂存内容', async () => {
    const env = setup(), model = pipelineModel(env.tool, async ({ submit }) => { await submitRequired(submit); });
    const create = model.adapter.createSession;
    model.adapter.createSession = async options => {
      const session = await create(options); if (!session.ok) return session;
      const send = session.value.send.bind(session.value);
      session.value.send = async function* (turn) { for await (const event of send(turn)) if (event.type !== 'COMPLETED') yield event; };
      return session;
    };
    const result = await env.repo.executeTextbookPipeline({ ...input(env), adapter: model.adapter });
    expect(result.ok && result.value.failedLessons).toBe(1);
    expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 0 });
    const stats = await env.repo.getTextbookAssetStats('book'); expect(stats.ok && stats.value.readyLessons).toBe(0);
  });

  it('同一原生调用幂等且不接受冲突内容；只查询不能算本轮提交，关闭 AI 练习不能绕过', async () => {
    const env = setup();
    await env.repo.seedTextbookTocSkeleton({ ...input(env), entries: toc });
    const binding = env.tool.bind('idempotent', { userId: 'owner', documentId: 'book', lessonId: 'a', assignmentId: 'attempt',
      signal: new AbortController().signal, allowAiExercises: true });
    env.tool.startTurn('idempotent', 'attempt', 'turn');
    const context = { userId: 'owner', sessionId: 'idempotent', turnId: 'turn', callId: 'same-call' };
    const article = env.tool.tools.find(tool => tool.kind === 'articles')!;
    const first = await article.execute({ items: [{ text: '一次内容' }] }, context);
    expect(await article.execute({ items: [{ text: '一次内容' }] }, context)).toEqual(first);
    const conflicting = await article.execute({ items: [{ text: '不能覆盖第一次' }] }, context);
    expect(conflicting.ok ? '' : conflicting.error.code).toBe('E_CONTENT_CALL_CONFLICT');
    const submit: ModelTurn['submit'] = (raw, kind = 'articles') => env.tool.tools.find(tool => tool.kind === kind)!.execute(raw,
      { ...context, callId: 'call:' + kind });
    await submitRequired(submit); expect((await binding.persist()).ok).toBe(true); env.tool.end('idempotent');
    expect(env.repo.getRawDb().query('SELECT text FROM textbook_articles').all()).toEqual([{ text: '一次内容' }]);
    const readOnly = await bind(env, 'read-only');
    for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) expect(items(await readOnly.submit({ action: 'read' }, kind))).toHaveLength(1);
    const final = await readOnly.binding.persist(); expect(final.ok ? '' : final.error.code).toBe('E_LESSON_CONTENT_MISSING');

    const disabled = setup(), model = pipelineModel(disabled.tool, async ({ submit }) => {
      await submit(requiredContent.grammar, 'grammar'); await submit(requiredContent.vocabulary, 'vocabulary');
      const rejected = await submit({ ...requiredContent.exercises, source: 'AI' }, 'exercises');
      expect(rejected.ok ? '' : rejected.error.code).toBe('E_AI_EXERCISES_DISABLED');
    });
    const result = await disabled.repo.executeTextbookPipeline({ ...input(disabled), adapter: model.adapter, allowAiExercises: false });
    expect(result.ok && result.value.failedLessons).toBe(1);
    expect(disabled.repo.getRawDb().query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 0 });
  });

  it('重新提取失败保留原版本；成功后整课替换，不遗留旧正文', async () => {
    const env = setup(), original = pipelineModel(env.tool);
    expect((await env.repo.executeTextbookPipeline({ ...input(env), adapter: original.adapter })).ok).toBe(true);
    const db = env.repo.getRawDb(), snapshot = db.query('SELECT * FROM textbook_articles').all();
    const failed = pipelineModel(env.tool, async ({ submit }) => {
      const row = items(await submit({ items: [{ text: '未完成的替换' }] }))[0]!;
      expect((await submit({ action: 'delete', refs: [row.ref] })).ok).toBe(true);
    });
    const result = await env.repo.executeTextbookPipeline({ ...input(env), adapter: failed.adapter, forceOverwrite: true });
    expect(result.ok && result.value.allLessonsReady).toBe(false);
    expect(db.query('SELECT * FROM textbook_articles').all()).toEqual(snapshot);
    const stats = await env.repo.getTextbookAssetStats('book'); expect(stats.ok && stats.value.readyLessons).toBe(1);
    const success = pipelineModel(env.tool, async ({ submit }) => {
      expect(items(await submit({ action: 'read' }))).toEqual([]);
      expect((await submit({ items: [{ text: '新版本正文' }] })).ok).toBe(true);
      expect(db.query('SELECT * FROM textbook_articles').all()).toEqual(snapshot);
    });
    const replaced = await env.repo.executeTextbookPipeline({ ...input(env), adapter: success.adapter, forceOverwrite: true });
    expect(replaced.ok && replaced.value.allLessonsReady).toBe(true);
    expect(db.query('SELECT text FROM textbook_articles').all()).toEqual([{ text: '新版本正文' }]);
    for (const table of ['textbook_knowledge', 'textbook_vocabulary', 'textbook_exercise_items'])
      expect(db.query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(db.query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 1 });
  });

  it('跨并发课程的短引用和失败批次被拒绝，不污染各自最终内容', async () => {
    const env = setup();
    await env.repo.seedTextbookTocSkeleton({ ...input(env), entries: [...toc, { ...toc[0]!, id: 'b', title: '第二课', startPage: 2 }] });
    const a = await bind(env, 'session-a'), b = await bind(env, 'session-b', 'b');
    const own = items(await a.submit({ items: [{ text: '甲的正文' }] }))[0]!;
    const foreign = await b.submit({ action: 'update', items: [{ ref: own.ref, text: '越权内容' }] });
    expect(foreign.ok ? '' : foreign.error.code).toBe('E_CONTENT_REF_INVALID');
    const badBatch = await a.submit({ items: [{ text: '不能部分暂存' }, { text: '' }] }); expect(badBatch.ok).toBe(false);
    expect(items(await a.submit({ action: 'read' }))).toHaveLength(1);
    expect((await a.submit({ action: 'update', items: [{ ref: own.ref, text: '甲的最终正文' }] })).ok).toBe(true);
    const other = items(await b.submit({ items: [{ text: '乙的正文' }] }))[0]!;
    expect((await b.submit({ action: 'update', items: [{ ref: other.ref, text: '乙的最终正文' }] })).ok).toBe(true);
    await Promise.all([submitRequired(a.submit), submitRequired(b.submit)]);
    expect((await a.binding.persist()).ok).toBe(false); // Invalid add has not been repaired by an update.
    expect((await a.submit({ items: [{ text: '已封口，不能迟到修正' }] })).ok).toBe(false);
    expect((await b.binding.persist()).ok).toBe(true);
    expect(env.repo.getRawDb().query('SELECT chapter_id, text FROM textbook_articles').all()).toEqual([{ chapter_id: 'b', text: '乙的最终正文' }]);
  });
});
