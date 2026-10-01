import { afterEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import * as tables from '@study-studio/storage-sqlite';
import { TextbookASTSchema, type TextbookLessonStage } from '@study-studio/document-model';
import { BusinessError, err } from '@study-studio/shared';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { LibraryLessonCommitTool } from '../tools/library-lesson-commit-tool.js';
import { deferred, pipelineModel, submissionFromPrompt, type ModelTurn } from './textbook-pipeline-fixtures.js';

const repositories: DrizzleLearnerRepository[] = [];
afterEach(() => { for (const repo of repositories.splice(0)) repo.getRawDb().close(); });
function setup(handle?: (turn: ModelTurn) => Promise<void>) {
  const repo = new DrizzleLearnerRepository(':memory:'); repositories.push(repo);
  const db = drizzle(repo.getRawDb(), { schema: tables }), tool = new LibraryLessonCommitTool(repo);
  const model = pipelineModel(tool, handle), stages: TextbookLessonStage[] = [];
  const input = { userId: 'owner', documentId: 'book', traceId: 'correction', title: '纠错集成教材',
    tocEntries: [{ id: 'a', title: '独立部分', level: 'section' as const, startPage: 3 }],
    lessonJobs: [{ lessonId: 'a', text: '正文' }], adapter: model.adapter, submissionTool: tool, poolSize: 1, modelRetries: 0,
    onProgress: (progress: { stage: TextbookLessonStage }) => { stages.push(progress.stage); },
  };
  return { repo, db, tool, model, input, stages };
}
async function eventDetails(repo: DrizzleLearnerRepository, name: string) {
  const events = await repo.listImportEvents({ userId: 'owner', traceId: 'correction' });
  if (!events.ok) throw events.error;
  return Promise.all(events.value.filter(event => event.name === name).map(async event => {
    const result = await repo.getImportEvent('owner', 'correction', event.sequence);
    if (!result.ok) throw result.error;
    return result.value;
  }));
}
describe('提交修正集成：准确身份反馈、字段保留、阶段与有界模型等待', () => {
  it('原生旧轮次零写入，模型不提交身份，合法内容生成系统 ID 并保存独立讲解', async () => {
    const env = setup(async ({ input, submit, sessionId }) => {
      const value = submissionFromPrompt(input.message);
      expect(input.message).not.toContain('assignmentId:');
      expect(input.message).not.toContain('documentId:');
      expect(env.tool.schema.safeParse(value).success).toBe(true);
      expect(env.tool.schema.safeParse({ ...value, assignmentId: 'model-id' }).success).toBe(false);
      const rejected = await env.tool.execute(value, { userId: 'owner', sessionId, turnId: 'previous-turn', callId: 'call:stale' });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.error.retryable).toBe(false);
        expect(rejected.error.code).toBe('E_SUBMISSION_SCOPE_INVALID');
      }
      expect(env.db.select().from(tables.textbookLines).all()).toHaveLength(0);
      value.content.vocabularies[0]!.aiExplanation = 'AI 讲解独立保留';
      const unknown = await submit({ ...value, unknownField: '拒绝未知字段' }); expect(unknown.ok).toBe(false);
      expect((await submit(value)).ok).toBe(true);
    });
    const result = await env.repo.executeTextbookPipeline(env.input);
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    const vocab = env.db.select().from(tables.textbookVocab).get()!;
    expect(vocab.aiExplanation).toBe('AI 讲解独立保留'); expect(vocab.glossZh).toBe('学习');
    const ast = TextbookASTSchema.parse(JSON.parse(env.db.select().from(tables.documents).where(eq(tables.documents.id, 'book')).get()!.astJson!));
    expect(ast.lessons[0]!.content!.vocabularies[0]!.aiExplanation).toBe('AI 讲解独立保留');
    const content = ast.lessons[0]!.content!;
    expect(content.vocabularies[0]!.id).toStartWith('content_');
    expect(content.exercises[0]!.knowledgePointIds).toEqual([content.knowledgePoints[0]!.id]);
    expect(new Set([...content.blocks, ...content.vocabularies, ...content.knowledgePoints, ...content.exercises].map(item => item.id)).size).toBe(4);
    expect(env.stages).toContain('correcting');
    const records = await eventDetails(env.repo, 'rejected');
    expect(records[0]?.callId).toBe('call:stale');
  });
  it('缺少 AI 例句关联拒绝写入，新模型轮次复用线程并明确显示模型重试', async () => {
    let attempts = 0;
    const env = setup(async ({ input, submit }) => {
      const value = submissionFromPrompt(input.message);
      if (!attempts++) delete value.content.knowledgePoints[0]!.examples[0]!.tocId;
      const result = await submit(value);
      expect(result.ok).toBe(attempts > 1);
    });
    const result = await env.repo.executeTextbookPipeline({ ...env.input, modelRetries: 1 });
    expect(result.ok && result.value.allLessonsReady).toBe(true);
    expect(env.stages).toContain('model_retrying'); expect(env.model.created).toHaveLength(1);
    expect(env.model.inputs[1]!.input.message).toContain('全部内容及例句必须关联当前目录 ID');
  });
  it('有效候选遇暂时数据库失败仅重试保存，阶段及回执均对应同一次模型输入', async () => {
    const env = setup(), commit = env.repo.commitLessonKnowledge.bind(env.repo); let count = 0;
    env.repo.commitLessonKnowledge = input => ++count === 1 ? Promise.resolve(err(new BusinessError('E_DB_BUSY', '数据库暂忙', 'DATABASE', true))) : commit(input);
    const result = await env.repo.executeTextbookPipeline({ ...env.input, storageRetries: 1 });
    expect(result.ok && result.value.allLessonsReady).toBe(true); expect(count).toBe(2);
    expect(env.stages).toContain('storage_retrying'); expect(env.stages).not.toContain('model_retrying');
    expect(env.model.inputs).toHaveLength(1);
  });
  it('普通文本即使包含合法 JSON 或代码围栏也不落库，监视保留真实文本与缺少工具的原因', async () => {
    const env = setup(), create = env.model.adapter.createSession;
    env.model.adapter.createSession = async options => {
      const created = await create(options); if (!created.ok) return created;
      created.value.send = async function* (input) {
        const json = JSON.stringify(submissionFromPrompt(input.message));
        yield { type: 'TEXT_DELTA', delta: `${json}\n\u0060\u0060\u0060json\n${json}\n\u0060\u0060\u0060` };
        yield { type: 'COMPLETED' };
      };
      return created;
    };
    const result = await env.repo.executeTextbookPipeline(env.input);
    expect(result.ok && result.value.failedLessons).toBe(1); expect(result.ok && result.value.successfulLessons).toBe(0);
    expect(result.ok && result.value.errors[0]?.error).toContain('未通过工具提交有效内容');
    expect(env.db.select().from(tables.textbookLines).all()).toHaveLength(0);
    const messages = await eventDetails(env.repo, 'message');
    expect(messages[0]?.detail).toEqual(expect.objectContaining({ text: expect.stringContaining('\u0060\u0060\u0060json') }));
  });
  for (const first of [true, false]) it(`${first ? '首响应' : '无活动'}超时会中断、结算失败并拒绝迟到工具`, async () => {
    const gate = deferred(), lateDone = deferred(); let accepted: boolean | undefined;
    const env = setup(async ({ input, submit }) => { await gate.promise; accepted = (await submit(submissionFromPrompt(input.message))).ok; lateDone.resolve(); });
    if (!first) {
      const create = env.model.adapter.createSession;
      env.model.adapter.createSession = async options => {
        const result = await create(options); if (!result.ok) return result;
        const send = result.value.send.bind(result.value);
        result.value.send = async function* (input) { yield { type: 'TEXT_DELTA', delta: '已响应，后续停滞' }; yield* send(input); };
        return result;
      };
    }
    try {
      const result = await env.repo.executeTextbookPipeline({ ...env.input, firstResponseTimeoutMs: 30, stallTimeoutMs: 30 });
      expect(result.ok && result.value.failedLessons).toBe(1); expect(result.ok && result.value.allLessonsReady).toBe(false);
      expect(env.model.interrupted).toHaveLength(1); expect(env.model.closed).toHaveLength(1);
      const failed = await eventDetails(env.repo, 'failed');
      expect(failed.some(event => typeof event?.detail === 'object' && event.detail !== null && 'code' in event.detail && event.detail.code === (first ? 'E_AGENT_FIRST_RESPONSE_TIMEOUT' : 'E_AGENT_STALL_TIMEOUT'))).toBe(true);
    } finally { gate.resolve(); if (env.model.inputs.length) await lateDone.promise; }
    expect(accepted).toBe(false); expect(env.db.select().from(tables.textbookLines).all()).toHaveLength(0);
  });
  it('超时会话先关闭再重试，旧工具零写入，新会话持续复用到下一部分', async () => {
    const gate = deferred(), lateDone = deferred(); let calls = 0, oldAccepted: boolean | undefined;
    const env = setup(async ({ input, submit }) => {
      if (!calls++) { await gate.promise; oldAccepted = (await submit(submissionFromPrompt(input.message))).ok; lateDone.resolve(); return; }
      expect(env.model.closed).toHaveLength(1);
      expect((await submit(submissionFromPrompt(input.message))).ok).toBe(true);
    });
    try {
      const result = await env.repo.executeTextbookPipeline({ ...env.input, modelRetries: 1, firstResponseTimeoutMs: 30,
        tocEntries: [...env.input.tocEntries, { id: 'b', title: '后一部分', level: 'lesson', startPage: 4 }], lessonJobs: [...env.input.lessonJobs, { lessonId: 'b', text: '后一部分正文' }],
      });
      expect(result.ok && result.value.allLessonsReady).toBe(true); expect(env.model.created).toHaveLength(2);
      expect(env.model.inputs.map(turn => turn.sessionId)).toEqual([env.model.created[0]!.sessionId, env.model.created[1]!.sessionId, env.model.created[1]!.sessionId]);
      expect(env.model.closed).toHaveLength(2);
    } finally { gate.resolve(); await lateDone.promise; }
    expect(oldAccepted).toBe(false); expect(env.db.select().from(tables.textbookLines).all()).toHaveLength(2);
  });
});
