import { describe, expect, it } from 'bun:test';
import type { MapPdfResult } from '../../queries/useLearnerQueries.js';
import { parseTocScanRange, tocCandidatesFromMap, validateTocCandidates, tocCandidatesFromEntries, changeTocCandidateLevel, changeTocCandidateType } from '../toc-recognition.js';

const BASE: MapPdfResult = {
  classification: { pdfType: 'Scanned', pageCount: 80, selectedPages: [3, 4] },
  window: [3, 4],
  headings: [],
  tocEntries: [],
};

describe('目录候选与人工确认边界', () => {
  it('目录页窗超出 30 页或只填一端时拒绝，避免服务端静默截断', () => {
    expect(parseTocScanRange('', '')).toEqual({ ok: true });
    expect(parseTocScanRange('31', '60')).toEqual({ ok: true, startPage: 31, endPage: 60 });
    expect(parseTocScanRange('31', '61').ok).toBe(false);
    expect(parseTocScanRange('31', '').ok).toBe(false);
  });

  it('PDF 书签只提供物理页，绝不推测印刷页', () => {
    const rows = tocCandidatesFromMap({
      ...BASE,
      outlineSource: 'embedded',
      embeddedOutline: [
        { title: '第一章', level: 1, physicalPage: 7 },
        { title: '第1課 あいさつ', level: 2, physicalPage: 12 },
      ],
    });
    expect(rows.map((row) => [row.printedPage, row.physicalPage, row.kind, row.level])).toEqual([
      ['', 7, 'section', 1],
      ['', 12, 'lesson', 2],
    ]);
    expect(validateTocCandidates(rows)).toContain('印刷页');
  });

  it('OCR 候选保留印刷页并去掉页码与点线，非课单元保守归为章节', () => {
    const rows = tocCandidatesFromMap({
      ...BASE,
      outlineSource: 'none',
      tocEntries: [
        { label: '第1課 あいさつ ……… 12', lessonNo: '1', printedPage: 12 },
        { label: '復習A42', lessonNo: '復習A', printedPage: 42 },
      ],
    });
    expect(rows.map((row) => [row.title, row.printedPage, row.kind])).toEqual([
      ['第1課 あいさつ', '12', 'lesson'],
      ['復習A', '42', 'section'],
    ]);
    expect(validateTocCandidates(rows)).toBeNull();
  });

  it('空页码、倒退页码不能确认；一级章节无需标为成课', () => {
    const rows = tocCandidatesFromMap({
      ...BASE,
      tocEntries: [
        { label: '第1課 10', lessonNo: '1', printedPage: 10 },
        { label: '第2課 20', lessonNo: '2', printedPage: 20 },
      ],
    });
    expect(validateTocCandidates([{ ...rows[0]!, printedPage: '' }])).toContain('印刷页');
    expect(validateTocCandidates(rows.map((row) => ({ ...row, kind: 'section' })))).toBeNull();
    expect(validateTocCandidates([rows[1]!, rows[0]!])).toContain('倒退');
  });

  it('真实教材多层级目录（单元 → 课 → 节 / 单元末）：准确计算深度与父子层级', () => {
    const rawEntries = [
      { id: 'u2', title: '第2单元 小李的公司生活——①', level: 'unit' as const, startPage: 67 },
      { id: 'l5', title: '第5课 森さんは 7時に 起きます', level: 'lesson' as const, startPage: 68, parentId: 'u2' },
      { id: 's5_1', title: '遅刻', level: 'section' as const, startPage: 73, parentId: 'l5' },
      { id: 'l6', title: '第6课 吉田さんは 来月 中国へ 行きます', level: 'lesson' as const, startPage: 78, parentId: 'u2' },
      { id: 's6_1', title: '交通機関', level: 'section' as const, startPage: 83, parentId: 'l6' },
      { id: 'u2_extra_1', title: '实用场景对话（在车站）', level: 'section' as const, startPage: 108, parentId: 'u2' },
    ];
    const candidates = tocCandidatesFromEntries(rawEntries, 'printed');

    expect(candidates.map(c => [c.title, c.level, c.directoryLevel, c.parentId])).toEqual([
      ['第2单元 小李的公司生活——①', 1, 'unit', undefined],
      ['第5课 森さんは 7時に 起きます', 2, 'lesson', 'u2'],
      ['遅刻', 3, 'section', 'l5'],
      ['第6课 吉田さんは 来月 中国へ 行きます', 2, 'lesson', 'u2'],
      ['交通機関', 3, 'section', 'l6'],
      ['实用场景对话（在车站）', 2, 'section', 'u2'],
    ]);
  });

  it('changeTocCandidateLevel 支持 1/2/3 级调整并正确挂载直接父节点', () => {
    const rawEntries = [
      { id: 'u1', title: '第一单元', level: 'unit' as const, startPage: 1 },
      { id: 'l1', title: '第一课', level: 'lesson' as const, startPage: 2 },
      { id: 's1', title: '会话', level: 'section' as const, startPage: 3 },
    ];
    let candidates = tocCandidatesFromEntries(rawEntries, 'printed');
    // 把 l1 设为二级（挂在 u1 下）
    candidates = changeTocCandidateLevel(candidates, 'l1', 2);
    expect(candidates[1]?.level).toBe(2);
    expect(candidates[1]?.parentId).toBe('u1');

    // 把 s1 设为三级（挂在 l1 下）
    candidates = changeTocCandidateLevel(candidates, 's1', 3);
    expect(candidates[2]?.level).toBe(3);
    expect(candidates[2]?.parentId).toBe('l1');

    // 把 s1 调整回一级（脱离父节点）
    candidates = changeTocCandidateLevel(candidates, 's1', 1);
    expect(candidates[2]?.level).toBe(1);
    expect(candidates[2]?.parentId).toBeUndefined();
  });

  it('changeTocCandidateType 直接通过语义角色（unit / lesson / section）自动维护归属关系与层级深度', () => {
    const rawEntries = [
      { id: 'u1', title: '第一单元', level: 'unit' as const, startPage: 1 },
      { id: 'l1', title: '第一课', level: 'lesson' as const, startPage: 2 },
      { id: 's1', title: '会话场景', level: 'section' as const, startPage: 3 },
    ];
    let candidates = tocCandidatesFromEntries(rawEntries, 'printed');

    // 将 l1 设为 lesson：自动挂到前面的 unit 下，深度为 2
    candidates = changeTocCandidateType(candidates, 'l1', 'lesson');
    expect(candidates[1]?.directoryLevel).toBe('lesson');
    expect(candidates[1]?.parentId).toBe('u1');
    expect(candidates[1]?.level).toBe(2);

    // 将 s1 设为 section：自动挂到前面的 lesson 下，深度为 3
    candidates = changeTocCandidateType(candidates, 's1', 'section');
    expect(candidates[2]?.directoryLevel).toBe('section');
    expect(candidates[2]?.parentId).toBe('l1');
    expect(candidates[2]?.level).toBe(3);

    // 将 s1 改为 unit：自动解除父节点，深度变为 1
    candidates = changeTocCandidateType(candidates, 's1', 'unit');
    expect(candidates[2]?.directoryLevel).toBe('unit');
    expect(candidates[2]?.parentId).toBeUndefined();
    expect(candidates[2]?.level).toBe(1);
  });
});
