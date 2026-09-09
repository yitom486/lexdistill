import { PDFDocument } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { newDeterministicPdf, stabilizePdfBytes } from './gen-common.js';

/**
 * 生成 scanned-shapes-no-text.pdf（1 页纯形状无字：白底 + 黑色横条）。
 * 用途：触发 OCR 路由（pagesNeedingOcr），验证零产出友好失败（E_OCR_LANG_UNSUPPORTED，
 * 文案不得断言语种），且不打 Azure。
 * 用法（apps/gateway 下）：bun src/modules/library/__tests__/fixtures/gen/gen-scanned-shapes.ts
 * 输出：../scanned-shapes-no-text.pdf（确定性字节，重跑一致）。
 * 注意：手写 PNG 必须用 node:zlib 的 deflateSync（zlib 包装），Bun.deflateSync 是裸流，pdf-lib 会炸。
 */
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

function makePng(w: number, h: number): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw: number[] = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) {
      const bar = (y > 30 && y < 42 && x > 20 && x < 180) || (y > 60 && y < 72 && x > 20 && x < 150);
      const v = bar ? 0 : 255;
      raw.push(v, v, v);
    }
  }
  const idat = Buffer.from(deflateSync(Buffer.from(raw)));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

async function main(): Promise<void> {
  const pdf = await newDeterministicPdf();
  const png = await pdf.embedPng(makePng(200, 120));
  const page = pdf.addPage([595, 842]);
  page.drawImage(png, { x: 50, y: 600, width: 400, height: 240 });
  const out = stabilizePdfBytes(await pdf.save());
  const outPath = new URL('../scanned-shapes-no-text.pdf', import.meta.url);
  await Bun.write(outPath, out);
  console.log(`wrote ${outPath.pathname} (${out.length} bytes)`);
}

await main();
process.exit(0);
