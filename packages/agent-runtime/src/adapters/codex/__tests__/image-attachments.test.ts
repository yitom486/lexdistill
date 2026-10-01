import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import type { AgentEvent } from '@study-studio/agent-runtime';
import { ok, type BusinessError, type Result } from '@study-studio/shared';
import type { CodexAppServerConnection } from '../app-server-client.js';
import type { CodexTurnInputItem } from '../app-server-protocol.js';
import { CodexAdapter, CodexSession } from '../codex-adapter.js';
import {
  MAX_PNG_BYTES_PER_TURN,
  buildTurnInputItems,
  materializePngAttachments,
} from '../image-attachments.js';

/**
 * CMD-LINGUA-P4B：内存 PNG → localImage 全链路（无真实付费模型）。
 * fake connection 只实现会话所需的最小形状，经 `as unknown as` 断言
 *（仓库既有测试桩先例），绝不触达真实 App Server 进程。
 */

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

interface FakeTurn {
  message: string;
  imagePaths?: string[];
  seenExisting?: boolean[];
}

function makeFakeConnection(opts: {
  onTurn?: (turn: FakeTurn) => void;
  failWith?: unknown;
  hangUntilAbort?: boolean;
} = {}): CodexAppServerConnection {
  const fake = {
    setToolCallHandler(_handler: unknown): void {},
    setApprovalHandler(_handler: unknown): void {},
    getActiveTurnId(): string | null {
      return null;
    },
    async interrupt(): Promise<Result<void, BusinessError>> {
      return ok(undefined);
    },
    async *runTurn(params: {
      threadId: string;
      message: string;
      signal?: AbortSignal;
      imagePaths?: string[];
    }): AsyncGenerator<AgentEvent, void, unknown> {
      const imagePaths = params.imagePaths ?? [];
      opts.onTurn?.({
        message: params.message,
        ...(imagePaths.length > 0
          ? {
              imagePaths: [...imagePaths],
              seenExisting: imagePaths.map((p) => existsSync(p)),
            }
          : {}),
      });
      if (opts.failWith !== undefined) throw opts.failWith;
      if (opts.hangUntilAbort) {
        yield { type: 'TEXT_DELTA', delta: 'partial' };
        await new Promise<void>((resolve) => {
          if (params.signal?.aborted) resolve();
          else params.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
      }
      yield { type: 'TEXT_DELTA', delta: '{"entries":[],"warnings":[]}' };
      yield { type: 'COMPLETED', finalOutput: '{"entries":[],"warnings":[]}' };
    },
  };
  return fake as unknown as CodexAppServerConnection;
}

async function drain(
  session: CodexSession,
  input: Parameters<CodexSession['send']>[0]
): Promise<AgentEvent[]> {
  const seen: AgentEvent[] = [];
  for await (const ev of session.send(input)) seen.push(ev);
  return seen;
}

describe('P4B 图片附件（adapters/codex）', () => {
  it('CodexAdapter 明确支持图片输入', () => {
    expect(new CodexAdapter().supportsImageInput()).toBe(true);
  });

  it('超过 8 张附件完整传递；总字节预算超限时不启动模型', async () => {
    const turns: FakeTurn[] = [];
    const session = new CodexSession('s-budget', 'thread-budget', 'u', makeFakeConnection({ onTurn: turn => turns.push(turn) }));
    try {
      await drain(session, { message: '完整章节', attachments: Array.from({ length: 11 }, () => ({ png: PNG })) });
      expect(turns[0]?.imagePaths).toHaveLength(11);
      expect(turns[0]?.seenExisting).toEqual(Array(11).fill(true));
      const seen = await drain(session, { message: '超限', attachments: [{ png: new Uint8Array(MAX_PNG_BYTES_PER_TURN + 1) }] });
      expect(turns).toHaveLength(1);
      expect(seen[0]?.type).toBe('ERROR');
    } finally { await session.close(); }
  });

  it('无附件：纯文本 turn 形状不变，不碰文件系统', async () => {
    const turns: FakeTurn[] = [];
    const session = new CodexSession('s1', 'thread-1', 'u1', makeFakeConnection({ onTurn: (t) => turns.push(t) }));
    const seen = await drain(session, { message: 'hi' });
    expect(turns.length).toBe(1);
    expect(turns[0]?.message).toBe('hi');
    expect(turns[0]).not.toHaveProperty('imagePaths');
    expect(seen.some((e) => e.type === 'COMPLETED')).toBe(true);
  });

  it('buildTurnInputItems：文本在前、图片按序 localImage', () => {
    expect(buildTurnInputItems('m', [])).toEqual([{ type: 'text', text: 'm' }]);
    const items: CodexTurnInputItem[] = buildTurnInputItems('m', ['/tmp/a.png', '/tmp/b.png']);
    expect(items).toEqual([
      { type: 'text', text: 'm' },
      { type: 'localImage', path: '/tmp/a.png' },
      { type: 'localImage', path: '/tmp/b.png' },
    ]);
  });

  it('附件精确转 localImage：调用期间文件存在，成功后删除', async () => {
    const turns: FakeTurn[] = [];
    const session = new CodexSession('s1', 'thread-1', 'u1', makeFakeConnection({ onTurn: (t) => turns.push(t) }));
    const seen = await drain(session, {
      message: 'review',
      attachments: [
        { png: PNG, label: 'toc-physical-page-1' },
        { png: PNG, label: 'toc-physical-page-2' },
      ],
    });
    expect(turns.length).toBe(1);
    const turn = turns[0];
    expect(turn?.message).toBe('review');
    const paths = turn?.imagePaths ?? [];
    expect(paths.length).toBe(2);
    // 调用期间两个临时文件都存在
    expect(turn?.seenExisting).toEqual([true, true]);
    // 随机命名且互异
    expect(new Set(paths).size).toBe(2);
    for (const p of paths) expect(p.endsWith('.png')).toBe(true);
    expect(seen.some((e) => e.type === 'COMPLETED')).toBe(true);
    // 会话级生命周期：轮末不删（同线程后轮仍引用），close 时统一删除
    for (const p of paths) expect(existsSync(p)).toBe(true);
    await session.close();
    for (const p of paths) expect(existsSync(p)).toBe(false);
  });

  it('turn 失败：ERROR 事件 + close 后删除（轮末保留）', async () => {
    const turns: FakeTurn[] = [];
    const session = new CodexSession(
      's1',
      'thread-1',
      'u1',
      makeFakeConnection({ onTurn: (t) => turns.push(t), failWith: new Error('boom') })
    );
    const seen = await drain(session, { message: 'review', attachments: [{ png: PNG }] });
    expect(seen.some((e) => e.type === 'ERROR')).toBe(true);
    for (const p of turns[0]?.imagePaths ?? []) expect(existsSync(p)).toBe(true);
    await session.close();
    for (const p of turns[0]?.imagePaths ?? []) expect(existsSync(p)).toBe(false);
  });

  it('取消：interrupt 不删（会话可能继续），close 后统一删除', async () => {
    const turns: FakeTurn[] = [];
    const session = new CodexSession(
      's1',
      'thread-1',
      'u1',
      makeFakeConnection({ onTurn: (t) => turns.push(t), hangUntilAbort: true })
    );
    const gen = session.send({ message: 'review', attachments: [{ png: PNG }] })[Symbol.asyncIterator]();
    const first = await gen.next();
    expect(first.done).toBe(false);
    await session.interrupt();
    while (!(await gen.next()).done) {
      // 排空
    }
    for (const p of turns[0]?.imagePaths ?? []) expect(existsSync(p)).toBe(true);
    await session.close();
    for (const p of turns[0]?.imagePaths ?? []) expect(existsSync(p)).toBe(false);
  });

  it('空附件：明确 ERROR，不发起 turn', async () => {
    let called = 0;
    const session = new CodexSession(
      's1',
      'thread-1',
      'u1',
      makeFakeConnection({ onTurn: () => { called++; } })
    );
    const seen = await drain(session, { message: 'review', attachments: [{ png: new Uint8Array() }] });
    expect(called).toBe(0);
    expect(seen.length).toBe(1);
    const firstEv = seen[0];
    expect(firstEv?.type).toBe('ERROR');
    if (firstEv?.type !== 'ERROR') return;
    expect(firstEv.error.code).toBe('E_INVALID_INPUT');
  });

  it('物化 helper：随机命名、cleanup 幂等', async () => {
    const first = await materializePngAttachments([{ png: PNG }]);
    const second = await materializePngAttachments([{ png: PNG }]);
    if (!first.ok || !second.ok) {
      expect(first.ok && second.ok).toBe(true);
      return;
    }
    const firstPath = first.value.paths[0];
    const secondPath = second.value.paths[0];
    expect(typeof firstPath).toBe('string');
    expect(typeof secondPath).toBe('string');
    expect(firstPath).not.toBe(secondPath);
    if (typeof firstPath !== 'string' || typeof secondPath !== 'string') return;
    expect(existsSync(firstPath)).toBe(true);
    await first.value.cleanup();
    await second.value.cleanup();
    expect(existsSync(firstPath)).toBe(false);
    expect(existsSync(secondPath)).toBe(false);
    // 幂等：重复清理不抛
    await first.value.cleanup();
  });
});
