import { describe, expect, it } from 'bun:test';
import { isOk, isErr, BusinessError } from '@lexdistill/shared';
import {
  generateLearningAnalysisReport,
  ANALYSIS_SYSTEM_PROMPT,
  type AnalysisTextPorts,
  type GenerateAnalysisInput,
} from '../index.js';

/** M7-9 内容用例测试（文本生成 port 桩，不碰模型/时钟）。 */
const GENERATED_AT = '2026-09-07T12:00:00.000Z';
const EXPIRES_AT = '2026-09-07T12:30:00.000Z';

function input(): GenerateAnalysisInput {
  return {
    snapshot: {
      userId: 'u1',
      targetLanguage: 'en',
      overallLevel: 'B1',
      strengths: [],
      weaknesses: [],
      dueCardsCount: 0,
      unresolvedMistakesCount: 0,
      assembledAt: GENERATED_AT,
    },
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
  };
}

function portsWith(text: string, captured?: { systemPrompt?: string; message?: unknown; tools?: unknown }): AnalysisTextPorts {
  return {
    generateText: async (input) => {
      if (captured) {
        captured.systemPrompt = input.systemPrompt;
        captured.message = input.message;
        captured.tools = input.tools;
      }
      return { ok: true as const, value: text };
    },
  };
}

const GOOD_TEXT = JSON.stringify({
  summary: '总览',
  suggestions: [
    { kind: 'WEAKNESS', title: 't1', detail: 'd1', skillId: 's1' },
    { kind: 'TIP', title: 't2', detail: 'd2' },
  ],
});

describe('generateLearningAnalysisReport', () => {
  it('成功解析 → ai 报告（裁剪/时间戳/模型透传）', async () => {
    const ports = portsWith(GOOD_TEXT);
    const res = await generateLearningAnalysisReport(ports, { ...input(), model: 'm1' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.source).toBe('ai');
    expect(res.value.summary).toBe('总览');
    expect(res.value.suggestions.length).toBe(2);
    expect(res.value.userId).toBe('u1');
    expect(res.value.language).toBe('en');
    expect(res.value.generatedAt).toBe(GENERATED_AT);
    expect(res.value.expiresAt).toBe(EXPIRES_AT);
    expect((res.value as { model?: string }).model).toBe('m1');
  });

  it('建议超过 5 条 → 截断前 5', async () => {
    const many = JSON.stringify({
      summary: 's',
      suggestions: Array.from({ length: 7 }, (_, i) => ({ kind: 'TIP', title: `t${i}`, detail: 'd' })),
    });
    const res = await generateLearningAnalysisReport(portsWith(many), input());
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.suggestions.length).toBe(5);
  });

  it('格式错误 → E_ANALYSIS_PARSE（可重试）', async () => {
    const res = await generateLearningAnalysisReport(portsWith('not json'), input());
    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.code).toBe('E_ANALYSIS_PARSE');
      expect(res.error.retryable).toBe(true);
    }
  });

  it('port 返回业务错误 → 原样上抛（由调用方回退）', async () => {
    const ports: AnalysisTextPorts = {
      generateText: async () => ({
        ok: false as const,
        error: new BusinessError('E_MODEL_DOWN', '模型不可用', 'AGENT_RUNTIME', true),
      }),
    };
    const res = await generateLearningAnalysisReport(ports, input());
    expect(isErr(res)).toBe(true);
    if (isErr(res)) expect(res.error.code).toBe('E_MODEL_DOWN');
  });

  it('无工具声明：systemPrompt 非空、消息带快照、tools 为空数组', async () => {
    const captured: { systemPrompt?: string; message?: unknown; tools?: unknown } = {};
    const res = await generateLearningAnalysisReport(portsWith(GOOD_TEXT, captured), input());
    expect(isOk(res)).toBe(true);
    expect(captured.systemPrompt).toBe(ANALYSIS_SYSTEM_PROMPT);
    expect(String(captured.message)).toContain('u1');
    expect(captured.tools).toEqual([]);
  });
});
