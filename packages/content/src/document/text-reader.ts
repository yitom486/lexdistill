import { BusinessError } from '@study-studio/shared';

/**
 * 纯文本/ Markdown 解码（clean-room）。
 * UTF-8 解码（BOM 剥离，非严格：坏字节替换而非整包拒绝）；标题取文件名。
 */

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export function decodeTextBytes(
  bytes: Uint8Array,
  filename: string
): { title: string; markdown: string } {
  if (bytes.length === 0 || bytes.length > MAX_TEXT_BYTES) {
    throw new BusinessError('E_INVALID_INPUT', '文本为空或过大（上限 5MB）', 'VALIDATION', false);
  }
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) {
    throw new BusinessError('E_CONTENT_EMPTY', '文本没有任何实质内容', 'VALIDATION', false);
  }
  const base = filename.split(/[\\/]/).pop() ?? '未命名文本';
  const title = base.replace(/\.(txt|md|markdown)$/i, '').trim() || '未命名文本';
  return { title, markdown: text };
}
