import { describe, expect, it } from 'bun:test';
import { normalizeLessonDisplayTitle } from '../lesson-display-title.js';

/**
 * P1-B1 display-title 原型回归（纯函数，未接入业务）。
 * 语料来自真实库 textbook_lessons 77 个去重 title（2026-09-10 只读扫描），分四类：
 * - high-confidence lesson label：必须原样提取
 * - contextual section（練習A/付録等）：永不升格为课次，必须 null
 * - noisy but recoverable：去噪后提取
 * - ambiguous/unresolved：必须 null（不得臆造课号）
 */
describe('normalizeLessonDisplayTitle（P1-B1 原型）', () => {
  it('high-confidence：裸课号原样提取', () => {
    expect(normalizeLessonDisplayTitle('第10課')).toBe('第10課');
    expect(normalizeLessonDisplayTitle('第1課')).toBe('第1課');
    expect(normalizeLessonDisplayTitle('復習A')).toBe('復習A');
    expect(normalizeLessonDisplayTitle('復習B')).toBe('復習B');
    expect(normalizeLessonDisplayTitle('  第13課  ')).toBe('第13課');
  });

  it('contextual section：練習A/付録/問題永不升格', () => {
    expect(normalizeLessonDisplayTitle('練習A')).toBeNull();
    expect(normalizeLessonDisplayTitle('練習C')).toBeNull();
    expect(normalizeLessonDisplayTitle('付録')).toBeNull();
    expect(normalizeLessonDisplayTitle('問題')).toBeNull();
    expect(normalizeLessonDisplayTitle('IV. 数字')).toBeNull();
    expect(normalizeLessonDisplayTitle('ⅡI.教室のことば')).toBeNull();
    expect(normalizeLessonDisplayTitle('初めまして')).toBeNull();
    expect(normalizeLessonDisplayTitle('うふくしゃう総復習')).toBeNull();
  });

  it('noisy but recoverable：OCR 前缀/页码尾缀去噪', () => {
    expect(normalizeLessonDisplayTitle('だい -第11課')).toBe('第11課');
    expect(normalizeLessonDisplayTitle('だい 方第12課')).toBe('第12課');
    expect(normalizeLessonDisplayTitle('だい 1第9課')).toBe('第9課');
    expect(normalizeLessonDisplayTitle('だい 』第16課')).toBe('第16課');
    expect(normalizeLessonDisplayTitle('-店第3課')).toBe('第3課');
    expect(normalizeLessonDisplayTitle('ほ第8課')).toBe('第8課');
    expect(normalizeLessonDisplayTitle('第10課 118')).toBe('第10課');
    expect(normalizeLessonDisplayTitle('第24課 294')).toBe('第24課');
    expect(normalizeLessonDisplayTitle('ふくしゃう 復習A')).toBe('復習A');
    expect(normalizeLessonDisplayTitle('ふくしゆう 復習B')).toBe('復習B');
    expect(normalizeLessonDisplayTitle('ふくしはう 復習D')).toBe('復習D');
  });

  it('ambiguous/unresolved：无 token 或坏 token 一律 null', () => {
    expect(normalizeLessonDisplayTitle('学生')).toBeNull();
    expect(normalizeLessonDisplayTitle('会社员')).toBeNull();
    expect(normalizeLessonDisplayTitle('安法')).toBeNull();
    expect(normalizeLessonDisplayTitle('肇語')).toBeNull();
    // 字母被 OCR 打坏（ç≠C）：不得猜是復習C
    expect(normalizeLessonDisplayTitle('ふくしゃう 復習ç')).toBeNull();
    expect(normalizeLessonDisplayTitle('から来ました。')).toBeNull();
    expect(normalizeLessonDisplayTitle('4.例：あなたは（学生）ですか。')).toBeNull();
    expect(normalizeLessonDisplayTitle('')).toBeNull();
    expect(normalizeLessonDisplayTitle(null)).toBeNull();
    expect(normalizeLessonDisplayTitle(undefined)).toBeNull();
  });

  it('互斥双 token：不得二选一，回 null', () => {
    expect(normalizeLessonDisplayTitle('第10課 第11課')).toBeNull();
    expect(normalizeLessonDisplayTitle('第3課 復習A')).toBeNull();
  });

  it('同 token 复读（页眉回声）：去重后唯一即提取', () => {
    expect(normalizeLessonDisplayTitle('第11課 だい -第11課')).toBe('第11課');
  });

  it('拉丁形态（种子英文书）：lesson/unit + 数字', () => {
    expect(normalizeLessonDisplayTitle('Lesson 1 Excuse me! (对不起，请原谅)')).toBe('Lesson 1');
  });
});
