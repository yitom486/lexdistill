import { describe, expect, it } from 'bun:test';
import {
  BASE_TOOLS,
  TASK_TOOL_PRESETS,
  VOCABULARY_EXPLAIN_TOOLS,
  resolveSessionTools,
  resolveTaskTools,
} from '../runtime/router/tool-catalog.js';
import { selectTurnTools } from '../runtime/router/turn-tools.js';

describe('tool-catalog（中央目录）', () => {
  it('词汇讲解任务集固定三件套，不受提示词干扰', () => {
    const tools = resolveSessionTools({ task: 'vocabulary.explain', userPrompt: '推送到Anki并收藏' });
    expect(tools).toEqual([...VOCABULARY_EXPLAIN_TOOLS]);
    expect(tools).toEqual(['vocabulary.learning.context', 'vocabulary.learning.submit', 'dictionary.lookup']);
  });

  it('多 agent 共用同一工具：dictionary.lookup 同时在基线与词汇任务集中', () => {
    expect([...BASE_TOOLS].includes('dictionary.lookup')).toBe(true);
    expect([...VOCABULARY_EXPLAIN_TOOLS].includes('dictionary.lookup')).toBe(true);
    expect(TASK_TOOL_PRESETS['vocabulary.explain']).toEqual([...VOCABULARY_EXPLAIN_TOOLS]);
  });

  it('无任务时与旧 selectTurnTools 同行为（意图 × 提示词矩阵）', () => {
    const intents = ['FREE_COACH', 'EXPLAIN', 'GENERATE_QUIZ', 'GRADE', 'REVIEW_MISTAKES', 'SOME_FUTURE_INTENT', ''];
    const prompts = [
      '随便聊聊',
      '帮我收藏这个生词',
      '推送到Anki',
      '请为「学校」生成AI讲解并保存讲解',
      '导入我的Anki牌组',
      '这题我会了，标为已会',
    ];
    for (const intent of intents) {
      for (const userPrompt of prompts) {
        expect(resolveSessionTools({ intent, userPrompt })).toEqual(selectTurnTools({ intent, userPrompt }));
      }
    }
  });

  it('主聊默认给词汇读依据、不给写：含 context、不含 submit', () => {
    const coach = resolveSessionTools({ intent: 'FREE_COACH', userPrompt: '随便聊聊' });
    expect(coach.includes('vocabulary.learning.context')).toBe(true);
    expect(coach.includes('vocabulary.learning.submit')).toBe(false);
  });

  it('未知任务 id 回退到意图/提示词路径，不抛', () => {
    const tools = resolveSessionTools({ task: 'no.such.task', userPrompt: '随便聊聊' });
    expect(tools).toEqual(selectTurnTools({ userPrompt: '随便聊聊' }));
  });

  it('resolveTaskTools：命中返回副本，未知/缺席返回 undefined', () => {
    expect(resolveTaskTools('vocabulary.explain')).toEqual([...VOCABULARY_EXPLAIN_TOOLS]);
    expect(resolveTaskTools('no.such.task')).toBeUndefined();
    expect(resolveTaskTools(undefined)).toBeUndefined();
    expect(resolveTaskTools('')).toBeUndefined();
  });
});
