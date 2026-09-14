import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  TOC_SEGMENT_CHUNK_PAGES,
  previewTocSegments,
  sha256HexBytes,
  type TocSegmentPreviewInput,
} from '../toc-segment-preview.js';

/**
 * CMD-LINGUA-P5A：印刷页 → 物理页映射与分段预览（纯函数，零副作用）。
 * 不碰 DB/网络/OCR/Agent/文件；输入冻结防意外变更。
 */

function lesson(title: string, printedPage: number) {
  return { title, printedPage, level: 1, kind: 'lesson' as const };
}

function section(title: string, printedPage: number) {
  return { title, printedPage, level: 2, kind: 'section' as const };
}

function preview(input: TocSegmentPreviewInput) {
  // 冻结输入：纯函数不得变更调用方对象（冻结后若写即抛）。
  const frozen = JSON.parse(JSON.stringify(input)) as TocSegmentPreviewInput;
  const snapshot = JSON.stringify(frozen);
  deepFreeze(frozen);
  const res = previewTocSegments(frozen);
  expect(JSON.stringify(frozen)).toBe(snapshot);
  return res;
}

function deepFreeze(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
}

describe('P5A previewTocSegments', () => {
  it('chunk 上限锁死 30 页（与 OCR 单次上限同值）', () => {
    expect(TOC_SEGMENT_CHUNK_PAGES).toBe(30);
  });

  it('1. 单一可信 anchor、常量 offset：全映射，外推有据', () => {
    const res = preview({
      pageCount: 100,
      entries: [lesson('第1課', 1), lesson('第2課', 12), lesson('第3課', 30)],
      anchors: [{ printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' }],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const [a, b, c] = res.value.lessons;
    expect(a?.physicalStart).toBe(6);
    expect(a?.reason).toBe('anchor-exact');
    expect(b?.physicalStart).toBe(17);
    expect(b?.reason).toBe('single-anchor-extrapolation');
    expect(c?.physicalStart).toBe(35);
    expect(a?.offsetUsed).toBe(5);
    expect(res.value.regions).toEqual([]);
    expect(res.value.diagnostics.mappedCount).toBe(3);
  });

  it('2. 两个同 offset anchor：已验证区间，相邻 end 可算', () => {
    const res = preview({
      pageCount: 100,
      entries: [lesson('第1課', 1), lesson('第2課', 12), lesson('第3課', 30)],
      anchors: [
        { printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' },
        { printedPage: 30, physicalPage: 35, evidence: 'human-confirmed' },
      ],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.regions.length).toBe(1);
    expect(res.value.regions[0]).toMatchObject({ offset: 5, printedFrom: 1, printedTo: 30, verified: true, anchorCount: 2 });
    const [a, b, c] = res.value.lessons;
    expect(b?.reason).toBe('verified-interval');
    // 8. 同 region 相邻 lesson 的 end = 下一条 start - 1
    expect(a?.physicalStart).toBe(6);
    expect(a?.physicalEnd).toBe(16);
    expect(b?.physicalStart).toBe(17);
    expect(b?.physicalEnd).toBe(34);
    // 末课取区间物理尾（30+5=35）
    expect(c?.physicalStart).toBe(35);
    expect(c?.physicalEnd).toBe(35);
  });

  it('3. 页码重启 / offset 不一致：分 region，中间地带 unresolved', () => {
    const res = preview({
      pageCount: 200,
      entries: [lesson('第1課', 1), lesson('第5課', 40), lesson('第6課', 55), lesson('第7課', 65)],
      anchors: [
        { printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' },
        { printedPage: 50, physicalPage: 55, evidence: 'human-confirmed' },
        { printedPage: 60, physicalPage: 60, evidence: 'human-confirmed' },
      ],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.regions.length).toBe(1);
    const segs = res.value.lessons;
    expect(segs[0]?.status).toBe('mapped');
    expect(segs[1]?.status).toBe('mapped');
    expect(segs[1]?.physicalStart).toBe(45);
    // printed 55 夹在 offset 5 与 offset 0 之间：歧义，不得猜
    expect(segs[2]?.status).toBe('unresolved');
    expect(segs[2]?.reason).toBe('between-conflicting-offsets');
    expect(segs[2]?.physicalStart).toBeNull();
    expect(segs[2]?.physicalEnd).toBeNull();
    // printed 65 只有下方 offset 0 邻居：一致外推
    expect(segs[3]?.status).toBe('mapped');
    expect(segs[3]?.physicalStart).toBe(65);
    expect(res.value.diagnostics.ambiguousCount).toBe(1);
  });

  it('4. 前言导致非零 offset：anchor-exact 落点正确', () => {
    const res = preview({
      pageCount: 50,
      entries: [lesson('第1課', 1), lesson('第2課', 10)],
      anchors: [
        { printedPage: 1, physicalPage: 6, evidence: 'embedded-outline' },
        { printedPage: 10, physicalPage: 15, evidence: 'embedded-outline' },
      ],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.lessons[0]?.physicalStart).toBe(6);
    expect(res.value.lessons[0]?.reason).toBe('anchor-exact');
  });

  it('4b. P3.2 thin 永不 preview：单条目直接拒绝', () => {
    const res = preview({
      pageCount: 50,
      entries: [lesson('第1課', 1)],
      anchors: [{ printedPage: 1, physicalPage: 6, evidence: 'embedded-outline' }],
    });
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_INVALID_INPUT');
  });

  it('5. 重复 / 倒序 TOC lesson：fail-closed', () => {
    const dup = preview({
      pageCount: 100,
      entries: [lesson('第1課', 12), lesson('第2課', 12)],
      anchors: [],
    });
    expect(isOk(dup)).toBe(false);
    if (isOk(dup)) return;
    expect(dup.error.code).toBe('E_INVALID_INPUT');
    const desc = preview({
      pageCount: 100,
      entries: [lesson('第1課', 30), lesson('第2課', 12)],
      anchors: [],
    });
    expect(isOk(desc)).toBe(false);
    if (isOk(desc)) return;
    expect(desc.error.code).toBe('E_INVALID_INPUT');
  });

  it('6. 无 anchor：全 unresolved，不伪造页码', () => {
    const res = preview({
      pageCount: 100,
      entries: [lesson('第1課', 12), section('文法', 13)],
      anchors: [],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.lessons.length).toBe(1);
    expect(res.value.lessons[0]?.status).toBe('unresolved');
    expect(res.value.lessons[0]?.reason).toBe('no-anchors');
    expect(res.value.lessons[0]?.physicalStart).toBeNull();
    expect(res.value.chunks).toEqual([]);
    expect(res.value.diagnostics.sectionCountIgnored).toBe(1);
  });

  it('7. anchor 越界 / physical 倒退：fail-closed', () => {
    for (const anchors of [
      [{ printedPage: 1, physicalPage: 0, evidence: 'human-confirmed' as const }],
      [{ printedPage: 1, physicalPage: 101, evidence: 'human-confirmed' as const }],
      [{ printedPage: 101, physicalPage: 101, evidence: 'human-confirmed' as const }],
      [
        { printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' as const },
        { printedPage: 10, physicalPage: 5, evidence: 'human-confirmed' as const },
      ],
      [
        { printedPage: 10, physicalPage: 15, evidence: 'human-confirmed' as const },
        { printedPage: 10, physicalPage: 16, evidence: 'human-confirmed' as const },
      ],
      [{ printedPage: 1, physicalPage: 6, evidence: 'model-confidence' as never }],
    ]) {
      const res = preview({ pageCount: 100, entries: [lesson('第1課', 1)], anchors });
      expect(isOk(res)).toBe(false);
      if (isOk(res)) continue;
      expect(res.error.code).toBe('E_INVALID_INPUT');
    }
  });

  it('9. 下一课 unresolved 时禁止伪造 end', () => {
    const res = preview({
      pageCount: 200,
      entries: [lesson('第5課', 45), lesson('第6課', 55)],
      anchors: [
        { printedPage: 1, physicalPage: 6, evidence: 'human-confirmed' },
        { printedPage: 50, physicalPage: 55, evidence: 'human-confirmed' },
        { printedPage: 60, physicalPage: 60, evidence: 'human-confirmed' },
      ],
    });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // 第5課 mapped（verified），但下一课 unresolved → end 保持 null
    expect(res.value.lessons[0]?.status).toBe('mapped');
    expect(res.value.lessons[0]?.physicalStart).toBe(50);
    expect(res.value.lessons[0]?.physicalEnd).toBeNull();
    expect(res.value.lessons[1]?.status).toBe('unresolved');
    expect(res.value.diagnostics.lessonsWithoutEnd).toBe(1);
    expect(res.value.chunks).toEqual([]);
  });

  it('10. 31/60/61 页 range 严格拆为 ≤30 的 chunk', () => {
    const run = (secondPrinted: number) =>
      preview({
        pageCount: 200,
        entries: [lesson('第1課', 1), lesson('第2課', secondPrinted)],
        anchors: [
          { printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' },
          { printedPage: 100, physicalPage: 100, evidence: 'human-confirmed' },
        ],
      });
    const r31 = run(32);
    expect(isOk(r31)).toBe(true);
    if (!isOk(r31)) return;
    // 第1課 range [1,31] → [1,30],[31,31]
    const chunks31 = r31.value.chunks.filter((c) => c.lessonIndex === 0);
    expect(chunks31.map((c) => [c.physicalFrom, c.physicalTo])).toEqual([[1, 30], [31, 31]]);

    const r60 = run(61);
    expect(isOk(r60)).toBe(true);
    if (!isOk(r60)) return;
    const chunks60 = r60.value.chunks.filter((c) => c.lessonIndex === 0);
    expect(chunks60.map((c) => [c.physicalFrom, c.physicalTo])).toEqual([[1, 30], [31, 60]]);

    const r61 = run(62);
    expect(isOk(r61)).toBe(true);
    if (!isOk(r61)) return;
    const chunks61 = r61.value.chunks.filter((c) => c.lessonIndex === 0);
    expect(chunks61.map((c) => [c.physicalFrom, c.physicalTo])).toEqual([[1, 30], [31, 60], [61, 61]]);

    for (const chunk of [...chunks31, ...chunks60, ...chunks61]) {
      expect(chunk.physicalTo - chunk.physicalFrom + 1).toBeLessThanOrEqual(30);
    }
  });

  it('11. 纯函数零副作用：同步返回、重复调用一致、远超页码映射判越界', () => {
    const input: TocSegmentPreviewInput = {
      pageCount: 100,
      entries: [lesson('第1課', 1), lesson('第9課', 200)],
      anchors: [{ printedPage: 1, physicalPage: 1, evidence: 'human-confirmed' }],
    };
    const first = previewTocSegments(input);
    expect(first instanceof Promise).toBe(false);
    const second = previewTocSegments(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    // printed 200 + offset 0 → 物理 200 > 100：越界 unresolved，不截断伪造
    const last = first.value.lessons[1];
    expect(last?.status).toBe('unresolved');
    expect(last?.reason).toBe('maps-beyond-pagecount');
    expect(first.value.diagnostics.outOfBoundsCount).toBe(1);
  });

  it('非正整数 pageCount / 非法 kind：fail-closed', () => {
    expect(isOk(preview({ pageCount: 0, entries: [], anchors: [] }))).toBe(false);
    const badKind = preview({
      pageCount: 100,
      entries: [{ title: 'x', printedPage: 1, level: 1, kind: 'chapter' as never }],
      anchors: [],
    });
    expect(isOk(badKind)).toBe(false);
    if (isOk(badKind)) return;
    expect(badKind.error.code).toBe('E_INVALID_INPUT');
  });

  it('内联 SHA-256 与 node:crypto 同口径（NIST 向量；改实现先跑本用例）', () => {
    const enc = new TextEncoder();
    expect(sha256HexBytes(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(sha256HexBytes(enc.encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256HexBytes(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
    );
  });
});
