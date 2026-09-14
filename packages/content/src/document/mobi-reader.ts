import { BusinessError } from '@study-studio/shared';

/**
 * MOBI 文本提取（clean-room，自研 PalmDB 解析；只做“学习型文本抽取”，不做排版渲染）。
 *
 * 支持：未压缩（compression=1）的 DRM-free MOBI/AZW（老格式同容器）。
 * 明确拒绝：PalmDOC LZ77（compression=2）、Huffman（17480）、KF8/AZW3（另一套容器，
 * 且多为 DRM 保护）——如实报错，不猜。
 * 产品定位是学习不是阅读：取纯文本进 AST/抽词/组卷，不还原排版图片。
 */

function u16(view: DataView, off: number): number {
  return view.getUint16(off, false);
}

function u32(view: DataView, off: number): number {
  return view.getUint32(off, false);
}

function ascii(bytes: Uint8Array, off: number, len: number): string {
  let out = '';
  for (let i = off; i < off + len; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

const MIN_MOBI_BYTES = 78 + 8 + 32;

/** PalmDB 头解析（魔数校验不过即拒绝）。 */
function parsePalmDb(bytes: Uint8Array): { numRecords: number; recordOffsets: number[] } {
  if (bytes.length < MIN_MOBI_BYTES) {
    throw new BusinessError('E_INVALID_INPUT', '不是有效的 MOBI 文件（过短）', 'VALIDATION', false);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (ascii(bytes, 60, 4) !== 'BOOK' || ascii(bytes, 64, 4) !== 'MOBI') {
    throw new BusinessError(
      'E_INVALID_INPUT',
      '不是 MOBI/AZW 文件（AZW3/KF8 请先转无 DRM 的 EPUB；DRM 保护内容无法导入）',
      'VALIDATION',
      false
    );
  }
  const numRecords = u16(view, 76);
  if (numRecords < 2 || numRecords > 4096) {
    throw new BusinessError('E_INVALID_INPUT', 'MOBI 记录数异常，文件可能已损坏', 'VALIDATION', false);
  }
  const recordOffsets: number[] = [];
  for (let i = 0; i < numRecords; i += 1) {
    const off = u32(view, 78 + i * 8);
    if (off >= bytes.length) {
      throw new BusinessError('E_INVALID_INPUT', 'MOBI 记录偏移越界，文件可能已损坏', 'VALIDATION', false);
    }
    recordOffsets.push(off);
  }
  return { numRecords, recordOffsets };
}

function recordSlice(bytes: Uint8Array, offsets: number[], index: number): Uint8Array {
  const start = offsets[index] ?? 0;
  const end = index + 1 < offsets.length ? (offsets[index + 1] ?? bytes.length) : bytes.length;
  return bytes.subarray(start, Math.min(end, bytes.length));
}

/** zip 条目 → MOBI 正文（抛中文 BusinessError）。 */
export function extractMobiText(bytes: Uint8Array, filename: string): { title: string; markdown: string } {
  const { numRecords, recordOffsets } = parsePalmDb(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const rec0 = recordSlice(bytes, recordOffsets, 0);
  if (rec0.length < 32 || ascii(rec0, 16, 4) !== 'MOBI') {
    throw new BusinessError('E_INVALID_INPUT', 'MOBI 头缺失（可能为 AZW3/KF8），暂不支持', 'VALIDATION', false);
  }
  const rec0View = new DataView(rec0.buffer, rec0.byteOffset, rec0.length);
  // 压缩标记在 PalmDOC 头 +0（1=无压缩，2=PalmDOC LZ，17480=Huffman）
  const compression = u16(rec0View, 0);
  if (compression === 2 || compression === 17480) {
    throw new BusinessError(
      'E_INVALID_INPUT',
      '压缩格式 MOBI 暂不支持（请用 calibre 转无 DRM 的 EPUB 后导入）',
      'VALIDATION',
      false
    );
  }
  if (compression !== 1) {
    throw new BusinessError('E_INVALID_INPUT', `未知 MOBI 压缩方式（${compression}）`, 'VALIDATION', false);
  }
  const encoding = u32(rec0View, 44);
  const decoderLabel = encoding === 65001 ? 'utf-8' : encoding === 1252 ? 'windows-1252' : undefined;
  if (!decoderLabel) {
    throw new BusinessError('E_INVALID_INPUT', 'MOBI 文本编码暂不支持（仅 UTF-8/Windows-1252）', 'VALIDATION', false);
  }
  const textRecordCount = u16(rec0View, 8);
  const count = Math.min(textRecordCount || numRecords - 1, numRecords - 1);
  if (count < 1) {
    throw new BusinessError('E_CONTENT_EMPTY', 'MOBI 没有正文记录', 'VALIDATION', false);
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 1; i <= count; i += 1) {
    const chunk = recordSlice(bytes, recordOffsets, i);
    parts.push(chunk);
    total += chunk.length;
    if (total > 20 * 1024 * 1024) {
      throw new BusinessError('E_INVALID_INPUT', 'MOBI 正文过大（上限 20MB）', 'VALIDATION', false);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  // 末记录 multibyte 补齐字节与 \x00 填充一并清理
  let end = merged.length;
  while (end > 0 && merged[end - 1] === 0) end -= 1;
  const text = new TextDecoder(decoderLabel, { fatal: false })
    .decode(merged.subarray(0, end))
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) {
    throw new BusinessError('E_CONTENT_EMPTY', 'MOBI 正文为空', 'VALIDATION', false);
  }
  const base = filename.split(/[\\/]/).pop() ?? '未命名电子书';
  const title = base.replace(/\.(mobi|azw)$/i, '').trim() || '未命名电子书';
  return { title, markdown: `# ${title}\n\n${text}` };
}
