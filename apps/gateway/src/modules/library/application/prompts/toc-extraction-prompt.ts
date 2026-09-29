/**
 * 教材目录提取与校验智能体（TOC Extraction Agent）专用提示词。
 * 遵循严格单调递增页码不变量与标准层级规范。
 */

export interface TocExtractionPromptInput {
  title?: string | undefined;
  language?: string | undefined;
  ocrText: string;
}

export function buildTocExtractionPrompt(input: TocExtractionPromptInput): string {
  const lang = input.language ?? 'ja';
  return [
    '你是一个专业的语言教材数字化排版与目录结构提取专家。',
    '请仔细分析以下教材的目录页（TOC）OCR 扫描文本，识别并提取完整的课程与章节目录大纲。',
    ...(input.title ? [`【教材参考名称】：${input.title}`] : []),
    `【目标语种】：${lang}`,
    '',
    '【目录页 OCR 扫描内容】：',
    input.ocrText,
    '',
    '【提取规则与质量不变量】：',
    '1. 必须准确提取课次序号（如第1課、Lesson 1）、课文主标题（去除点号、虚线、装饰符号）、印刷起始页码。',
    '2. 严禁倒退页码：提取出的条目必须满足单调递增页码顺序。如果识别出倒退，请仔细核对是否为前言、附录或 OCR 误识别数字。',
    '3. 层级规范（level）：单元/篇章（unit/chapter）标记为 unit 或 chapter，具体成课课次标记为 lesson。',
    '4. 过滤无关内容：版权信息、编者序言、出版说明等非教学课次条目请勿作为 lesson 提取。',
    '',
    '【输出格式】：必须且仅输出合法 JSON 格式，严禁包含任何前言、结语、代码块外文字。',
    'JSON 结构定义：',
    '{',
    '  "title": "教材标准规范标题",',
    '  "entries": [',
    '    {',
    '      "title": "课次标题（如：第1課 初対面）",',
    '      "level": "lesson",',
    '      "startPage": 14,',
    '      "endPage": 25',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}
