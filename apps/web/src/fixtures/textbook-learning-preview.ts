import { TextbookLearningContentSchema, type TextbookLearningContent } from '@study-studio/document-model';

/** Temporary, user-authorized sample. Uses the current SQLite read contract; never written to a database. */
export const previewLesson = {
  bookTitle: '日语入门 · 演示教材',
  chapterTitle: '第 2 课 · これは何ですか',
  subtitle: '指认身边的物品，询问名称与归属。',
  content: {
    vocabulary: [
      { id: 'preview-v1', vocabularyId: 'preview-global-v1', word: '本', reading: 'ほん', meaning: '书；书本', level: 'N5', partOfSpeech: '名词', explanation: '这里表示书籍，不是数量单位。', examples: [{ text: 'これは日本語の本です。', translation: '这是一本日语书。' }] },
      { id: 'preview-v2', vocabularyId: 'preview-global-v2', word: '辞書', reading: 'じしょ', meaning: '词典', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'それは辞書ですか。', translation: '那是词典吗？' }] },
      { id: 'preview-v3', vocabularyId: 'preview-global-v3', word: 'ノート', reading: 'ノート', meaning: '笔记本', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'これはわたしのノートです。', translation: '这是我的笔记本。' }] },
      { id: 'preview-v4', vocabularyId: 'preview-global-v4', word: '鉛筆', reading: 'えんぴつ', meaning: '铅笔', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'あれは鉛筆です。', translation: '那个是铅笔。' }] },
      { id: 'preview-v5', vocabularyId: 'preview-global-v5', word: '時計', reading: 'とけい', meaning: '钟；手表', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'これはだれの時計ですか。', translation: '这是谁的手表？' }] },
      { id: 'preview-v6', vocabularyId: 'preview-global-v6', word: 'かばん', reading: 'かばん', meaning: '包；书包', level: 'N5', partOfSpeech: '名词', examples: [{ text: 'それは田中さんのかばんです。', translation: '那是田中的包。' }] },
    ],
    grammar: [
      { id: 'preview-g1', kind: 'GRAMMAR', title: 'これ・それ・あれ：指认物品', explanation: 'これ指靠近说话人的物品；それ指靠近听话人的物品；あれ指离双方都较远的物品。它们可以直接作为名词使用。', connection: 'これ／それ／あれ ＋ は ＋ 名词 ＋ です', aiExplanation: '先判断物品靠近谁，再选指示词。直接说「これは本です」即可；如果要放在「本」前面修饰，则使用「この本」。', examples: [{ text: 'これは本です。', translation: '这是书。' }, { text: 'それは辞書ですか。', translation: '那是词典吗？' }], source: 'AI' },
      { id: 'preview-g2', kind: 'GRAMMAR', title: '「の」：表达物品的归属', explanation: '名词之间的「の」可以表示所属关系。询问物品属于谁时，用「だれの」。', connection: '人 ＋ の ＋ 物品', aiExplanation: '物品名称已明确时，可以省略：「田中さんのです」表示“是田中的”。这里的「の」代替前面提到的物品。', examples: [{ text: 'これはだれのノートですか。', translation: '这是谁的笔记本？' }, { text: 'わたしのです。', translation: '是我的。' }], source: 'AI' },
      { id: 'preview-g3', kind: 'USAGE', title: 'そうです／違います：确认与否认', explanation: '确认对方的判断时用「はい、そうです」。否认时可以用「いいえ、違います」，再说明实际是什么。', examples: [{ text: 'それは辞書ですか。いいえ、違います。ノートです。', translation: '那是词典吗？不，不是。是笔记本。' }], source: 'AI' },
    ],
    articles: [{ id: 'preview-a1', title: '教室里的一段对话', text: '田中：これは何ですか。\n李：それは日本語の本です。\n田中：そうですか。これはだれの本ですか。\n李：わたしのです。\n田中：あれも李さんのですか。\n李：いいえ、違います。あれは先生の辞書です。', translation: '田中：这是什么？\n李：那是一本日语书。\n田中：这样啊。这是谁的书？\n李：是我的。\n田中：那个也是李的东西吗？\n李：不，不是。那个是老师的词典。', source: 'AI' }],
    sentences: [
      { id: 'preview-s1', text: 'これは何ですか。', translation: '这是什么？', explanation: '询问物品的名称。「何」在这里读作「なん」。', source: 'AI' },
      { id: 'preview-s2', text: 'それは日本語の本です。', translation: '那是一本日语书。', explanation: '「日本語の本」中的「の」说明书的类别。', source: 'AI' },
      { id: 'preview-s3', text: 'これはだれのかばんですか。', translation: '这是谁的包？', explanation: '用「だれの」询问归属。', source: 'AI' },
    ],
    exercises: [
      { id: 'preview-e1', type: 'CHOICE', prompt: '你拿着一本书，想说“这是书”。请选择合适的句子。', options: ['これは本です。', 'それは本です。', 'あれは本です。'], answer: 'これは本です。', explanation: '书在说话人手里，靠近说话人，所以使用「これ」。', source: 'AI' },
      { id: 'preview-e2', type: 'FILL_BLANK', prompt: '填入表示所属关系的助词：これは田中さん（　）ノートです。', answer: 'の', explanation: '「田中さんのノート」表示田中的笔记本。', source: 'AI' },
      { id: 'preview-e3', type: 'MATCHING', prompt: '把词汇与对应词义连接起来。', left: ['辞書', '時計', '鉛筆'], right: ['铅笔', '词典', '钟；手表'], answer: [{ left: '辞書', right: '词典' }, { left: '時計', right: '钟；手表' }, { left: '鉛筆', right: '铅笔' }], explanation: '辞書是词典；時計是钟或手表；鉛筆是铅笔。', source: 'AI' },
      { id: 'preview-e4', type: 'TRANSLATION', prompt: '请用日语表达：“这是谁的书？”', answer: 'これはだれの本ですか。', explanation: '用「だれの」询问所属，用「ですか」构成礼貌问句。', gradingNotes: '关注指示词、だれの与礼貌问句；合理表达均可，不限定唯一文字答案。', source: 'AI' },
      { id: 'preview-e5', type: 'ORDERING', prompt: '按顺序点击词块，组成“这是我的书”。', options: ['です。', '本', 'これは', 'の', 'わたし'], answer: ['これは', 'わたし', 'の', '本', 'です。'], explanation: 'これは／わたし／の／本／です。', source: 'AI' },
      { id: 'preview-e6', type: 'MULTI_CHOICE', prompt: '请选择可以直接指代物品、独立使用的指示词。', options: ['これ', 'その', 'あれ', 'この'], answer: ['これ', 'あれ'], explanation: 'これ、あれ可以独立使用；この、その后面需要接名词。', source: 'AI' },
      { id: 'preview-e7', type: 'SHORT_ANSWER', prompt: '「これ」与「この」的用法有什么区别？用中文简单说明。', answer: 'これ可以独立指代物品；この必须接名词，例如この本。', gradingNotes: '能说明是否需要接名词，并给出一个正确例子。', explanation: '重点是语法用法，而不只是距离远近。', source: 'AI' },
    ],
    material: '本章整理材料\n\n指示词：これ、それ、あれ。\n归属表达：人＋の＋物品。\n确认：はい、そうです。\n否认：いいえ、違います。',
  } satisfies TextbookLearningContent,
};

// Check the same contract used when reading actual saved content.
TextbookLearningContentSchema.parse(previewLesson.content);
