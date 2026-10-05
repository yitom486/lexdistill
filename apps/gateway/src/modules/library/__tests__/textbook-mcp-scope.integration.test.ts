/**
 * 教材 MCP 作用域矩阵（真实 MCP 协议 + 真实工具 + 真实 SQLite）。
 *
 * 经 TextbookMcpRegistry.handleRequest 走完整 SDK 传输与工具链；
 * 不 Mock 工具执行、不伪造保存成功。
 */
import { describe, expect, it } from 'bun:test';
import { DrizzleLearnerRepository } from '../../../infrastructure/drizzle-learner-repository.js';
import { TextbookMcpRegistry } from '../mcp/textbook-mcp-server.js';

const repos: DrizzleLearnerRepository[] = [];

function setup() {
  const repo = new DrizzleLearnerRepository(':memory:');
  repos.push(repo);
  const registry = new TextbookMcpRegistry({ repo });
  return { repo, registry };
}

async function seedChapters(repo: DrizzleLearnerRepository, lessonIds: string[]): Promise<void> {
  const seeded = await repo.seedTextbookTocSkeleton({
    documentId: 'book',
    userId: 'owner',
    title: ' scope-test-book',
    language: 'ja',
    entries: lessonIds.map((id, index) => ({ id, level: 'lesson' as const, title: `第${index + 1}课`, startPage: index + 1 })),
  });
  if (!seeded.ok) throw seeded.error;
}

async function teardown(): Promise<void> {
  for (const repo of repos.splice(0)) repo.getRawDb().close();
}

let rpcSeq = 0;
const sessions = new Map<string, string>();
function sessionKey(taskToken: string, workerIndex: number) {
  return `${taskToken}:w${workerIndex}`;
}
async function post(
  registry: TextbookMcpRegistry,
  taskToken: string,
  workerIndex: number,
  body: unknown,
  sessionId?: string,
): Promise<Response> {
  return registry.handleRequest(
    taskToken,
    workerIndex,
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
function sseResult(text: string): { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } } | null {
  const dataLine = text
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('data:'));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(5).trim()) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } };
}
/** 按真实 MCP 客户端行为建会话：initialize 取 session id，再调工具。 */
async function ensureSession(registry: TextbookMcpRegistry, taskToken: string, workerIndex: number): Promise<string> {
  const key = sessionKey(taskToken, workerIndex);
  const cached = sessions.get(key);
  if (cached) return cached;
  const init = await post(registry, taskToken, workerIndex, {
    jsonrpc: '2.0',
    id: `init-${(rpcSeq += 1)}`,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'scope-test', version: '1' } },
  });
  const sessionId = init.headers.get('mcp-session-id') ?? '';
  if (!sessionId) throw new Error('MCP 服务未返回会话标识');
  await init.text();
  await post(registry, taskToken, workerIndex, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  sessions.set(key, sessionId);
  return sessionId;
}
async function mcpCall(
  registry: TextbookMcpRegistry,
  taskToken: string,
  workerIndex: number,
  tool: string,
  args: unknown,
): Promise<{ ok: boolean; text: string }> {
  const sessionId = await ensureSession(registry, taskToken, workerIndex);
  const res = await post(
    registry,
    taskToken,
    workerIndex,
    { jsonrpc: '2.0', id: `call-${(rpcSeq += 1)}`, method: 'tools/call', params: { name: tool, arguments: args } },
    sessionId,
  );
  const payload = sseResult(await res.text());
  if (!payload) return { ok: false, text: 'non-sse response' };
  if (payload.error) return { ok: false, text: payload.error.message ?? 'unknown' };
  const content = payload.result?.content?.[0]?.text ?? '';
  return { ok: !payload.result?.isError, text: content };
}

function assignment(lessonId: string, attempt = 'attempt-1') {
  return {
    userId: 'owner',
    documentId: 'book',
    lessonId,
    assignmentId: attempt,
    allowAiExercises: true,
    signal: new AbortController().signal,
  };
}

describe('教材 MCP 调用作用域矩阵', () => {
  it('正常提交暂存并整章事务保存', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      const scope = registry.setChapter(taskToken, 0, assignment('ch1'));
      expect(scope).toBeDefined();
      const called = await mcpCall(registry, taskToken, 0, 'write_vocabulary', {
        action: 'add',
        items: [{ word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5' }],
      });
      expect(called.ok).toBe(true);
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 0 });
      const saved = await scope!.submission.persist();
      expect(saved.ok).toBe(true);
      expect(repo.getRawDb().query('SELECT word FROM global_vocabulary').all()).toEqual([{ word: '学校' }]);
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 1 });
    } finally {
      await teardown();
    }
  });

  it('未登记工具被拒绝且不污染数据库', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      registry.setChapter(taskToken, 0, assignment('ch1'));
      const called = await mcpCall(registry, taskToken, 0, 'write_nonexistent', { action: 'add', items: [] });
      expect(called.ok).toBe(false);
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 0 });
    } finally {
      await teardown();
    }
  });

  it('任务撤销后调用被拒绝（未知端点 404 语义）', async () => {
    const { registry } = setup();
    try {
      const { taskToken } = registry.createTask('owner', 'book', 1);
      registry.setChapter(taskToken, 0, assignment('ch1'));
      registry.revokeTask(taskToken);
      const res = await registry.handleRequest(
        taskToken,
        0,
        new Request('http://localhost/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      );
      expect(res.status).toBe(404);
    } finally {
      await teardown();
    }
  });

  it('跨用户建作用域被拒绝且不影响原作用域', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      const scope = registry.setChapter(taskToken, 0, assignment('ch1'));
      expect(scope).toBeDefined();
      const foreign = registry.setChapter(taskToken, 0, { ...assignment('ch1'), userId: 'intruder' });
      expect(foreign).toBeUndefined();
      const called = await mcpCall(registry, taskToken, 0, 'write_vocabulary', {
        action: 'add',
        items: [{ word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5' }],
      });
      expect(called.ok).toBe(true);
      expect((await scope!.submission.persist()).ok).toBe(true);
      expect(repo.getRawDb().query("SELECT user_id FROM global_vocabulary WHERE word='学校'").get()).toEqual({ user_id: 'owner' });
      expect(repo.getRawDb().query("SELECT count(*) AS n FROM global_vocabulary WHERE user_id='intruder'").get()).toEqual({ n: 0 });
    } finally {
      await teardown();
    }
  });

  it('同一请求 id 重放返回原结果不重复执行；不同内容同 id 报冲突', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      const scope = registry.setChapter(taskToken, 0, assignment('ch1'));
      expect(scope).toBeDefined();
      const args = { action: 'add', items: [{ word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5' }] };
      const first = await scope!.submission.execute('vocabulary', args, 'rpc-1');
      expect(first.ok).toBe(true);
      const replay = await scope!.submission.execute('vocabulary', args, 'rpc-1');
      expect(replay.ok).toBe(true);
      const conflict = await scope!.submission.execute(
        'vocabulary',
        { action: 'add', items: [{ word: '先生', reading: 'せんせい', meaning: '老师', level: 'N5' }] },
        'rpc-1',
      );
      expect(conflict.ok).toBe(false);
      // 冲突只拒绝本次调用，首次合法提交不受影响并可正常保存（无部分污染）。
      const saved = await scope!.submission.persist();
      expect(saved.ok).toBe(true);
      expect(repo.getRawDb().query('SELECT word FROM global_vocabulary ORDER BY word').all()).toEqual([{ word: '学校' }]);
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 1 });
    } finally {
      await teardown();
    }
  });

  it('取消后提交被拒绝且无落库', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      const controller = new AbortController();
      const scope = registry.setChapter(taskToken, 0, { ...assignment('ch1'), signal: controller.signal });
      expect(scope).toBeDefined();
      const called = await mcpCall(registry, taskToken, 0, 'write_vocabulary', {
        action: 'add',
        items: [{ word: '学校', reading: 'がっこう', meaning: '学校', level: 'N5' }],
      });
      expect(called.ok).toBe(true);
      controller.abort();
      const saved = await scope!.submission.persist();
      expect(saved.ok).toBe(false);
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM textbook_vocabulary').get()).toEqual({ n: 0 });
      expect(repo.getRawDb().query('SELECT count(*) AS n FROM global_vocabulary').get()).toEqual({ n: 0 });
    } finally {
      await teardown();
    }
  });

  it('双 Worker 章节隔离：调用各自落到各自章节', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch-a', 'ch-b']);
      const { taskToken } = registry.createTask('owner', 'book', 2);
      const scopeA = registry.setChapter(taskToken, 0, assignment('ch-a'));
      const scopeB = registry.setChapter(taskToken, 1, assignment('ch-b'));
      expect(scopeA).toBeDefined();
      expect(scopeB).toBeDefined();
      const word = (text: string) => ({
        action: 'add',
        items: [{ word: text, reading: 'r', meaning: 'm', level: 'N5' as const }],
      });
      expect((await mcpCall(registry, taskToken, 0, 'write_vocabulary', word('甲'))).ok).toBe(true);
      expect((await mcpCall(registry, taskToken, 1, 'write_vocabulary', word('乙'))).ok).toBe(true);
      expect((await scopeA!.submission.persist()).ok).toBe(true);
      expect((await scopeB!.submission.persist()).ok).toBe(true);
      const rows = repo
        .getRawDb()
        .query('SELECT chapter_id, vocabulary_id FROM textbook_vocabulary ORDER BY chapter_id')
        .all() as Array<{ chapter_id: string; vocabulary_id: string }>;
      expect(rows.map(row => row.chapter_id)).toEqual(['ch-a', 'ch-b']);
      const words = repo.getRawDb().query('SELECT word FROM global_vocabulary ORDER BY word').all();
      expect(words).toEqual([{ word: '乙' }, { word: '甲' }]);
    } finally {
      await teardown();
    }
  });

  it('单类别章节可正常保存（不强制凑齐类别）', async () => {    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      const scope = registry.setChapter(taskToken, 0, assignment('ch1'));
      expect(scope).toBeDefined();
      expect((await mcpCall(registry, taskToken, 0, 'write_articles', {
        action: 'add',
        source: 'TEXTBOOK',
        items: [{ text: '本文' }],
      })).ok).toBe(true);
      const saved = await scope!.submission.persist();
      expect(saved.ok).toBe(true);
      expect(repo.getRawDb().query('SELECT text FROM textbook_articles').all()).toEqual([{ text: '本文' }]);
    } finally {
      await teardown();
    }
  });

  it('零提交时 persist 被拒绝', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      const scope = registry.setChapter(taskToken, 0, assignment('ch1'));
      expect(scope).toBeDefined();
      const saved = await scope!.submission.persist();
      expect(saved.ok).toBe(false);
    } finally {
      await teardown();
    }
  });

  it('并发首次调用串行执行不丢暂存', async () => {
    const { repo, registry } = setup();
    try {
      await seedChapters(repo, ['ch1']);
      const { taskToken } = registry.createTask('owner', 'book', 1);
      const scope = registry.setChapter(taskToken, 0, assignment('ch1'));
      expect(scope).toBeDefined();
      // 先建好会话，并发只发生在工具调用层，不测测试助手的建连竞态。
      await ensureSession(registry, taskToken, 0);
      const word = (text: string) => ({
        action: 'add',
        items: [{ word: text, reading: 'r', meaning: 'm', level: 'N5' as const }],
      });
      const [first, second] = await Promise.all([
        mcpCall(registry, taskToken, 0, 'write_vocabulary', word('甲')),
        mcpCall(registry, taskToken, 0, 'write_vocabulary', word('乙')),
      ]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      const saved = await scope!.submission.persist();
      expect(saved.ok).toBe(true);
      expect(repo.getRawDb().query('SELECT word FROM global_vocabulary ORDER BY word').all()).toEqual([{ word: '乙' }, { word: '甲' }]);
    } finally {
      await teardown();
    }
  });
});
