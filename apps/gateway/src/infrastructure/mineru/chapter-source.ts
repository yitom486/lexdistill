import { JSDOM } from 'jsdom';
import { z } from 'zod';
import { ChapterSourceSchema, type ChapterSource, type ChapterSourceBlock } from '@study-studio/document-model';
import { BusinessError } from '@study-studio/shared';

const bbox = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);
const cloudBlock = z.object({ type: z.string(), bbox: bbox.nullish(), content: z.string().nullish() });
const cloudPages = z.array(z.array(cloudBlock));

/** HTML 仅作为表格输入读取；不执行脚本、不把任意 HTML 注入桌面。 */
function tableRows(html: string): string[][] {
  const dom = new JSDOM(html);
  try { return [...dom.window.document.querySelectorAll('tr')].map(row => [...row.querySelectorAll('td,th')].map(cell => cell.textContent?.trim() ?? '')); }
  finally { dom.window.close(); }
}

function checked(blocks: ChapterSourceBlock[], parser: ChapterSource['parser']): ChapterSource {
  const result = ChapterSourceSchema.safeParse({ parser, blocks });
  if (!result.success || !blocks.some(block => block.text.trim() || block.rows?.some(row => row.some(cell => cell.trim())))) {
    throw new BusinessError('E_PARSE_CONTENT_INVALID', '解析结果没有可用的章节内容，请核对页码和解析服务', 'VALIDATION', true);
  }
  return result.data;
}

/** 采用逐页原始模型输出，避免 content_list 后处理跨页合并造成词条串行。 */
export function cloudChapterSource(raw: unknown, physicalPages: readonly number[]): ChapterSource {
  const parsed = cloudPages.safeParse(raw);
  if (!parsed.success || parsed.data.length !== physicalPages.length) throw new BusinessError('E_PARSE_PAGE_MAP_INVALID', '解析结果页数或格式与提交章节不一致', 'VALIDATION', true, parsed.success ? undefined : parsed.error.issues);
  const blocks: ChapterSourceBlock[] = [];
  parsed.data.forEach((page, pageIndex) => page.forEach((block, blockIndex) => {
    if (!block.content && block.type !== 'image') return;
    const kind = block.type === 'table' ? 'TABLE' : block.type === 'image' ? 'IMAGE' : block.type === 'paragraph_title' ? 'TITLE' : 'TEXT';
    blocks.push({ id: `p${physicalPages[pageIndex]}b${blockIndex}`, page: physicalPages[pageIndex]!, kind, text: block.content ?? '',
      ...(block.bbox ? { bbox: block.bbox } : {}), ...(kind === 'TABLE' ? { rows: tableRows(block.content ?? '') } : {}) });
  }));
  return checked(blocks, 'mineru-cloud');
}

/** 当前本地 V1 structured_content 契约；不兼容废弃 file_parse 返回。 */
export function localChapterSource(raw: unknown, physicalPages: readonly number[]): ChapterSource {
  const result = z.object({ pages: z.array(z.object({ page_idx: z.number().int().nonnegative(), blocks: z.array(z.object({
    type: z.string(), content: z.string(), bbox: bbox.nullish(),
    captions: z.array(z.object({ content: z.string() })).optional(), footnotes: z.array(z.object({ content: z.string() })).optional(),
  }).passthrough()) })) }).safeParse(raw);
  if (!result.success || result.data.pages.length !== physicalPages.length || new Set(result.data.pages.map(page => page.page_idx)).size !== physicalPages.length) {
    throw new BusinessError('E_PARSE_PAGE_MAP_INVALID', '本地解析返回的页数或结构不正确，请检查 MinerU V1 服务', 'VALIDATION', true);
  }
  const blocks: ChapterSourceBlock[] = [];
  for (const page of result.data.pages) {
    const physicalPage = physicalPages[page.page_idx];
    if (!physicalPage) throw new BusinessError('E_PARSE_PAGE_MAP_INVALID', '本地解析返回了章节范围以外的页码', 'VALIDATION', true);
    page.blocks.forEach((block, index) => {
      const text = [block.content, ...(block.captions ?? []).map(part => part.content), ...(block.footnotes ?? []).map(part => part.content)].filter(Boolean).join('\n');
      const kind = block.type === 'table' ? 'TABLE' : ['image', 'chart', 'equation'].includes(block.type) ? 'IMAGE' : ['doc_title', 'paragraph_title'].includes(block.type) ? 'TITLE' : 'TEXT';
      blocks.push({ id: `p${physicalPage}b${index}`, page: physicalPage, kind, text, ...(block.bbox ? { bbox: block.bbox } : {}), ...(kind === 'TABLE' ? { rows: tableRows(block.content) } : {}) });
    });
  }
  return checked(blocks, 'mineru-local');
}
