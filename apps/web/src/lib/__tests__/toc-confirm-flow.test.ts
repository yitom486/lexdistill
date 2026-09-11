import { describe, expect, it } from 'bun:test';
import {
  TOC_CONFIRM_MAX_PAGES,
  TOC_REVIEW_MAX_PAGES_UI,
  canRequestTocReview,
  decideExtractRequest,
  decideReviewRequest,
  initialTocConfirmState,
  narrowTocBaseline,
  narrowTocDiscovery,
  narrowTocReview,
  summarizeConfirmedEntries,
  toEditableEntries,
  tocConfirmReducer,
  validateTocConfirmRange,
} from '../toc-confirm-flow.js';

/** CMD-LINGUA-P4C：确认流程纯逻辑（无 React、无网络、无存储）。 */

describe('validateTocConfirmRange', () => {
  it('上限锁死 30 页', () => {
    expect(TOC_CONFIRM_MAX_PAGES).toBe(30);
    expect(TOC_REVIEW_MAX_PAGES_UI).toBe(8);
  });

  it('合法范围通过', () => {
    expect(validateTocConfirmRange('1', '30')).toEqual({ ok: true, from: 1, to: 30 });
    expect(validateTocConfirmRange(' 3 ', '3')).toEqual({ ok: true, from: 3, to: 3 });
  });

  it('31 页明确拒绝（超限请求发不出去）', () => {
    const res = validateTocConfirmRange('1', '31');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain('30');
  });

  it('非正整数 / 逆序 / 空串拒绝', () => {
    const cases: Array<[string, string]> = [['0', '5'], ['-1', '5'], ['1.5', '5'], ['abc', '5'], ['5', '3'], ['', ''], ['1', '']];
    for (const [start, end] of cases) {
      expect(validateTocConfirmRange(start, end).ok).toBe(false);
    }
  });
});

describe('decideExtractRequest / decideReviewRequest（守门：ok:false 即零请求）', () => {
  it('无源直接拒绝', () => {
    expect(decideExtractRequest(false, '1', '2').ok).toBe(false);
    expect(decideReviewRequest(false, '1', '2', { embedded: false }).ok).toBe(false);
  });

  it('31 页 extract 拒绝', () => {
    const res = decideExtractRequest(true, '1', '31');
    expect(res.ok).toBe(false);
  });

  it('review：无基线 / embedded / 超 8 页拒绝，合法通过', () => {
    expect(decideReviewRequest(true, '1', '2', null).ok).toBe(false);
    const embedded = decideReviewRequest(true, '1', '2', { embedded: true });
    expect(embedded.ok).toBe(false);
    if (!embedded.ok) expect(embedded.message).toContain('无需 AI 审核');
    const over = decideReviewRequest(true, '1', '9', { embedded: false });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain('8');
    expect(decideReviewRequest(true, '1', '8', { embedded: false })).toEqual({ ok: true, from: 1, to: 8 });
  });

  it('canRequestTocReview 边界', () => {
    expect(canRequestTocReview(1, 8)).toBe(true);
    expect(canRequestTocReview(1, 9)).toBe(false);
    expect(canRequestTocReview(5, 3)).toBe(false);
  });
});

describe('narrowTocDiscovery', () => {
  it('found 单候选通过', () => {
    expect(
      narrowTocDiscovery({ status: 'found', candidates: [{ fromPage: 2, toPage: 4, score: 12 }], pageCount: 100, pagesScanned: [1, 2, 3], embedded: false })
    ).toEqual({ status: 'found', candidates: [{ fromPage: 2, toPage: 4, score: 12 }], pageCount: 100, pagesScannedCount: 3, embedded: false, outlineQuality: 'none' });
  });

  it('ambiguous 多候选通过；数量与状态不符判 null', () => {
    const payload = {
      status: 'ambiguous',
      candidates: [
        { fromPage: 2, toPage: 3, score: 10 },
        { fromPage: 9, toPage: 11, score: 8 },
      ],
      pageCount: 100,
      pagesScanned: [1, 2, 3],
      embedded: false,
    };
    const narrowed = narrowTocDiscovery(payload);
    expect(narrowed?.candidates.length).toBe(2);
    expect(narrowTocDiscovery({ ...payload, status: 'found' })).toBeNull();
    expect(narrowTocDiscovery({ ...payload, status: 'not-found' })).toBeNull();
  });

  it('not-found 空候选 + embedded 透传', () => {
    expect(
      narrowTocDiscovery({ status: 'not-found', candidates: [], pageCount: 50, pagesScanned: [], ocrPages: [], embedded: true })
    ).toEqual({ status: 'not-found', candidates: [], pageCount: 50, pagesScannedCount: 0, embedded: true, outlineQuality: 'usable' });
  });

  it('P2.2 outlineQuality 透传；缺席按 embedded 回填；非法回填 none', () => {
    const base = { status: 'found', candidates: [{ fromPage: 2, toPage: 4, score: 12 }], pageCount: 100, pagesScanned: [1, 2, 3], embedded: false };
    expect(narrowTocDiscovery({ ...base, outlineQuality: 'unusable' })?.outlineQuality).toBe('unusable');
    expect(narrowTocDiscovery({ ...base, outlineQuality: 'usable' })?.outlineQuality).toBe('usable');
    expect(narrowTocDiscovery(base)?.outlineQuality).toBe('none');
    expect(narrowTocDiscovery({ ...base, outlineQuality: 'garbage' })?.outlineQuality).toBe('none');
  });

  it('畸形一律 null', () => {
    expect(narrowTocDiscovery(null)).toBeNull();
    expect(narrowTocDiscovery({ status: 'found', candidates: [], pageCount: 10, pagesScanned: [] })).toBeNull();
    expect(narrowTocDiscovery({ status: 'weird', candidates: [], pageCount: 10, pagesScanned: [] })).toBeNull();
  });
});

describe('narrowTocBaseline / narrowTocReview', () => {
  const baselinePayload = {
    status: 'ok',
    range: { fromPage: 1, toPage: 2 },
    pageCount: 100,
    entries: [{ title: '第1課', printedPage: 12, level: 1, source: 'text', kind: 'lesson' }],
    diagnostics: {
      pagesRequested: 2,
      pagesOcr: 2,
      linesConsidered: 10,
      linesDroppedWash: 1,
      entriesAccepted: 1,
      entriesRejected: 0,
    },
    embedded: false,
  };

  it('基线合法通过；条目非法判 null', () => {
    expect(narrowTocBaseline(baselinePayload)?.entries.length).toBe(1);
    expect(narrowTocBaseline({ ...baselinePayload, entries: [{ title: '', printedPage: 0 }] })).toBeNull();
  });

  it('review 合法通过；embedded 时 draft 必须为 null', () => {
    const payload = {
      embedded: false,
      range: { fromPage: 1, toPage: 2 },
      pageCount: 100,
      baseline: baselinePayload,
      draft: {
        entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' }],
        warnings: ['存疑'],
      },
      diagnostics: { pagesRequested: 2, pagesRendered: 2, baselineEntries: 1, draftEntries: 1 },
    };
    expect(narrowTocReview(payload)?.draft?.warnings).toEqual(['存疑']);
    // 前端收窄容忍多余键（只保形状不崩溃）；字段非法才判 null
    expect(
      narrowTocReview({ ...payload, draft: { entries: [], warnings: [], physicalPage: 5 } })?.draft
    ).toEqual({ entries: [], warnings: [] });
    expect(
      narrowTocReview({
        ...payload,
        draft: { entries: [{ title: 'x', printedPage: 1, level: 3, kind: 'lesson', confidence: 'high' }], warnings: [] },
      })
    ).toBeNull();
    const embeddedPayload = { ...payload, embedded: true, draft: null };
    const narrowed = narrowTocReview(embeddedPayload);
    expect(narrowed?.embedded).toBe(true);
    expect(narrowed?.draft).toBeNull();
    expect(narrowTocReview({ ...payload, embedded: true, draft: { entries: [], warnings: [] } })).toBeNull();
  });
});

describe('tocConfirmReducer（选择/采纳/编辑/确认全本地）', () => {
  it('初始态：未选、未采纳、未确认（重挂载不声称保存）', () => {
    expect(initialTocConfirmState.selectedIndex).toBeNull();
    expect(initialTocConfirmState.adopted).toBeNull();
    expect(initialTocConfirmState.confirmed).toBe(false);
    expect(initialTocConfirmState.confirmedSummary).toBeNull();
  });

  it('手选候选填入范围；越界下标忽略', () => {
    const picked = tocConfirmReducer(initialTocConfirmState, {
      type: 'select-candidate',
      index: 1,
      candidate: { fromPage: 9, toPage: 11, score: 8 },
    });
    expect(picked.selectedIndex).toBe(1);
    expect(picked.startText).toBe('9');
    expect(picked.endText).toBe('11');
    expect(tocConfirmReducer(picked, { type: 'select-candidate', index: -1, candidate: { fromPage: 1, toPage: 1, score: 1 } })).toBe(picked);
  });

  it('采纳播种可编辑条目；确认只产摘要不碰网络', () => {
    const entries = toEditableEntries(
      [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }],
      ['high']
    );
    expect(entries[0]).toMatchObject({ title: '第1課', printedPage: '12', level: 1, kind: 'lesson', confidence: 'high' });
    let state = tocConfirmReducer(initialTocConfirmState, { type: 'adopt', source: 'ai', entries });
    expect(state.adopted).toBe('ai');
    state = tocConfirmReducer(state, { type: 'start-edit' });
    expect(state.editing).toBe(true);
    state = tocConfirmReducer(state, { type: 'update-entry', key: 'toc-edit-0', patch: { title: '第1課（改）' } });
    expect(state.editedEntries[0]?.title).toBe('第1課（改）');
    state = tocConfirmReducer(state, { type: 'confirm', range: { fromPage: 1, toPage: 2 } });
    expect(state.confirmed).toBe(true);
    expect(state.confirmedSummary).toContain('1 条');
    expect(state.confirmedSummary).toContain('AI 草稿');
  });

  it('未采纳确认无效；reset 回到初始', () => {
    expect(tocConfirmReducer(initialTocConfirmState, { type: 'confirm', range: { fromPage: 1, toPage: 2 } })).toBe(
      initialTocConfirmState
    );
    const picked = tocConfirmReducer(initialTocConfirmState, {
      type: 'select-candidate',
      index: 0,
      candidate: { fromPage: 2, toPage: 4, score: 5 },
    });
    expect(tocConfirmReducer(picked, { type: 'reset-flow' })).toEqual(initialTocConfirmState);
  });

  it('确认摘要计数课/节', () => {
    const summary = summarizeConfirmedEntries(
      'ocr',
      { fromPage: 1, toPage: 2 },
      toEditableEntries([
        { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' },
        { title: '文法', printedPage: 13, level: 2, kind: 'section' },
      ])
    );
    expect(summary).toContain('2 条');
    expect(summary).toContain('1 课');
    expect(summary).toContain('OCR 基线');
  });
});
