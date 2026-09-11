import { describe, expect, it } from 'bun:test';
import {
  applyTocExtractStreamEvent,
  cancelledTocExtractProgress,
  initialTocExtractProgress,
  isTocExtractPending,
  narrowTocBaselineStreamEvent,
  shouldAcceptExtractStreamEvent,
  tocExtractStageLabel,
  type NarrowedTocBaselineStreamEvent,
} from '../toc-baseline-stream.js';

/**
 * CMD-LINGUA-P3.3 基线流式进度纯逻辑单测（无 React、无网络）。
 * 锁定：白名单收窄、真实数字累进、无伪造百分比、世代守门。
 */

function batch(completed: number, planned = 6, from = 16, to = 20): NarrowedTocBaselineStreamEvent {
  return { type: 'ocr_batch_completed', plannedPages: planned, completedPages: completed, batchFrom: from, batchTo: to, readBytes: null, totalBytes: null, data: null, code: null, userMessage: null };
}

function simple(type: NarrowedTocBaselineStreamEvent['type'], extra: Partial<NarrowedTocBaselineStreamEvent> = {}): NarrowedTocBaselineStreamEvent {
  return { type, plannedPages: null, completedPages: null, batchFrom: null, batchTo: null, readBytes: null, totalBytes: null, data: null, code: null, userMessage: null, ...extra };
}

describe('narrowTocBaselineStreamEvent', () => {
  it('白名单事件逐行通过（含 parsing 与基线 completed）', () => {
    expect(narrowTocBaselineStreamEvent({ type: 'started', elapsedMs: 1 })?.type).toBe('started');
    expect(narrowTocBaselineStreamEvent({ type: 'parsing', plannedPages: 6, completedPages: 6 })?.type).toBe('parsing');
    const done = narrowTocBaselineStreamEvent({
      type: 'completed',
      plannedPages: 6,
      completedPages: 6,
      result: {
        status: 'ok',
        verdict: 'usable',
        range: { fromPage: 16, toPage: 21 },
        pageCount: 371,
        entries: [
          { title: '第1課', printedPage: 12, level: 1, source: 'text', kind: 'lesson' },
          { title: '第2課', printedPage: 30, level: 1, source: 'text', kind: 'lesson' },
        ],
        diagnostics: { pagesRequested: 6, pagesOcr: 6, linesConsidered: 8, linesDroppedWash: 0, entriesAccepted: 2, entriesRejected: 0, badTitle: 0 },
        pageEvidence: [{ page: 16, excerpt: '第1課 12' }],
        embedded: false,
      },
    });
    expect(done?.data?.verdict).toBe('usable');
    expect(done?.data?.entries.length).toBe(2);
  });

  it('未知 type/形状不对一律 null', () => {
    expect(narrowTocBaselineStreamEvent(null)).toBeNull();
    expect(narrowTocBaselineStreamEvent({ type: 'scoring' })).toBeNull();
    expect(narrowTocBaselineStreamEvent({ type: 'ocr_batch_completed', plannedPages: 6, completedPages: 5 })).toBeNull();
    expect(narrowTocBaselineStreamEvent({ type: 'completed', plannedPages: 6, completedPages: 6, result: { nope: 1 } })).toBeNull();
  });

  it('含禁用键整行丢弃', () => {
    for (const key of ['filePath', 'filename', 'userId', 'markdown', 'title', 'entries', 'url', 'bytes']) {
      expect(narrowTocBaselineStreamEvent({ type: 'started', [key]: 'x' })).toBeNull();
    }
  });
});

describe('applyTocExtractStreamEvent', () => {
  it('真实累计 + parsing 推进，不插值', () => {
    let s = initialTocExtractProgress;
    s = applyTocExtractStreamEvent(s, simple('started'));
    s = applyTocExtractStreamEvent(s, simple('page_count_ready', { plannedPages: 6 }));
    expect(s.plannedPages).toBe(6);
    s = applyTocExtractStreamEvent(s, batch(5));
    expect(s.phase).toBe('ocr');
    expect(s.completedPages).toBe(5);
    s = applyTocExtractStreamEvent(s, batch(6, 6, 21, 21));
    expect(s.completedPages).toBe(6);
    s = applyTocExtractStreamEvent(s, simple('parsing'));
    expect(s.phase).toBe('parsing');
  });

  it('读取阶段推进字节；总量未知只显示已读', () => {
    let s = applyTocExtractStreamEvent(initialTocExtractProgress, simple('started'));
    s = applyTocExtractStreamEvent(s, simple('input_read_started'));
    expect(s.phase).toBe('input_read');
    s = applyTocExtractStreamEvent(s, simple('input_read_progress', { readBytes: 4194304, totalBytes: 20971520 }));
    expect(s.readBytes).toBe(4194304);
    expect(tocExtractStageLabel(s)).toContain('4.0 MB / 20.0 MB');
  });

  it('终态后忽略后续事件', () => {
    const done = applyTocExtractStreamEvent(initialTocExtractProgress, {
      type: 'completed', plannedPages: 6, completedPages: 6, batchFrom: null, batchTo: null, readBytes: null, totalBytes: null,
      data: { status: 'empty', verdict: 'empty', range: { fromPage: 16, toPage: 21 }, pageCount: 371, entries: [], diagnostics: { pagesRequested: 6, pagesOcr: 0, linesConsidered: 0, linesDroppedWash: 0, entriesAccepted: 0, entriesRejected: 0, badTitle: 0 }, pageEvidence: [], embedded: false },
      code: null, userMessage: null,
    });
    expect(done.phase).toBe('done');
    expect(applyTocExtractStreamEvent(done, batch(6))).toBe(done);
    expect(isTocExtractPending(done)).toBe(false);
    expect(isTocExtractPending(cancelledTocExtractProgress)).toBe(false);
    expect(isTocExtractPending({ ...initialTocExtractProgress, started: true, phase: 'ocr' })).toBe(true);
  });

  it('ocr 文案只报真实数字，无百分比', () => {
    const label = tocExtractStageLabel({ ...initialTocExtractProgress, started: true, phase: 'ocr', plannedPages: 6, completedPages: 5, batchFrom: 16, batchTo: 20 });
    expect(label).toContain('5/6');
    expect(label).toContain('第 16–20 页批次完成');
    expect(label).not.toContain('%');
  });
});

describe('shouldAcceptExtractStreamEvent', () => {
  it('同代未终结才接受', () => {
    expect(shouldAcceptExtractStreamEvent(1, 1, false)).toBe(true);
    expect(shouldAcceptExtractStreamEvent(1, 2, false)).toBe(false);
    expect(shouldAcceptExtractStreamEvent(1, 1, true)).toBe(false);
  });
});
