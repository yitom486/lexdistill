import { describe, expect, it } from 'bun:test';
import {
  decideChunkExecute,
  decideSessionPrepare,
  narrowExecuteResult,
  narrowPrepareResult,
  narrowSessionView,
  sessionChunkStatusLabel,
  sessionStatusLabel,
  type SessionView,
} from '../toc-import-session-flow.js';
import type { PreviewResponseData } from '../toc-anchor-flow.js';

/** CMD-LINGUA-P5D2D：session 纯逻辑（无 React、无网络、无存储）。 */

function greenPreview(): PreviewResponseData {
  return {
    pageCount: 100,
    lessons: [
      { lessonIndex: 0, title: '第1課', printedStart: 12, physicalStart: 17, physicalEnd: 30, status: 'mapped', reason: 'verified-interval', regionId: 'v', offsetUsed: 5 },
      { lessonIndex: 1, title: '第2課', printedStart: 31, physicalStart: 36, physicalEnd: 40, status: 'mapped', reason: 'verified-interval', regionId: 'v', offsetUsed: 5 },
    ],
    regions: [],
    chunks: [
      { lessonIndex: 0, title: '第1課', chunkIndex: 0, physicalFrom: 17, physicalTo: 30 },
      { lessonIndex: 1, title: '第2課', chunkIndex: 0, physicalFrom: 36, physicalTo: 40 },
    ],
    diagnostics: { lessonCount: 2, mappedCount: 2, unresolvedCount: 0, regionCount: 1, chunksPlanned: 2, lessonsWithoutEnd: 0 },
    fingerprint: 'fp-green',
  };
}

function sessionView(overrides: Partial<SessionView> = {}): SessionView {  return {
    sessionId: 's1',
    status: 'prepared',
    documentId: null,
    totalChunks: 2,
    completedChunks: 0,
    chunks: [
      { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', range: { fromPage: 17, toPage: 30 }, status: 'prepared', attempts: 0 },
      { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 }, status: 'prepared', attempts: 0 },
    ],
    next: { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', range: { fromPage: 17, toPage: 30 } },
    ...overrides,
  };
}

describe('decideSessionPrepare', () => {
  it('全绿通过；无效/缺指纹/未映射/无终点/空计划全拒绝', () => {
    expect(decideSessionPrepare(greenPreview(), true)).toEqual({ ok: true });
    expect(decideSessionPrepare(null, true).ok).toBe(false);
    expect(decideSessionPrepare(greenPreview(), false).ok).toBe(false);
    expect(decideSessionPrepare({ ...greenPreview(), fingerprint: '' }, true).ok).toBe(false);
    const unresolved = greenPreview();
    unresolved.diagnostics.unresolvedCount = 1;
    expect(decideSessionPrepare(unresolved, true).ok).toBe(false);
    const noEnd = greenPreview();
    noEnd.diagnostics.lessonsWithoutEnd = 1;
    expect(decideSessionPrepare(noEnd, true).ok).toBe(false);
    expect(decideSessionPrepare({ ...greenPreview(), lessons: [], chunks: [] }, true).ok).toBe(false);
  });
});

describe('decideChunkExecute（只认服务端 next）', () => {
  it('首课经 execute-first 通过', () => {
    const res = decideChunkExecute(sessionView(), greenPreview(), true, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.via).toBe('execute-first');
    expect(res.lesson.title).toBe('第1課');
  });

  it('非 next ordinal 拒绝（不自动不跳过）', () => {
    expect(decideChunkExecute(sessionView(), greenPreview(), true, 1).ok).toBe(false);
  });

  it('终态全拒绝并给原因', () => {
    for (const status of ['target_deleted', 'failed', 'cancelled', 'completed'] as const) {
      const res = decideChunkExecute(sessionView({ status, next: null }), greenPreview(), true, 0);
      expect(res.ok).toBe(false);
    }
    const next = { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', range: { fromPage: 17, toPage: 30 } };
    const target = decideChunkExecute(sessionView({ status: 'target_deleted', next }), greenPreview(), true, 0);
    expect(target.ok).toBe(false);
    if (target.ok) return;
    expect(target.message).toContain('不可恢复');
  });

  it('running 有 documentId 走 execute-next；缺 target 拒绝', () => {
    const running = sessionView({
      status: 'running',
      documentId: 'doc_1',
      completedChunks: 1,
      chunks: [
        { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', range: { fromPage: 17, toPage: 30 }, status: 'completed', attempts: 1 },
        { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 }, status: 'prepared', attempts: 0 },
      ],
      next: { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 } },
    });
    const res = decideChunkExecute(running, greenPreview(), true, 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.via).toBe('execute-next');
    const noTarget = decideChunkExecute(sessionView({ status: 'running', documentId: null }), greenPreview(), true, 0);
    expect(noTarget.ok).toBe(false);
  });

  it('long/multi lesson blocker', () => {
    const preview = greenPreview();
    preview.chunks = [
      { lessonIndex: 0, title: '第1課', chunkIndex: 0, physicalFrom: 17, physicalTo: 30 },
      { lessonIndex: 0, title: '第1課', chunkIndex: 1, physicalFrom: 31, physicalTo: 31 },
    ];
    const res = decideChunkExecute(sessionView(), preview, true, 0);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain('完整 chunk');
  });
});

describe('labels', () => {
  it('状态中性中文齐备', () => {
    for (const s of ['prepared', 'running', 'completed', 'failed', 'cancelled', 'target_deleted', 'weird']) {
      expect(sessionStatusLabel(s).length).toBeGreaterThan(0);
    }
    for (const s of ['prepared', 'running', 'completed', 'failed', 'weird']) {
      expect(sessionChunkStatusLabel(s).length).toBeGreaterThan(0);
    }
    expect(sessionStatusLabel('target_deleted')).toContain('不可恢复');
  });
});

describe('narrowSessionView / narrowPrepareResult / narrowExecuteResult', () => {
  const viewPayload = {
    sessionId: 's1',
    status: 'running',
    documentId: 'doc_1',
    totalChunks: 2,
    completedChunks: 1,
    chunks: [
      { ordinal: 0, lessonIndex: 0, lessonTitle: '第1課', range: { fromPage: 17, toPage: 30 }, status: 'completed', attempts: 1 },
      { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 }, status: 'prepared', attempts: 0 },
    ],
    next: { ordinal: 1, lessonIndex: 1, lessonTitle: '第2課', range: { fromPage: 36, toPage: 40 } },
    extraSecret: 'drop-me',
  };

  it('白名单收窄，多余丢弃，畸形 null', () => {
    const narrowed = narrowSessionView(viewPayload);
    expect(narrowed?.next?.ordinal).toBe(1);
    expect(narrowed).not.toHaveProperty('extraSecret');
    expect(narrowSessionView({ ...viewPayload, status: 'weird' })).toBeNull();
    expect(narrowSessionView(null)).toBeNull();
  });

  it('prepare/execute 结果收窄', () => {
    expect(narrowPrepareResult({ session: { id: 's1', status: 'prepared' }, reused: true, chunks: [] })?.reused).toBe(true);
    expect(narrowPrepareResult({})).toBeNull();
    const exec = {
      documentId: 'doc_1', lessonId: 'l1', lessonTitle: '第1課',
      range: { fromPage: 17, toPage: 30 }, pageCount: 100, stats: { lessons: 1, dialogues: 2, chunks: 1 },
    };
    expect(narrowExecuteResult(exec)?.documentId).toBe('doc_1');
    expect(narrowExecuteResult({})).toBeNull();
  });
});
