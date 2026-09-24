import { describe, expect, it } from 'bun:test';
import { isOk, isErr, BusinessError } from '@study-studio/shared';
import { previewTocSegments, validateTocEntries, type TocEntryIssue, type TocSegmentTocEntry } from '@study-studio/content';
import { narrowPlanEntries } from '../application/pdf-import/toc-segment-plan.js';

/**
 * LLM 目录 JSON 形状矩阵（mock 大模型输出，不调模型不碰 PDF）。
 * 测的是 P5-A 纯函数对各种目录形状的区分能力与输出一致性：
 * - kind=lesson 才成课；kind=section（章/復習/前言/噪音）一律忽略并计数；
 * - level 只参与排序与诊断，不决定成课；
 * - 输出 lessons[] 形状恒定；非法输入 fail-closed（E_INVALID_INPUT）。
 */

function anchorsFor(pairs: Array<[number, number]>) {
  return pairs.map(([printedPage, physicalPage]) => ({
    printedPage,
    physicalPage,
    evidence: 'human-confirmed' as const,
  }));
}

const LESSON_KEYS = [
  'lessonIndex',
  'title',
  'printedStart',
  'physicalStart',
  'physicalEnd',
  'status',
  'reason',
  'regionId',
  'offsetUsed',
].sort();

describe('LLM 目录形状矩阵', () => {
  it('A. 扁平课（大家的日语形）：level 全 1，课按顺序映射', () => {
    const entries = [
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
      { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' as const },
      { title: '第3課', printedPage: 48, level: 1, kind: 'lesson' as const },
    ];
    const res = previewTocSegments({
      pageCount: 100,
      entries,
      anchors: anchorsFor([
        [12, 17],
        [30, 35],
        [48, 53],
      ]),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課', '第3課']);
    expect(res.value.lessons.map((l) => l.lessonIndex)).toEqual([0, 1, 2]);
    expect(res.value.lessons.every((l) => l.status === 'mapped')).toBe(true);
    expect(res.value.diagnostics).toMatchObject({ lessonCount: 3, sectionCountIgnored: 0 });
    for (const l of res.value.lessons) {
      expect(Object.keys(l).sort()).toEqual(LESSON_KEYS);
    }
  });

  it('B. 章+课嵌套：section 被忽略并计数，课映射不受影响', () => {
    const entries = [
      { title: '第一章', printedPage: 10, level: 0, kind: 'section' as const },
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
      { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' as const },
      { title: '第二章', printedPage: 44, level: 0, kind: 'section' as const },
      { title: '第3課', printedPage: 48, level: 1, kind: 'lesson' as const },
    ];
    const res = previewTocSegments({
      pageCount: 100,
      entries,
      anchors: anchorsFor([
        [12, 17],
        [30, 35],
        [48, 53],
      ]),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 成课的只有 3 个 lesson；section 不占 lessonIndex。
    expect(res.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課', '第3課']);
    expect(res.value.lessons.map((l) => l.lessonIndex)).toEqual([0, 1, 2]);
    expect(res.value.diagnostics).toMatchObject({ lessonCount: 3, sectionCountIgnored: 2 });
  });

  it('C. 復習/前言/目次噪音：kind=section 一律忽略', () => {
    const entries = [
      { title: 'まえがき', printedPage: 1, level: 0, kind: 'section' as const },
      { title: '目次', printedPage: 3, level: 0, kind: 'section' as const },
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
      { title: '復習A', printedPage: 40, level: 1, kind: 'section' as const },
      { title: '第2課', printedPage: 48, level: 1, kind: 'lesson' as const },
    ];
    const res = previewTocSegments({
      pageCount: 100,
      entries,
      anchors: anchorsFor([
        [12, 17],
        [48, 53],
      ]),
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.lessons.map((l) => l.title)).toEqual(['第1課', '第2課']);
    expect(res.value.diagnostics).toMatchObject({ lessonCount: 2, sectionCountIgnored: 3 });
  });

  it('D. 单条目拒绝分段；零 anchor 则 unresolved（reason=no-anchors）', () => {
    const single = previewTocSegments({
      pageCount: 100,
      entries: [{ title: '第1課', printedPage: 12, level: 1, kind: 'lesson' }],
      anchors: [],
    });
    expect(isErr(single)).toBe(true);

    const entries = [
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
      { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' as const },
    ];
    const res = previewTocSegments({ pageCount: 100, entries, anchors: [] });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.lessons).toHaveLength(2);
    expect(res.value.lessons.every((l) => l.status === 'unresolved')).toBe(true);
    expect(res.value.lessons.every((l) => l.reason === 'no-anchors')).toBe(true);
    expect(res.value.diagnostics).toMatchObject({ mappedCount: 0, unresolvedCount: 2 });
    for (const l of res.value.lessons) {
      expect(Object.keys(l).sort()).toEqual(LESSON_KEYS);
    }

    // 只给第 1 课 anchor：第 2 课必须有原因（extrapolated 或 unresolved 皆可）。
    const partial = previewTocSegments({ pageCount: 100, entries, anchors: anchorsFor([[12, 17]]) });
    expect(isOk(partial)).toBe(true);
    if (!isOk(partial)) return;
    expect(partial.value.lessons[0]?.status).toBe('mapped');
    expect(typeof partial.value.lessons[1]?.reason).toBe('string');
  });

  it('E. LLM 坏形状 fail-closed：缺 kind / level 非整数 / 同页重复', () => {
    // 缺 kind
    expect(narrowPlanEntries([{ title: '第1課', printedPage: 12, level: 1 }])).toBeNull();
    // level 非整数
    expect(
      narrowPlanEntries([{ title: '第1課', printedPage: 12, level: '一', kind: 'lesson' }])
    ).toBeNull();
    // kind 非法
    expect(
      narrowPlanEntries([{ title: '第1課', printedPage: 12, level: 1, kind: 'chapter' }])
    ).toBeNull();
    // 非数组
    expect(narrowPlanEntries('第1課')).toBeNull();
    // 同印刷页两课：纯函数层拒绝
    const dup = previewTocSegments({
      pageCount: 100,
      entries: [
        { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' },
        { title: '第2課', printedPage: 12, level: 1, kind: 'lesson' },
      ],
      anchors: anchorsFor([[12, 17]]),
    });
    expect(isErr(dup)).toBe(true);
    if (isErr(dup)) expect(dup.error.code).toBe('E_INVALID_INPUT');
  });

  it('F. 越界印刷页 fail-closed', () => {
    const res = previewTocSegments({
      pageCount: 100,
      entries: [{ title: '第99課', printedPage: 500, level: 1, kind: 'lesson' }],
      anchors: anchorsFor([[12, 17]]),
    });
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('E_INVALID_INPUT');
  });

  it('G. 缺 level：E_TOC_ENTRY_INVALID + details.issues 可机读', () => {
    const entries = [
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' as const },
      // 大模型漏了第 2 条的 level
      { title: '第2課', printedPage: 30, kind: 'lesson' as const },
    ];
    const checked = validateTocEntries(entries);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.issues).toHaveLength(1);
    expect(checked.issues[0]).toMatchObject({ index: 1, field: 'level' });
    expect(typeof checked.issues[0]?.hint).toBe('string');

    const res = previewTocSegments({
      pageCount: 100,
      // 故意传入缺字段的 LLM 原始 JSON（运行时拒绝口径，类型断言仅用于测试）。
      entries: entries as unknown as TocSegmentTocEntry[],
      anchors: anchorsFor([[12, 17]]),
    });
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_TOC_ENTRY_INVALID');
      // 优雅报错 JSON：整体可序列化，issues 随 details 透出（HTTP error.details 同源）。
      const details = (res.error as BusinessError).internalDetails as { issues: TocEntryIssue[] };
      const roundTripped = JSON.parse(JSON.stringify(details)) as typeof details;
      expect(roundTripped.issues).toHaveLength(1);
      expect(roundTripped.issues[0]).toMatchObject({ index: 1, field: 'level', title: '第2課' });
    }
  });

  it('H. 缺 printedPage：issues 定位到条目与字段', () => {
    const checked = validateTocEntries([
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' },
      { title: '第2課', level: 1, kind: 'lesson' },
    ]);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.issues).toMatchObject([{ index: 1, field: 'printedPage' }]);
  });

  it('I. 层级跳跃 0→2 非法；1→1、2→0、0→1 合法', () => {
    const bad = validateTocEntries([
      { title: '第一章', printedPage: 10, level: 0, kind: 'section' },
      { title: '第1課', printedPage: 12, level: 2, kind: 'lesson' },
    ]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.issues[0]).toMatchObject({ index: 1, field: 'level' });

    const good = validateTocEntries([
      { title: '第一章', printedPage: 10, level: 0, kind: 'section' },
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' },
      { title: '1.1 会話', printedPage: 14, level: 2, kind: 'section' },
      { title: '第2課', printedPage: 30, level: 1, kind: 'lesson' },
    ]);
    expect(good.ok).toBe(true);
  });

  it('J. 首条层级为 2 非法（目录必须从 0/1 开始）', () => {
    const res = validateTocEntries([
      { title: '第1課', printedPage: 12, level: 2, kind: 'lesson' },
      { title: '第2課', printedPage: 30, level: 2, kind: 'lesson' },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues[0]).toMatchObject({ index: 0, field: 'level' });
  });

  it('K. 增量修复循环演示：catch issues → 按 hint 补齐 → 重验证通过并映射', () => {
    // 第 1 轮：大模型输出缺 level + 缺页码
    const draft: Array<Record<string, unknown>> = [
      { title: '第1課', printedPage: 12, level: 1, kind: 'lesson' },
      { title: '第2課', kind: 'lesson' },
    ];
    const first = validateTocEntries(draft);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.issues.map((i) => i.field).sort()).toEqual(['level', 'printedPage']);

    // 第 2 轮：模拟大模型按 issues 增量补齐（只动问题条目）
    for (const issue of first.issues) {
      const row = draft[issue.index];
      if (!row) continue;
      if (issue.field === 'level') row.level = 1;
      if (issue.field === 'printedPage') row.printedPage = 30;
    }
    const second = validateTocEntries(draft);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const preview = previewTocSegments({
      pageCount: 100,
      entries: second.entries,
      anchors: anchorsFor([
        [12, 17],
        [30, 35],
      ]),
    });
    expect(isOk(preview)).toBe(true);
    if (!isOk(preview)) return;
    expect(preview.value.lessons.map((l) => l.status)).toEqual(['mapped', 'mapped']);
  });
});
