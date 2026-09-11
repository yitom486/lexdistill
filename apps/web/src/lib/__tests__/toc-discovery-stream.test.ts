import { describe, expect, it } from 'bun:test';
import {
  applyTocStreamEvent,
  cancelledTocDiscoverProgress,
  initialTocDiscoverProgress,
  isTocDiscoverPending,
  narrowTocStreamEvent,
  shouldAcceptStreamEvent,
  tocDiscoverStageLabel,
  type NarrowedTocStreamEvent,
} from '../toc-discovery-stream.js';

/**
 * CMD-LINGUA-P2.1 流式进度纯逻辑单测（无 React、无网络）。
 * 锁定：白名单收窄、真实数字累进、无伪造百分比、世代守门。
 */

function batch(completed: number, planned = 30, from = 1, to = 5): NarrowedTocStreamEvent {
  return { type: 'ocr_batch_completed', plannedPages: planned, completedPages: completed, batchFrom: from, batchTo: to, readBytes: null, totalBytes: null, data: null, code: null, userMessage: null };
}

function simple(type: NarrowedTocStreamEvent['type'], extra: Partial<NarrowedTocStreamEvent> = {}): NarrowedTocStreamEvent {
  return { type, plannedPages: null, completedPages: null, batchFrom: null, batchTo: null, readBytes: null, totalBytes: null, data: null, code: null, userMessage: null, ...extra };
}

describe('narrowTocStreamEvent', () => {
  it('白名单事件逐行通过', () => {
    expect(narrowTocStreamEvent({ type: 'started', elapsedMs: 3 })?.type).toBe('started');
    expect(narrowTocStreamEvent({ type: 'page_count_ready', plannedPages: 30 })?.plannedPages).toBe(30);
    const done = narrowTocStreamEvent({
      type: 'completed',
      plannedPages: 30,
      completedPages: 30,
      result: { status: 'found', candidates: [{ fromPage: 2, toPage: 4, score: 12 }], pageCount: 100, pagesScanned: [1, 2, 3], embedded: false },
    });
    expect(done?.data?.status).toBe('found');
    const failed = narrowTocStreamEvent({ type: 'failed', code: 'E_PDF_PARSE', userMessage: '探测失败' });
    expect(failed?.userMessage).toBe('探测失败');
  });

  it('未知 type/形状不对一律 null', () => {
    expect(narrowTocStreamEvent(null)).toBeNull();
    expect(narrowTocStreamEvent({ type: 'progress_99' })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'ocr_batch_completed', plannedPages: 30, completedPages: 5 })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'ocr_batch_completed', plannedPages: 30, completedPages: 35, batchFrom: 1, batchTo: 5 })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'completed', plannedPages: 30, completedPages: 30, result: { nope: 1 } })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'failed', code: '', userMessage: 'x' })).toBeNull();
  });

  it('含禁用键整行丢弃（路径/正文/标题/userId/模型输出）', () => {
    for (const key of ['filePath', 'filename', 'userId', 'markdown', 'title', 'folio', 'entries', 'model', 'url', 'bytes']) {
      expect(narrowTocStreamEvent({ type: 'started', [key]: 'x' })).toBeNull();
    }
  });
});

describe('applyTocStreamEvent', () => {
  it('真实累计：5→10，不插值不估算', () => {
    let s = initialTocDiscoverProgress;
    s = applyTocStreamEvent(s, simple('started'));
    s = applyTocStreamEvent(s, simple('page_count_ready', { plannedPages: 30 }));
    expect(s.plannedPages).toBe(30);
    expect(s.completedPages).toBe(0);
    s = applyTocStreamEvent(s, batch(5));
    expect(s.phase).toBe('ocr');
    expect(s.completedPages).toBe(5);
    s = applyTocStreamEvent(s, batch(10, 30, 6, 10));
    expect(s.completedPages).toBe(10);
    expect(s.batchFrom).toBe(6);
    expect(s.batchTo).toBe(10);
  });

  it('runtime 下载标志只由服务端事件置位', () => {
    let s = initialTocDiscoverProgress;
    expect(s.runtimeDownloading).toBe(false);
    s = applyTocStreamEvent(s, simple('runtime_check'));
    expect(s.runtimeDownloading).toBe(false);
    s = applyTocStreamEvent(s, simple('runtime_download_started'));
    expect(s.runtimeDownloading).toBe(true);
  });

  it('终态后忽略后续事件（迟到 completed 不推进）', () => {
    const done = applyTocStreamEvent(initialTocDiscoverProgress, {
      type: 'completed', plannedPages: 30, completedPages: 30, batchFrom: null, batchTo: null,
      readBytes: null, totalBytes: null,
      data: { status: 'not-found', candidates: [], pageCount: 12, pagesScannedCount: 12, embedded: false, outlineQuality: 'none' },
      code: null, userMessage: null,
    });
    expect(done.phase).toBe('done');
    expect(applyTocStreamEvent(done, batch(30))).toBe(done);
    expect(applyTocStreamEvent(cancelledTocDiscoverProgress, batch(5))).toBe(cancelledTocDiscoverProgress);
  });

  it('pending 判定：done/cancelled/failed 均不在跑', () => {
    expect(isTocDiscoverPending(null)).toBe(false);
    expect(isTocDiscoverPending(initialTocDiscoverProgress)).toBe(false);
    expect(isTocDiscoverPending({ ...initialTocDiscoverProgress, started: true, phase: 'ocr' })).toBe(true);
    expect(isTocDiscoverPending(cancelledTocDiscoverProgress)).toBe(false);
    expect(isTocDiscoverPending({ ...initialTocDiscoverProgress, started: true, phase: 'done' })).toBe(false);
    expect(isTocDiscoverPending({ ...initialTocDiscoverProgress, started: true, phase: 'failed' })).toBe(false);
  });
});

describe('tocDiscoverStageLabel', () => {
  it('ocr 阶段只报真实数字与真实批次，无百分比', () => {
    const label = tocDiscoverStageLabel({ ...initialTocDiscoverProgress, started: true, phase: 'ocr', plannedPages: 30, completedPages: 5, batchFrom: 1, batchTo: 5 });
    expect(label).toContain('5/30');
    expect(label).toContain('第 1–5 页批次完成');
    expect(label).not.toContain('%');
  });

  it('计划未知时不编造分母', () => {
    const label = tocDiscoverStageLabel({ ...initialTocDiscoverProgress, started: true, phase: 'ocr' });
    expect(label).not.toContain('/');
    expect(label).not.toContain('%');
  });
});

describe('shouldAcceptStreamEvent', () => {
  it('同代未终结才接受；取消换代后迟到一律丢弃', () => {
    expect(shouldAcceptStreamEvent(1, 1, false)).toBe(true);
    expect(shouldAcceptStreamEvent(1, 2, false)).toBe(false);
    expect(shouldAcceptStreamEvent(1, 1, true)).toBe(false);
  });
});

describe('P2.1a input_read 事件', () => {
  it('收窄：progress/ready 通过，缺 readBytes 或倒挂拒绝', () => {
    const p = narrowTocStreamEvent({ type: 'input_read_progress', readBytes: 262144, totalBytes: 1048576, elapsedMs: 5 });
    expect(p?.readBytes).toBe(262144);
    expect(p?.totalBytes).toBe(1048576);
    expect(narrowTocStreamEvent({ type: 'input_read_started', elapsedMs: 1 })?.type).toBe('input_read_started');
    const ready = narrowTocStreamEvent({ type: 'input_read_ready', readBytes: 1048576, totalBytes: 1048576, elapsedMs: 9 });
    expect(ready?.type).toBe('input_read_ready');
    // totalBytes 不可靠时允许 null（只显示已读量）
    expect(narrowTocStreamEvent({ type: 'input_read_ready', readBytes: 100, totalBytes: null })?.totalBytes).toBeNull();
    expect(narrowTocStreamEvent({ type: 'input_read_progress', totalBytes: 100 })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'input_read_progress', readBytes: 200, totalBytes: 100 })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'input_read_progress', readBytes: -1, totalBytes: 100 })).toBeNull();
  });

  it('禁用键：filePath/path/filename 整行丢弃', () => {
    expect(narrowTocStreamEvent({ type: 'input_read_started', filePath: 'C:\\x.pdf' })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'input_read_progress', readBytes: 1, totalBytes: 2, path: '/x' })).toBeNull();
    expect(narrowTocStreamEvent({ type: 'input_read_ready', readBytes: 2, totalBytes: 2, filename: 'a.pdf' })).toBeNull();
  });

  it('reducer：读取阶段推进字节，ready 后进入后续阶段', () => {
    let s = applyTocStreamEvent(initialTocDiscoverProgress, simple('started'));
    s = applyTocStreamEvent(s, simple('input_read_started'));
    expect(s.phase).toBe('input_read');
    expect(s.readBytes).toBe(0);
    s = applyTocStreamEvent(s, simple('input_read_progress', { readBytes: 262144, totalBytes: 1048576 }));
    expect(s.readBytes).toBe(262144);
    expect(s.totalBytes).toBe(1048576);
    s = applyTocStreamEvent(s, simple('input_read_progress', { readBytes: 524288, totalBytes: 1048576 }));
    expect(s.readBytes).toBe(524288);
    s = applyTocStreamEvent(s, simple('page_count_ready', { plannedPages: 30 }));
    expect(s.phase).toBe('page_count');
  });

  it('文案：X / Y MB 真实数字；总量未知只显示已读；永无百分比', () => {
    const full = tocDiscoverStageLabel({ ...initialTocDiscoverProgress, started: true, phase: 'input_read', readBytes: 524288, totalBytes: 1048576 });
    expect(full).toContain('正在读取本地 PDF');
    expect(full).toContain('0.5 MB / 1.0 MB');
    expect(full).not.toContain('%');
    const unknown = tocDiscoverStageLabel({ ...initialTocDiscoverProgress, started: true, phase: 'input_read', readBytes: 524288, totalBytes: null });
    expect(unknown).toContain('已读 0.5 MB');
    expect(unknown).not.toContain('%');
  });

  it('读取阶段属于 pending（取消按钮可见）', () => {
    expect(isTocDiscoverPending({ ...initialTocDiscoverProgress, started: true, phase: 'input_read' })).toBe(true);
  });
});
