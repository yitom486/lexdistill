import fontkit from 'fontkit';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { newDeterministicPdf, stabilizePdfBytes } from './gen-common.js';

/**
 * 生成 scanned-lesson-dialect.pdf（3 页无文字层日语课结构扫描页）。
 * 用途：CMD-03 真机锁——像素页 → 本地 OCR → 提升 → 切课（第1課/第2課/復習A42，
 * 会話/練習A 不成课）。句子全部自撰，未抄任何教材原文；说话人用アキ/ミナ。
 * 用法（apps/gateway 下）：bun src/modules/library/__tests__/fixtures/gen/gen-scanned-lesson-dialect.ts
 * 输出：../scanned-lesson-dialect.pdf（确定性字节，重跑一致）。
 *
 * 实现要点：
 * - 页面是整页位图（embed PNG），内容流无 BT/Tj，文本层天然 thin，必走 OCR；
 * - 字形用 fontkit 取 NotoSansJP.ttf 轮廓，自研展平 + 偶奇扫描线填充光栅化
 *   （纯函数、确定性；不依赖系统字体/浏览器 canvas）；
 * - deflate 必须用 node:zlib（Bun.deflateSync 是裸流，pdf-lib 会炸）。
 */
const FONT_PATH = new URL('./NotoSansJP.ttf', import.meta.url);

/** 2x 渲染（595x842pt → 1190x1684px）：标题 64px / 小标题 50px / 正文 44px。 */
const SCALE = 2;
const PAGE_W = 595 * SCALE;
const PAGE_H = 842 * SCALE;
const LEFT = 50 * SCALE;
const TOP_MARGIN = 90 * SCALE;
const BOTTOM_MARGIN = 90 * SCALE;

type OutlineCommand = { command?: string; args?: number[] };

function crc32Table(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (1 + w * 3) + 1);
  }
  const idat = Buffer.from(deflateSync(raw));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

interface FlatEdge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 二次贝塞尔按平坦度递归展平（设备像素系）。 */
function flattenQuad(
  out: Array<{ x: number; y: number }>,
  x0: number, y0: number, cx: number, cy: number, x1: number, y1: number,
  depth: number
): void {
  const mx = (x0 + 2 * cx + x1) / 4;
  const my = (y0 + 2 * cy + y1) / 4;
  const dx = (x0 + x1) / 2 - mx;
  const dy = (y0 + y1) / 2 - my;
  if (depth >= 12 || dx * dx + dy * dy <= 0.16) {
    out.push({ x: x1, y: y1 });
    return;
  }
  const q0x = (x0 + cx) / 2;
  const q0y = (y0 + cy) / 2;
  const q1x = (cx + x1) / 2;
  const q1y = (cy + y1) / 2;
  flattenQuad(out, x0, y0, q0x, q0y, mx, my, depth + 1);
  flattenQuad(out, mx, my, q1x, q1y, x1, y1, depth + 1);
}

function flattenCubic(
  out: Array<{ x: number; y: number }>,
  x0: number, y0: number, c1x: number, c1y: number, c2x: number, c2y: number, x1: number, y1: number,
  depth: number
): void {
  const mx = (x0 + 3 * c1x + 3 * c2x + x1) / 8;
  const my = (y0 + 3 * c1y + 3 * c2y + y1) / 8;
  const dx = (x0 + x1) / 2 - mx;
  const dy = (y0 + y1) / 2 - my;
  if (depth >= 12 || dx * dx + dy * dy <= 0.16) {
    out.push({ x: x1, y: y1 });
    return;
  }
  const a1x = (x0 + c1x) / 2; const a1y = (y0 + c1y) / 2;
  const a2x = (c1x + c2x) / 2; const a2y = (c1y + c2y) / 2;
  const a3x = (c2x + x1) / 2; const a3y = (c2y + y1) / 2;
  const b1x = (a1x + a2x) / 2; const b1y = (a1y + a2y) / 2;
  const b2x = (a2x + a3x) / 2; const b2y = (a2y + a3y) / 2;
  flattenCubic(out, x0, y0, a1x, a1y, b1x, b1y, mx, my, depth + 1);
  flattenCubic(out, mx, my, b2x, b2y, a3x, a3y, x1, y1, depth + 1);
}

interface GlyphRun {
  edges: FlatEdge[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** fontkit 轮廓命令 → 设备像素边集（y 已翻转为位图系，含基线/画笔偏移）。 */
function outlineToEdges(
  commands: OutlineCommand[],
  penX: number,
  baselineY: number,
  scale: number
): GlyphRun {
  const edges: FlatEdge[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let cx = 0;
  let cy = 0;
  let subStart: { x: number; y: number } | null = null;
  const tx = (x: number): number => penX + x * scale;
  const ty = (y: number): number => baselineY - y * scale;
  const pushEdge = (x0: number, y0: number, x1: number, y1: number): void => {
    edges.push({ x0, y0, x1, y1 });
    minX = Math.min(minX, x0, x1);
    maxX = Math.max(maxX, x0, x1);
    minY = Math.min(minY, y0, y1);
    maxY = Math.max(maxY, y0, y1);
  };
  const lineTo = (x: number, y: number): void => {
    const px = tx(x);
    const py = ty(y);
    pushEdge(cx, cy, px, py);
    cx = px;
    cy = py;
  };
  for (const c of commands) {
    const args = Array.isArray(c.args) ? c.args : [];
    if (c.command === 'moveTo' && args.length >= 2) {
      cx = tx(args[0] ?? 0);
      cy = ty(args[1] ?? 0);
      subStart = { x: cx, y: cy };
    } else if (c.command === 'lineTo' && args.length >= 2) {
      lineTo(args[0] ?? 0, args[1] ?? 0);
    } else if (c.command === 'quadraticCurveTo' && args.length >= 4) {
      const pts: Array<{ x: number; y: number }> = [{ x: cx, y: cy }];
      flattenQuad(pts, cx, cy, tx(args[0] ?? 0), ty(args[1] ?? 0), tx(args[2] ?? 0), ty(args[3] ?? 0), 0);
      for (const p of pts.slice(1)) pushEdge(cx, cy, p.x, p.y), (cx = p.x), (cy = p.y);
    } else if (c.command === 'bezierCurveTo' && args.length >= 6) {
      const pts: Array<{ x: number; y: number }> = [{ x: cx, y: cy }];
      flattenCubic(
        pts, cx, cy,
        tx(args[0] ?? 0), ty(args[1] ?? 0), tx(args[2] ?? 0), ty(args[3] ?? 0),
        tx(args[4] ?? 0), ty(args[5] ?? 0), 0
      );
      for (const p of pts.slice(1)) pushEdge(cx, cy, p.x, p.y), (cx = p.x), (cy = p.y);
    } else if (c.command === 'closePath') {
      if (subStart) {
        pushEdge(cx, cy, subStart.x, subStart.y);
        cx = subStart.x;
        cy = subStart.y;
        subStart = null;
      }
    }
  }
  return { edges, minX, maxX, minY, maxY };
}

interface FontFace {
  unitsPerEm: number;
  layout: (text: string) => {
    glyphs: Array<{ path: { commands: OutlineCommand[] } }>;
    positions: Array<{ xAdvance?: number; xOffset?: number; yOffset?: number }>;
  };
}

/** 一行横排文字打进 RGB 位图（黑字白底，偶奇填充）。 */
function drawRun(
  rgb: Uint8Array,
  pageW: number,
  pageH: number,
  font: FontFace,
  text: string,
  xPx: number,
  baselineYPx: number,
  pxSize: number
): void {
  const scale = pxSize / font.unitsPerEm;
  const laid = font.layout(text);
  let penX = xPx;
  for (let i = 0; i < laid.glyphs.length; i++) {
    const glyph = laid.glyphs[i];
    const pos = laid.positions[i] ?? {};
    if (!glyph) {
      penX += (pos.xAdvance ?? 0) * scale;
      continue;
    }
    const run = outlineToEdges(
      glyph.path.commands,
      penX + (pos.xOffset ?? 0) * scale,
      baselineYPx - (pos.yOffset ?? 0) * scale,
      scale
    );
    penX += (pos.xAdvance ?? 0) * scale;
    if (run.edges.length === 0 || !Number.isFinite(run.minY)) continue;
    const y0 = Math.max(0, Math.floor(run.minY));
    const y1 = Math.min(pageH - 1, Math.ceil(run.maxY));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (const e of run.edges) {
        if ((e.y0 <= yc && yc < e.y1) || (e.y1 <= yc && yc < e.y0)) {
          xs.push(e.x0 + ((yc - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k] ?? 0;
        const xb = xs[k + 1] ?? 0;
        const xStart = Math.max(0, Math.ceil(xa - 0.5));
        const xEnd = Math.min(pageW - 1, Math.floor(xb - 0.5));
        for (let x = xStart; x <= xEnd; x++) {
          const o = (y * pageW + x) * 3;
          rgb[o] = 0;
          rgb[o + 1] = 0;
          rgb[o + 2] = 0;
        }
      }
    }
  }
}

interface PlacedLine {
  text: string;
  size: number;
  /** 行间距系数（相对字号） */
  gap: number;
}

function renderPage(font: FontFace, lines: PlacedLine[]): Uint8Array {
  const rgb = new Uint8Array(PAGE_W * PAGE_H * 3).fill(255);
  let y = TOP_MARGIN;
  for (const line of lines) {
    y += line.size;
    drawRun(rgb, PAGE_W, PAGE_H, font, line.text, LEFT, y, line.size);
    y += Math.round(line.size * line.gap);
    if (y > PAGE_H - BOTTOM_MARGIN) {
      throw new Error(`版面溢出：${line.text.slice(0, 12)}（调小字号或行数）`);
    }
  }
  return rgb;
}

/** 自撰三页课结构（未抄任何教材原文；说话人用アキ/ミナ）。 */
function pageLines(): PlacedLine[][] {
  const title = (text: string): PlacedLine => ({ text, size: 64, gap: 0.9 });
  const h2 = (text: string): PlacedLine => ({ text, size: 50, gap: 0.8 });
  const body = (text: string): PlacedLine => ({ text, size: 44, gap: 0.75 });
  return [
    [
      title('第1課'),
      h2('会話'),
      body('アキ：きょうは いい てんきですね。'),
      body('ミナ：そうですね。さんぽしましょう。'),
      h2('練習A'),
      body('れんしゅうしましょう。'),
    ],
    [
      title('第2課'),
      h2('会話'),
      body('アキ：これは なんですか。'),
      body('ミナ：それは わたしの かさです。'),
    ],
    [
      title('復習A42'),
      body('ふくしゅうしましょう。'),
      body('もういちど いってください。'),
    ],
  ];
}

export async function buildScannedLessonDialectPdf(): Promise<Uint8Array> {
  const fontBytes = Buffer.from(await Bun.file(FONT_PATH).arrayBuffer());
  const font = fontkit.create(fontBytes) as unknown as FontFace;
  const pdf = await newDeterministicPdf();
  for (const lines of pageLines()) {
    const rgb = renderPage(font, lines);
    const png = await pdf.embedPng(encodePng(PAGE_W, PAGE_H, rgb));
    const page = pdf.addPage([595, 842]);
    page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
  }
  return stabilizePdfBytes(await pdf.save());
}

async function main(): Promise<void> {
  const out = await buildScannedLessonDialectPdf();
  const outPath = new URL('../scanned-lesson-dialect.pdf', import.meta.url);
  await Bun.write(outPath, out);
  console.log(`wrote ${outPath.pathname} (${out.length} bytes)`);
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
