/**
 * agentpool 管线测试 harness：确定性“模型”脚本 + stub 池驱动。
 *
 * 生产 ask 由真实模型发起；测试里 ask 只计数，内容由 onChapterScope 脚本
 * 经 scope.submission 直接提交（走真实校验、暂存与事务），与提示词文本无关。
 */
import type { AgentPoolDriver, AgentPoolLease } from '@lexdistill/agent-runtime';
import { TextbookMcpRegistry } from '../mcp/textbook-mcp-server.js';
import type { McpChapterScope } from '../mcp/textbook-mcp-scope.js';
import type { LessonExtractionJob } from '../application/lesson-batch-extractor.js';
import type { ContentRepository } from '../ports.js';

export type ChapterScript = (scope: McpChapterScope, job: LessonExtractionJob, attempt: number) => void | Promise<void>;

export interface HarnessDriver extends AgentPoolDriver {
  asks: string[];
  acquires: number[];
  finishes: number[];
  closes: number;
}

export function stubPoolDriver(overrides?: Partial<Pick<HarnessDriver, 'ask' | 'drainEvents' | 'acquire'>>): HarnessDriver {
  const state = { asks: [] as string[], acquires: [] as number[], finishes: [] as number[], closes: 0 };
  // 按真池语义发号：给最小空闲序号，finish 即回收（序号恒小于池大小，端点恒有映射）。
  const held = new Set<number>();
  const baseAsk = async (lease: AgentPoolLease, prompt: string) => {
    state.asks.push(prompt);
    state.acquires.push(lease.agentIndex);
    return { text: 'done', stopReason: 'completed' };
  };
  return {
    ...state,
    acquire: overrides?.acquire ?? (async () => {
      let agentIndex = 0;
      while (held.has(agentIndex)) agentIndex++;
      held.add(agentIndex);
      return { agentIndex };
    }),
    ask: overrides?.ask ?? baseAsk,
    drainEvents: overrides?.drainEvents ?? (() => [{ kind: 'turn_ended', turnId: 'test-turn', atMs: Date.now() }]),
    cancel: () => undefined,
    finish: async (lease: AgentPoolLease) => {
      held.delete(lease.agentIndex);
      state.finishes.push(lease.agentIndex);
    },
    status: () => ({ queued: 0, active: 0, closed: false }),
    close: async () => {
      state.closes += 1;
      return { closeErrors: [], panickedWorkers: 0 };
    },
  };
}

/** 组装管线注入字段：新 registry + stub 驱动 + scope 脚本分发。 */
export function harnessInjection(
  repo: ContentRepository,
  scripts?: Map<string, ChapterScript>,
  driver?: HarnessDriver,
) {
  const registry = new TextbookMcpRegistry({ repo });
  const poolDriver = driver ?? stubPoolDriver();
  return {
    registry,
    driver: poolDriver,
    extra: {
      mcpRegistry: registry,
      gatewayBaseUrl: 'http://127.0.0.1:1',
      poolDriver,
      onChapterScope: async (scope: McpChapterScope, job: LessonExtractionJob, attempt: number) => {
        await scripts?.get(job.lessonId)?.(scope, job, attempt);
      },
    },
  };
}
