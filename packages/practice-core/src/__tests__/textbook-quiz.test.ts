import { describe, it, expect } from 'bun:test';
import { isOk, isErr } from '@study-studio/shared';
import type { TextbookLesson } from '@study-studio/protocol';
import { buildTextbookLessonQuestions } from '../index.js';

/**
 * M7-19 教材本课出题测试（纯逻辑；Gateway 原测试文件保持不动作兼容覆盖）。
 * 只吃本课 AST，不调 LLM、不臆造。
 */
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
    expect(res.value[0]?.testedSkillId).toBe('jp.vocab.review');
    expect(res.value[2]?.testedSkillId).toBe('jp.sentence.review');
  });

  it('无效选项/答案跳过（选项<2、答案为空、答案不在选项中）', () => {
    const res = buildTextbookLessonQuestions(
      lesson({
        exercises: [
          { id: 'e1', type: 'CHOICE', prompt: '少选项', options: ['a'], answer: 'a' },
          { id: 'e2', type: 'CHOICE', prompt: '答案不在选项', options: ['a', 'b'], answer: 'z' },
          { id: 'e3', type: 'FILL_BLANK', prompt: '空答案', answer: '   ' },
          { id: 'e4', type: 'CHOICE', prompt: '有效', options: ['a', 'b'], answer: 'b' },
        ],
      }),
      5,
      'ja'
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.length).toBe(1);
    expect(res.value[0]?.correctAnswer).toBe('b');
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

  it('课文对话选译文（说话人保留）与 count 截断', () => {
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

  it('空课如实报 E_CONTENT_EMPTY（不伪造）', () => {
    const res = buildTextbookLessonQuestions(lesson(), 5, 'ja');
    expect(isOk(res)).toBe(false);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_CONTENT_EMPTY');
      expect(res.error.retryable).toBe(false);
    }
  });
});
