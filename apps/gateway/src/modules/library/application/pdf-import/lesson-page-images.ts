import type { AgentImageAttachment } from '@study-studio/agent-runtime';
import { BusinessError } from '@study-studio/shared';
import type { PdfInspectorLike, RenderedPagePng } from '../../../../infrastructure/pdf-runtime/pdf-runtime.js';

// PDFium 单次最多 8 页；完整课程可包含多批，不能据此截断课程。
export const LESSON_RENDER_BATCH_PAGES = 8;
export const LESSON_RENDER_DPI = 200;
// 与 Agent 当前的单轮图片传输预算一致；不将 PNG 持久化进业务记录。
export const LESSON_IMAGE_BYTES_LIMIT = 32 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function renderLessonImages(
  pdf: Uint8Array, pages: number[], inspector: PdfInspectorLike, signal: AbortSignal,
  timeoutMs: number, cache: Map<number, RenderedPagePng[]>,
): Promise<AgentImageAttachment[]> {
  const render = inspector.renderPdfPages;
  if (!render) throw new BusinessError('E_PDF_RENDER_UNAVAILABLE', '当前 PDF 运行时不支持图片渲染，请重启应用更新运行时后重试', 'TOOL_EXECUTION');
  const images: AgentImageAttachment[] = [];
  let bytes = 0;
  for (let offset = 0; offset < pages.length; offset += LESSON_RENDER_BATCH_PAGES) {
    if (signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
    const requested = pages.slice(offset, offset + LESSON_RENDER_BATCH_PAGES);
    let rendered = cache.get(offset);
    if (!rendered) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: (() => void) | undefined;
      try {
        rendered = await Promise.race([
          render.call(inspector, pdf, requested, { dpi: LESSON_RENDER_DPI }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new BusinessError('E_PDF_RENDER_TIMEOUT', '本课图片准备超时，请重试本课', 'TOOL_EXECUTION', true)), timeoutMs);
            cancel = () => reject(new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION'));
            signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted) cancel();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        if (cancel) signal.removeEventListener('abort', cancel);
      }
      if (rendered.length !== requested.length || rendered.some((page, index) =>
        page.pageNumber !== requested[index] || !Number.isFinite(page.width) || page.width <= 0 ||
        !Number.isFinite(page.height) || page.height <= 0 || !(page.png instanceof Uint8Array) ||
        PNG_SIGNATURE.some((byte, i) => page.png[i] !== byte))) {
        throw new BusinessError('E_PDF_RENDER_INVALID', '本课图片不完整或顺序不正确，请重试本课', 'TOOL_EXECUTION', true);
      }
      cache.set(offset, rendered);
    }
    for (const page of rendered) {
      bytes += page.png.byteLength;
      if (bytes > LESSON_IMAGE_BYTES_LIMIT) throw new BusinessError('E_CHAPTER_IMAGES_TOO_LARGE', '本课图片超过单次发送容量，请缩小本课范围或手动选择文字解析方式', 'VALIDATION');
      images.push({ png: page.png, label: `本课第 ${images.length + 1} 张图片` });
    }
  }
  if (signal.aborted) throw new BusinessError('E_CANCELLED', '教材提取已取消', 'TOOL_EXECUTION');
  return images;
}
