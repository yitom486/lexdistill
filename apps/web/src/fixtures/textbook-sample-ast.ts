/**
 * 教材导入器示例 AST（新编日语样例）。
 * 仅用于「载入样例 / 下载模版」；真实导入走用户 JSON + parseTextbookAST。
 */
import type { TextbookAST } from '@study-studio/document-model';

export const SAMPLE_TEXTBOOK_JSON: TextbookAST = {
  id: 'shinpen-nihongo-1',
  language: 'JA',
  title: '新编日语 第一册 (精编重排版)',
  shortTitle: '新编日语1',
  level: 'JLPT N5',
  publisher: '上海外语教育出版社',
  description: '经典大学日语专业教材，注重句型操练与系统语法推导。',
  totalLessons: 1,

  lessons: [
    {
      id: 'shinpen-l1',
      lessonNumber: 1,
      title: '第1課 五十音図と挨拶 (五十音与日常问候)',
      summary: '五十音假名认读、声调特征与初次寒暄问候。',
      vocabularies: [
        {
          id: 'shinpen-v1',
          kanji: 'おはようございます',
          kana: 'おはようございます',
          pos: '寒暄语',
          pitchAccent: '④',
          chinese: '早上好（敬体）',
          example: {
            japanese: '先生、おはようございます。',
            chinese: '老师，早上好。',
          },
        },
        {
          id: 'shinpen-v2',
          kanji: '失礼します',
          kana: 'しつれいします',
          pos: '动词/寒暄语',
          pitchAccent: '②',
          chinese: '打扰了；告辞',
          example: {
            japanese: 'それでは、失礼します。',
            chinese: '那么，我先告辞了。',
          },
        },
        {
          id: 'shinpen-v3',
          kanji: 'どうぞ',
          kana: 'どうぞ',
          pos: '副词',
          pitchAccent: '①',
          chinese: '请；请便',
          example: {
            japanese: 'こちらへどうぞ。',
            chinese: '请往这边走。',
          },
        },
      ],
      grammarPoints: [
        {
          id: 'shinpen-g1',
          title: '～は～です (判断句的基准形态)',
          connection: '名词 + は + 名词 + です',
          explanation: '用于明确主语主题并对身份、国籍、属性做出肯定判断。',
          examples: [
            {
              japanese: '王さんは留学生です。',
              chinese: '小王是留学生。',
            },
          ],
        },
      ],
      dialogues: [
        {
          speaker: '王',
          japanese: '田中先生、おはようございます。',
          chinese: '田中老师，早上好。',
        },
        {
          speaker: '田中',
          japanese: '王さん、おはようございます。どうぞ入ってください。',
          chinese: '小王，早上好。请进吧。',
        },
      ],
      exercises: [
        {
          id: 'shinpen-ex1',
          type: 'CHOICE',
          prompt: '早晨向长辈或老师问好时，最得体的表达是？',
          options: ['おはよう', 'おはようございます', 'こんばんは', 'さようなら'],
          answer: 'おはようございます',
          explanation: '面对长辈应使用包含「ございます」的完整敬体。',
        },
      ],
    },
  ],
};
