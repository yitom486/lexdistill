import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TocReviewPanelView, type TocReviewPanelViewProps } from '../TocReviewPanel.js';
import type { TocBaselineData, TocDiscoveryData, TocReviewData } from '../../lib/toc-confirm-flow.js';

/**
 * CMD-LINGUA-P4C：确认面板纯视图 SSR 断言（无 DOM、无网络）。
 * 交互守门由 lib 单测覆盖；此处锁定各状态文案、并排结构与诚实声明。
 */

function baseProps(overrides: Partial<TocReviewPanelViewProps> = {}): TocReviewPanelViewProps {
  return {
    hasSource: true,
    discovering: false,
    discoverProgress: null,
    discoverError: null,
    discover: null,
    selectedIndex: null,
    startText: '',
    endText: '',
    rangeError: null,
    extractDisabled: true,
    extractDisabledReason: null,
    extracting: false,
    extractProgress: null,
    onCancelExtract: () => {},
    extractError: null,
    baseline: null,
    reviewDisabled: true,
    reviewDisabledReason: '先提取目录基线',
    reviewSizeHint: null,
    reviewing: false,
    reviewError: null,
    review: null,
    adopted: null,
    editing: false,
    editedEntries: [],
    confirmed: false,
    confirmedSummary: null,
    adoptDisabled: false,
    onStartManual: () => {},
    onAddEntry: () => {},
    onRemoveEntry: () => {},
    confirmDisabled: false,
    onDiscover: () => {},
    onCancelDiscover: () => {},
    onSelectCandidate: () => {},
    onStartChange: () => {},
    onEndChange: () => {},
    onExtract: () => {},
    onReview: () => {},
    onAdopt: () => {},
    onStartEdit: () => {},
    onUpdateEntry: () => {},
    onConfirm: () => {},
    ...overrides,
  };
}

function render(props: Partial<TocReviewPanelViewProps> = {}): string {
  return renderToStaticMarkup(TocReviewPanelView(baseProps(props)));
}

const AMBIGUOUS: TocDiscoveryData = {
  status: 'ambiguous',
  candidates: [
    { fromPage: 2, toPage: 4, score: 12 },
    { fromPage: 9, toPage: 11, score: 8 },
  ],
  pageCount: 100,
  pagesScannedCount: 12,
  embedded: false,
  outlineQuality: 'none',
};

const BASELINE: TocBaselineData = {
  status: 'ok',
  verdict: 'thin',
  range: { fromPage: 2, toPage: 4 },
  pageCount: 100,
  entries: [{ title: '第1課', printedPage: 12, level: 1, source: 'text-fallback', kind: 'lesson' }],
  diagnostics: {
    pagesRequested: 3,
    pagesOcr: 3,
    linesConsidered: 10,
    linesDroppedWash: 1,
    entriesAccepted: 1,
    entriesRejected: 0,
    badTitle: 0,
    entriesFromBlocks: 0,
    unresolvedBlocks: 0,
  },
  pageEvidence: [{ page: 2, excerpt: '第1課 12' }],
  embedded: false,
};

const REVIEW: TocReviewData = {
  embedded: false,
  range: { fromPage: 2, toPage: 4 },
  pageCount: 100,
  baseline: BASELINE,
  draft: {
    entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson', confidence: 'high' }],
    warnings: ['第3页有污渍'],
  },
  reviewStatus: 'ok',
  reviewError: null,
  diagnostics: { pagesRequested: 3, pagesRendered: 3, baselineEntries: 1, draftEntries: 1 },
};

describe('P4C TocReviewPanelView（SSR）', () => {
  it('初始态：有识别入口与诚实声明，不声称已保存', () => {
    const html = render();
    expect(html).toContain('识别目录');
    expect(html).toContain('尚未写入教材');
    expect(html).not.toContain('已保存');
    expect(html).not.toContain('已入库');
    expect(html).not.toContain('已导入');
  });

  it('无源：识别按钮禁用并提示先给 PDF', () => {
    const html = render({ hasSource: false });
    expect(html).toContain('先选择 PDF 文件或填写本机路径');
    expect(html).toContain('disabled');
  });

  it('ambiguous：候选与得分全列，无一预选', () => {
    const html = render({ discover: AMBIGUOUS });
    expect(html).toContain('第 2–4 页');
    expect(html).toContain('第 9–11 页');
    expect(html).toContain('得分 12');
    expect(html).toContain('得分 8');
    expect(html).toContain('手动选一个');
    expect(html).toContain('不会自动选择');
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(2);
    expect(html).not.toContain('aria-pressed="true"');
  });

  it('found 手选后：选中态精确一个', () => {
    const html = render({
      discover: { status: 'found', candidates: [{ fromPage: 2, toPage: 4, score: 12 }], pageCount: 100, pagesScannedCount: 12, embedded: false, outlineQuality: 'none' },
      selectedIndex: 0,
      startText: '2',
      endText: '4',
    });
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html).not.toContain('aria-pressed="false"');
  });

  it('not-found：中性说明 + 手工填写引导', () => {
    const html = render({
      discover: { status: 'not-found', candidates: [], pageCount: 100, pagesScannedCount: 12, embedded: false, outlineQuality: 'none' },
    });
    expect(html).toContain('未找到可信目录');
    expect(html).toContain('手工填写');
  });

  it('embedded：如实说明不触发 AI', () => {
    const html = render({
      discover: { status: 'not-found', candidates: [], pageCount: 100, pagesScannedCount: 0, embedded: true, outlineQuality: 'usable' },
    });
    expect(html).toContain('原生目录');
    expect(html).toContain('不再做基线与 AI 审核');
  });

  it('P2.2 unusable：书签不足以构成目录、已改用 OCR，不再说“无需 OCR”', () => {
    const html = render({
      discover: { status: 'found', candidates: [{ fromPage: 2, toPage: 4, score: 12 }], pageCount: 100, pagesScannedCount: 12, embedded: false, outlineQuality: 'unusable' },
    });
    expect(html).toContain('标题不足以构成教材目录；已改用 OCR 识别');
    expect(html).not.toContain('无需 OCR');
    // 候选照常展示（OCR 已跑完）
    expect(html).toContain('第 2–4 页');
  });

  it('31 页：范围错误展示，提取禁用', () => {
    const html = render({
      startText: '1',
      endText: '31',
      rangeError: '一次最多确认 30 页（当前 31 页），请缩小范围',
      extractDisabled: true,
    });
    expect(html).toContain('一次最多确认 30 页');
    expect(html).toContain('disabled');
  });

  it('基线：条目/印刷页/kind/source/诊断 + 印刷页说明', () => {
    const html = render({ baseline: BASELINE, extractDisabled: false });
    expect(html).toContain('第1課');
    expect(html).toContain('印12页');
    expect(html).toContain('不等于 PDF 物理页');
    expect(html).toContain('接受');
  });

  it('审核结果：基线与草稿并排 + warnings + confidence + 需确认标注', () => {
    const html = render({ baseline: BASELINE, review: REVIEW, reviewDisabled: false, reviewDisabledReason: null });
    expect(html).toContain('OCR 基线');
    expect(html).toContain('AI 草稿');
    expect(html).toContain('需人工确认');
    expect(html).toContain('high');
    expect(html).toContain('第3页有污渍');
    expect(html).not.toContain('已保存');
  });

  it('embedded review：说明不触发 AI', () => {
    const embeddedReview: TocReviewData = { ...REVIEW, embedded: true, draft: null };
    const html = render({ baseline: BASELINE, review: embeddedReview });
    expect(html).toContain('没有触发 AI 审核');
  });

  it('AI 错误：userMessage 原样展示', () => {
    const html = render({ baseline: BASELINE, reviewError: 'AI 审核草稿不是合法 JSON，已丢弃，未写入任何数据' });
    expect(html).toContain('AI 审核草稿不是合法 JSON，已丢弃，未写入任何数据');
  });

  it('确认态：摘要 + 三句诚实声明，不出现已保存', () => {
    const html = render({
      baseline: BASELINE,
      adopted: 'ai',
      editedEntries: [
        { key: 'toc-edit-0', title: '第1課', printedPage: '12', level: 1, kind: 'lesson', confidence: 'high' },
      ],
      confirmed: true,
      confirmedSummary: '已确认1 条（1 课 · 0 节），来源：AI 草稿，目录页第 2–4 页。',
    });
    expect(html).toContain('已确认1 条');
    expect(html).toContain('下一阶段才会生成教材结构');
    expect(html).toContain('尚未写入教材');
    expect(html).toContain('没有调用任何保存接口');
    expect(html).toContain('刷新页面后需重新确认');
    expect(html).not.toContain('已保存');
    expect(html).not.toContain('已入库');
  });

  it('编辑态：标题/页码输入与层级/类型选择齐备', () => {
    const html = render({
      baseline: BASELINE,
      adopted: 'ocr',
      editing: true,
      editedEntries: [
        { key: 'toc-edit-0', title: '第1課', printedPage: '12', level: 1, kind: 'lesson', confidence: null },
      ],
    });
    expect(html).toContain('aria-label="条目标题"');
    expect(html).toContain('aria-label="印刷页码"');
    expect(html).toContain('aria-label="层级"');
    expect(html).toContain('aria-label="类型"');
    expect(html).toContain('确认目录');
  });
});

describe('P3.1B verdict/证据/手动/降级视图（SSR）', () => {
  it('thin：结果不足横幅 + 采用禁用 + 手动填写入口 + 证据折叠', () => {
    const html = render({ baseline: BASELINE, adoptDisabled: true });
    expect(html).toContain('结果不足，不能直接采用');
    expect(html).toContain('不是错误');
    expect(html).toContain('手动填写');
    expect(html).toContain('查看 OCR 原文证据');
    expect(html).toContain('第1課 12');
    expect(html).toContain('disabled');
  });

  it('empty：无条目说明 + 采用禁用', () => {
    const html = render({
      baseline: { ...BASELINE, status: 'empty', verdict: 'empty', entries: [], pageEvidence: [] },
      adoptDisabled: true,
    });
    expect(html).toContain('规则未形成目录条目');
    expect(html).toContain('可让 AI 根据原文与页面图重建草稿');
    expect(html).toContain('手动填写');
  });

  it('usable：无不足横幅（向后兼容旧断言）', () => {
    const html = render({ baseline: { ...BASELINE, verdict: 'usable' }, adoptDisabled: false });
    expect(html).not.toContain('结果不足');
    expect(html).toContain('采用 OCR 基线');
  });

  it('P3.2B 来源三态：几何块/文本/AI草稿 + 印刷非物理 title + 未定位计数', () => {
    const html = render({
      baseline: {
        ...BASELINE,
        verdict: 'usable',
        entries: [
          { title: '第3課', printedPage: 30, level: 1, source: 'geometry-block', kind: 'lesson' },
          { title: '第1課', printedPage: 12, level: 1, source: 'text-fallback', kind: 'lesson' },
        ],
        diagnostics: { ...BASELINE.diagnostics, entriesFromBlocks: 1, unresolvedBlocks: 2 },
      },
      adoptDisabled: false,
      review: REVIEW,
    });
    expect(html).toContain('几何块');
    expect(html).toContain('文本');
    expect(html).toContain('AI草稿');
    expect(html).toContain('不是 PDF 物理页');
    expect(html).toContain('2 个标题未定位页码（待定，不猜）');
    expect(html).toContain('版式 1');
  });

  it('编辑态有增删行按钮；空标题确认禁用', () => {
    const html = render({
      baseline: BASELINE,
      adopted: 'manual',
      editing: true,
      editedEntries: [
        { key: 'toc-manual-0', title: '', printedPage: '', level: 2, kind: 'section', confidence: null },
      ],
      confirmDisabled: true,
    });
    expect(html).toContain('待确认：手动填写');
    expect(html).toContain('添加一行');
    expect(html).toContain('删除本行');
    const confirmOpen = html.slice(0, html.indexOf('确认目录')).split('<button').pop() ?? '';
    expect(confirmOpen).toContain('disabled');
  });

  it('unavailable：可读错误 + 基线可采用提示，无 draft 面板', () => {
    const html = render({
      baseline: { ...BASELINE, verdict: 'usable' },
      adoptDisabled: false,
      review: { ...REVIEW, draft: null, reviewStatus: 'unavailable', reviewError: { code: 'E_TOC_REVIEW_TOOL_INVALID', userMessage: 'AI 工具参数两次校验失败，已保留可编辑基线' } },
    });
    expect(html).toContain('AI 审核暂不可用');
    expect(html).toContain('已保留可编辑基线');
    expect(html).toContain('E_TOC_REVIEW_TOOL_INVALID');
    expect(html).not.toContain('AI 草稿，需人工确认');
    expect(html).toContain('手动填写');
  });

  it('成功草稿显示与基线差异计数', () => {
    const html = render({ baseline: BASELINE, review: REVIEW });
    expect(html).toContain('新增 0');
    expect(html).toContain('修改 0');
    expect(html).toContain('保留 1');
    expect(html).toContain('OCR 原文证据');
    expect(html).toContain('OCR 基线');
    expect(html).toContain('AI 草稿');
  });
});

describe('P3.3 基线流式进度视图（SSR）', () => {
  it('ocr 进行中：真实页数 + 批次范围 + 取消提取按钮，无百分比', () => {
    const html = render({
      extracting: true,
      extractProgress: {
        started: true,
        phase: 'ocr',
        plannedPages: 6,
        completedPages: 5,
        batchFrom: 16,
        batchTo: 20,
        readBytes: 0,
        totalBytes: null,
        runtimeDownloading: false,
        error: null,
      },
    });
    expect(html).toContain('5/6');
    expect(html).toContain('第 16–20 页批次完成');
    expect(html).toContain('取消提取');
    expect(html).not.toContain('%');
  });

  it('读取阶段：已读 MB + 取消提取', () => {
    const html = render({
      extracting: true,
      extractProgress: {
        started: true,
        phase: 'input_read',
        plannedPages: 0,
        completedPages: 0,
        batchFrom: null,
        batchTo: null,
        readBytes: 4194304,
        totalBytes: 20971520,
        runtimeDownloading: false,
        error: null,
      },
    });
    expect(html).toContain('正在读取本地 PDF');
    expect(html).toContain('4.0 MB / 20.0 MB');
    expect(html).toContain('取消提取');
  });

  it('空闲无进度：无取消提取按钮；已取消：中性文案无错误', () => {
    expect(render()).not.toContain('取消提取');
    const html = render({
      extracting: false,
      extractError: null,
      extractProgress: {
        started: true,
        phase: 'cancelled',
        plannedPages: 0,
        completedPages: 0,
        batchFrom: null,
        batchTo: null,
        readBytes: 0,
        totalBytes: null,
        runtimeDownloading: false,
        error: null,
      },
    });
    expect(html).toContain('已取消提取，未采纳任何结果');
    expect(html).not.toContain('role="alert"');
  });
});
