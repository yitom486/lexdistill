import { rgb, type PDFPage } from 'pdf-lib';
import fontkit from 'fontkit';
import { Buffer } from 'node:buffer';
import { newDeterministicPdf, stabilizePdfBytes } from './gen-common.js';

/**
 * 生成 rich-textbook-toc-review.pdf（5 页真文本日语教材，见 README）。
 * 用法（apps/gateway 下）：bun src/modules/library/__tests__/fixtures/gen/gen-rich-textbook.ts
 * 输出：../rich-textbook-toc-review.pdf（确定性字节，重跑一致）。
 */
const FONT_PATH = new URL('./NotoSansJP.ttf', import.meta.url);

async function main(): Promise<void> {
  const pdf = await newDeterministicPdf();
  pdf.registerFontkit(fontkit);
  const fontBytes = Buffer.from(await Bun.file(FONT_PATH).arrayBuffer());
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const W = 595;
  const H = 842;
  const title = (page: PDFPage, text: string, y: number): void => {
    page.drawText(text, { x: 50, y, size: 20, font, color: rgb(0, 0, 0) });
  };
  const h2 = (page: PDFPage, text: string, y: number): void => {
    page.drawText(text, { x: 50, y, size: 14, font });
  };
  const body = (page: PDFPage, text: string, y: number): void => {
    page.drawText(text, { x: 50, y, size: 11, font });
  };

  // ---- p1 目录（普通点线 + J1 断行 + J2 前置同行 + 復習 + 付録） ----
  {
    const p = pdf.addPage([W, H]);
    let y = 780;
    title(p, '目次', y);
    y -= 40;
    for (const t of [
      '第1課 はじめまして ................ 2',
      '第2課 これは本です ................ 3',
      '復習A ............................ 4',
      '付録 ............................. 5',
    ]) {
      body(p, t, y);
      y -= 22;
    }
    y -= 10;
    body(p, '第3課 さんぽ …………………', y);
    y -= 22; // J1：点线结尾，页码掉下一行
    body(p, '30', y);
    y -= 22;
    y -= 10;
    body(p, '31', y);
    y -= 22; // J2：裸页码在前，裸标题在后（inspector 常合并成同行，测分支三）
    body(p, '第4課 てんき', y);
    y -= 22;
  }
  // ---- p2 第1課（含无标记前言，测并入首课） ----
  {
    const p = pdf.addPage([W, H]);
    let y = 780;
    h2(p, 'まえがき', y);
    y -= 22;
    body(p, 'この本は にほんごの きょうかしょです。', y);
    y -= 30;
    title(p, '第1課 はじめまして', y);
    y -= 32;
    h2(p, '会話', y);
    y -= 24;
    body(p, 'アキ：はじめまして。わたしはアキです。', y);
    y -= 20;
    body(p, 'ミナ：はじめまして。ミナです。よろしくおねがいします。', y);
    y -= 28;
    h2(p, 'ことば', y);
    y -= 24;
    body(p, 'わたし - I', y);
    y -= 20;
    body(p, 'はじめまして - Nice to meet you', y);
    y -= 28;
    h2(p, '文法', y);
    y -= 24;
    body(p, 'N は N です。', y);
    y -= 20;
    body(p, 'わたしはアキです。', y);
    y -= 28;
    h2(p, '練習', y);
    y -= 24;
    body(p, '1. わたしはミナです。', y);
    y -= 20;
    body(p, '2. あなたは学生ですか。', y);
    y -= 20;
  }
  // ---- p3 第2課 ----
  {
    const p = pdf.addPage([W, H]);
    let y = 780;
    title(p, '第2課 これは本です', y);
    y -= 32;
    h2(p, '会話', y);
    y -= 24;
    body(p, 'アキ：これは本ですか。', y);
    y -= 20;
    body(p, 'ミナ：はい、それは日本語の本です。', y);
    y -= 28;
    h2(p, 'ことば', y);
    y -= 24;
    body(p, 'これ - this', y);
    y -= 20;
    body(p, '本 - book', y);
    y -= 28;
    h2(p, '文法', y);
    y -= 24;
    body(p, 'これ は N です。', y);
    y -= 20;
    body(p, 'これは本です。', y);
    y -= 28;
    h2(p, '練習', y);
    y -= 24;
    body(p, '1. これは辞書です。', y);
    y -= 20;
    body(p, '2. それは何ですか。', y);
    y -= 20;
  }
  // ---- p4 復習A（非数字章节） ----
  {
    const p = pdf.addPage([W, H]);
    let y = 780;
    title(p, '復習A', y);
    y -= 32;
    body(p, '1. わたしはアキです。', y);
    y -= 20;
    body(p, '2. これは本です。', y);
    y -= 20;
  }
  // ---- p5 付録（无切课标记，应并入上一课） ----
  {
    const p = pdf.addPage([W, H]);
    let y = 780;
    h2(p, '付録', y);
    y -= 24;
    body(p, 'あ - a', y);
    y -= 20;
    body(p, 'い - i', y);
    y -= 20;
  }
  const out = stabilizePdfBytes(await pdf.save());
  const outPath = new URL('../rich-textbook-toc-review.pdf', import.meta.url);
  await Bun.write(outPath, out);
  console.log(`wrote ${outPath.pathname} (${out.length} bytes)`);
}

await main();
process.exit(0);
