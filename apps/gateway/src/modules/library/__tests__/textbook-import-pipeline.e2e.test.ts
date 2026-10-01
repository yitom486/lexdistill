import { afterEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { BusinessError, err } from '@study-studio/shared';
import { TextbookASTSchema, type TocEntry } from '@study-studio/document-model';
import * as schema from '@study-studio/storage-sqlite';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { TextbookPipelineJobRegistry } from '../application/pipeline-job-runner.js';
import type { TextbookPipelineInput } from '../application/textbook-pipeline.js';
import { contentFor, deferred, fixturePdf, parsedText, pipelineModel, submissionFromPrompt, type ModelTurn } from './textbook-pipeline-fixtures.js';

const repos: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repos.splice(0)) repo.getRawDb().close(); });
const toc: TocEntry[] = [
  { id: 'l1', title: '第一章', level: 'lesson', startPage: 1, endPage: 1 },
  { id: 's1', title: '会话', level: 'section', startPage: 1, endPage: 1, parentId: 'l1' },
  { id: 'l2', title: '第二章', level: 'lesson', startPage: 2, endPage: 2 },
];
function environment(handle?: (turn: ModelTurn) => Promise<void>) {
  const repo = new DrizzleLearnerRepository(':memory:'); repos.push(repo);
  const db = drizzle(repo.getRawDb(), { schema });
  const tool = new LibraryLessonCommitTool(repo);
  const model = pipelineModel(tool, handle);
  const input: TextbookPipelineInput = { userId: 'owner', documentId: 'book', title: '集成教材', language: 'ja', tocEntries: toc,
    lessonJobs: [{ lessonId: 'l1', text: '第一章原文' }, { lessonId: 'l2', text: '第二章原文' }],
    adapter: model.adapter, submissionTool: tool, poolSize: 1, model: 'chosen-model', effort: 'low', modelRetries: 0,
  };
  return { repo, db, tool, model, input };
}

describe('教材按章流水线：会话原生工具 → 独立校验 → SQLite → 回执', () => {
  it('首章落库时第二章还在 OCR；只注入提交工具且同一线程复用，来源与目录排序贯通 AST/行表', async () => {
    const secondStarted = deferred(), releaseSecond = deferred(), firstSaved = deferred();
    const env = environment(async ({ input, submit }) => {
      const submission = submissionFromPrompt(input.message);
      if (submission.lessonId === 'l1') await secondStarted.promise;
      expect((await submit(submission)).ok).toBe(true);
    });
    let secondFinished = false;
    const run = env.repo.executeTextbookPipeline({ ...env.input, lessonJobs: undefined, pdf: await fixturePdf(2), parseConcurrency: 2,
      inspector: {
        processPdf: () => ({ pageCount: 2, markdown: '', pagesNeedingOcr: [1] }),
        processPdfWithOcr: async () => { throw new Error('旧正文 OCR 不得被调用'); },
      },
      chapterParser: { parse: async (_bytes, pages) => {
        if (pages[0] === 2) { secondStarted.resolve(); await releaseSecond.promise; secondFinished = true; }
        return parsedText('受控 MinerU 内容', pages);
      } },
      onProgress: progress => {
        if (progress.lessonId === 'l1' && progress.stage === 'saved') {
          expect(secondFinished).toBe(false);
          expect(env.db.select().from(schema.textbookLessons).all().find(row => row.lessonId === 'l1')?.status).toBe('ready');
          firstSaved.resolve();
        }
      },
    });
    await firstSaved.promise;
    expect(env.model.created).toHaveLength(1);
    releaseSecond.resolve();
    const result = await run;
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(env.model.inputs.map(turn => turn.sessionId)).toEqual([env.model.created[0]!.sessionId, env.model.created[0]!.sessionId]);
    expect(env.model.created[0]!.tools?.map(tool => tool.name)).toEqual(['library.commit_lesson_knowledge']);
    expect(env.model.created[0]!.model).toBe('chosen-model');
    expect(env.model.inputs.every(turn => turn.input.turnOptions?.effort === 'low')).toBe(true);
    expect(env.model.closed).toHaveLength(1);
    const doc = env.db.select().from(schema.documents).where(eq(schema.documents.id, 'book')).get()!;
    const ast = TextbookASTSchema.parse(JSON.parse(doc.astJson!));
    expect(ast.lessons.map(lesson => lesson.id)).toEqual(['l1', 's1', 'l2']);
    expect(ast.lessons[0]!.content?.blocks[1]?.kind).toBe('DIALOGUE');
    expect(env.db.select().from(schema.textbookLines).all().filter(row => row.lessonId === 'l1').map(row => [row.kind, row.speaker])).toEqual([['PARAGRAPH', ''], ['DIALOGUE', '甲']]);
    const grammar = env.db.select().from(schema.textbookGrammar).get()!;
    expect(grammar.explanation).toBe('原书说明'); expect(grammar.aiExplanation).toBe('模型补充说明');
    const exercise = env.db.select().from(schema.textbookExercises).get()!;
    expect(exercise.source).toBe('TEXTBOOK'); expect(JSON.parse(exercise.fieldSourcesJson!)).toEqual({ answer: 'AI', explanation: 'AI' });
    expect(JSON.parse(exercise.answerJson!)).toEqual({ text: '补充答案' });
    expect(JSON.parse(env.db.select().from(schema.textbookLessons).get()!.contentJson!)).toEqual(ast.lessons[0]!.content);
  }, 10000);

  it('乱序保存后仍按目录读；固定两条会话处理多章，不按章重建', async () => {
    const secondSaved = deferred();
    const env = environment(async ({ input, submit }) => {
      const submission = submissionFromPrompt(input.message);
      if (submission.lessonId === 'l1') await secondSaved.promise;
      expect((await submit(submission)).ok).toBe(true);
      if (submission.lessonId === 'l2') secondSaved.resolve();
    });
    const entries = Array.from({ length: 7 }, (_, index): TocEntry => ({ id: `l${index + 1}`, title: `章 ${index + 1}`, level: 'lesson', startPage: index + 1 }));
    const saved: string[] = [];
    const result = await env.repo.executeTextbookPipeline({ ...env.input, poolSize: 2, queueCapacity: 1, tocEntries: entries,
      lessonJobs: entries.map(entry => ({ lessonId: entry.id, text: '输入文字' })), onProgress: progress => { if (progress.stage === 'saved') saved.push(progress.lessonId); },
    });
    expect(result.ok && result.value.successfulLessons).toBe(7);
    expect(saved[0]).toBe('l2'); expect(env.model.created).toHaveLength(2); expect(env.model.closed).toHaveLength(2);
    expect(new Set(env.model.inputs.map(turn => turn.sessionId)).size).toBe(2);
    expect((await env.repo.listTextbookLessonSlots('book')).ok).toBe(true);
    expect(env.db.select().from(schema.textbookLessons).orderBy(schema.textbookLessons.sortOrder).all().map(row => row.lessonId)).toEqual(entries.map(entry => entry.id));
  });

  for (const [name, code, corrupt] of [
    ['破损参数', 'E_LLM_SCHEMA_INVALID', (value: ReturnType<typeof submissionFromPrompt>) => ({ ...value, content: '{}' })],
    ['非法题型', 'E_LLM_SCHEMA_INVALID', (value: ReturnType<typeof submissionFromPrompt>) => ({ ...value, content: { ...value.content, exercises: [{ ...value.content.exercises[0], type: 'UNKNOWN' }] } })],
    ['目录缺项', 'E_TOC_COVERAGE_INCOMPLETE', (value: ReturnType<typeof submissionFromPrompt>) => ({ ...value, content: { ...value.content, coverage: value.content.coverage.map(item => ({ ...item, status: 'UNREADABLE' })) } })],
    ['目录越界', 'E_TOC_SLOT_NOT_FOUND', (value: ReturnType<typeof submissionFromPrompt>) => ({ ...value, content: { ...value.content, coverage: [...value.content.coverage, { tocId: 'ghost', status: 'EXTRACTED' }] } })],
    ['只用 AI 内容冒充提取', 'E_TOC_COVERAGE_INCOMPLETE', (value: ReturnType<typeof submissionFromPrompt>) => ({ ...value, content: { ...value.content, blocks: [{ id: 'ai-only', kind: 'PARAGRAPH', text: '新增内容', source: 'AI', tocId: value.lessonId }], vocabularies: [], knowledgePoints: [], exercises: [] } })],
  ] as const) {
    it(`${name}返回明确回执，修正后才能写库`, async () => {
      const env = environment(async ({ input, submit }) => {
        const value = submissionFromPrompt(input.message);
        const bad = await submit(corrupt(value));
        expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error.code).toBe(code);
        expect(env.db.select().from(schema.textbookLessons).all().find(row => row.lessonId === value.lessonId)?.status).toBe('pending');
        expect((await submit(value)).ok).toBe(true);
      });
      const result = await env.repo.executeTextbookPipeline(env.input);
      expect(result.ok && result.value.allLessonsReady).toBe(true);
    });
  }
  it('无工具提交只失败该章；普通 JSON 文本不成为成功回填', async () => {
    const env = environment(async ({ input, submit }) => { if (submissionFromPrompt(input.message).lessonId === 'l2') await submit(submissionFromPrompt(input.message)); });
    const result = await env.repo.executeTextbookPipeline(env.input);
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    expect(result.value.successfulLessons).toBe(1); expect(result.value.failedLessons).toBe(1);
    expect(result.value.allLessonsReady).toBe(false);
    expect(env.db.select().from(schema.textbookLines).all().every(row => row.lessonId === 'l2')).toBe(true);
  });
  it('暂时性写库失败仅重试候选保存，模型不重复生成；重复工具提交只接受首次内容', async () => {
    let writes = 0;
    const env = environment(async ({ input, submit }) => {
      const value = submissionFromPrompt(input.message);
      await submit(value);
    });
    const commit = env.repo.commitLessonKnowledge.bind(env.repo);
    env.repo.commitLessonKnowledge = async input => { writes++; if (writes === 1) return err(new BusinessError('E_DB_BUSY', '数据库暂忙', 'DATABASE', true)); return commit(input); };
    const result = await env.repo.executeTextbookPipeline({ ...env.input, tocEntries: [toc[0]!], lessonJobs: [env.input.lessonJobs![0]!], storageRetries: 1 });
    expect(result.ok && result.value.allLessonsReady).toBe(true); expect(writes).toBe(2); expect(env.model.inputs).toHaveLength(1);
    const stored = env.db.select().from(schema.textbookLessons).get()!;
    const duplicate = await commit({ documentId: 'book', lessonId: 'l1', submissionId: stored.submissionId!, content: { ...contentFor(['l1']), blocks: [{ id: 'changed', kind: 'PARAGRAPH', source: 'TEXTBOOK', tocId: 'l1', text: '重复提交不能覆盖' }] } });
    expect(duplicate.ok).toBe(true); expect(env.db.select().from(schema.textbookLines).get()?.ja).toBe('整理后的正文 l1');
  });
  it('切章后旧绑定、其他用户和取消后迟到提交全部拒绝；取消释放会话', async () => {
    let previous: ReturnType<typeof submissionFromPrompt> | undefined;
    const controller = new AbortController();
    const env = environment(async ({ input, sessionId, submit }) => {
      const value = submissionFromPrompt(input.message);
      const wrongUser = await env.tool.execute(value, { userId: 'other', sessionId });
      expect(wrongUser.ok).toBe(false);
      if (previous) {
        const stale = await submit(previous); expect(stale.ok).toBe(false); if (!stale.ok) expect(stale.error.code).toBe('E_SUBMISSION_SCOPE_INVALID');
        controller.abort();
        const late = await submit(value); expect(late.ok).toBe(false); return;
      }
      await submit(value); previous = value;
    });
    const result = await env.repo.executeTextbookPipeline({ ...env.input, signal: controller.signal });
    expect(result.ok).toBe(false); expect(env.model.closed).toHaveLength(1); expect(env.model.interrupted).toHaveLength(1);
    expect(env.db.select().from(schema.textbookLessons).all().find(row => row.lessonId === 'l1')?.status).toBe('ready');
    expect(env.db.select().from(schema.textbookLessons).all().find(row => row.lessonId === 'l2')?.status).toBe('pending');
    expect((await env.tool.execute(previous!, { userId: 'owner', sessionId: env.model.created[0]!.sessionId })).ok).toBe(false);
  });
  it('成功提交后 Turn 失败仍保留成功回执；另一章异常隔离', async () => {
    const env = environment(async ({ input, submit }) => {
      if (submissionFromPrompt(input.message).lessonId === 'l1') await submit(submissionFromPrompt(input.message));
      throw new Error('模型流中断');
    });
    const result = await env.repo.executeTextbookPipeline(env.input);
    expect(result.ok && result.value.successfulLessons).toBe(1); expect(result.ok && result.value.failedLessons).toBe(1);
    expect(env.model.closed).toHaveLength(2);
    expect(env.model.created).toHaveLength(2);
  });
  it('派生表故障使 AST、正文和 ready 整体回滚', async () => {
    const env = environment();
    env.repo.getRawDb().run("CREATE TRIGGER block_vocab BEFORE INSERT ON textbook_vocab BEGIN SELECT RAISE(ABORT, 'test-write-fault'); END");
    const result = await env.repo.executeTextbookPipeline({ ...env.input, storageRetries: 0, traceId: 'rollback-trace' });
    expect(result.ok && result.value.successfulLessons).toBe(0);
    expect(env.db.select().from(schema.textbookLines).all()).toHaveLength(0);
    const ast = TextbookASTSchema.parse(JSON.parse(env.db.select().from(schema.documents).where(eq(schema.documents.id, 'book')).get()!.astJson!));
    expect(ast.lessons.every(lesson => !lesson.content && lesson.status === 'pending')).toBe(true);
    const events = await env.repo.listImportEvents({ userId: 'owner', traceId: 'rollback-trace' });
    expect(events.ok && events.value.some(event => event.name === 'transaction_rolled_back')).toBe(true);
    expect(events.ok && events.value.some(event => event.name === 'committed')).toBe(false);
  });
  it('模型初始化期间队列满后停止预扫，OCR 与模型并发均受用户配置限制', async () => {
    const releaseInit = deferred(), thirdText = deferred();
    let ocrCalls = 0, ocrActive = 0, ocrPeak = 0, modelActive = 0, modelPeak = 0;
    const env = environment(async ({ input, submit }) => {
      modelActive++; modelPeak = Math.max(modelPeak, modelActive);
      try { await new Promise(resolve => setTimeout(resolve, 2)); await submit(submissionFromPrompt(input.message)); } finally { modelActive--; }
    });
    const createSession = env.model.adapter.createSession;
    env.model.adapter.createSession = async options => { expect(options.tools?.map(tool => tool.name)).toEqual([env.tool.name]); await releaseInit.promise; return createSession(options); };
    const entries = Array.from({ length: 8 }, (_, index): TocEntry => ({ id: `l${index + 1}`, title: `章 ${index + 1}`, level: 'lesson', startPage: index + 1, endPage: index + 1 }));
    let queued = 0;
    const run = env.repo.executeTextbookPipeline({ ...env.input, tocEntries: entries, lessonJobs: undefined, poolSize: 2, parseConcurrency: 2, queueCapacity: 1, pdf: await fixturePdf(8),
      inspector: { processPdf: () => ({ pageCount: 8 }), processPdfWithOcr: async () => { throw new Error('不得调用旧 OCR'); } },
      chapterParser: { parse: async (_bytes, pages) => { ocrCalls++; ocrActive++; ocrPeak = Math.max(ocrPeak, ocrActive); await new Promise(resolve => setTimeout(resolve, 1)); ocrActive--; return parsedText('文字', pages); } },
      onProgress: progress => { if (progress.stage === 'queued' && ++queued === 3) thirdText.resolve(); },
    });
    await thirdText.promise; await new Promise(resolve => setTimeout(resolve, 10));
    expect(ocrCalls).toBe(3); // 容量 1 + 两个正在等待交接的生产者；不能无限预扫。
    expect(env.model.inputs).toHaveLength(0); releaseInit.resolve();
    const result = await run;
    expect(result.ok && result.value.successfulLessons).toBe(8); expect(ocrPeak).toBe(2); expect(modelPeak).toBe(2); expect(ocrActive + modelActive).toBe(0); expect(env.model.closed).toHaveLength(2);
  }, 10000);
  it('会话初始化失败不能静默缩小池，关闭已创建会话并释放满队列', async () => {
    const env = environment();
    const createSession = env.model.adapter.createSession;
    let created = 0;
    env.model.adapter.createSession = async options => ++created === 1 ? err(new BusinessError('E_WORKER_START_FAILED', '测试 Worker 初始化失败', 'AGENT_RUNTIME')) : createSession(options);
    const result = await env.repo.executeTextbookPipeline({ ...env.input, poolSize: 2, queueCapacity: 1 });
    expect(result.ok).toBe(false); expect(created).toBe(2); expect(env.model.closed).toHaveLength(1); expect(env.db.select().from(schema.textbookLines).all()).toHaveLength(0);
  });
  it('格式重试复用当前线程，旧尝试 ID 被拒绝；纠错详情交给模型', async () => {
    let previous: ReturnType<typeof submissionFromPrompt> | undefined;
    const env = environment(async ({ input, submit }) => {
      const value = submissionFromPrompt(input.message);
      if (!previous) { previous = value; await submit({ ...value, content: null }); return; }
      const old = await submit(previous); expect(old.ok).toBe(false);
      expect(input.message).toContain('上次未完成的原因'); expect((await submit(value)).ok).toBe(true);
    });
    const result = await env.repo.executeTextbookPipeline({ ...env.input, tocEntries: [toc[0]!], lessonJobs: [env.input.lessonJobs![0]!], modelRetries: 1 });
    expect(result.ok && result.value.allLessonsReady).toBe(true); expect(env.model.inputs).toHaveLength(2); expect(env.model.created).toHaveLength(1);
  });
  it('没有原书练习目录可补充七种题型；答案格式错误不能落库', async () => {
    const env = environment(async ({ input, submit }) => {
      const value = submissionFromPrompt(input.message);
      value.content.exercises = [
        ...(['CHOICE', 'MULTI_CHOICE', 'ORDERING'] as const).map(type => ({ id: type, type, prompt: '新增练习', source: 'AI' as const, knowledgePointIds: ['g1'], options: [{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }], answer: { optionIds: type === 'CHOICE' ? ['a'] : ['b', 'a'] }, fieldSources: { answer: 'AI' as const } })),
        ...(['FILL_BLANK', 'TRANSLATION', 'SHORT_ANSWER'] as const).map(type => ({ id: type, type, prompt: '新增练习', source: 'AI' as const, knowledgePointIds: ['g1'], answer: { text: '答案' }, fieldSources: { answer: 'AI' as const } })),
        { id: 'match', type: 'MATCHING', prompt: '匹配', source: 'AI', knowledgePointIds: ['g1'], left: [{ id: 'a', text: '甲' }], right: [{ id: 'b', text: '乙' }], answer: { pairs: [{ leftId: 'a', rightId: 'b' }] }, fieldSources: { answer: 'AI' } },
      ];
      value.content.exercises = value.content.exercises.map(item => ({ ...item, tocId: value.lessonId }));
      const badAnswer = await submit({ ...value, content: { ...value.content, exercises: [{ ...value.content.exercises[0], answer: { optionIds: ['ghost'] } }] } });
      expect(badAnswer.ok).toBe(false); if (!badAnswer.ok) expect(badAnswer.error.code).toBe('E_LLM_SCHEMA_INVALID');
      expect((await submit(value)).ok).toBe(true);
    });
    const result = await env.repo.executeTextbookPipeline(env.input);
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(env.db.select().from(schema.textbookExercises).all()).toHaveLength(14);
    expect(env.db.select().from(schema.textbookExercises).all().every(row => row.source === 'AI' && row.answerJson)).toBe(true);
  });
  it('长章节按配置解析批次处理，失败重试保留成功批次，只生成一次章节', async () => {
    const env = environment(), calls: number[][] = [];
    const limit = 2, pages = limit + 2;
    let failed = false;
    const result = await env.repo.executeTextbookPipeline({ ...env.input, lessonJobs: undefined, parseRetries: 1, parsePageLimit: limit, pdf: await fixturePdf(pages),
      tocEntries: [{ id: 'l1', title: '长章节', level: 'lesson', startPage: 1, endPage: pages }],
      inspector: { processPdf: () => ({ pageCount: pages }), processPdfWithOcr: async () => { throw new Error('不得调用旧 OCR'); } },
      chapterParser: { parse: async (_bytes, batch) => {
        calls.push([...batch]);
        if (batch[0] !== 1 && !failed) { failed = true; throw new BusinessError('E_MINERU_BUSY', '解析服务暂时忙', 'TOOL_EXECUTION', true); }
        return parsedText(batch[0] === 1 ? '前半章' : '后半章', batch);
      } },
    });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(calls.map(batch => batch.length)).toEqual([limit, 2, 2]);
    expect(calls.filter(batch => batch[0] === 1)).toHaveLength(1);
    expect(env.model.inputs).toHaveLength(1); expect(env.model.inputs[0]?.input.message).toContain('前半章'); expect(env.model.inputs[0]?.input.message).toContain('后半章');
  });
  it('网关关闭取消后台任务，收尾在途解析并释放会话，迟到内容不入库', async () => {
    const env = environment(), registry = new TextbookPipelineJobRegistry(), nativeStarted = deferred(), releaseNative = deferred();
    let nativeCalls = 0, settled = false;
    const result = registry.start(env.repo, { ...env.input, lessonJobs: undefined, pdf: await fixturePdf(2), parseConcurrency: 1,
      inspector: { processPdf: () => ({ pageCount: 2 }), processPdfWithOcr: async () => { throw new Error('不得调用旧 OCR'); } },
      chapterParser: { parse: async (_bytes, pages) => { nativeCalls++; nativeStarted.resolve(); await releaseNative.promise; return parsedText('迟到文字', pages); } },
    });
    expect(result.ok).toBe(true); if (!result.ok) throw result.error;
    await nativeStarted.promise;
    const shutdown = registry.shutdown().then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false); expect(registry.get(result.value.jobId)?.status).toBe('cancelled');
    releaseNative.resolve(); await shutdown;
    expect(nativeCalls).toBe(1); expect(env.model.inputs).toHaveLength(0); expect(env.model.closed).toHaveLength(1);
    expect(env.db.select().from(schema.textbookLines).all()).toHaveLength(0);
  }, 10000);
});
