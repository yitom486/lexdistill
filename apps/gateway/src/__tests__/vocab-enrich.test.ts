import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, BusinessError } from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-core';
import {
  enrichBookLessons,
  enrichLessonVocab,
  groundGrammarPoints,
  groundVocabularies,
  normalizeEnrichJson,
  normalizeGrammarItem,
  normalizePitch,
  normalizeVocabItem,
  parseAndGround,
} from '../modules/library/application/pdf-import/vocab-enrich.js';

// ---------- mock adapter（与 learning-assess-ai.test.ts 同构） ----------
type StreamScenario = { kind: 'success'; text: string } | { kind: 'error' } | { kind: 'create-fail' };

function makeMockAdapter(scenario: StreamScenario): AgentAdapter {
  const session: AgentSession = {
    sessionId: 's1',
    send: async function* () {
      if (scenario.kind === 'success') {
        yield { type: 'TEXT_DELTA' as const, delta: scenario.text };
        yield { type: 'COMPLETED' as const };
      } else {
        yield {
          type: 'ERROR' as const,
          error: new BusinessError('E_CODEX_TURN', '模型流错误', 'AGENT_RUNTIME'),
        };
      }
    },
    submitToolResult: async () => ok(undefined),
    submitApproval: async () => ok(undefined),
    steer: async () => ok(undefined),
    interrupt: async () => ok(undefined),
    close: async () => ok(undefined),
  };
  return {
    id: 'mock',
    name: 'mock',
    createSession: async () =>
      scenario.kind === 'create-fail'
        ? err(new BusinessError('E_CODEX_SESSION_CREATE', '建会话失败', 'AGENT_RUNTIME'))
        : ok(session),
    resumeSession: async () => ok(session),
  };
}

const LESSON_TEXT = '李さん：はじめまして。李です。\n森：はじめまして。森です。どうぞよろしく。';

const AI_VOCAB_JSON = JSON.stringify({
  vocabularies: [
    {
      id: 'x',
      kanji: '李',
      kana: 'り',
      chinese: '李（姓氏）',
      pos: '名词',
      pitchAccent: '①',
      example: { japanese: '李です。', chinese: '我是小李。' },
    },
    {
      // 编造词：课文没有 → 必须被接地检查丢弃
      id: 'y',
      kanji: '図書館',
      kana: 'としょかん',
      chinese: '图书馆',
      pos: '名词',
      pitchAccent: '⓪',
      example: { japanese: '図書館です。', chinese: '是图书馆。' },
    },
    {
      // 声调乱写 → 记 ？，词保留（词面在课文）
      id: 'z',
      kanji: 'はじめまして',
      kana: 'はじめまして',
      chinese: '初次见面',
      pos: '寒暄语',
      pitchAccent: '乱写',
      example: { japanese: 'はじめまして。', chinese: '初次见面。' },
    },
  ],
  grammarPoints: [
    {
      id: 'g',
      title: 'です判断句',
      connection: '名词 + です',
      explanation: '表示判断与身份。',
      examples: [{ japanese: '李です。', chinese: '我是小李。' }],
    },
  ],
});

describe('groundVocabularies', () => {
  it('只收原文出现的词，声调乱写记？', () => {
    const { kept, dropped } = groundVocabularies(JSON.parse(AI_VOCAB_JSON).vocabularies, LESSON_TEXT, 'l1');
    expect(kept.map((v) => v.kanji)).toEqual(['李', 'はじめまして']);
    expect(kept[1]?.pitchAccent).toBe('？');
    expect(dropped).toBe(1);
  });

  it('非法结构整条丢弃', () => {
    const { kept, dropped } = groundVocabularies([{ kanji: '李' }], LESSON_TEXT, 'l1');
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });
});

describe('groundGrammarPoints', () => {  it('无例句的文法点丢弃', () => {
    const { kept, dropped } = groundGrammarPoints(
      [
        { id: 'a', title: 'X', connection: 'Y', explanation: 'Z', examples: [] },
        ...JSON.parse(AI_VOCAB_JSON).grammarPoints,
      ],
      'l1'
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });
});

describe('enrichLessonVocab', () => {
  const input = {
    lessonId: 'l1',
    lessonTitle: '第 1 課',
    language: 'JA' as const,
    dialogueTexts: LESSON_TEXT.split('\n'),
  };
  it('模型正常：接地+计数', async () => {
    const res = await enrichLessonVocab(makeMockAdapter({ kind: 'success', text: AI_VOCAB_JSON }), input);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.vocabularies).toHaveLength(2);
    expect(res.value.grammarPoints).toHaveLength(1);
    expect(res.value.dropped).toBe(1);
  });

  it('无 adapter / 建会话失败 / 流错误 / 乱码 → err（不写库，由调用方处理）', async () => {
    expect(isOk(await enrichLessonVocab(undefined, input))).toBe(false);
    expect(
      isOk(await enrichLessonVocab(makeMockAdapter({ kind: 'create-fail' }), input))
    ).toBe(false);
    expect(isOk(await enrichLessonVocab(makeMockAdapter({ kind: 'error' }), input))).toBe(false);
    expect(
      isOk(await enrichLessonVocab(makeMockAdapter({ kind: 'success', text: '胡言乱语' }), input))
    ).toBe(false);
  });
});

describe('enrichBookLessons', () => {
  const book = {
    id: 'b1',
    language: 'JA' as const,
    title: '样例',
    shortTitle: '样例',
    level: 'N5',
    lessons: [
      {
        id: 'l1',
        lessonNumber: 1,
        title: '第 1 課',
        vocabularies: [],
        grammarPoints: [],
        dialogues: [{ speaker: '李さん', japanese: 'はじめまして。李です。', chinese: '' }],
        exercises: [],
      },
      {
        id: 'l2',
        lessonNumber: 2,
        title: '第 2 課',
        vocabularies: [
          {
            id: 'old',
            kanji: '既有',
            kana: 'きゆう',
            chinese: '已有',
            pos: '名词',
            pitchAccent: '⓪',
          },
        ],
        grammarPoints: [],
        dialogues: [{ speaker: '森', japanese: '森です。', chinese: '' }],
        exercises: [],
      },
    ],
  };
  it('只抽无生词的课，已有词不覆盖', async () => {
    const res = await enrichBookLessons(
      makeMockAdapter({ kind: 'success', text: AI_VOCAB_JSON }),
      book,
      ['l1', 'l2']
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.enrichedLessons).toBe(1);
    expect(res.value.book.lessons[0]?.vocabularies.length).toBeGreaterThan(0);
    expect(res.value.book.lessons[1]?.vocabularies).toHaveLength(1);
  });

  it('顺带产出 draftables（课 id + 词条，供草稿箱提议）', async () => {
    const res = await enrichBookLessons(
      makeMockAdapter({ kind: 'success', text: AI_VOCAB_JSON }),
      book,
      ['l1']
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.draftables.length).toBe(res.value.vocabularies);
    expect(res.value.draftables[0]?.lessonId).toBe('l1');
    expect(typeof res.value.draftables[0]?.vocab.kanji).toBe('string');
  });

  it('全已有词 → E_INVALID_INPUT', async () => {
    const res = await enrichBookLessons(makeMockAdapter({ kind: 'success', text: AI_VOCAB_JSON }), book, ['l2']);
    expect(isOk(res)).toBe(false);
  });
});

describe('normalizePitch / normalizeEnrichJson / parseAndGround', () => {
  it('阿拉伯数字声调映射圈号，乱写记？', () => {
    expect(normalizePitch('⓪')).toBe('⓪');
    expect(normalizePitch('4')).toBe('④');
    expect(normalizePitch('随前接人名变化')).toBe('？');
    expect(normalizePitch(undefined)).toBe('？');
  });

  it('顶层中文键别名归一', () => {
    const out = normalizeEnrichJson({ 生词: [{ id: 'a' }], 文法: [] });
    expect(out.vocabularies).toHaveLength(1);
    expect(out.grammarPoints).toEqual([]);
  });

  it('parseAndGround 对中文键 + 数字声调全链路可用', () => {
    const raw = JSON.stringify({
      生词: [
        {
          id: 'a',
          kanji: '李',
          kana: 'り',
          chinese: '李',
          pos: '名词',
          pitchAccent: '1',
          example: { japanese: '李です。', chinese: '我是小李。' },
        },
      ],
      文法: [],
    });
    const g = parseAndGround(raw, LESSON_TEXT, 'l1');
    expect(g?.vocabularies).toHaveLength(1);
    expect(g?.vocabularies[0]?.pitchAccent).toBe('①');
  });

  it('条目中文键归一 + 辞书形～前缀接地', () => {
    const raw = JSON.stringify({
      生词: [
        { 词语: 'はじめまして', 读音: 'はじめまして', 释义: '初次见面', 词性: '寒暄语' },
        { 词语: '～さん', 读音: 'さん', 释义: '尊称接尾', 词性: '接尾词' },
        { 词语: '図書館', 读音: 'としょかん', 释义: '图书馆', 词性: '名词' },
      ],
      文法: [{ 标题: 'です判断句', 接续: '名词＋です', 讲解: '表判断。', 例句: [{ 日文: '李です。', 中文: '我是小李。' }] }],
    });
    const g = parseAndGround(raw, LESSON_TEXT, 'l1');
    // はじめまして/～さん收录（～按さん接地），図書館无接地丢弃
    expect(g?.vocabularies.map((v) => v.kanji)).toEqual(['はじめまして', '～さん']);
    expect(g?.grammarPoints).toHaveLength(1);
    expect(g?.dropped).toBe(1);
    expect(normalizeVocabItem('x')).toBe('x');
    expect(normalizeGrammarItem(null)).toBe(null);
  });

  it('真机方言全链路（词/句型/含义/要点/字符串例句/核心文法）', () => {
    // 2026-09-09 大家的日语第10課实测：模型全中文键 + 无例句对象 + 无接续
    const raw = JSON.stringify({
      课名: '第10課',
      生词: [
        { 词: 'あります', 读音: 'あります', 中文: '有；在', 词性: '动词' },
        { 词: '郵便局', 读音: 'ゆうびんきょく', 中文: '邮局', 词性: '名词' },
      ],
      核心文法: [
        { 句型: '名詞1は名詞2です', 含义: '判断句', 要点: '用は提示主题', 例句: 'わたしは学生です' },
      ],
    });
    const lessonText = 'ここは郵便局です\nわたしは学生です\nありますか';
    const g = parseAndGround(raw, lessonText, 'l10');
    expect(g?.vocabularies.map((v) => v.kanji)).toEqual(['あります', '郵便局']);
    expect(g?.vocabularies[0]?.pitchAccent).toBe('？');
    expect(g?.grammarPoints).toHaveLength(1);
    expect(g?.grammarPoints[0]).toMatchObject({
      title: '名詞1は名詞2です',
      explanation: '判断句\n用は提示主题',
    });
    expect(g?.grammarPoints[0]?.examples[0]).toMatchObject({
      japanese: 'わたしは学生です',
      chinese: '',
    });
    expect(g?.dropped).toBe(0);
  });
});

describe('enrichLessonVocab 修复重试', () => {
  it('首轮中文键零收成 → 同会话修复一次后成功', async () => {
    const zeroKeep = JSON.stringify({ 生词: [], 文法: [] });
    const calls: string[] = [];
    const session: AgentSession = {
      sessionId: 's-retry',
      send: async function* (req: { message?: string }) {
        calls.push(req.message ?? '');
        yield { type: 'TEXT_DELTA' as const, delta: calls.length === 1 ? zeroKeep : AI_VOCAB_JSON };
        yield { type: 'COMPLETED' as const };
      },
      submitToolResult: async () => ok(undefined),
      submitApproval: async () => ok(undefined),
      steer: async () => ok(undefined),
      interrupt: async () => ok(undefined),
      close: async () => ok(undefined),
    };
    const adapter: AgentAdapter = {
      id: 'mock-retry',
      name: 'mock-retry',
      createSession: async () => ok(session),
      resumeSession: async () => ok(session),
    };
    const res = await enrichLessonVocab(adapter, {
      lessonId: 'l1',
      lessonTitle: '第 1 課',
      language: 'JA' as const,
      dialogueTexts: LESSON_TEXT.split('\n'),
    });
    expect(calls.length).toBe(2);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.vocabularies.length).toBeGreaterThan(0);
  });
});
