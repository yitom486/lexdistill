import { describe, expect, it } from 'bun:test';
import {
  ANCHOR_CHECK_MAX_PAGES,
  anchorFlowReducer,
  buildPreviewEntries,
  decideAnchorConfirm,
  decideManualAnchorConfirm,
  decideLessonImport,
  findCorroboratedFolios,
  fingerprintAnchors,
  initialAnchorFlowState,
  narrowFolioResponse,
  narrowPreviewResponse,
  narrowTocLessonImport,
  parseAnchorCheckPages,
  type FolioCandidateData,
  type LocalAnchor,
  type PreviewResponseData,
} from '../toc-anchor-flow.js';

/** CMD-LINGUA-P5C：anchor 确认与预览纯逻辑（无 React、无网络、无存储）。 */

function arabic(raw: string, value: number, source: 'native' | 'ocr' = 'native'): FolioCandidateData {
  return { raw, normalized: { kind: 'arabic', value }, location: 'footer', source, confidence: source === 'native' ? 'medium' : 'low' };
}

function roman(raw: string): FolioCandidateData {
  return { raw, normalized: { kind: 'roman', value: raw.toUpperCase() }, location: 'header', source: 'native', confidence: 'medium' };
}

describe('parseAnchorCheckPages', () => {
  it('上限锁死 8 页', () => {
    expect(ANCHOR_CHECK_MAX_PAGES).toBe(8);
  });

  it('逗号/空白分隔，去重排序', () => {
    expect(parseAnchorCheckPages('31, 26,26')).toEqual({ ok: true, pages: [26, 31] });
  });

  it('空 / 非整数 / 超 8 页拒绝', () => {
    expect(parseAnchorCheckPages('').ok).toBe(false);
    expect(parseAnchorCheckPages('26,x').ok).toBe(false);
    expect(parseAnchorCheckPages('0').ok).toBe(false);
    expect(parseAnchorCheckPages('1,2,3,4,5,6,7,8,9').ok).toBe(false);
  });
});

describe('decideAnchorConfirm（唯一 anchor 判定点）', () => {
  it('Arabic 显式确认通过，evidence 恒 human-confirmed', () => {
    const res = decideAnchorConfirm(arabic('18', 18), 26, []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.anchor).toEqual({ printedPage: 18, physicalPage: 26, evidence: 'human-confirmed', label: '印18 ↔ 物26' });
  });

  it('Roman 永不成 anchor（仅前言证据）', () => {
    const res = decideAnchorConfirm(roman('iv'), 3, []);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain('Roman');
  });

  it('重复印刷页拒绝（P5-A fail-closed 的前端映射）', () => {
    const existing: LocalAnchor[] = [{ printedPage: 18, physicalPage: 26, evidence: 'human-confirmed', label: '印18 ↔ 物26' }];
    const res = decideAnchorConfirm(arabic('18', 18), 27, existing);
    expect(res.ok).toBe(false);
  });

  it('OCR-low 不自动降级为拒绝：仍需且仅需显式确认（守门只判形状）', () => {
    // 守门通过 ≠ 自动确认：调用方只有点击 handler 一处，没有数据驱动的自动路径。
    const res = decideAnchorConfirm(arabic('18', 18, 'ocr'), 26, []);
    expect(res.ok).toBe(true);
  });
});

describe('手填 anchor 必须显式确认', () => {
  it('合法的印刷页与 PDF 物理页组成 human-confirmed anchor', () => {
    expect(decideManualAnchorConfirm('18', '26', [])).toEqual({
      ok: true,
      anchor: { printedPage: 18, physicalPage: 26, evidence: 'human-confirmed', label: '印18 ↔ 物26' },
    });
  });

  it('拒绝非法与重复页码', () => {
    const existing: LocalAnchor[] = [{ printedPage: 18, physicalPage: 26, evidence: 'human-confirmed', label: '印18 ↔ 物26' }];
    expect(decideManualAnchorConfirm('0', '27', []).ok).toBe(false);
    expect(decideManualAnchorConfirm('18', '27', existing).ok).toBe(false);
    expect(decideManualAnchorConfirm('19', '26', existing).ok).toBe(false);
  });
});

describe('anchorFlowReducer（只有显式动作能增删）', () => {
  it('初始零 anchor（重挂载不声称保存）', () => {
    expect(initialAnchorFlowState.anchors).toEqual([]);
    expect(initialAnchorFlowState.previewSig).toBeNull();
  });

  it('确认/移除显式进行；任何变化使旧预览失效', () => {
    const anchor: LocalAnchor = { printedPage: 18, physicalPage: 26, evidence: 'human-confirmed', label: '印18 ↔ 物26' };
    let state = anchorFlowReducer(initialAnchorFlowState, { type: 'confirm-anchor', anchor });
    expect(state.anchors.length).toBe(1);
    // 重复确认同一印刷页忽略
    expect(anchorFlowReducer(state, { type: 'confirm-anchor', anchor })).toBe(state);
    state = anchorFlowReducer(state, { type: 'preview-requested', sig: 'sig-1' });
    expect(state.previewSig).toBe('sig-1');
    state = anchorFlowReducer(state, { type: 'remove-anchor', printedPage: 18 });
    expect(state.anchors).toEqual([]);
    expect(state.previewSig).toBeNull();
  });
});

describe('fingerprintAnchors / buildPreviewEntries', () => {
  it('指纹只看印刷/物理有序对', () => {
    const a: LocalAnchor[] = [
      { printedPage: 30, physicalPage: 35, evidence: 'human-confirmed', label: 'x' },
      { printedPage: 18, physicalPage: 26, evidence: 'human-confirmed', label: 'y' },
    ];
    expect(fingerprintAnchors(a)).toBe('[[18,26],[30,35]]');
  });

  it('装配：字符串页码转数值；非法 fail-closed', () => {
    const ok = buildPreviewEntries([{ title: '第1課', printedPage: '12', level: 1, kind: 'lesson' }]);
    expect(ok).toEqual({ ok: true, entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }] });
    expect(buildPreviewEntries([]).ok).toBe(false);
    expect(buildPreviewEntries([{ title: '', printedPage: '12', level: 1, kind: 'lesson' }]).ok).toBe(false);
    expect(buildPreviewEntries([{ title: '第1課', printedPage: 'x', level: 1, kind: 'lesson' }]).ok).toBe(false);
  });
});

describe('findCorroboratedFolios（展示提示，不改变确认规则）', () => {
  it('同页 native+OCR 同值才提示', () => {
    const out = findCorroboratedFolios([
      { physicalPage: 26, candidates: [arabic('18', 18, 'native'), arabic('18', 18, 'ocr')] },
      { physicalPage: 27, candidates: [arabic('19', 19, 'ocr')] },
    ]);
    expect(out).toEqual([{ physicalPage: 26, value: 18 }]);
  });
});

describe('narrowFolioResponse / narrowPreviewResponse', () => {
  it('folio 合法通过；畸形 null', () => {
    const payload = {
      pageCount: 100,
      pages: [{ physicalPage: 26, candidates: [{ raw: '18', normalized: { kind: 'arabic', value: 18 }, location: 'footer', source: 'native', confidence: 'medium' }] }],
      diagnostics: { pagesRequested: 1, nativePages: 1, ocrPages: 0, candidatesFound: 1 },
    };
    expect(narrowFolioResponse(payload)?.pages.length).toBe(1);
    expect(narrowFolioResponse({ bogus: 1 })).toBeNull();
  });

  it('preview 合法通过；畸形 null', () => {
    const payload = {
      pageCount: 100,
      lessons: [{ lessonIndex: 0, title: '第1課', printedStart: 12, physicalStart: 17, physicalEnd: 30, status: 'mapped', reason: 'verified-interval', regionId: 'verified:5:12-30', offsetUsed: 5 }],
      regions: [{ id: 'verified:5:12-30', offset: 5, printedFrom: 12, printedTo: 30, verified: true, anchorCount: 2 }],
      chunks: [{ lessonIndex: 0, title: '第1課', chunkIndex: 0, physicalFrom: 17, physicalTo: 30 }],
      diagnostics: { lessonCount: 1, mappedCount: 1, unresolvedCount: 0, regionCount: 1, chunksPlanned: 1, lessonsWithoutEnd: 0 },
      fingerprint: 'fp-1',
    };
    const narrowed = narrowPreviewResponse(payload);
    expect(narrowed?.lessons.length).toBe(1);
    expect(narrowed?.chunks.length).toBe(1);
    expect(narrowed?.fingerprint).toBe('fp-1');
    expect(narrowPreviewResponse({ lessons: [] })).toBeNull();
    const { fingerprint: _drop, ...noFp } = payload;
    void _drop;
    expect(narrowPreviewResponse(noFp)).toBeNull();
  });
});

function greenPreview(): PreviewResponseData {
  return {
    pageCount: 100,
    lessons: [
      { lessonIndex: 0, title: '第1課', printedStart: 12, physicalStart: 17, physicalEnd: 30, status: 'mapped', reason: 'verified-interval', regionId: 'verified:5:12-30', offsetUsed: 5 },
    ],
    regions: [{ id: 'verified:5:12-30', offset: 5, printedFrom: 12, printedTo: 30, verified: true, anchorCount: 2 }],
    chunks: [{ lessonIndex: 0, title: '第1課', chunkIndex: 0, physicalFrom: 17, physicalTo: 30 }],
    diagnostics: { lessonCount: 1, mappedCount: 1, unresolvedCount: 0, regionCount: 1, chunksPlanned: 1, lessonsWithoutEnd: 0 },
    fingerprint: 'fp-green',
  };
}

describe('decideLessonImport（单课试导入守门）', () => {
  it('全绿通过并带回课与 chunk', () => {
    const res = decideLessonImport(greenPreview(), true, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lesson.title).toBe('第1課');
    expect(res.chunk.physicalFrom).toBe(17);
  });

  it('无效预览/缺指纹/未映射/坏下标全拒绝', () => {
    expect(decideLessonImport(null, true, 0).ok).toBe(false);
    expect(decideLessonImport(greenPreview(), false, 0).ok).toBe(false);
    expect(decideLessonImport({ ...greenPreview(), fingerprint: '' }, true, 0).ok).toBe(false);
    expect(decideLessonImport(greenPreview(), true, 9).ok).toBe(false);
    const unresolved = greenPreview();
    unresolved.diagnostics.unresolvedCount = 1;
    expect(decideLessonImport(unresolved, true, 0).ok).toBe(false);
    const noEnd = greenPreview();
    noEnd.diagnostics.lessonsWithoutEnd = 1;
    expect(decideLessonImport(noEnd, true, 0).ok).toBe(false);
  });

  it('超 30 页 / 非完整 chunk 拒绝', () => {
    const big = greenPreview();
    big.lessons[0] = { ...big.lessons[0]!, printedStart: 1, physicalStart: 1, physicalEnd: 31, status: 'mapped', reason: 'verified-interval', regionId: 'verified:0:1-100', offsetUsed: 0 };
    big.chunks = [
      { lessonIndex: 0, title: '第1課', chunkIndex: 0, physicalFrom: 1, physicalTo: 30 },
      { lessonIndex: 0, title: '第1課', chunkIndex: 1, physicalFrom: 31, physicalTo: 31 },
    ];
    const res = decideLessonImport(big, true, 0);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain('31');
  });
});

describe('narrowTocLessonImport', () => {
  it('合法通过；畸形 null', () => {
    const payload = {
      documentId: 'doc_1',
      lessonId: 'l1',
      lessonTitle: '第1課',
      range: { fromPage: 17, toPage: 30 },
      pageCount: 100,
      stats: { lessons: 1, dialogues: 2, chunks: 1 },
    };
    expect(narrowTocLessonImport(payload)?.lessonId).toBe('l1');
    expect(narrowTocLessonImport({ bogus: 1 })).toBeNull();
  });
});
