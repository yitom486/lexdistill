import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import type { DocumentItem } from '@lexdistill/protocol';
import type { TextbookLesson } from '@lexdistill/document-model';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import {
  buildTextbookLessonQuestions,
  canQuizDocument,
} from '../modules/library/application/textbook-lesson-quiz.js';

function lesson(over: Partial<TextbookLesson> = {}): TextbookLesson {
  return {
    id: 'l1',
    lessonNumber: 3,
    title: '第 3 課',
    vocabularies: [],
    grammarPoints: [],
    dialogues: [],
    exercises: [],
    ...over,
  };
}

/** 教材本课真出题（只吃本课 AST，不调 LLM、不臆造）。 */
describe('textbook lesson quiz', () => {
  it('课后自带习题三种题型照搬（金牌优先）', () => {
    const res = buildTextbookLessonQuestions(
      lesson({
        exercises: [
          { id: 'e1', type: 'CHOICE', prompt: '选', options: ['a', 'b'], answer: 'a' },
          { id: 'e2', type: 'FILL_BLANK', prompt: '填つ__', answer: 'く' },
          { id: 'e3', type: 'TRANSLATION', prompt: '今日はいい天気です。', answer: '今天天气很好。' },
        ],
      }),
      5,
      'ja'
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(3);
    expect(res.value[0]?.type).toBe('MULTIPLE_CHOICE');
    expect(res.value[1]?.type).toBe('FILL_IN_BLANK');
    expect(res.value[2]?.type).toBe('TRANSLATION');
    expect(res.value.every((q) => q.difficultyTier === 2)).toBe(true);
    // 雷达有意义的技能，不走 DEFAULT 兜底
    expect(res.value[0]?.testedSkillId).toBe('jp.vocab.review');
    expect(res.value[2]?.testedSkillId).toBe('jp.sentence.review');
  });

  it('生词选中释义（干扰项同课，<2 个干扰项跳过该词）', () => {
    const res = buildTextbookLessonQuestions(
      lesson({
        vocabularies: [
          { id: 'v1', kanji: '食べる', kana: 'たべる', pos: '动词', pitchAccent: '⓪', chinese: '吃' },
          { id: 'v2', kanji: '飲む', kana: 'のむ', pos: '动词', pitchAccent: '⓪', chinese: '喝' },
          { id: 'v3', kanji: '見る', kana: 'みる', pos: '动词', pitchAccent: '⓪', chinese: '看' },
        ],
      }),
      5,
      'ja'
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(3);
    const first = res.value[0]!;
    expect(first.content).toContain('食べる');
    expect(first.correctAnswer).toBe('吃');
    expect(first.options).toContain('喝');
    // 孤词（凑不够干扰项）整题跳过，不断链
    const lonely = buildTextbookLessonQuestions(
      lesson({
        vocabularies: [
          { id: 'v1', kanji: '食べる', kana: 'たべる', pos: '动词', pitchAccent: '⓪', chinese: '吃' },
        ],
      }),
      5,
      'ja'
    );
    expect(isOk(lonely)).toBe(false);
  });

  it('课文对话选译文（说话人保留）', () => {
    const res = buildTextbookLessonQuestions(
      lesson({
        dialogues: [
          { speaker: '李', japanese: 'おはよう。', chinese: '早上好。' },
          { speaker: '王', japanese: 'さようなら。', chinese: '再见。' },
          { speaker: '李', japanese: 'ありがとう。', chinese: '谢谢。' },
        ],
      }),
      2,
      'ja'
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(2);
    expect(res.value[0]?.content).toContain('おはよう');
    expect(res.value[0]?.testedSkillId).toBe('jp.sentence.review');
  });

  it('空课如实报错（指路 AI 抽生词，不伪造）', () => {
    const res = buildTextbookLessonQuestions(lesson(), 5, 'ja');
    expect(isOk(res)).toBe(false);
  });

  it('访问判定：自有或公共种子可出，别人的私档不行', () => {
    expect(canQuizDocument({ userId: 'u', sourceKind: 'user_import' }, 'u')).toBe(true);
    expect(canQuizDocument({ userId: 'seed', sourceKind: 'curriculum_textbook' }, 'u')).toBe(true);
    expect(canQuizDocument({ userId: 'other', sourceKind: 'user_import' }, 'u')).toBe(false);
    expect(canQuizDocument(null, 'u')).toBe(false);
  });
});

/** 教材焦点（reading_positions 推学到哪课，给计划指路）。 */
describe('textbook focus', () => {
  let repo: DrizzleLearnerRepository;
  const userId = 'focus_user';

  beforeEach(() => {
    repo = new DrizzleLearnerRepository(':memory:');
  });

  afterEach(() => {
    repo.getRawDb().close();
  });

  async function seedBook() {
    const ast = {
      id: 'book1',
      language: 'JA',
      title: '标日初上',
      shortTitle: '标日',
      level: 'N5',
      lessons: [
        { id: 'b-l1', lessonNumber: 1, title: '第 1 課', vocabularies: [], grammarPoints: [], dialogues: [] },
        { id: 'b-l2', lessonNumber: 2, title: '第 2 課', vocabularies: [], grammarPoints: [], dialogues: [] },
      ],
    };
    const doc: DocumentItem = {
      id: 'doc1',
      userId,
      title: '标日初上',
      sourceKind: 'user_import',
      language: 'ja',
      content: '标日初上',
      astJson: JSON.stringify(ast),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await repo.saveDocument(doc);
    expect(isOk(saved)).toBe(true);
  }

  it('无阅读记录 → 无焦点（计划保持原样）', async () => {
    await seedBook();
    const res = await repo.getTextbookFocus(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toBeNull();
  });

  it('最近读到的课即焦点', async () => {
    await seedBook();
    const pos = await repo.saveReadingPosition(userId, 'doc1', { lessonId: 'b-l2' });
    expect(isOk(pos)).toBe(true);
    const res = await repo.getTextbookFocus(userId, 'ja');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value?.lessonId).toBe('b-l2');
    expect(res.value?.lessonNumber).toBe(2);
    expect(res.value?.bookTitle).toBe('标日初上');
  });
});
