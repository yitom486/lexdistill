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
  /** 本课在目录中已知的子条目（微观上下文白名单，如文型 1~4、会话标题） */
  subSections?: string[] | undefined;
  ocrText: string;
}

export function buildLessonExtractionPrompt(input: LessonExtractionPromptInput): string {
  const lang = input.language ?? 'ja';
  const pageRangeDesc =
    input.startPage !== undefined && input.endPage !== undefined
      ? `（页码范围：第 ${input.startPage} 页 至 第 ${input.endPage} 页）`
      : '';
  const subSectionsBlock =
    input.subSections && input.subSections.length > 0
      ? [
          '【本课已确认的目录子目（请严格对照提取对应知识）】：',
          ...input.subSections.map((s) => `  - ${s}`),
          '',
        ]
      : [];

  return [
    '你是一个专业的语言教材数字化与 AI 教学赋能专家。',
    `请深入分析以下提供的教材章节 OCR 扫描文本${pageRangeDesc}，进行高质量的教材数字化结构提炼与教学内容增强：`,
    `【教材ID】：${input.documentId}（教材: ${input.documentId}）`,
    `【课次槽位】：${input.lessonId}（课次: ${input.lessonId}）${input.title ? `，标题: ${input.title}` : ''}`,
    `【目标语种】：${lang}`,
    '',
    ...subSectionsBlock,
    '【待提炼课文 OCR 文本】：',
    input.ocrText,
    '',
    '【提炼质量规范与教学赋能】：',
    '1. 课前导学与破局指南 (preview)：为学习者提炼本课核心攻坚点 (keyPoints)、初学者高频易错避坑预警 (pitfalls)、以及实际生活场景达成目标 (canDoGoal)。',
    '2. 课文全文 (passageMd)：以规整规范的 Markdown 格式输出课文或会话对话内容。保留角色标签，段落之间空行，修缮断行乱码，使之适合沉浸式精读排版。',
    '3. 核心生词 (vocabularies)：提取生词表中的核心单词，补全注音（假名/音标）、词性、准确中文释义，若有例句请同时提取例句及其中文翻译。',
    '4. 核心语法/知识点 (knowledgePoints)：提取重点句型与文法，对照上述子目列出接续规则、用法解析，并提供高质量的双语对照例句。',
    '5. 课后习题与保姆级解析 (exercises)：提取练习题（CHOICE 单选、FILL_BLANK 填空、TRANSLATION 翻译），必须包含标准答案和保姆级详细解析（说明考查语法点、题目翻译、以及错误选项为何被排除）。',
    '6. 课后总结与记忆清单 (summary)：提炼本课必须脱口而出的 3 句核心黄金骨架句 (goldenSentences)、以及睡前自我检视清单 (selfCheckQuestions)。',
    '',
    '【输出格式】：必须且仅输出合法 JSON 格式，严禁包含任何前言、结语或解释。',
    'JSON 结构示例：',
    '{',
    '  "title": "精校后的课文标题",',
    '  "preview": {',
    '    "keyPoints": ["掌握敬体与简体的主客观区别", "动词て形的变形法则与接续"],',
    '    "pitfalls": ["注意助词「は」与「が」在主从句中的主客体错位"],',
    '    "canDoGoal": "学完后能够在日本餐厅流畅点餐、询问价格并分单结账"',
    '  },',
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
    '      "explanation": "【考查】：动词て形+から表示相继动作。【翻译】：来日本之后已经一年了。【排除】：B为过去式接续破损，C为原形接续非法。"',
    '    }',
    '  ],',
    '  "summary": {',
    '    "goldenSentences": ["手を洗ってから、ご飯を食べます。"],',
    '    "selfCheckQuestions": ["能分清动词て形变形的五种类型吗？"]',
    '  }',
    '}',
  ].join('\n');
}
