import { describe, expect, it } from 'bun:test';
import {
  parseTextbookAST,
  TextbookASTSchema,
  LanguageCodeSchema,
} from '../index.js';

/** M8-1 教材 AST 正典测试（自 protocol 迁入行为，覆盖合法/非法/重复/默认/错误码）。 */
function lesson(id: string, lessonNumber: number, over: Record<string, unknown> = {}) {
  return {
    id,
    lessonNumber,
    title: `t${lessonNumber}`,
    vocabularies: [],
    grammarPoints: [],
    dialogues: [],
    exercises: [],
    ...over,
  };
}

describe('parseTextbookAST', () => {
  it('合法 AST 通过并填充默认值', () => {
    const res = parseTextbookAST({
      id: 'book-test',
      title: '测试日语教材',
      shortTitle: '测日',
      level: 'N5',
      lessons: [
        {
          ...lesson('lesson-1', 1),
          vocabularies: [
            { id: 'v-1', kanji: '初めまして', kana: 'はじめまして', chinese: '初次见面' },
          ],
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.shortTitle).toBe('测日');
    // 默认字段：language 缺省 JA、level 缺省 N5、exercises 缺省 []、pos/声调缺省
    expect(res.value.language).toBe('JA');
    expect(res.value.level).toBe('N5');
    expect(res.value.lessons[0]!.exercises).toEqual([]);
    expect(res.value.lessons[0]!.vocabularies[0]?.pos).toBe('名词');
    expect(res.value.lessons[0]!.vocabularies[0]?.pitchAccent).toBe('⓪');
  });

  it('非法 AST 返回 E_INVALID_TEXTBOOK_AST（VALIDATION）', () => {
    const res = parseTextbookAST({ id: 'invalid' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('E_INVALID_TEXTBOOK_AST');
    expect(res.error.category).toBe('VALIDATION');
    expect(res.error.userMessage).toContain('教材结构化格式不符合规范');
  });

  it('同一 book 内重复 lesson.id 直接拒绝', () => {
    const res = parseTextbookAST({
      id: 'book-dup',
      language: 'JA',
      title: 'B',
      shortTitle: 'B',
      lessons: [lesson('l1', 1), lesson('l1', 2)],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('E_INVALID_TEXTBOOK_AST');
  });

  it('空 lessons 数组拒绝（min 1）', () => {
    const res = parseTextbookAST({
      id: 'book-empty',
      language: 'JA',
      title: 'B',
      shortTitle: 'B',
      lessons: [],
    });
    expect(res.ok).toBe(false);
  });

  it('schema 直用与语言码默认一致', () => {
    expect(LanguageCodeSchema.parse(undefined)).toBe('JA');
    expect(TextbookASTSchema.safeParse(null).success).toBe(false);
  });
});
