/**
 * 教材单课内容提炼智能体（Lesson Extraction Agent）专用提示词。
 * 遵循四大要素：精读课文/对话全文 Markdown、核心生词（带假名/音调/例句）、核心语法（接续/讲解/双语例句）、课后习题。
 */

export interface LessonExtractionPromptInput {
  documentId: string;
  lessonId: string;
  title?: string | undefined;
  language?: string | undefined;
  startPage?: number | undefined;
  endPage?: number | undefined;
  ocrText: string;
}

export function buildLessonExtractionPrompt(input: LessonExtractionPromptInput): string {
  const lang = input.language ?? 'ja';
  const pageRangeDesc =
    input.startPage !== undefined && input.endPage !== undefined
      ? `（页码范围：第 ${input.startPage} 页 至 第 ${input.endPage} 页）`
      : '';

  return [
    '你是一个专业的语言教材数字化与知识提取专家。',
    `请深入分析以下提供的教材章节 OCR 扫描文本${pageRangeDesc}，进行高质量的教材数字化结构提炼：`,
    `【教材ID】：${input.documentId}（教材: ${input.documentId}）`,
    `【课次槽位】：${input.lessonId}（课次: ${input.lessonId}）${input.title ? `，标题: ${input.title}` : ''}`,
    `【目标语种】：${lang}`,
    '',
    '【待提炼课文 OCR 文本】：',
    input.ocrText,
    '',
    '【提炼质量规范与不变量】：',
    '1. 课文全文 (passageMd)：以规整规范的 Markdown 格式输出课文或会话对话内容。保留说话人角色标签（如 **田中**：...），段落之间空行，修缮 OCR 断行或乱码，使之适合沉浸式精读排版。',
    '2. 核心生词 (vocabularies)：提取本课生词表中的核心单词，补全注音（假名/音标）、词性（如 名詞、動詞1類、形容詞 等）、准确中文释义，若有课文例句请同时提取例句及其中文翻译。',
    '3. 核心语法/知识点 (knowledgePoints)：提取本课讲解的重点句型与文法，准确列出接续规则（如 動詞て形 + から）、用法解析，并提供高质量的双语对照例句（原语句子 + 中文译文）。',
    '4. 课后习题 (exercises)：若本课包含练习题、确认题，提取为标准习题条目（题型分为 CHOICE 单选、FILL_BLANK 填空、TRANSLATION 翻译），提取题干、选项、标准答案和答案解析。',
    '',
    '【输出格式】：必须且仅输出合法 JSON 格式，严禁包含任何前言、结语或解释。',
    'JSON 结构示例：',
    '{',
    '  "title": "精校后的课文标题（如：第1課 初対面）",',
    '  "passageMd": "### 本文\\n\\n**李**：はじめまして、李です。\\n\\n**田中**：田中です。どうぞよろしく。...",',
    '  "vocabularies": [',
    '    {',
    '      "surface": "初対面",',
    '      "reading": "しょたいめん",',
    '      "pos": "名詞",',
    '      "glossZh": "初次见面",',
    '      "pitch": "③",',
    '      "exampleJa": "初対面の人と話すのは緊張します。",',
    '      "exampleZh": "和初次见面的人说话很紧张。"',
    '    }',
    '  ],',
    '  "knowledgePoints": [',
    '    {',
    '      "title": "～てから",',
    '      "connection": "動詞て形 + から",',
    '      "explanation": "表示动作相继发生，相当于汉语的“……之后”。",',
    '      "examples": [',
    '        {',
    '          "japanese": "手を洗ってから、ご飯を食べます。",',
    '          "chinese": "洗完手之后吃饭。"',
    '        }',
    '      ]',
    '    }',
    '  ],',
    '  "exercises": [',
    '    {',
    '      "type": "CHOICE",',
    '      "prompt": "日本へ（　）から、もう一年になりました。",',
    '      "options": ["A. 来て", "B. 来た", "C. 来る", "D. 来ない"],',
    '      "answer": "A. 来て",',
    '      "explanation": "「～てから」表示……之后，前面接动词て形。"',
    '    }',
    '  ]',
    '}',
  ].join('\n');
}
