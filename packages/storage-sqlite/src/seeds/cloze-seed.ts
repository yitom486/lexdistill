import type { ContentTemplateSeed } from './content-template-seed.js';

const passages = [
  {
    language: 'en' as const, title: 'A study group',
    body: 'Mia wanted to improve her English, (1) ___ she joined a study group. The group meets (2) ___ Friday. At first she was nervous, but regular practice helped her speak more (3) ___.',
    blanks: [
      { options: ['so', 'although', 'unless', 'despite'], answer: 'so', explanation: '前句是原因，后句是结果，so 连接因果关系。' },
      { options: ['at', 'on', 'in', 'by'], answer: 'on', explanation: '表示在具体星期几，用介词 on。' },
      { options: ['confident', 'confidence', 'confidently', 'confide'], answer: 'confidently', explanation: '修饰动词 speak，需要副词 confidently。' },
    ],
  },
  {
    language: 'ja' as const, title: '図書館での勉強',
    body: '土曜日、私は友達と図書館 (1) ___ 勉強しました。新しい言葉が難しかった (2) ___、辞書を使いました。勉強の後で、二人 (3) ___ 一緒に昼ご飯を食べました。',
    blanks: [
      { options: ['で', 'に', 'を', 'へ'], answer: 'で', explanation: '图书馆是学习动作发生的场所，使用助词「で」。' },
      { options: ['から', 'まで', 'より', 'だけ'], answer: 'から', explanation: '难以理解新词是使用词典的原因，「から」表示原因。' },
      { options: ['を', 'へ', 'に', 'で'], answer: 'で', explanation: '「二人で」表示两人一起进行某项活动。' },
    ],
  },
  {
    language: 'ko' as const, title: '도서관 공부',
    body: '저는 토요일에 친구와 도서관 (1) ___ 공부했습니다. 모르는 단어가 많아서 사전 (2) ___ 찾았습니다. 공부가 끝난 후에 친구와 점심 (3) ___ 먹었습니다.',
    blanks: [
      { options: ['에서', '에', '을', '와'], answer: '에서', explanation: '学习动作发生的场所使用「에서」。' },
      { options: ['이', '에', '을', '와'], answer: '을', explanation: '「사전」是「찾다」的宾语，词尾有收音，使用「을」。' },
      { options: ['에', '을', '에서', '이'], answer: '을', explanation: '「점심」是「먹다」的宾语，词尾有收音，使用「을」。' },
    ],
  },
];

/** Original starter passages; they are finite templates, not live AI generation. */
export const CLOZE_TEMPLATE_SEEDS: ContentTemplateSeed[] = passages.flatMap(passage => passage.blanks.map((blank, index) => ({
  id: `tpl_${passage.language}_cloze_study_${index + 1}`,
  language: passage.language, action: 'generate_quiz' as const, format: 'MULTIPLE_CHOICE',
  skillId: `${passage.language === 'ja' ? 'jp' : passage.language}.reading.cloze`, difficulty: 2, sortOrder: index + 1,
  payload: { kind: 'question', question: {
    type: 'MULTIPLE_CHOICE', prompt: `阅读短文，选择第 ${index + 1} 空的正确答案。`, content: `第 ${index + 1} 空`,
    options: blank.options, correctAnswer: blank.answer, explanation: blank.explanation,
    testedSkillId: `${passage.language === 'ja' ? 'jp' : passage.language}.reading.cloze`, difficultyTier: 2,
    reading: { setId: `cloze_${passage.language}_study`, title: passage.title, body: passage.body },
  } },
})));

export const KOREAN_DICTATION_TEMPLATE_SEEDS: ContentTemplateSeed[] = [
  { sentence: '저는 도서관에서 공부합니다.', cloze: '저는 도서관( ) 공부합니다.', word: '에서', meaning: '我在图书馆学习。', explanation: '动作发生的场所使用「에서」。' },
  { sentence: '저는 책을 읽습니다.', cloze: '저는 책( ) 읽습니다.', word: '을', meaning: '我读书。', explanation: '有收音的宾语「책」后使用「을」。' },
  { sentence: '친구와 함께 공부합니다.', cloze: '친구( ) 함께 공부합니다.', word: '와', meaning: '我和朋友一起学习。', explanation: '「친구」没有收音，表示和朋友一起使用「와」。' },
].map((item, index) => ({
  id: `tpl_ko_dictation_study_${index + 1}`, language: 'ko', action: 'dictation', format: 'LISTENING_DICTATION',
  skillId: 'ko.listening.dictation', difficulty: 2, sortOrder: index + 1,
  payload: { kind: 'dictation', item: {
    fullJapanese: item.sentence, chinese: item.meaning, blankPrompt: '听句子，补全空缺内容。', clozeDisplay: item.cloze,
    targetWord: item.word, furiganaHint: '', categoryTag: '韩语听写', testedSkillId: 'ko.listening.dictation', grammarExplanation: item.explanation,
  } },
}));
