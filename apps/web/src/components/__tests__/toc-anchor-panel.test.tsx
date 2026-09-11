import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TocAnchorPanelView, LessonImportDialogContent, type TocAnchorPanelViewProps } from '../TocAnchorPanel.js';
import type { FolioResponseData, PreviewResponseData } from '../../lib/toc-anchor-flow.js';

/**
 * CMD-LINGUA-P5C：anchor 面板纯视图 SSR 断言（无 DOM、无网络）。
 * 显式确认门由 lib 单测覆盖；此处锁定各态文案、按钮有无与诚实声明。
 */

function baseProps(overrides: Partial<TocAnchorPanelViewProps> = {}): TocAnchorPanelViewProps {
  return {
    hasSource: true,
    checkText: '',
    checkError: null,
    checking: false,
    folioError: null,
    folio: null,
    corroborated: [],
    anchors: [],
    previewBuildError: null,
    requestingPreview: false,
    previewError: null,
    preview: null,
    previewValid: false,
    importGates: [],
    importDialog: null,
    importing: false,
    importError: null,
    importResult: null,
    onCheckTextChange: () => {},
    onCheckFolio: () => {},
    onConfirmAnchor: () => {},
    onRemoveAnchor: () => {},
    onRequestPreview: () => {},
    onSelectLessonImport: () => {},
    onCloseImportDialog: () => {},
    onDocTitleChange: () => {},
    onConfirmImport: () => {},
    ...overrides,
  };
}

function render(props: Partial<TocAnchorPanelViewProps> = {}): string {
  return renderToStaticMarkup(TocAnchorPanelView(baseProps(props)));
}

const FOLIO: FolioResponseData = {
  pageCount: 100,
  pages: [
    {
      physicalPage: 26,
      candidates: [
        { raw: '18', normalized: { kind: 'arabic', value: 18 }, location: 'footer', source: 'native', confidence: 'medium' },
        { raw: '18', normalized: { kind: 'arabic', value: 18 }, location: 'footer', source: 'ocr', confidence: 'low' },
      ],
    },
    {
      physicalPage: 3,
      candidates: [
        { raw: 'iv', normalized: { kind: 'roman', value: 'IV' }, location: 'header', source: 'native', confidence: 'medium' },
      ],
    },
  ],
};

const PREVIEW_MAPPED: PreviewResponseData = {
  pageCount: 100,
  lessons: [
    { lessonIndex: 0, title: '第1課', printedStart: 12, physicalStart: 17, physicalEnd: 30, status: 'mapped', reason: 'verified-interval', regionId: 'verified:5:12-30', offsetUsed: 5 },
  ],
  regions: [{ id: 'verified:5:12-30', offset: 5, printedFrom: 12, printedTo: 30, verified: true, anchorCount: 2 }],
  chunks: [{ lessonIndex: 0, title: '第1課', chunkIndex: 0, physicalFrom: 17, physicalTo: 30 }],
  diagnostics: { lessonCount: 1, mappedCount: 1, unresolvedCount: 0, regionCount: 1, chunksPlanned: 1, lessonsWithoutEnd: 0 },
  fingerprint: 'fp-test-mapped',
};

const PREVIEW_UNRESOLVED: PreviewResponseData = {
  pageCount: 100,
  lessons: [
    { lessonIndex: 0, title: '第1課', printedStart: 12, physicalStart: 17, physicalEnd: null, status: 'mapped', reason: 'consistent-extrapolation', regionId: 'extrapolated:5', offsetUsed: 5 },
    { lessonIndex: 1, title: '第2課', printedStart: 60, physicalStart: null, physicalEnd: null, status: 'unresolved', reason: 'between-conflicting-offsets', regionId: null, offsetUsed: null },
  ],
  regions: [],
  chunks: [],
  diagnostics: { lessonCount: 2, mappedCount: 1, unresolvedCount: 1, regionCount: 0, chunksPlanned: 0, lessonsWithoutEnd: 1 },
  fingerprint: 'fp-test-unresolved',
};

const ANCHORS = [{ printedPage: 18, physicalPage: 26, evidence: 'human-confirmed' as const, label: '印18 ↔ 物26' }];

describe('P5C TocAnchorPanelView（SSR）', () => {
  it('初始零 anchor，不声称已保存', () => {
    const html = render();
    expect(html).toContain('暂无 anchor');
    expect(html).toContain('检查 folio');
    expect(html).not.toContain('已保存');
    expect(html).not.toContain('已入库');
  });

  it('候选五元组齐备；Arabic 有确认按钮，Roman 无按钮仅前言徽标', () => {
    const html = render({ folio: FOLIO, corroborated: [{ physicalPage: 26, value: 18 }] });
    expect(html).toContain('PDF 物理页 26');
    expect(html).toContain('18');
    expect(html).toContain('页脚');
    expect(html).toContain('原生');
    expect(html).toContain('中置信');
    expect(html).toContain('低置信');
    expect(html).toContain('确认为 anchor（印18 ↔ 物26）');
    expect(html).toContain('Roman·前言证据，不可成 anchor');
    // Roman 行没有确认按钮：全页恰好两个确认按钮（native+ocr 各一）
    expect(html.match(/确认为 anchor/g)?.length).toBe(2);
    // 双源一致辅助提示出现，但仍需手动确认（按钮仍在）
    expect(html).toContain('双源一致');
  });

  it('anchor 列表渲染可移除项', () => {
    const html = render({ anchors: ANCHORS });
    expect(html).toContain('印18 ↔ 物26');
    expect(html).toContain('移除anchor印18');
    expect(html).not.toContain('暂无 anchor');
  });

  it('预览：课字段齐备 + chunk 仅预览标记，无写按钮', () => {
    const html = render({ anchors: ANCHORS, preview: PREVIEW_MAPPED, previewValid: true });
    expect(html).toContain('第1課');
    expect(html).toContain('印12页');
    expect(html).toContain('物17–30');
    expect(html).toContain('已映射');
    expect(html).toContain('已验证区间');
    expect(html).toContain('offset +5');
    expect(html).toContain('仅预览，尚未 OCR/导入');
    expect(html).toContain('第1段');
    expect(html).not.toContain('开始导入');
    expect(html).not.toContain('写入教材');
    expect(html).not.toContain('自动修复');
  });

  it('unresolved>0：醒目禁导文案，无写按钮', () => {
    const html = render({ anchors: ANCHORS, preview: PREVIEW_UNRESOLVED, previewValid: true });
    expect(html).toContain('未映射');
    expect(html).toContain('offset 冲突');
    expect(html).toContain('当前目录不能自动导入；请补充或修正 anchor');
    expect(html).not.toContain('开始导入');
    expect(html).not.toContain('写入教材');
  });

  it('unresolved=0：只显示下一阶段文案', () => {
    const html = render({ anchors: ANCHORS, preview: PREVIEW_MAPPED, previewValid: true });
    expect(html).toContain('分段计划已验证；下一阶段才可能执行导入');
    expect(html).not.toContain('当前目录不能自动导入');
  });

  it('anchor 变更后预览失效：藏表显重请求', () => {
    const html = render({ anchors: [], preview: PREVIEW_MAPPED, previewValid: false });
    expect(html).toContain('anchor 已变更，当前预览已失效，请重新请求分段预览');
    expect(html).not.toContain('第1段');
  });

  it('预览错误展示 userMessage', () => {
    const html = render({ anchors: ANCHORS, previewError: 'anchor 超出本书（本书共 100 页）' });
    expect(html).toContain('anchor 超出本书（本书共 100 页）');
  });

  it('gate 未满足：无试导入按钮', () => {
    const html = render({
      anchors: ANCHORS,
      preview: PREVIEW_UNRESOLVED,
      previewValid: true,
      importGates: [
        { lessonIndex: 0, ok: false },
        { lessonIndex: 1, ok: false },
      ],
    });
    expect(html).not.toContain('试导入这一课');
    expect(html).toContain('当前目录不能自动导入');
  });

  it('gate 全绿：课行出现试导入按钮，无整书/接力 UI', () => {
    const html = render({
      anchors: ANCHORS,
      preview: PREVIEW_MAPPED,
      previewValid: true,
      importGates: [{ lessonIndex: 0, ok: true }],
    });
    expect(html).toContain('试导入这一课');
    expect(html).not.toContain('整书导入');
    expect(html).not.toContain('接力');
    expect(html).not.toContain('开始导入');
  });

  it('最终确认 Dialog 内容：文案准确，无整书按钮（Dialog 壳需 DOM，内容直渲）', () => {
    const html = renderToStaticMarkup(
      LessonImportDialogContent({
        dialog: {
          lessonIndex: 0,
          lessonTitle: '第1課',
          printedStart: 12,
          physicalFrom: 17,
          physicalTo: 30,
          pages: 14,
          docTitle: '第1課',
        },
        importing: false,
        onClose: () => {},
        onDocTitleChange: () => {},
        onConfirm: () => {},
      })
    );
    expect(html).toContain('确认导入这一课');
    expect(html).toContain('将导入这一课；这会创建教材数据');
    expect(html).toContain('第1課');
    expect(html).toContain('不会继续接力导入后续章节');
    expect(html).toContain('新教材标题');
    expect(html).toContain('取消');
    expect(html).toContain('确认导入');
    expect(html).not.toContain('整书导入');
    expect(html).not.toContain('开始导入');
  });

  it('成功摘要：documentId 与范围，无整书文案', () => {
    const html = render({
      anchors: ANCHORS,
      preview: PREVIEW_MAPPED,
      previewValid: true,
      importGates: [{ lessonIndex: 0, ok: true }],
      importResult: {
        documentId: 'doc_abc',
        lessonId: 'l1',
        lessonTitle: '第1課',
        range: { fromPage: 17, toPage: 30 },
        pageCount: 100,
        stats: { lessons: 1, dialogues: 2, chunks: 1 },
      },
    });
    expect(html).toContain('已创建新教材 document');
    expect(html).toContain('doc_abc');
    expect(html).toContain('不是整本教材导入');
  });

  it('导入失败：userMessage 展示', () => {
    const html = render({
      anchors: ANCHORS,
      preview: PREVIEW_MAPPED,
      previewValid: true,
      importGates: [{ lessonIndex: 0, ok: true }],
      importError: '分段预览已过期，请重新请求预览后再导入',
    });
    expect(html).toContain('分段预览已过期，请重新请求预览后再导入');
  });
});
