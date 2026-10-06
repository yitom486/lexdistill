import { TextbookLearningContentSchema, type TextbookLearningContent } from '@study-studio/document-model';
import type { LearningLibraryBook } from '../components/textbook/preview/library-view.js';
import { previewStudy, segmentText } from './textbook-study-preview.js';

/** Temporary, user-authorized sample. Uses the current SQLite read contract; never written to a database. */
export const previewLesson = {
  bookId: 'preview-japanese-basics', chapterId: 'preview-objects',
  language: 'JA',
  bookTitle: '日语入门 · 演示教材',
  chapterTitle: '第 2 课 · これは何ですか',
  subtitle: '指认身边的物品，询问名称与归属。',
  content: {
    vocabulary: [
      { id: 'preview-v1', vocabularyId: 'preview-global-v1', word: '本', reading: 'ほん', meaning: '书；书本', level: 'N5', partOfSpeech: '名词', explanation: '这里表示书籍，不是数量单位。', examples: [{ text: 'これは日本語の本です。', translation: '这是一本日语书。' }], source: 'TEXTBOOK' },
      { id: 'preview-v2', vocabularyId: 'preview-global-v2', word: '辞書', reading: 'じしょ', meaning: '词典', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'それは辞書ですか。', translation: '那是词典吗？' }], source: 'TEXTBOOK' },
      { id: 'preview-v3', vocabularyId: 'preview-global-v3', word: 'ノート', reading: 'ノート', meaning: '笔记本', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'これはわたしのノートです。', translation: '这是我的笔记本。' }], source: 'TEXTBOOK' },
      { id: 'preview-v4', vocabularyId: 'preview-global-v4', word: '鉛筆', reading: 'えんぴつ', meaning: '铅笔', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'あれは鉛筆です。', translation: '那个是铅笔。' }], source: 'TEXTBOOK' },
      { id: 'preview-v5', vocabularyId: 'preview-global-v5', word: '時計', reading: 'とけい', meaning: '钟；手表', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'これはだれの時計ですか。', translation: '这是谁的手表？' }], source: 'TEXTBOOK' },
      { id: 'preview-v6', vocabularyId: 'preview-global-v6', word: 'かばん', reading: 'かばん', meaning: '包；书包', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'それは田中さんのかばんです。', translation: '那是田中的包。' }], source: 'TEXTBOOK' },
    ],
    grammar: [
      { id: 'preview-g1', kind: 'GRAMMAR', title: 'これ・それ・あれ：指认物品', explanation: 'これ指靠近说话人的物品；それ指靠近听话人的物品；あれ指离双方都较远的物品。它们可以直接作为名词使用。', connection: 'これ／それ／あれ ＋ は ＋ 名词 ＋ です', aiExplanation: '先判断物品靠近谁，再选指示词。直接说「これは本です」即可；如果要放在「本」前面修饰，则使用「この本」。', examples: [{ text: 'これは本です。', translation: '这是书。' }, { text: 'それは辞書ですか。', translation: '那是词典吗？' }], source: 'AI' },
      { id: 'preview-g2', kind: 'GRAMMAR', title: '「の」：表达物品的归属', explanation: '名词之间的「の」可以表示所属关系。询问物品属于谁时，用「だれの」。', connection: '人 ＋ の ＋ 物品', aiExplanation: '物品名称已明确时，可以省略：「田中さんのです」表示“是田中的”。这里的「の」代替前面提到的物品。', examples: [{ text: 'これはだれのノートですか。', translation: '这是谁的笔记本？' }, { text: 'わたしのです。', translation: '是我的。' }], source: 'AI' },
      { id: 'preview-g3', kind: 'USAGE', title: 'そうです／違います：确认与否认', explanation: '确认对方的判断时用「はい、そうです」。否认时可以用「いいえ、違います」，再说明实际是什么。', examples: [{ text: 'それは辞書ですか。いいえ、違います。ノートです。', translation: '那是词典吗？不，不是。是笔记本。' }], source: 'AI' },
    ],
    articles: [{ id: 'preview-a1', title: '教室里的一段对话', text: segmentText(previewStudy['preview-objects']!.articles['preview-a1']!), translation: segmentText(previewStudy['preview-objects']!.articles['preview-a1']!, true), source: 'AI' }],
    sentences: [
      { id: 'preview-s1', text: 'これは何ですか。', translation: '这是什么？', explanation: '询问物品的名称。「何」在这里读作「なん」。', source: 'AI' },
      { id: 'preview-s2', text: 'それは日本語の本です。', translation: '那是一本日语书。', explanation: '「日本語の本」中的「の」说明书的类别。', source: 'AI' },
      { id: 'preview-s3', text: 'これはだれのかばんですか。', translation: '这是谁的包？', explanation: '用「だれの」询问归属。', source: 'AI' },
    ],
    exercises: [
      { id: 'preview-e1', difficultyTier: 1, difficultyReason: '指示词与单句识别。', type: 'CHOICE', prompt: '你拿着一本书，想说“这是书”。请选择合适的句子。', options: ['これは本です。', 'それは本です。', 'あれは本です。'], answer: 'これは本です。', explanation: '书在说话人手里，靠近说话人，所以使用「これ」。', source: 'AI' },
      { id: 'preview-e2', difficultyTier: 1, difficultyReason: '单一所属助词填空。', type: 'FILL_BLANK', prompt: '填入表示所属关系的助词：これは田中さん（　）ノートです。', answer: 'の', explanation: '「田中さんのノート」表示田中的笔记本。', source: 'AI' },
      { id: 'preview-e3', difficultyTier: 1, difficultyReason: '常见具体名词匹配。', type: 'MATCHING', prompt: '把词汇与对应词义连接起来。', left: ['辞書', '時計', '鉛筆'], right: ['铅笔', '词典', '钟；手表'], answer: [{ left: '辞書', right: '词典' }, { left: '時計', right: '钟；手表' }, { left: '鉛筆', right: '铅笔' }], explanation: '辞書是词典；時計是钟或手表；鉛筆是铅笔。', source: 'AI' },
      { id: 'preview-e4', difficultyTier: 2, difficultyReason: '组合指示词、所属和礼貌问句。', type: 'TRANSLATION', prompt: '请用日语表达：“这是谁的书？”', answer: 'これはだれの本ですか。', explanation: '用「だれの」询问所属，用「ですか」构成礼貌问句。', gradingNotes: '关注指示词、だれの与礼貌问句；合理表达均可，不限定唯一文字答案。', source: 'AI' },
      { id: 'preview-e5', difficultyTier: 2, difficultyReason: '组合完整句子的词序。', type: 'ORDERING', prompt: '按顺序点击词块，组成“这是我的书”。', options: ['です。', '本', 'これは', 'の', 'わたし'], answer: ['これは', 'わたし', 'の', '本', 'です。'], explanation: 'これは／わたし／の／本／です。', source: 'AI' },
      { id: 'preview-e6', difficultyTier: 2, difficultyReason: '区分独立指示词与连体词。', type: 'MULTI_CHOICE', prompt: '请选择可以直接指代物品、独立使用的指示词。', options: ['これ', 'その', 'あれ', 'この'], answer: ['これ', 'あれ'], explanation: 'これ、あれ可以独立使用；この、その后面需要接名词。', source: 'AI' },
      { id: 'preview-e7', difficultyTier: 2, difficultyReason: '解释语法区别并举例。', type: 'SHORT_ANSWER', prompt: '「これ」与「この」的用法有什么区别？用中文简单说明。', answer: 'これ可以独立指代物品；この必须接名词，例如この本。', gradingNotes: '能说明是否需要接名词，并给出一个正确例子。', explanation: '重点是语法用法，而不只是距离远近。', source: 'AI' },
    ],
    material: '本章整理材料\n\n指示词：これ、それ、あれ。\n归属表达：人＋の＋物品。\n确认：はい、そうです。\n否认：いいえ、違います。',
  } satisfies TextbookLearningContent,
};

// Check the same contract used when reading actual saved content.
TextbookLearningContentSchema.parse(previewLesson.content);

export const previewBooks: LearningLibraryBook[] = [
  { id: previewLesson.bookId, title: '日语入门：从问候到日常表达', language: 'JA', level: 'N5', temporary: true, chapters: [
    { id: 'preview-greetings', title: '第 1 课 · はじめまして', subtitle: '初次见面时，介绍自己并回应对方。', content: {
      vocabulary: [{ id: 'preview-greeting-v1', vocabularyId: 'preview-greeting-global-v1', word: '学生', reading: 'がくせい', meaning: '学生', level: 'N5', examples: [{ text: 'わたしは学生です。', translation: '我是学生。' }], source: 'TEXTBOOK' }],
      grammar: [{ id: 'preview-greeting-g1', kind: 'GRAMMAR', title: '名词 ＋ は ＋ 名词 ＋ です', connection: 'わたし ＋ は ＋ 学生 ＋ です', explanation: '「は」提示话题，「です」用于礼貌地说明身份。这里的「は」读作 wa。', examples: [{ text: 'わたしは李です。', translation: '我姓李。' }], source: 'AI' }],
      articles: [{ id: 'preview-greeting-a1', title: '初次见面', text: segmentText(previewStudy['preview-greetings']!.articles['preview-greeting-a1']!), translation: segmentText(previewStudy['preview-greetings']!.articles['preview-greeting-a1']!, true), source: 'AI' }],
      sentences: [{ id: 'preview-greeting-s1', text: 'よろしくお願いします。', translation: '请多关照。', explanation: '初次见面、开始合作或请别人帮忙时使用。', source: 'AI' }],
      exercises: [{ id: 'preview-greeting-e1', difficultyTier: 1, difficultyReason: '识别基础自我介绍。', type: 'CHOICE', prompt: '请选择礼貌的自我介绍。', options: ['わたしは李です。', 'これは李です。'], answer: 'わたしは李です。', explanation: '介绍自己用「わたしは」。', source: 'AI' }], material: null,
    } },
    { id: previewLesson.chapterId, title: previewLesson.chapterTitle, subtitle: previewLesson.subtitle, content: previewLesson.content },
    { id: 'preview-pronunciation', title: '发音练习 · 长音与促音', subtitle: '先理解拍长，再听读对比。', content: {
      vocabulary: [], articles: [], sentences: [], exercises: [], material: null,
      grammar: [
        { id: 'preview-long-vowels', kind: 'PRONUNCIATION', title: '长音（ちょうおん）', source: 'AI',
          explanation: '### 核心规则\n\n长音把前面的元音**延长一拍**。短音和长音可能区分词义，练习时要听清拍数。\n\n### 常见写法\n\n- 平假名中用元音假名表示延长。\n- 片假名中常用长音符号「ー」。\n\n不要只提高音量；保持元音，把时间延长。',
          aiExplanation: '### 练习方法\n\n先慢读两个词，边读边打拍子，再恢复自然语速。\n\n**自检**：是否只是读得更响，而没有延长元音？',
          examples: [{ text: 'おばさん。おばあさん。', translation: '阿姨；奶奶。对比「ば」后一拍的延长。' }, { text: 'ゆき。ゆうき。', translation: '雪；勇气。对比「ゆ」后一拍的延长。' }, { text: 'カード。', translation: '卡片。注意「カー」的两拍。' }],
        },
        { id: 'preview-gemination', kind: 'PRONUNCIATION', title: '促音（そくおん）', source: 'AI',
          explanation: '### 核心规则\n\n小「っ／ッ」表示**停顿一拍**，随后发出下一个辅音。\n\n- 不把小「っ」读成「つ」。\n- 停顿时间计入拍数。',
          examples: [{ text: 'きて。きって。', translation: '来；邮票。注意第二个词中间的停顿。' }],
        },
      ],
    } },
  ] },
  { id: 'preview-travel-japanese', title: '旅行日语：在城市里问路', language: 'JA', level: 'N5', temporary: true, chapters: [
    { id: 'preview-directions', title: '第 1 课 · 駅はどこですか', subtitle: '礼貌问路，听懂简单的方向指引。', content: {
      vocabulary: [{ id: 'preview-travel-v1', vocabularyId: 'preview-travel-global-v1', word: '駅', reading: 'えき', meaning: '车站', level: 'N5', examples: [{ text: '駅はどこですか。', translation: '车站在哪里？' }], source: 'TEXTBOOK' }, { id: 'preview-travel-v2', vocabularyId: 'preview-travel-global-v2', word: '右', reading: 'みぎ', meaning: '右；右侧', level: 'N5', examples: [{ text: '右に曲がってください。', translation: '请向右转。' }], source: 'TEXTBOOK' }],
      grammar: [{ id: 'preview-travel-g1', kind: 'USAGE', title: 'すみません：礼貌地引起注意', explanation: '向陌生人问路前先说「すみません」，表示“打扰一下”。', examples: [{ text: 'すみません。駅はどこですか。', translation: '打扰一下，车站在哪里？' }], source: 'AI' }],
      articles: [{ id: 'preview-travel-a1', title: '去车站的路', text: segmentText(previewStudy['preview-directions']!.articles['preview-travel-a1']!), translation: segmentText(previewStudy['preview-directions']!.articles['preview-travel-a1']!, true), source: 'AI' }],
      sentences: [], exercises: [{ id: 'preview-travel-e1', difficultyTier: 1, difficultyReason: '基础方向词匹配。', type: 'MATCHING', prompt: '把方向与词义配对。', left: ['右', '左'], right: ['左侧', '右侧'], answer: [{ left: '右', right: '右侧' }, { left: '左', right: '左侧' }], source: 'AI' }], material: null,
    } },
  ] },
];
for (const book of previewBooks) for (const chapter of book.chapters) TextbookLearningContentSchema.parse(chapter.content);
