import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import type { DocumentItem } from '@study-studio/protocol';
import {
  groundVocabularies,
  groundGrammarPoints,
} from '../application/pdf-import/vocab-enrich.js';
import { appendPdfToDocument } from '../application/pdf-import/pdf-import-service.js';

/**
 * P1-C2-A vocab/grammar identity（真实 grounding 代码路径）。
 * 锁定事实：id = `${lessonId}-v/g${kept序号}` —— lesson 作用域 + 过滤后位置计数，
 * 非内容派生、非随机、非全局唯一。 insertion/deletion/filter-drop 全部移位。
 */
const TEXT = 'ご飯を食べる。水を飲む。学校へ行く。先生に会う。';
const V = (kanji: string, kana: string) => ({ kanji, kana, chinese: '义' });
const G = (title: string) => ({
  title,
  connection: '接续',
  explanation: '说明',
  examples: [{ japanese: 'ご飯を食べる。', chinese: '吃饭。' }],
});

describe('vocab/grammar id 生成事实', () => {
  it('repeatability：同输入同 lessonId → id 完全一致；换 lessonId 整体改变', () => {
    const list = [V('食べる', 'たべる'), V('飲む', 'のむ'), V('行く', 'いく')];
    const a = groundVocabularies(structuredClone(list), TEXT, 'l1');
    const b = groundVocabularies(structuredClone(list), TEXT, 'l1');
    expect(a.kept.map((v) => v.id)).toEqual(['l1-v1', 'l1-v2', 'l1-v3']);
    expect(b.kept.map((v) => v.id)).toEqual(['l1-v1', 'l1-v2', 'l1-v3']);
    const c = groundVocabularies(structuredClone(list), TEXT, 'l2');
    expect(c.kept.map((v) => v.id)).toEqual(['l2-v1', 'l2-v2', 'l2-v3']);
    const g = groundGrammarPoints([{ ...G('〜ます'), examples: [{ japanese: '食べる。', chinese: '吃。' }] }], 'l1');
    expect(g.kept.map((x) => x.id)).toEqual(['l1-g1']);
  });

  it('前置插入：A/B/C id 全部移位（positional drift）', () => {
    const before = groundVocabularies([V('食べる', 'たべる'), V('飲む', 'のむ')], TEXT, 'l1');
    expect(before.kept.map((v) => v.id)).toEqual(['l1-v1', 'l1-v2']);
    const after = groundVocabularies([V('会う', 'あう'), V('食べる', 'たべる'), V('飲む', 'のむ')], TEXT + '先生に会う。', 'l1');
    // 会う=l1-v1；食べる从 v1→v2，飲む从 v2→v3：内容未变但 id 全变
    expect(after.kept.map((v) => [v.kanji, v.id])).toEqual([
      ['会う', 'l1-v1'],
      ['食べる', 'l1-v2'],
      ['飲む', 'l1-v3'],
    ]);
  });

  it('删除与 reorder：id 跟位置不跟内容', () => {
    // 删除 = 新输入不再含飲む：食べる仍是 l1-v1（位置 0 未变）
    const del = groundVocabularies([V('食べる', 'たべる')], TEXT, 'l1');
    expect(del.kept.map((v) => v.id)).toEqual(['l1-v1']);
    expect(del.dropped).toBe(0);
    const re = groundVocabularies([V('飲む', 'のむ'), V('食べる', 'たべる')], TEXT, 'l1');
    expect(re.kept.map((v) => [v.kanji, v.id])).toEqual([
      ['飲む', 'l1-v1'],
      ['食べる', 'l1-v2'],
    ]);
  });

  it('filter-drop（未接地）同样使后续移位；模型自带 id 被丢弃', () => {
    const list = [
      { kanji: '不存在語', kana: 'zzz', chinese: '无', id: 'model-says-keep-me' },
      V('食べる', 'たべる'),
    ];
    const r = groundVocabularies(list, TEXT, 'l1');
    expect(r.dropped).toBe(1);
    // 食べる是 kept[0] → l1-v1；模型给的 id 永不采用
    expect(r.kept.map((v) => v.id)).toEqual(['l1-v1']);
  });

  it('grammar 同理：前置插入移位', () => {
    const mk = (t: string) => ({ ...G(t), examples: [{ japanese: '食べる。', chinese: '吃。' }] });
    const before = groundGrammarPoints([mk('〜ます'), mk('〜たい')], 'l1');
    expect(before.kept.map((g) => g.id)).toEqual(['l1-g1', 'l1-g2']);
    const after = groundGrammarPoints([mk('〜ない'), mk('〜ます'), mk('〜たい')], 'l1');
    expect(after.kept.map((g) => [g.title, g.id])).toEqual([
      ['〜ない', 'l1-g1'],
      ['〜ます', 'l1-g2'],
      ['〜たい', 'l1-g3'],
    ]);
  });

  it('title 修改不影响 id（id 只跟 lessonId+位置）', () => {
    const a = groundVocabularies([V('食べる', 'たべる')], TEXT, 'l1');
    expect(a.kept[0]?.id).toBe('l1-v1');
  });

  it('append：既有 lesson 的 vocab/grammar ids 逐字保留', async () => {
    const baseAst = {
      id: 'doc', language: 'JA', title: 'B', shortTitle: 'B',
      lessons: [
        {
          id: 'doc-l1', lessonNumber: 1, title: '第1課',
          vocabularies: [{ id: 'doc-l1-v1', kanji: '食べる', kana: 'たべる', chinese: '吃' }],
          grammarPoints: [],
          dialogues: [{ speaker: 'A', japanese: 'ご飯を食べる。', chinese: '' }],
          exercises: [],
        },
      ],
    };
    const baseDoc = {
      id: 'doc1', userId: 'u1', title: 'B', sourceKind: 'user_import' as const, language: 'ja',
      content: 'Base', astJson: JSON.stringify(baseAst), createdAt: 'x', updatedAt: 'x',
    };
    let savedAst = '';
    const res = await appendPdfToDocument(
      {
        saveDocument: async (doc: DocumentItem) => {
          const { ok } = await import('@study-studio/shared');
          return ok(doc);
        },
        saveCanonicalAst: async (docBase, book) => {
          savedAst = JSON.stringify(book);
          const { ok } = await import('@study-studio/shared');
          return ok({ ...docBase, astJson: savedAst } as typeof baseDoc);
        },
        getDocument: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ ...baseDoc });
        },
        projectLinesSegments: async () => {
          const { ok } = await import('@study-studio/shared');
          return ok({ inserted: 0, skipped: 0 });
        },
        loadInspector: async () => ({
          processPdf: () => ({
            pdfType: 'TextBased', pageCount: 1,
            markdown: '# 第2課\nB：さようなら。', pagesNeedingOcr: [], confidence: 0.9,
          }),
          processPdfWithOcr: async () => ({ markdown: null, pagesRoutedToOcr: [], pagesRecommendingHosted: [] }),
        }),
      },
      { userId: 'u1', filename: 'p2.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), documentId: 'doc1' }
    );
    expect(isOk(res)).toBe(true);
    const merged = JSON.parse(savedAst) as { lessons: Array<{ id: string; vocabularies: Array<{ id: string }> }> };
    expect(merged.lessons[0]?.vocabularies.map((v) => v.id)).toEqual(['doc-l1-v1']);
  });

  it('enrich 语义：重跑 grounding 即整体重建 id（无保留逻辑，见 processOne 原位替换）', () => {
    // 同一 lesson 两次不同 AI 输出 → id 按各自 kept 位置重编，不继承旧 id
    const first = groundVocabularies([V('食べる', 'たべる'), V('飲む', 'のむ')], TEXT, 'l1');
    const second = groundVocabularies([V('飲む', 'のむ'), V('行く', 'いく')], TEXT, 'l1');
    expect(first.kept.map((v) => v.id)).toEqual(['l1-v1', 'l1-v2']);
    expect(second.kept.map((v) => v.id)).toEqual(['l1-v1', 'l1-v2']);
    // 飲む在两次 runs 中 id 不同（v2 vs v1）：re-enrich 不保留
    expect(first.kept.find((v) => v.kanji === '飲む')?.id).toBe('l1-v2');
    expect(second.kept.find((v) => v.kanji === '飲む')?.id).toBe('l1-v1');
  });
});
