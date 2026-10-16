import { afterEach, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookContentTools } from '../tools/textbook-content-tools.js';
import { requiredContent, submitRequired } from './textbook-pipeline-fixtures.js';
import type { TextbookContentKind } from '@lexdistill/document-model';
import type { BusinessError, Result } from '@lexdistill/shared';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import { harnessInjection, stubPoolDriver, type ChapterScript } from './agentpool-pipeline-harness.js';
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
    lessonJobs: [{ lessonId: 'a', text: '本课材料' }], poolSize: 1, modelRetries: 0 };
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
  const submit = (raw: unknown, kind: TextbookContentKind = 'articles') => env.tool.tools.find(tool => tool.kind === kind)!.execute(raw,
    { userId: 'owner', sessionId, turnId: 'turn:' + sessionId, callId: `${sessionId}:${++call}` });
  return { binding, submit };
}

let rpcSeq = 0;
async function submitScope(scope: McpChapterScope, kind: TextbookContentKind, raw: unknown) {
  const result = await scope.submission.execute(kind, raw, `test-${++rpcSeq}`);
  if (!result.ok) throw result.error;
}
async function submitRequiredScope(scope: McpChapterScope) {
  for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) {
    await submitScope(scope, kind, requiredContent[kind]);
  }
}

describe('agentpool 课程 CRUD 暂存与整课事务', () => {
  it('HTTP 入口经 MCP 六工具提交，暂存期库里 0 行，保存后落库', async () => {
    const env = setup();
    const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([['a', async (scope) => {
      await submitRequiredScope(scope);
      expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 0 });
    }]]));
    const deps = { repo: env.repo, server: {} } as GatewayDeps;
    const routes = createPdfImportRoutes(deps, { poolDriver: harness.driver, onChapterScope: harness.extra.onChapterScope });
    const response = await routes.request('/api/documents/owner/execute-textbook-pipeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        documentId: 'book', title: 'MCP 入口', language: 'ja', tocEntries: toc, lessonJobs: [{ lessonId: 'a', text: '本课材料' }], poolSize: 1, modelRetries: 0,
      }),
    });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ allLessonsReady: true, successfulLessons: 1 });
    expect(harness.driver.asks).toHaveLength(1);
    expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 1 });
  });

  it('六类多次增查改删只保存最终视图；被删除的新词不进入全局表', async () => {
    const env = setup();
    const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([['a', async (scope) => {
      await submitRequiredScope(scope);
      for (const [kind, value] of Object.entries({
        articles: { text: '第一版正文' }, sentences: { text: '第一版句子' }, material: { text: '第一版材料' },
      }) as Array<[TextbookContentKind, { text: string }]>) {
        const added = items(await scope.submission.execute(kind, { items: [value] }, `test-add-${kind}`));
        const row = added[0]!;
        expect(row).not.toHaveProperty('id'); expect(row).not.toHaveProperty('documentId');
        expect((await scope.submission.execute(kind, { action: 'update', items: [{ ref: row.ref, text: '最终' + kind }] }, `test-upd-${kind}`)).ok).toBe(true);
        expect(items(await scope.submission.execute(kind, { action: 'read' }, `test-read-${kind}`))[0]).toMatchObject({ ref: row.ref, text: '最终' + kind });
      }
      const abandoned = items(await scope.submission.execute('vocabulary', { items: [{ word: '废弃词', meaning: '不保存', level: 'N5' }] }, 'test-abandon'))[0]!;
      expect((await scope.submission.execute('vocabulary', { action: 'delete', refs: [abandoned.ref] }, 'test-abandon-del')).ok).toBe(true);
      const abandonedArticle = items(await scope.submission.execute('articles', { items: [{ text: '废弃正文' }] }, 'test-abandon-a'))[0]!;
      expect((await scope.submission.execute('articles', { action: 'delete', refs: [abandonedArticle.ref] }, 'test-abandon-a-del')).ok).toBe(true);
      expect(items(await scope.submission.execute('articles', { action: 'read' }, 'test-read-a'))).toHaveLength(1);
      for (const table of ['textbook_articles', 'textbook_knowledge', 'textbook_vocabulary', 'textbook_exercise_items', 'global_vocabulary', 'textbook_fts'])
        expect(env.repo.getRawDb().query(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }]]));
    const result = await env.repo.executeTextbookPipeline({ ...input(env), ...harness.extra });
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
    const env = setup();
    const entries = [...toc, { ...toc[0]!, id: 'b', title: '第二课', startPage: 2 }];
    const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([
      ['a', async (scope) => { await submitRequiredScope(scope); }],
      ['b', async (scope) => { await submitRequiredScope(scope); }],
    ]));
    const result = await env.repo.executeTextbookPipeline({ ...input(env), tocEntries: entries,
      lessonJobs: [{ lessonId: 'a', text: '甲' }, { lessonId: 'b', text: '乙' }], ...harness.extra });
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
        db.run('DROP TRIGGER reject_ready');
      }
      return result;
    };
    const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([['a', async (scope) => {
      db.run("CREATE TRIGGER reject_ready BEFORE UPDATE OF chapters_json ON documents BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY controlled fault'); END");
      await submitRequiredScope(scope);
    }]]));
    const driver = stubPoolDriver();
    const harnessWithDriver = harnessInjection(env.repo, new Map<string, ChapterScript>([['a', async (scope) => {
      db.run("CREATE TRIGGER reject_ready BEFORE UPDATE OF chapters_json ON documents BEGIN SELECT RAISE(ABORT, 'SQLITE_BUSY controlled fault'); END");
      await submitRequiredScope(scope);
    }]]), driver);
    void harness;
    const result = await env.repo.executeTextbookPipeline({ ...input(env), storageRetries: 1, ...harnessWithDriver.extra });
    expect(result.ok && result.value.allLessonsReady).toBe(true); expect(commits).toBe(2); expect(driver.asks).toHaveLength(1);
    expect(db.query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 1 });
    expect(db.query('SELECT count(*) AS n FROM textbook_knowledge').get()).toEqual({ n: 1 });
    expect(db.query('SELECT count(*) AS n FROM textbook_fts').get()).toEqual({ n: 1 });
  });

  it('删空暂存内容时不写库；新轮次获得反馈且不继承失败引用', async () => {
    const env = setup(); let commits = 0;
    const commit = env.repo.commitTextbookLesson.bind(env.repo);
    env.repo.commitTextbookLesson = (...args) => { commits++; return commit(...args); };
    const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([['a', async (scope, job, attempt) => {
      if (attempt === 0) {
        const first = items(await scope.submission.execute('articles', { items: [{ text: '失败轮次正文' }] }, 'rpc-a1'))[0]!;
        expect((await scope.submission.execute('articles', { action: 'delete', refs: [first.ref] }, 'rpc-a2')).ok).toBe(true);
      } else {
        expect(items(await scope.submission.execute('articles', { action: 'read' }, 'rpc-b1'))).toEqual([]);
        const foreign = await scope.submission.execute('articles', { action: 'delete', refs: ['stale-ref'] }, 'rpc-b2');
        expect(foreign.ok ? '' : foreign.error.code).toBe('E_CONTENT_REF_INVALID');
        const own = items(await scope.submission.execute('articles', { items: [{ text: '本轮删除以修正反馈' }] }, 'rpc-b3'))[0]!;
        expect((await scope.submission.execute('articles', { action: 'delete', refs: [own.ref] }, 'rpc-b4')).ok).toBe(true);
        await submitRequiredScope(scope);
      }
    }]]));
    const result = await env.repo.executeTextbookPipeline({ ...input(env), modelRetries: 1, storageRetries: 3, ...harness.extra });
    expect(result.ok && result.value.allLessonsReady).toBe(true); expect(commits).toBe(1); expect(harness.driver.asks).toHaveLength(2);
    expect(env.repo.getRawDb().query('SELECT * FROM textbook_articles').all()).toEqual([]);
  });

  it('无有效工具提交不能保存，即使暂存为空', async () => {
    const env = setup();
    const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([['a', async () => undefined]]));
    const result = await env.repo.executeTextbookPipeline({ ...input(env), ...harness.extra });
    expect(result.ok && result.value.failedLessons).toBe(1);
    expect(env.repo.getRawDb().query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 0 });
    const stats = await env.repo.getTextbookAssetStats('book'); expect(stats.ok && stats.value.readyLessons).toBe(0);
  });

  it('同一调用幂等且不接受冲突内容；只查询不能算本轮提交，关闭 AI 练习不能绕过', async () => {
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
    const submit: (raw: unknown, kind?: TextbookContentKind) => Promise<Result<unknown, BusinessError>> = (raw, kind = 'articles') => env.tool.tools.find(tool => tool.kind === kind)!.execute(raw,
      { ...context, callId: 'call:' + kind });
    await submitRequired(submit as never); expect((await binding.persist()).ok).toBe(true); env.tool.end('idempotent');
    expect(env.repo.getRawDb().query('SELECT text FROM textbook_articles').all()).toEqual([{ text: '一次内容' }]);
    const readOnly = await bind(env, 'read-only');
    for (const kind of ['grammar', 'vocabulary', 'exercises'] as const) expect(items(await readOnly.submit({ action: 'read' }, kind))).toHaveLength(1);
    const final = await readOnly.binding.persist(); expect(final.ok ? '' : final.error.code).toBe('E_LESSON_CONTENT_MISSING');

    const disabled = setup();
    const harnessDisabled = harnessInjection(disabled.repo, new Map<string, ChapterScript>([['a', async (scope) => {
      await submitScope(scope, 'grammar', requiredContent.grammar);
      await submitScope(scope, 'vocabulary', requiredContent.vocabulary);
      const rejected = await scope.submission.execute('exercises', { ...requiredContent.exercises, source: 'AI' }, 'rpc-ex');
      expect(rejected.ok ? '' : rejected.error.code).toBe('E_AI_EXERCISES_DISABLED');
    }]]));
    const result = await disabled.repo.executeTextbookPipeline({ ...input(disabled), allowAiExercises: false, ...harnessDisabled.extra });
    expect(result.ok && result.value.failedLessons).toBe(1);
    expect(disabled.repo.getRawDb().query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 0 });
  });

  it('重新提取失败保留原版本；成功后整课替换，不遗留旧正文', async () => {
    const env = setup();
    const good = new Map<string, ChapterScript>([['a', async (scope) => { await submitRequiredScope(scope); }]]);
    expect((await env.repo.executeTextbookPipeline({ ...input(env), ...harnessInjection(env.repo, good).extra })).ok).toBe(true);
    const db = env.repo.getRawDb(), snapshot = db.query('SELECT * FROM textbook_articles').all();
    const failing = new Map<string, ChapterScript>([['a', async (scope) => {
      const row = items(await scope.submission.execute('articles', { items: [{ text: '未完成的替换' }] }, 'rpc-f1'))[0]!;
      expect((await scope.submission.execute('articles', { action: 'delete', refs: [row.ref] }, 'rpc-f2')).ok).toBe(true);
    }]]);
    const result = await env.repo.executeTextbookPipeline({ ...input(env), forceOverwrite: true, ...harnessInjection(env.repo, failing).extra });
    expect(result.ok && result.value.allLessonsReady).toBe(false);
    expect(db.query('SELECT * FROM textbook_articles').all()).toEqual(snapshot);
    const stats = await env.repo.getTextbookAssetStats('book'); expect(stats.ok && stats.value.readyLessons).toBe(1);
    const success = new Map<string, ChapterScript>([['a', async (scope) => {
      expect(items(await scope.submission.execute('articles', { action: 'read' }, 'rpc-s1'))).toEqual([]);
      expect((await scope.submission.execute('articles', { items: [{ text: '新版本正文' }] }, 'rpc-s2')).ok).toBe(true);
      expect(db.query('SELECT * FROM textbook_articles').all()).toEqual(snapshot);
    }]]);
    const replaced = await env.repo.executeTextbookPipeline({ ...input(env), forceOverwrite: true, ...harnessInjection(env.repo, success).extra });
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
    await Promise.all([submitRequired(a.submit as never), submitRequired(b.submit as never)]);
    expect((await a.binding.persist()).ok).toBe(false); // Invalid add has not been repaired by an update.
    expect((await a.submit({ items: [{ text: '已封口，不能迟到修正' }] })).ok).toBe(false);
    expect((await b.binding.persist()).ok).toBe(true);
    expect(env.repo.getRawDb().query('SELECT chapter_id, text FROM textbook_articles').all()).toEqual([{ chapter_id: 'b', text: '乙的最终正文' }]);
  });
});

it('词汇提交可带本课用法与取义说明；落库后读回保留且来源为 TEXTBOOK', async () => {
  const env = setup();
  const harness = harnessInjection(env.repo, new Map<string, ChapterScript>([['a', async (scope) => {
    await submitScope(scope, 'grammar', requiredContent.grammar);
    await submitScope(scope, 'vocabulary', { items: [{ word: '学校', meaning: '学校', level: 'N5', usage: '学校へ行く；常见搭配', contextNote: '本课指上学的场所' }] });
    await submitScope(scope, 'exercises', requiredContent.exercises);
  }]]));
  const result = await env.repo.executeTextbookPipeline({ ...input(env), ...harness.extra });
  expect(result.ok && result.value.allLessonsReady).toBe(true);
  const saved = await env.repo.readTextbookChapter({ userId: 'owner', documentId: 'book', chapterId: 'a' });
  if (!saved.ok) throw saved.error;
  expect(saved.value.vocabulary).toHaveLength(1);
  expect(saved.value.vocabulary[0]).toMatchObject({ usage: '学校へ行く；常见搭配', contextNote: '本课指上学的场所', source: 'TEXTBOOK' });
  expect(env.repo.getRawDb().query('SELECT usage_notes, context_note, source FROM textbook_vocabulary').get()).toEqual(
    { usage_notes: '学校へ行く；常见搭配', context_note: '本课指上学的场所', source: 'TEXTBOOK' });
});
