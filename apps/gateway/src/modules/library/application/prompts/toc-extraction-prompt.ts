/** 目录视觉审核给任务、原则和模型可见工具名；字段由工具声明。 */
export interface TocExtractionPromptInput {
  title?: string | undefined;
  language?: string | undefined;
  pageNumbers: number[];
}

export function buildTocExtractionPrompt(input: TocExtractionPromptInput): string {
  const langDesc = input.language ? `目标语种：${input.language}` : '';
  return [
    '请阅读随消息附上的教材目录页高清图片，按阅读顺序完整提取全书的树状目录草稿。',
    `图片依次对应 PDF 物理页：${input.pageNumbers.join('、')}。`,
    ...(input.title ? [`教材参考名称：${input.title}`] : []),
    ...(langDesc ? [langDesc] : []),
    '',
    '【语言教材通用目次提取准则】：',
    '1. 必须提取前置教学准备单元（Lesson 0 / Introductory）：',
    '   - 严禁将开篇带有实质教学内容的入门准备部分（如字母/发音/音标、课堂用语、日常问候、数词等）误当成版权页或无用序言过滤；',
    '   - 只要开篇部分印刷了具体教学条目并配有印刷页码，必须作为 section 提取并记录印刷起始页。',
    '2. 必须提取深度多级子目（还原真实树状大纲，严禁偷懒只提取平铺课名）：',
    '   - 核心教学实体（如课次、Lesson、Chapter、第X课/章）标记为 level: "lesson"；',
    '   - 凡是在成课下方通过缩进、编号（如 1. 2. 3.）、小标题、点线对齐排版的具体次级条目（如核心句型/语法点、情景会话、课文主题、单元复习/Test 等），均为目录有效条目，必须全部作为 level: "section" 提取！',
    '3. 印刷页码规则：',
    '   - 只读取图片中通过虚线点线或对齐指向的教材印刷页码，不要填入 PDF 的物理页码；',
    '   - 同一课内的次级条目若在同一起始页，页码相同即可，后续条目的页码不能倒退。',
    '4. 工具调用约束：',
    '   - 本会话提供 library_propose_toc 目录草稿工具。请直接调用它提交完整条目草稿；具体字段以工具说明为准。严禁以普通聊天文本回复。',
  ].join('\n');
}

