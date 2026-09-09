/**
 * fontkit 类型垫片：fontkit@1.x 无自带 .d.ts。
 * pdf-lib 自带 Fontkit 结构接口（create(buffer)），垫片只做形状对齐，
 * 运行时仍是真实 fontkit（pdf-lib 做 CJK 子集化必须品）。
 */
declare module 'fontkit' {
  import type { Fontkit } from 'pdf-lib';
  const fontkit: Fontkit;
  export default fontkit;
}
