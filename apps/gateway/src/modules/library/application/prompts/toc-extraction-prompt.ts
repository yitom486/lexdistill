import { pdfReadingInstructions, type PdfTaskFile } from '../pdf-import/pdf-task-workspace.js';
export interface TocExtractionPromptInput {
  title?: string | undefined; language?: string | undefined; pdfFile: PdfTaskFile;
}

const CORE_LINES = [
  '【目录语义角色划分（以排版缩进与视觉层级为准，不依赖死板名称）】：',
  '1. 单元外壳 (unit)：顶格/无缩进/加粗大标题（如“第1单元”、“UNIT 1”、“Part 1”等），作为外层组织容器，无父节点，省略 parentIndex。若教材本身无单元、正文成课直接顶格排版，则成课直接作为顶层项。',
  '2. 成课与独立模块 (lesson)：核心学习切分面。包含常规成课（如“第1课 李さんは中国人です”、“Lesson 1”）以及排版上与课处于同一缩进水平线的“单元总结”、“单元末专栏”、“复习测验”等独立模块（与课平齐的单元总结同样属于独立 session，level 填 lesson）。它们的 parentIndex 必须指向所属单元在 entries 中的从 0 开始的下标。',
  '3. 课内附属小节 (section)：更深层缩进、字号较小或带有情境小图标的条目（如会话情境“出迎え”、基本课文、语法条目等），属于主课内部的附属小节，level 填 section。它们的 parentIndex 必须严格指向直接所属课的下标，绝不能误标为独立成课或挂到单元。',
  '4. 无子课的单篇单元：若某一单元下方未划分细课，该单元自身作为独立学习切分面（level 填 unit）。',
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
