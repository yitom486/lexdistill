import { PDFDocument } from 'pdf-lib';
import { Buffer } from 'node:buffer';

/**
 * fixture 生成公共件：确定性输出。
 * - 固定 CreationDate/ModificationDate（pdf-lib 默认写当前时间）；
 * - trailer /ID 固定（pdf-lib 每次随机，必须抹掉，否则 git 每次 diff 全变）。
 */
export const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');
const FIXED_ID = '0'.repeat(32);

export function stabilizePdfBytes(raw: Uint8Array): Uint8Array {
  const text = Buffer.from(raw).toString('latin1');
  const fixed = text.replace(/\/ID\s*\[\s*<[0-9a-fA-F]{32}>\s*<[0-9a-fA-F]{32}>\s*\]/g, `/ID [<${FIXED_ID}><${FIXED_ID}>]`);
  return new Uint8Array(Buffer.from(fixed, 'latin1'));
}

export async function newDeterministicPdf(): Promise<PDFDocument> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  return pdf;
}
