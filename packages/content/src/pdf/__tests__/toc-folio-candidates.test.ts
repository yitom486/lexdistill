import { describe, expect, it } from 'bun:test';
import {
  FOLIO_CANDIDATE_MAX_PAGES,
  detectFolioCandidates,
  type FolioGeometryItem,
} from '../../index.js';

/**
 * M8-7：自 Gateway 迁入（P5B 纯函数单测；自造坐标，不读私人教材）。
 * Gateway 侧保留编排（mock）与真机位测试，本文件只覆盖纯检测闭包。
 */

function item(text: string, x: number, y: number, height = 12): FolioGeometryItem {
  return { text, x, y, height };
}

function frozen<T>(value: T): T {
  const snapshot = JSON.stringify(value);
  const copy = JSON.parse(snapshot) as T;
  const first = detectFolioCandidates(copy as FolioGeometryItem[], 'native');
  const second = detectFolioCandidates(copy as FolioGeometryItem[], 'native');
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  return copy;
}

describe('P5B detectFolioCandidates（纯函数）', () => {
  it('上限锁死 8 页', () => {
    expect(FOLIO_CANDIDATE_MAX_PAGES).toBe(8);
  });

  it('footer 孤立 Arabic 页码命中（native → medium）', () => {
    const items = frozen([
      item('第一章 はじめに 会話', 50, 600, 14),
      item('本文の内容が続きます 段落', 50, 580, 14),
      item('12', 280, 40),
    ]);
    const found = detectFolioCandidates(items, 'native');
    expect(found).toEqual([
      { raw: '12', normalized: { kind: 'arabic', value: 12 }, location: 'footer', source: 'native', confidence: 'medium' },
    ]);
  });

  it('header Roman 页码命中（只给大写原形，绝不转数字）', () => {
    const found = detectFolioCandidates(
      [item('Body line one here', 50, 400), item('Body line two here', 50, 380), item('iv', 280, 750)],
      'native'
    );
    expect(found.length).toBe(1);
    expect(found[0]?.normalized).toEqual({ kind: 'roman', value: 'IV' });
    expect(found[0]?.location).toBe('header');
    // roman 归一化里没有数字值可误用为 anchor
    expect(typeof (found[0]?.normalized as { value?: unknown }).value).toBe('string');
  });

  it('中央 2026 / 水印数字拒绝（不在边带；边带内年份超限也拒绝）', () => {
    const central = detectFolioCandidates(
      [item('Body line one here', 50, 600), item('Body line two here', 50, 580), item('2026', 280, 400)],
      'native'
    );
    expect(central).toEqual([]);
    const footerYear = detectFolioCandidates(
      [item('Body line one here', 50, 600), item('Body line two here', 50, 580), item('2026', 280, 40)],
      'native'
    );
    expect(footerYear).toEqual([]);
  });

  it('行内数字 / 习题序号 / 表格数字拒绝', () => {
    const body = [item('Body line one here', 50, 600), item('Body line two here', 50, 580)];
    expect(detectFolioCandidates([...body, item('第1課 会話 12', 50, 40)], 'native')).toEqual([]);
    expect(detectFolioCandidates([...body, item('練習3', 50, 40)], 'native')).toEqual([]);
    expect(detectFolioCandidates([...body, item('A | 12 | B', 50, 40)], 'native')).toEqual([]);
    expect(detectFolioCandidates([...body, item('010-1234-5678', 50, 40)], 'native')).toEqual([]);
  });

  it('同页 header/footer 冲突并列保留，绝不仲裁', () => {
    const found = detectFolioCandidates(
      [item('Body line one here', 50, 400), item('Body line two here', 50, 380), item('vii', 280, 750), item('88', 280, 40)],
      'native'
    );
    expect(found.length).toBe(2);
    expect(found.map((c) => c.location).sort()).toEqual(['footer', 'header']);
  });

  it('候选形状恒为五键（无 anchor 字段可误用）', () => {
    const found = detectFolioCandidates(
      [item('Body line one here', 50, 400), item('Body line two here', 50, 380), item('·12', 280, 40)],
      'ocr'
    );
    expect(found.length).toBe(1);
    expect(Object.keys(found[0] ?? {}).sort()).toEqual(['confidence', 'location', 'normalized', 'raw', 'source']);
    expect(found[0]?.confidence).toBe('low');
    expect(found[0]?.raw).toBe('·12');
    expect(found[0]?.normalized).toEqual({ kind: 'arabic', value: 12 });
  });

  it('证据不足（<3 条）直接无候选，不猜边带', () => {
    expect(detectFolioCandidates([item('12', 280, 40)], 'native')).toEqual([]);
  });
});
