import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, BusinessError } from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
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

  it('英文混排方言（vocabulary/meaning_zh/part_of_speech/字符串例句）', () => {
    const raw = JSON.stringify({
      vocabulary: [
        { word: 'つけます', reading: 'つけます', part_of_speech: '动词', meaning_zh: '打开', example: 'エアコンをつけます。' },
        { word: '消します', reading: 'けします', part_of_speech: '动词', meaning_zh: '关掉' },
      ],
    });
    const lessonText = 'エアコンをつけます\n電気を消します';
    const g = parseAndGround(raw, lessonText, 'l14');
    expect(g?.vocabularies.map((v) => v.kanji)).toEqual(['つけます', '消します']);
    expect(g?.vocabularies[0]).toMatchObject({
      chinese: '打开',
      example: { japanese: 'エアコンをつけます。', chinese: '' },
    });
    expect(g?.dropped).toBe(0);
  });

  it('文法形分拣与归一同源（名称/结构/功能实测方言）', () => {
    const raw = JSON.stringify({
      核心文法: [
        { 名称: '动词て形+もいいですか', 结构: 'Vて+もいいですか', 功能: '请求许可', 例句: '写真を撮ってもいいですか。' },
      ],
    });
    const g = parseAndGround(raw, '写真を撮ってもいいですか', 'l15');
    expect(g?.grammarPoints).toHaveLength(1);
    expect(g?.grammarPoints[0]).toMatchObject({
      title: '动词て形+もいいですか',
      connection: 'Vて+もいいですか',
    });
  });

  it('分组对象展平（生词按词性分组是实测方言）', () => {
    const raw = JSON.stringify({
      课名: '第14課',
      生词: {
        动词: [
          { 日语: 'つけます', 中文: '打开' },
          { 日语: '消します', 中文: '关掉' },
        ],
        名词: [{ 日语: '電気', 中文: '电' }],
      },
    });
    const lessonText = 'つけます\n消します\n電気を消します';
    const g = parseAndGround(raw, lessonText, 'l14');
    expect(g?.vocabularies.map((v) => v.kanji)).toEqual(['つけます', '消します', '電気']);
    expect(g?.dropped).toBe(0);
  });

  it('附赠数组拼主表（key_responses/te_form_conjugation/formation接续）', () => {
    const raw = JSON.stringify({
      vocabulary: [{ word: 'つけます', reading: 'つけます', part_of_speech: '动词', meaning_zh: '打开' }],
      grammar: [
        { pattern: 'Vて形 + ください', name_zh: '请求', formation: '动词て形 + ください', usage_zh: '请对方做某事', examples: ['待ってください'] },
      ],
      te_form_conjugation: [
        { verb_group: 'Ⅰ类', rule: 'いちり去い接って', examples: ['買います→買って'] },
      ],
      key_responses: [{ expression: 'はい、お願いします', meaning_zh: '好的拜托了' }],
    });
    const lessonText = 'つけます\n待ってください\n買います→買って\nはい、お願いします';
    const g = parseAndGround(raw, lessonText, 'l14');
    expect(g?.vocabularies.map((v) => v.kanji)).toEqual(['つけます', 'はい、お願いします']);
    expect(g?.grammarPoints).toHaveLength(2);
    expect(g?.grammarPoints[0]).toMatchObject({
      title: 'Vて形 + ください',
      connection: '动词て形 + ください',
    });
    expect(g?.grammarPoints[1]).toMatchObject({ title: 'いちり去い接って' });
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

describe('enrichLessonVocab 取消', () => {
  const cancelInput = {
    lessonId: 'l1',
    lessonTitle: '第 1 課',
    language: 'JA' as const,
    dialogueTexts: LESSON_TEXT.split('\n'),
  };
  it('预取消：不建会话，直接 E_ENRICH_CANCELLED', async () => {
    let created = 0;
    const base = makeMockAdapter({ kind: 'success', text: AI_VOCAB_JSON });
    const counting: AgentAdapter = {
      ...base,
      createSession: async (...args: Parameters<AgentAdapter['createSession']>) => {
        created += 1;
        return base.createSession(...args);
      },
    };
    const controller = new AbortController();
    controller.abort();
    const res = await enrichLessonVocab(counting, { ...cancelInput, signal: controller.signal });
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_ENRICH_CANCELLED');
    expect(created).toBe(0);
  });

  it('在途取消：interrupt 被调用，返回 E_ENRICH_CANCELLED', async () => {
    let interrupted = 0;
    let release: (() => void) | null = null;
    const session: AgentSession = {
      sessionId: 's-hang',
      send: async function* () {
        yield { type: 'TEXT_DELTA' as const, delta: '{"vocabularies":[' };
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      submitToolResult: async () => ok(undefined),
      submitApproval: async () => ok(undefined),
      steer: async () => ok(undefined),
      interrupt: async () => {
        interrupted += 1;
        release?.();
        return ok(undefined);
      },
      close: async () => ok(undefined),
    };
    const adapter: AgentAdapter = {
      id: 'mock-hang',
      name: 'mock-hang',
      createSession: async () => ok(session),
      resumeSession: async () => ok(session),
    };
    const controller = new AbortController();
    const pending = enrichLessonVocab(adapter, { ...cancelInput, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    const res = await pending;
    expect(interrupted).toBe(1);
    expect(isOk(res)).toBe(false);
    if (isOk(res)) return;
    expect(res.error.code).toBe('E_ENRICH_CANCELLED');
  });
});

describe('enrichLessonVocab 模型分流', () => {
  const shuntInput = {
    lessonId: 'l1',
    lessonTitle: '第 1 課',
    language: 'JA' as const,
    dialogueTexts: LESSON_TEXT.split('\n'),
  };
  it('model/effort 经建会话生效；不填则缺席（turnOptions 通道已删除，无适配器读取）', async () => {
    const seenInputs: unknown[] = [];
    const seenOptions: unknown[] = [];
    const session: AgentSession = {
      sessionId: 's-turnopts',
      send: async function* (input: unknown) {
        seenInputs.push(input);
        yield { type: 'TEXT_DELTA' as const, delta: AI_VOCAB_JSON };
        yield { type: 'COMPLETED' as const };
      },
      submitToolResult: async () => ok(undefined),
      submitApproval: async () => ok(undefined),
      steer: async () => ok(undefined),
      interrupt: async () => ok(undefined),
      close: async () => ok(undefined),
    };
    const adapter: AgentAdapter = {
      id: 'mock-turnopts',
      name: 'mock-turnopts',
      createSession: async (options) => { seenOptions.push(options); return ok(session); },
      resumeSession: async () => ok(session),
    };
    const withModel = await enrichLessonVocab(adapter, {
      ...shuntInput,
      model: 'mini-x',
      effort: 'low',
    });
    expect(isOk(withModel)).toBe(true);
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]).not.toHaveProperty('turnOptions');
    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]).toMatchObject({ model: 'mini-x', effort: 'low' });
    seenInputs.length = 0;
    seenOptions.length = 0;
    const withoutModel = await enrichLessonVocab(adapter, { ...shuntInput });
    expect(isOk(withoutModel)).toBe(true);
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0]).not.toHaveProperty('turnOptions');
    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]).not.toHaveProperty('model');
    expect(seenOptions[0]).not.toHaveProperty('effort');
  });
});
