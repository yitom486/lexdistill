import { describe, expect, it } from 'bun:test';
import { arbitraryColorUtility, dynamicColorConcat, styleContextColor, utilityColorLiteral } from '../color-gate.js';

/**
 * P3.5-FIX2 门禁匹配器单测（失败测试先行）。
 * 历史教训：bg-amber-500/[0.04] 曾漏网——小数/bracket opacity、variant 前缀、
 * arbitrary opacity 必须全部识别。
 */
describe('P3.5-FIX2 color-gate 匹配器', () => {
  it('识别小数与 bracket opacity', () => {
    expect(utilityColorLiteral('x bg-amber-500/[0.04] y')).toEqual(['bg-amber-500/[0.04]']);
    expect(utilityColorLiteral('x text-stone-500/80 y')).toEqual(['text-stone-500/80']);
    expect(utilityColorLiteral('x bg-white/8 y')).toEqual(['bg-white/8']);
  });

  it('穿透 variant 前缀（含 dark:hover: 双前缀）', () => {
    expect(utilityColorLiteral('hover:bg-red-500')).toEqual(['bg-red-500']);
    expect(utilityColorLiteral('dark:text-stone-100')).toEqual(['text-stone-100']);
    expect(utilityColorLiteral('dark:hover:bg-amber-950/40')).toEqual(['bg-amber-950/40']);
    expect(utilityColorLiteral('data-[highlighted]:bg-amber-100')).toEqual(['bg-amber-100']);
  });

  it('识别 arbitrary 颜色与 opacity 后缀', () => {
    expect(arbitraryColorUtility('bg-[#1a1917]')).toEqual(['bg-[#1a1917]']);
    expect(arbitraryColorUtility('bg-[#1a1917]/85')).toEqual(['bg-[#1a1917]/85']);
    expect(arbitraryColorUtility('text-[rgb(0,0,0)]')).toEqual(['text-[rgb(0,0,0)]']);
    // 尺寸类放行
    expect(arbitraryColorUtility('text-[10px]')).toEqual([]);
    expect(arbitraryColorUtility('w-[90vw]')).toEqual([]);
  });

  it('放行语义 token 与透明关键字', () => {
    expect(utilityColorLiteral('bg-toc-surface text-toc-strong')).toEqual([]);
    expect(utilityColorLiteral('bg-transparent border-transparent')).toEqual([]);
    expect(arbitraryColorUtility('bg-[var(--toc-surface)]')).toEqual([]);
  });

  it('识别 className/style 上下文 hex', () => {
    expect(styleContextColor('className="a bg-[#211e1b] b"')).toEqual(['className hex #211e1b']);
    expect(styleContextColor('style={{ color: "#fff" }}')).toEqual(['style hex #fff']);
  });

  it('识别 style 命名色与 hsl/oklch（P3.5-FIX2-A4）', () => {
    expect(styleContextColor(`style={{ color: 'red' }}`)).toEqual(['style named red']);
    expect(styleContextColor('style={{ background: "hsl(0, 0%, 100%)" }}')).toEqual(['style fn hsl(']);
    expect(styleContextColor('style={{ borderColor: "oklch(50% 0.1 200)" }}')).toEqual(['style fn oklch(']);
    // transparent 永远放行
    expect(styleContextColor(`style={{ color: 'transparent' }}`)).toEqual([]);
  });

  it('识别 arbitrary 命名色（P3.5-FIX2-A4）', () => {
    expect(arbitraryColorUtility('text-[red]')).toEqual(['text-[red]']);
    expect(arbitraryColorUtility('text-[10px]')).toEqual([]);
  });

  it('识别动态 class 拼接（P3.5-FIX2-A4）', () => {
    expect(dynamicColorConcat('`bg-${tone}`')).toHaveLength(1);
    expect(dynamicColorConcat(`'text-' + size`)).toHaveLength(1);
    expect(dynamicColorConcat('`text-base font-bold`')).toEqual([]);
    expect(dynamicColorConcat(`'hello world'`)).toEqual([]);
  });
});
