import { pdfReadingInstructions, type PdfTaskFile } from '../pdf-import/pdf-task-workspace.js';
export interface TocExtractionPromptInput {
  title?: string | undefined; language?: string | undefined; pdfFile: PdfTaskFile;
}

const CORE_LINES = [
  '保留真实父子层级：成课为 lesson，单元为 unit，其余条目为 section；小标题通过 parentIndex 归属父节点，独立章节不强行归入上一课。',
  'entries 使用教材印刷页码；tocEndPage 填实际目录末页的原 PDF 物理页码，可确认物理页与印刷页的对应时填写 pageOffset。不要把本次提供的文件结束页当目录结束页。',
  '使用 library_propose_toc 提交草稿；只依据当前文件，不新增工具未声明的字段。',
];

/** Codex 通路：Agent 原生读文件（路径指令）。 */
export function buildTocExtractionPrompt(input: TocExtractionPromptInput): string {
  return [
    '读取当前 PDF，找到实际目录并按阅读顺序提交树状目录。文件可能还包含封面、前言和正文，不把这些都当目录。没有目录时明确说明，不猜目录。',
    ...CORE_LINES,
    ...(input.title ? [`教材：${input.title}`] : []),
    ...(input.language ? [`语种：${input.language}`] : []),
    pdfReadingInstructions(input.pdfFile),
  ].join('\n\n');
}

/**
 * ACP 通路：无原生文件读取，文字内嵌（调用方按原物理页取字，空页已剔除）。
 * 页分隔标注原物理页，tocEndPage 照此对应；扫描版（images 非空）不得走此通路。
 */
export function buildTocExtractionPromptForEmbeddedText(
  input: TocExtractionPromptInput,
  pageTexts: Array<{ originalPage: number; text: string }>,
): string {
  const blocks = pageTexts.map(entry => `【原PDF第${entry.originalPage}页】\n${entry.text}`).join('\n\n');
  return [
    '下面是原 PDF 指定页的文字（按【原PDF第X页】分隔，只依据这些文字找实际目录并按阅读顺序提交树状目录）。文件可能还包含封面、前言和正文，不把这些都当目录。没有目录时明确说明，不猜目录。',
    ...CORE_LINES,
    ...(input.title ? [`教材：${input.title}`] : []),
    ...(input.language ? [`语种：${input.language}`] : []),
    `目录候选文字：\n${blocks}`,
  ].join('\n\n');
}
