import { describe, expect, it } from 'bun:test';
import { BusinessError, isOk, ok } from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
import type { DocumentItem } from '@study-studio/protocol';
import type { TextbookAST } from '@study-studio/document-model';
import {
  EnrichJobRegistry,
  type EnrichJobRepo,
  type EnrichJobRunnerDeps,
} from '../modules/library/application/pdf-import/enrich-job-runner.js';

function makeBook(): TextbookAST {
  return {
    id: 'book1',
    language: 'JA',
    title: '测试课本',
    shortTitle: '测试',
    level: 'N5',
    lessons: [
      {
        id: 'l1',
        lessonNumber: 1,
        title: '第 1 課',
        vocabularies: [],
        grammarPoints: [],
        exercises: [],
        dialogues: [{ speaker: '李', japanese: '李です。', chinese: '我是小李。' }],
      },
      {
        id: 'l2',
        lessonNumber: 2,
        title: '第 2 課',
        vocabularies: [],
        grammarPoints: [],
        exercises: [],
        dialogues: [{ speaker: '森', japanese: '森です。', chinese: '我是森。' }],
      },
    ],
  };
}

function makeDoc(book: TextbookAST): DocumentItem {
  return {
    id: 'doc1',
    userId: 'u1',
    title: '测试课本',
    sourceKind: 'user_import',
    language: 'ja',
    content: '',
    astJson: JSON.stringify(book),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** 每课返回一句“课文原词”的 JSON；failLessonIds 命中的课走 ERROR 流 */
function makeAdapter(opts: { failLessonIds?: string[]; hangLessonIds?: string[]; gates?: Map<string, () => void> } = {}): AgentAdapter {
  const mkSession = (lessonId: string): AgentSession => ({
    sessionId: `s-${lessonId}`,
    send: async function* () {
      if (opts.failLessonIds?.includes(lessonId)) {
        yield { type: 'ERROR' as const, error: new BusinessError('E_CODEX_TURN', '模型流错误', 'AGENT_RUNTIME') };
        return;
      }
      if (opts.hangLessonIds?.includes(lessonId)) {
        yield { type: 'TEXT_DELTA' as const, delta: '{"vocabularies":[' };
        await new Promise<void>((resolve) => {
          opts.gates?.set(lessonId, resolve);
        });
        return;
      }
      const word = lessonId === 'l1' ? '李です' : '森です';
      yield {
        type: 'TEXT_DELTA' as const,
        delta: JSON.stringify({
          vocabularies: [
            { kanji: word, kana: word, chinese: '测试', pos: '名词', example: { japanese: `${word}。`, chinese: '测试。' } },
          ],
          grammarPoints: [],
        }),
      };
      yield { type: 'COMPLETED' as const };
    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async () => ok(undefined),
    steer: async () => ok(undefined),
    interrupt: async () => {
      opts.gates?.get(lessonId)?.();
      return ok(undefined);
    },
    close: async () => ok(undefined),
  });
  return {
    id: 'mock',
    name: 'mock',
    createSession: async (params: { sessionId: string }) => {
      const m = /^enrich-(.+)-\d+$/.exec(params.sessionId);
      return ok(mkSession(m?.[1] ?? 'unknown'));
    },
    resumeSession: async () => ok(mkSession('unknown')),
  };
}

function makeRepo(doc: DocumentItem): EnrichJobRepo & { saved: DocumentItem[]; shreds: number; drafts: number } {
  const state = {
    saved: [] as DocumentItem[],
    shreds: 0,
    drafts: 0,
  };
  return {
    // 计数器用 getter：避免 {...state} 把数字快照复制
    get saved() {
      return state.saved;
    },
    get shreds() {
      return state.shreds;
    },
    get drafts() {
      return state.drafts;
    },
    getDocumentById: async (id: string) => ok(id === doc.id ? { ...doc } : null),
    saveDocument: async (d: DocumentItem) => {
      state.saved.push(d);
      return ok(d);
    },
    // 显式 atomic fake：一次调用记一次保存 + 一次 shred（与生产 saveCanonicalAst 同语义）
    saveCanonicalAst: async (d: Omit<DocumentItem, 'astJson'>, book: { lessons: unknown[] }) => {
      const full = { ...d, astJson: JSON.stringify(book) } as DocumentItem;
      state.saved.push(full);
      state.shreds += 1;
      return ok(full);
    },
    // P2-2a：生产即完整 repo 门面；fake 不投影（persistLesson 的 hook 由 pdf 单测覆盖）。
    projectLinesSegments: async (_userId: string, _documentId: string) => {
      return ok({ inserted: 0, skipped: 0 });
    },
    shredDocument: async () => {
      state.shreds += 1;
      return ok({ lessons: 1, vocab: 1, lines: 1, mappedEntries: 0, unmapped: 0 });
    },
    proposeCardDrafts: async (inputs: Array<{ headword: string }>) => {
      state.drafts += inputs.length;
      return ok(inputs.map((_, i) => ({ draftId: `d${i}` })));
    },
  };
}

async function waitFor(
  registry: EnrichJobRegistry,
  jobId: string,
  terminal: boolean,
  timeoutMs = 15_000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const snap = registry.get(jobId);
    if (snap && (terminal ? snap.status !== 'running' : true)) return;
    if (Date.now() - start > timeoutMs) throw new Error(`等待任务超时: ${jobId}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('EnrichJobRegistry', () => {
  it('整本跑通：逐课落库+终态 done', async () => {
    const registry = new EnrichJobRegistry();
    const repo = makeRepo(makeDoc(makeBook()));
    const emitted: Array<{ type: string }> = [];
    const deps: EnrichJobRunnerDeps = {
      repo,
      adapter: makeAdapter(),
      emitToSession: (_sid, type) => {
        emitted.push({ type });
      },
    };
    const started = registry.start(deps, { userId: 'u1', documentId: 'doc1', sessionId: 'sess1' });
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    await waitFor(registry, started.value.jobId, true);
    const snap = registry.get(started.value.jobId)!;
    expect(snap.status).toBe('done');
    expect(snap.doneLessons).toBe(2);
    expect(snap.totalLessons).toBe(2);
    expect(snap.vocabularies).toBe(2);
    expect(snap.failed).toEqual([]);
    // 逐课落库：两课各一次 save + shred，草稿两条
    expect(repo.saved).toHaveLength(2);
    expect(repo.shreds).toBe(2);
    expect(repo.drafts).toBe(2);
    // WS：progress 若干 + completed 收尾
    expect(emitted[emitted.length - 1]?.type).toBe('import.enrich.completed');
    expect(emitted.some((e) => e.type === 'import.enrich.progress')).toBe(true);
  });

  it('单课失败不中断整本：failed 记录+其余课照存', async () => {
    const registry = new EnrichJobRegistry();
    const repo = makeRepo(makeDoc(makeBook()));
    const deps: EnrichJobRunnerDeps = {
      repo,
      adapter: makeAdapter({ failLessonIds: ['l2'] }),
      emitToSession: () => {},
    };
    const started = registry.start(deps, { userId: 'u1', documentId: 'doc1' });
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    await waitFor(registry, started.value.jobId, true);
    const snap = registry.get(started.value.jobId)!;
    // 两轮都失败（首轮 ERROR + 修复轮 ERROR）→ l2 进 failed，任务照 done
    expect(snap.status).toBe('done');
    expect(snap.failed).toHaveLength(1);
    expect(snap.failed[0]?.lessonId).toBe('l2');
    expect(repo.saved).toHaveLength(1);
  });

  it('取消：课间即停，已完成课保留', async () => {
    const registry = new EnrichJobRegistry();
    const repo = makeRepo(makeDoc(makeBook()));
    const gates = new Map<string, () => void>();
    const deps: EnrichJobRunnerDeps = {
      repo,
      adapter: makeAdapter({ hangLessonIds: ['l1'], gates }),
      emitToSession: () => {},
    };
    const started = registry.start(deps, { userId: 'u1', documentId: 'doc1' });
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    // 等 l1 挂到 gate 上（在途轮次真实存在）再取消，避免 abort 落在 send 启动前
    const t0 = Date.now();
    for (;;) {
      if (gates.has('l1')) break;
      if (Date.now() - t0 > 10_000) throw new Error('l1 未进入在途');
      await new Promise((r) => setTimeout(r, 25));
    }
    const cancelled = registry.cancel(started.value.jobId);
    expect(isOk(cancelled)).toBe(true);
    await waitFor(registry, started.value.jobId, true);
    const snap = registry.get(started.value.jobId)!;
    expect(snap.status).toBe('cancelled');
    expect(gates.has('l1')).toBe(true);
  });

  it('同一文档双启动返回同一 running 任务', () => {
    const registry = new EnrichJobRegistry();
    const repo = makeRepo(makeDoc(makeBook()));
    const deps: EnrichJobRunnerDeps = {
      repo,
      adapter: makeAdapter({ hangLessonIds: ['l1'], gates: new Map() }),
      emitToSession: () => {},
    };
    const a = registry.start(deps, { userId: 'u1', documentId: 'doc1' });
    const b = registry.start(deps, { userId: 'u1', documentId: 'doc1' });
    expect(isOk(a) && isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(b.value.jobId).toBe(a.value.jobId);
    registry.cancel(a.value.jobId);
  });

  it('并发：concurrency=2 双路并行，结果照收齐', async () => {
    const book = makeBook();
    book.lessons.push(
      {
        id: 'l3',
        lessonNumber: 3,
        title: '第 3 課',
        vocabularies: [],
        grammarPoints: [],
        exercises: [],
        dialogues: [{ speaker: '森', japanese: '森です。', chinese: '我是森。' }],
      },
      {
        id: 'l4',
        lessonNumber: 4,
        title: '第 4 課',
        vocabularies: [],
        grammarPoints: [],
        exercises: [],
        dialogues: [{ speaker: '王', japanese: '森です。', chinese: '我是森。' }],
      }
    );
    const registry = new EnrichJobRegistry();
    const repo = makeRepo(makeDoc(book));
    let inFlight = 0;
    let peak = 0;
    const base = makeAdapter();
    const timed: AgentAdapter = {
      ...base,
      createSession: async (...args: Parameters<AgentAdapter['createSession']>) => {
        const res = await base.createSession(...args);
        if (!isOk(res)) return res;
        const session = res.value;
        return ok({
          ...session,
          send: async function* (...sendArgs: Parameters<AgentSession['send']>) {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            try {
              await new Promise((r) => setTimeout(r, 30));
              yield* session.send(...sendArgs);
            } finally {
              inFlight -= 1;
            }
          },
        });
      },
    };
    const deps: EnrichJobRunnerDeps = { repo, adapter: timed, emitToSession: () => {} };
    const started = registry.start(deps, { userId: 'u1', documentId: 'doc1', concurrency: 2 });
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    await waitFor(registry, started.value.jobId, true);
    const snap = registry.get(started.value.jobId)!;
    expect(snap.status).toBe('done');
    expect(snap.doneLessons).toBe(4);
    expect(snap.vocabularies).toBe(4);
    expect(snap.failed).toEqual([]);
    expect(peak).toBe(2);
    expect(repo.saved).toHaveLength(4);
  });

  it('文档不存在/无归属：任务直接 failed（用户可读原因）', async () => {
    const registry = new EnrichJobRegistry();
    const repo = makeRepo(makeDoc(makeBook()));
    const deps: EnrichJobRunnerDeps = {
      repo,
      adapter: makeAdapter(),
      emitToSession: () => {},
    };
    const started = registry.start(deps, { userId: 'u1', documentId: 'doc-missing' });
    expect(isOk(started)).toBe(true);
    if (!isOk(started)) return;
    await waitFor(registry, started.value.jobId, true);
    const snap = registry.get(started.value.jobId)!;
    expect(snap.status).toBe('failed');
    expect(snap.error).toBeTruthy();
  });
});
