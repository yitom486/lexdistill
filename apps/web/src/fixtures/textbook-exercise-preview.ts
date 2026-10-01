import { TextbookLearningContentSchema } from '@study-studio/document-model';
import type { LearningLibraryBook } from '../components/textbook/preview/library-view.js';
import { previewLesson } from './textbook-learning-preview.js';

/** User-requested interaction examples, held in this temporary file and never saved as learning assets. */
export const exercisePreviewBook: LearningLibraryBook = {
  id: 'preview-exercise-types', title: '练习题型案例 · 点击试答', language: 'JA', level: 'N5', temporary: true,
  chapters: [{
    id: 'preview-all-exercise-types', title: '七类题型 · 交互案例',
    subtitle: '单选、多选、填空、翻译、排序、配对、简答；可以筛选题型、试答和重做。',
    content: {
      vocabulary: [], grammar: [], articles: [], sentences: [], material: null,
      exercises: [
        ...previewLesson.content.exercises.map(exercise => ({ ...exercise, id: `exercise-case-${exercise.type.toLowerCase()}` })),
        {
          id: 'exercise-case-multiple-blanks', type: 'FILL_BLANK',
          prompt: '依次填写两个空格：\nこれは田中さん（　）本です。\nそれ（　）ノートですか。',
          answer: ['の', 'は'], explanation: '第一空用「の」表示归属，第二空用「は」提示话题。', source: 'AI',
        },
        {
          id: 'exercise-case-repeated-words', type: 'ORDERING',
          prompt: '用下面的词块组成两次“是的，没错”的回复。相同词块可以分别选择。',
          options: ['そうです。', 'はい、', 'そうです。', 'はい、'],
          answer: ['はい、', 'そうです。', 'はい、', 'そうです。'],
          explanation: '每次回复为「はい、そうです。」。可以点击已排列的词块撤回，再调整顺序。', source: 'AI',
        },
      ],
    },
  }],
};

TextbookLearningContentSchema.parse(exercisePreviewBook.chapters[0]!.content);
