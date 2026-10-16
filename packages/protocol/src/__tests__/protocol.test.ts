import { describe, expect, it } from 'bun:test';
import {
  WsEnvelopeSchema,
  WsEventTypes,
  GeneratedQuestionSchema,
  KanaItemSchema,
  KanaLearningGuideSchema,
  QuizGradingResultSchema,
  parseTextbookAST,
  TextbookASTSchema,
  toUiQuizType,
  toProtocolQuizType,
  PracticePlanScheduleSchema,
  PracticePlanTemplateSchema,
  ContentSegmentSchema,
  ContentSourceSchema,
  SelectionContextSchema,
  EncounteredTermSchema,
  TermOccurrenceSchema,
} from '../index.js';


describe('Protocol Package Schemas', () => {
  it('should validate standard envelope correctly', () => {
    const rawEnvelope = {
      version: '1.0',
      id: 'msg-123',
      sessionId: 'sess-456',
      turnId: 'turn-789',
      type: WsEventTypes.CLIENT_TURN_SEND,
      payload: { input: 'How to say apple in Japanese?' },
      timestamp: Date.now(),
    };

    const parsed = WsEnvelopeSchema.safeParse(rawEnvelope);
    expect(parsed.success).toBe(true);
  });

  it('should map FILL_IN_BLANK ↔ FILL_BLANK and CHOICE ↔ MULTIPLE_CHOICE', () => {
    expect(toUiQuizType('FILL_IN_BLANK')).toBe('FILL_BLANK');
    expect(toUiQuizType('FILL_BLANK')).toBe('FILL_BLANK');
    expect(toProtocolQuizType('FILL_BLANK')).toBe('FILL_IN_BLANK');
    expect(toProtocolQuizType('CHOICE')).toBe('MULTIPLE_CHOICE');
    expect(toUiQuizType('SENTENCE_REORDER')).toBe('REORDER');
    expect(toProtocolQuizType('REORDER')).toBe('SENTENCE_REORDER');
  });

  it('should validate generated question schema', () => {
    const question = {
      id: 'q-001',
      type: 'MULTIPLE_CHOICE',
      prompt: '选择正确的助词填空',
      content: '李さんはデパート____行きます。',
      options: ['に', 'で', 'を', 'から'],
      correctAnswer: 'に',
      explanation: '表示移动的目的地时使用助词「に」。',
      testedSkillId: 'jp.particle.direction_ni',
      difficultyTier: 2,
    };

    const parsed = GeneratedQuestionSchema.safeParse(question);
    expect(parsed.success).toBe(true);
  });

  it('should validate the structured kana learning guide and keep it optional', () => {
    const guide = {
      soundDescription: '表示日语的 a 音，是一个假名拍。',
      memoryTip: '张大嘴说“啊”。',
      pronunciationTip: '口腔打开，短促发音。',
      confusionNotes: '与お对照字形。',
      exampleWords: [{ word: '朝', reading: 'あさ', meaning: '早上' }],
    };
    expect(KanaLearningGuideSchema.safeParse(guide).success).toBe(true);
    expect(
      KanaItemSchema.safeParse({
        id: 'kana_a',
        type: 'SEION',
        hiragana: 'あ',
        katakana: 'ア',
        romaji: 'a',
        row: 'あ行',
        col: 'あ段',
        audioText: 'あ',
        sortOrder: 1,
        learningGuide: guide,
      }).success
    ).toBe(true);
    expect(KanaItemSchema.safeParse({
      id: 'kana_a',
      type: 'SEION',
      hiragana: 'あ',
      katakana: 'ア',
      romaji: 'a',
      row: 'あ行',
      col: 'あ段',
      audioText: 'あ',
      sortOrder: 1,
    }).success).toBe(true);
  });

  it('should validate structured grading result schema', () => {
    const report = {
      questionId: 'q-001',
      isCorrect: false,
      score: 0,
      correctAnswer: 'に',
      userSubmission: 'で',
      explanation: '「で」表示动作发生的场所，而移动的目的地应用「に」。',
      errorDiagnosis: {
        category: 'PARTICLE',
        description: '助词「に」与「で」混淆',
        motherTongueInterference: '中文里“去百货商店”与“在百货商店”都可用介词表示，容易混淆。',
      },
      refinementSuggestion: '可以联想「へ」也是方向助词。',
      followUpTip: '口诀：目的地用に，活动地点用で。',
      mistakeRecorded: true,
    };

    const parsed = QuizGradingResultSchema.safeParse(report);
    expect(parsed.success).toBe(true);
  });

  it('should validate structured textbook AST and parse valid payload', () => {
    const rawTextbook = {
      id: 'book-test',
      title: '测试日语教材',
      shortTitle: '测日',
      level: 'N5',
      publisher: 'LexDistill Press',
      totalLessons: 1,
      lessons: [
        {
          id: 'lesson-1',
          lessonNumber: 1,
          title: '第1课 初次见面',
          summary: '基本寒暄与自我介绍',
          vocabularies: [
            {
              id: 'v-1',
              kanji: '初めまして',
              kana: 'はじめまして',
              pos: '寒暄语',
              pitchAccent: '④',
              chinese: '初次见面',
            },
          ],
          grammarPoints: [
            {
              id: 'g-1',
              title: '～は～です',
              connection: '名词1 + は + 名词2 + です',
              explanation: '判断句结构，表示断定。',
              examples: [{ japanese: '私は学生です。', chinese: '我是学生。' }],
            },
          ],
          dialogues: [
            {
              speaker: '田中',
              japanese: '初めまして、田中です。',
              chinese: '初次见面，我是田中。',
            },
          ],
          exercises: [
            {
              id: 'ex-1',
              type: 'CHOICE',
              prompt: '私は学生_____。',
              options: ['です', 'ます', 'でした', 'ません'],
              answer: 'です',
              explanation: '现在肯定判断用「です」。',
            },
          ],
        },
      ],
    };

    const parseResult = parseTextbookAST(rawTextbook);
    expect(parseResult.ok).toBe(true);
    if (parseResult.ok) {
      expect(parseResult.value.shortTitle).toBe('测日');
      expect(parseResult.value.lessons[0]!.vocabularies.length).toBe(1);
    }

    // 测试非法数据返回 BusinessError
    const invalidResult = parseTextbookAST({ id: 'invalid' });
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.error.code).toBe('E_INVALID_TEXTBOOK_AST');
    }
  });

  it('同一 book 内重复 lesson.id 直接拒绝（P1-C0.75 Task 3）', () => {
    const dup = {
      id: 'book-dup',
      language: 'JA',
      title: 'B',
      shortTitle: 'B',
      lessons: [
        { id: 'l1', lessonNumber: 1, title: 't1', vocabularies: [], grammarPoints: [], dialogues: [], exercises: [] },
        { id: 'l1', lessonNumber: 2, title: 't2', vocabularies: [], grammarPoints: [], dialogues: [], exercises: [] },
      ],
    };
    const res = parseTextbookAST(dup);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('E_INVALID_TEXTBOOK_AST');
    }
  });

  it('should validate practice plan schedule (P6-1)', () => {
    expect(PracticePlanScheduleSchema.safeParse({ kind: 'daily' }).success).toBe(true);
    expect(
      PracticePlanScheduleSchema.safeParse({ kind: 'weekly', weekdays: [1, 3, 5] }).success
    ).toBe(true);
    // 非法：空 weekdays / 越界 / 缺 kind / monthly 暂缓
    expect(
      PracticePlanScheduleSchema.safeParse({ kind: 'weekly', weekdays: [] }).success
    ).toBe(false);
    expect(
      PracticePlanScheduleSchema.safeParse({ kind: 'weekly', weekdays: [7] }).success
    ).toBe(false);
    expect(PracticePlanScheduleSchema.safeParse({ weekdays: [1] }).success).toBe(false);
    expect(PracticePlanScheduleSchema.safeParse({ kind: 'monthly' }).success).toBe(false);
  });

  it('should accept template with or without schedule (backward compatible)', () => {
    const base = {
      id: 'tpl_1',
      userId: 'u1',
      language: 'en',
      name: '晚间计划',
      enabled: true,
      revision: 1,
      blocks: [
        { id: 'b1', kind: 'QUIZ', count: 5, gradingMode: 'AUTO_IMMEDIATE' },
      ],
      createdAt: '2026-09-05T00:00:00.000Z',
      updatedAt: '2026-09-05T00:00:00.000Z',
    };
    expect(PracticePlanTemplateSchema.safeParse(base).success).toBe(true);
    expect(
      PracticePlanTemplateSchema.safeParse({
        ...base,
        schedule: { kind: 'weekly', weekdays: [1, 3, 5] },
      }).success
    ).toBe(true);
    expect(
      PracticePlanTemplateSchema.safeParse({
        ...base,
        schedule: { kind: 'weekly', weekdays: [] },
      }).success
    ).toBe(false);
  });
});

describe('P1-3 content index schemas', () => {
  it('ContentSegment：空 lesson 允许，ord 非负', () => {
    const base = {
      id: 'seg_1',
      documentId: 'd1',
      lessonId: '',
      ord: 0,
      kind: 'paragraph',
      text: '你好',
      hash: 'h',
      createdAt: '2026-09-14T00:00:00.000Z',
    };
    expect(ContentSegmentSchema.safeParse(base).success).toBe(true);
    expect(ContentSegmentSchema.safeParse({ ...base, ord: -1 }).success).toBe(false);
    expect(ContentSegmentSchema.safeParse({ ...base, kind: 'audio' }).success).toBe(false);
  });

  it('ContentSource／SelectionContext／EncounteredTerm／TermOccurrence 形状', () => {
    expect(
      ContentSourceSchema.safeParse({
        id: 'csrc-user-pdf',
        format: 'pdf',
        origin: 'user_import',
        displayName: '用户 PDF 导入',
        capabilitiesJson: '{}',
        createdAt: 't',
      }).success
    ).toBe(true);
    expect(
      SelectionContextSchema.safeParse({
        id: 'sel_1',
        userId: 'u1',
        language: 'ja',
        surface: '曖昧',
        normalizedText: '曖昧',
        createdAt: 't',
      }).success
    ).toBe(true);
    expect(
      SelectionContextSchema.safeParse({
        id: 'sel_1',
        userId: 'u1',
        language: 'fr',
        surface: 'x',
        normalizedText: 'x',
        createdAt: 't',
      }).success
    ).toBe(false);
    expect(
      EncounteredTermSchema.safeParse({
        userId: 'u1',
        language: 'ja',
        termKey: 'k',
        headword: '曖昧',
        status: 'new',
        exposureCount: 1,
        lookupCount: 1,
        readCount: 0,
        firstSeenAt: 't',
        lastSeenAt: 't',
      }).success
    ).toBe(true);
    expect(
      TermOccurrenceSchema.safeParse({
        id: 'tocc_1',
        userId: 'u1',
        language: 'ja',
        termKey: 'k',
        source: 'lookup',
        createdAt: 't',
      }).success
    ).toBe(true);
  });
});

