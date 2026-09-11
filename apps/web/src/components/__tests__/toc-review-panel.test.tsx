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
  range: { fromPage: 2, toPage: 4 },
  pageCount: 100,
  entries: [{ title: '第1課', printedPage: 12, level: 1, source: 'text', kind: 'lesson' }],
  diagnostics: {
    pagesRequested: 3,
    pagesOcr: 3,
    linesConsidered: 10,
    linesDroppedWash: 1,
    entriesAccepted: 1,
    entriesRejected: 0,
  },
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
