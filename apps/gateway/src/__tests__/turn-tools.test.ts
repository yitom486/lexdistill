import { describe, expect, it } from 'bun:test';
import { selectTurnTools } from '../runtime/router/turn-tools.js';

describe('selectTurnTools', () => {
  it('默认意图：基线 9 个 + 只读三件套，不开写', () => {
    const tools = selectTurnTools({ userPrompt: '随便聊聊' });
    for (const base of [
      'learning.content',
      'learning.assess',
      'learning.progress',
      'learning.plan',
      'learning.curriculum',
      'learning.library',
      'dictionary.lookup',
      'ui.navigate',
      'ui.present',
    ]) {
      expect(tools.includes(base)).toBe(true);
    }
    expect(tools.includes('mistakes.list')).toBe(true);
    expect(tools.includes('flashcards.due')).toBe(true);
    expect(tools.includes('flashcards.render')).toBe(true);
    expect(tools.includes('flashcards.collect')).toBe(false);
    expect(tools.includes('mistakes.resolve')).toBe(false);
    expect(tools.includes('flashcards.anki_push')).toBe(false);
  });

  it('GRADE 意图不带攻克词不开 resolve；带了才开', () => {
    const plain = selectTurnTools({ intent: 'GRADE', userPrompt: '批改这道题' });
    expect(plain.includes('mistakes.list')).toBe(true);
    expect(plain.includes('mistakes.resolve')).toBe(false);
    const mastered = selectTurnTools({ intent: 'GRADE', userPrompt: '这题我会了，标为已会' });
    expect(mastered.includes('mistakes.resolve')).toBe(true);
  });

  it('REVIEW_MISTAKES 给读不给写；收藏必须明示', () => {
    const review = selectTurnTools({ intent: 'REVIEW_MISTAKES', userPrompt: '复习错题' });
    expect(review.includes('mistakes.list')).toBe(true);
    expect(review.includes('flashcards.collect')).toBe(false);
    const collect = selectTurnTools({ intent: 'FREE_COACH', userPrompt: '帮我收藏这个生词' });
    expect(collect.includes('flashcards.collect')).toBe(true);
  });

  it('Anki/模板/导入提示词开对应工具', () => {
    const push = selectTurnTools({ intent: 'FREE_COACH', userPrompt: '推送到Anki' });
    expect(push.includes('flashcards.anki_push')).toBe(true);
    expect(push.includes('flashcards.render')).toBe(true);
    const tpl = selectTurnTools({ intent: 'FREE_COACH', userPrompt: '卡片模板改一下正面' });
    expect(tpl.includes('flashcards.render')).toBe(true);
    expect(tpl.includes('flashcards.anki_push')).toBe(false);
    const imp = selectTurnTools({ intent: 'FREE_COACH', userPrompt: '导入我的Anki牌组' });
    expect(imp.includes('flashcards.apkg_analyze')).toBe(true);
  });

  it('去重保序；未知意图回退教练基线', () => {
    const tools = selectTurnTools({ intent: 'SOME_FUTURE_INTENT', userPrompt: '查词什麼意思' });
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools.includes('mistakes.list')).toBe(true);
    expect(tools.indexOf('learning.content') < tools.indexOf('mistakes.list')).toBe(true);
  });

  it('词汇讲解提示词同时可见读写工具；普通聊天都不给', () => {
    const generate = selectTurnTools({ intent: 'FREE_COACH', userPrompt: '请为「学校」生成AI讲解并保存讲解' });
    expect(generate.includes('vocabulary.learning.context')).toBe(true);
    expect(generate.includes('vocabulary.learning.submit')).toBe(true);
    const plain = selectTurnTools({ intent: 'FREE_COACH', userPrompt: '随便聊聊' });
    expect(plain.includes('vocabulary.learning.context')).toBe(false);
    expect(plain.includes('vocabulary.learning.submit')).toBe(false);
  });
});

const RETIRED_TOC_TOOL_NAMES = [
  'toc_draft_replace_all',
  'toc_draft_add_entry',
  'toc_draft_update_entry',
  'toc_draft_remove_entry',
] as const;

describe('P3.5 目录工具隔离：当前主 lane 不声明已下线目录工具', () => {
  it('全意图 × 目录相关提示词都不含 toc_draft 命名空间', () => {
    const intents = ['FREE_COACH', 'EXPLAIN', 'GENERATE_QUIZ', 'GRADE', 'REVIEW_MISTAKES', 'SOME_FUTURE_INTENT', ''];
    const prompts = [
      '随便聊聊',
      '帮我看看这本书的目录',
      '审核一下目录草稿',
      ...RETIRED_TOC_TOOL_NAMES,
      '把目录导出来',
      '第1課 12',
    ];
    for (const intent of intents) {
      for (const userPrompt of prompts) {
        const tools = selectTurnTools({ intent, userPrompt });
        expect(tools.filter((name) => name.startsWith('toc_draft_'))).toEqual([]);
        for (const name of RETIRED_TOC_TOOL_NAMES) expect(tools.includes(name)).toBe(false);
      }
    }
  });
});
