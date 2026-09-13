import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import {
  analyzeParsedApkg,
  type ApkgAnalysis,
} from '../index.js';
import { getBuiltinCardFormat } from '@study-studio/flashcard-core';
import type { ParsedApkg } from '@study-studio/flashcard-integrations';

/** M7-12 只读分析用例测试（手造 ParsedApkg，不碰解包/数据库）。 */
function basicModel() {
  const builtin = getBuiltinCardFormat('study-basic');
  if (!builtin) throw new Error('missing builtin study-basic');
  return {
    name: 'Basic',
    fields: Object.keys(builtin.fields),
    front: builtin.frontTemplate,
    back: builtin.backTemplate,
    css: builtin.css,
  };
}
function parsed(): ParsedApkg {
  return {
    notes: [
      { mid: '1', tags: [], fields: ['a', 'b'], deckName: 'D1' },
      { mid: '1', tags: [], fields: ['c', 'd'], deckName: 'D1' },
      { mid: '2', tags: [], fields: ['e', 'f'], deckName: 'D2' },
    ],
    cardCount: 5,
    decks: new Map([
      ['D1', 2],
      ['D2', 1],
    ]),
    models: new Map([
      ['1', basicModel()],
      [
        '2',
        {
          name: 'ClozeLike',
          fields: ['Text'],
          front: '{{type:Text}}',
          back: '{{Back}}',
          css: '',
        },
      ],
    ]),
    mediaRefCount: 3,
    mediaFileCount: 2,
    mediaBlobs: new Map(),
  };
}

describe('analyzeParsedApkg', () => {
  it('计数/排序/形状：model 按示例数降序，deck 按笔记数降序', () => {
    const res = analyzeParsedApkg(parsed(), 't.apkg');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const a: ApkgAnalysis = res.value;
    expect(a.fileLabel).toBe('t.apkg');
    expect(a.noteCount).toBe(3);
    expect(a.cardCount).toBe(5);
    expect(a.truncated).toBe(false);
    expect(a.mediaFileCount).toBe(2);
    expect(a.mediaRefCount).toBe(3);
    expect(a.decks).toEqual([
      { name: 'D1', noteCount: 2 },
      { name: 'D2', noteCount: 1 },
    ]);
    expect(a.models.map((m) => m.modelName)).toEqual(['Basic', 'ClozeLike']);
    expect(a.models[0]?.exampleNoteCount).toBe(2);
    expect(a.models[1]?.exampleNoteCount).toBe(1);
  });

  it('字段映射与模板兼容性经规范函数计算', () => {
    const res = analyzeParsedApkg(parsed(), 't.apkg');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const basic = res.value.models[0];
    expect(basic?.ankiFields).toEqual(Object.keys(getBuiltinCardFormat('study-basic')?.fields ?? {}));
    expect(basic?.fieldMapping['Expression']).toBe('expression');
    expect(basic?.compatIssues).toEqual([]);
    const cloze = res.value.models[1];
    expect(cloze?.compatIssues.length).toBeGreaterThan(0);
  });

  it('空解析 → 零计数空列表（不抛）', () => {
    const res = analyzeParsedApkg(
      {
        notes: [],
        cardCount: 0,
        decks: new Map(),
        models: new Map(),
        mediaRefCount: 0,
        mediaFileCount: 0,
        mediaBlobs: new Map(),
      },
      'empty.apkg'
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.noteCount).toBe(0);
    expect(res.value.decks).toEqual([]);
    expect(res.value.models).toEqual([]);
    expect(res.value.truncated).toBe(false);
  });
});
