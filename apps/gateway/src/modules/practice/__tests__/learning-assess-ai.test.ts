import { describe, expect, it } from 'bun:test';
import { ok, err, isOk, BusinessError } from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
import type { LearnerRepository } from '@study-studio/learner-core';
import {
  LearningAssessTool,
  parseAiGradingResults,
  type LearningAssessBatchOutput,
} from '../tools/learning-assess-tool.js';

// ---------- mock adapter（与 learning-analysis.test.ts 同构） ----------
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

const repo = {} as unknown as LearnerRepository;
const ctx = { userId: 'u1', sessionId: 's1' };

const AI_SINGLE_JSON = JSON.stringify({
  isCorrect: true,
  score: 92,
  grammarFeedback: '句式规范，用词准确。',
  nativeNuanceAdvice: '表达自然地道。',
  refinementSuggestion: '标准答案',
  mistakeDetected: false,
});

describe('parseAiGradingResults (P6-3)', () => {
  it('parses pure JSON single result', () => {
    const res = parseAiGradingResults(AI_SINGLE_JSON, 1);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0]?.isCorrect).toBe(true);
    expect(res.value[0]?.score).toBe(92);
  });

  it('tolerates markdown fences and surrounding prose', () => {
    const res = parseAiGradingResults(`好的，这是批改结果：\n\`\`\`json\n${AI_SINGLE_JSON}\n\`\`\`\n完毕`, 1);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]?.grammarFeedback).toBe('句式规范，用词准确。');
  });

  it('rejects garbage and missing fields', () => {
    expect(isOk(parseAiGradingResults('今天天气不错', 1))).toBe(false);
    expect(isOk(parseAiGradingResults('', 1))).toBe(false);
    expect(isOk(parseAiGradingResults(JSON.stringify({ score: 90 }), 1))).toBe(false);
  });

  it('clamps out-of-range scores', () => {
    const res = parseAiGradingResults(
      JSON.stringify({
        isCorrect: true,
        score: 150,
        grammarFeedback: '好',
        nativeNuanceAdvice: '好',
        refinementSuggestion: '好',
      }),
      1
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value[0]?.score).toBe(100);
  });
});

describe('learning.assess mode routing (P6-3)', () => {
  const singleInput = {
    prompt: '把“我在学校学习”译成英语',
    standardAnswer: 'I study at school.',
    userSubmission: 'I study at school.',
    testedSkillId: 'en.test',
    language: 'en' as const,
  };

  it('defaults to rule engine with source=rule (no adapter needed)', async () => {
    const tool = new LearningAssessTool(repo);
    const res = await tool.execute({ ...singleInput }, ctx);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const out = res.value as { source?: string; isCorrect?: boolean };
    expect(out.source).toBe('rule');
    expect(out.isCorrect).toBe(true);
  });

  it('ai mode grades via model with source=ai', async () => {
    const tool = new LearningAssessTool(repo, makeMockAdapter({ kind: 'success', text: AI_SINGLE_JSON }));
    const res = await tool.execute({ ...singleInput, mode: 'ai' }, ctx);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const out = res.value as { source?: string; isCorrect?: boolean; score?: number; accuracyRate?: number };
    expect(out.source).toBe('ai');
    expect(out.isCorrect).toBe(true);
    expect(out.score).toBe(92);
    expect(out.accuracyRate).toBe(0.92);
  });

  it('ai mode falls back to rules on stream error / create failure / missing adapter', async () => {
    const scenarios: Array<{ name: string; tool: LearningAssessTool }> = [
      { name: 'stream-error', tool: new LearningAssessTool(repo, makeMockAdapter({ kind: 'error' })) },
      { name: 'create-fail', tool: new LearningAssessTool(repo, makeMockAdapter({ kind: 'create-fail' })) },
      { name: 'no-adapter', tool: new LearningAssessTool(repo) },
      {
        name: 'garbage',
        tool: new LearningAssessTool(repo, makeMockAdapter({ kind: 'success', text: '胡言乱语' })),
      },
    ];
    for (const s of scenarios) {
      const res = await s.tool.execute({ ...singleInput, mode: 'ai' }, ctx);
      expect(isOk(res)).toBe(true);
      if (!isOk(res)) continue;
      const out = res.value as { source?: string };
      expect(out.source).toBe('rule-fallback');
    }
  });

  it('ai batch aligns reordered results by itemId and summarizes', async () => {
    const batchJson = JSON.stringify({
      results: [
        {
          itemId: 'q2',
          isCorrect: false,
          score: 55,
          grammarFeedback: '助词误用。',
          nativeNuanceAdvice: '注意格助词。',
          refinementSuggestion: '标准2',
          mistakeDetected: true,
          negativeTransferTag: 'ZH_TRANSFER_LOCATION_DE_INSTEAD_OF_NI',
        },
        {
          itemId: 'q1',
          isCorrect: true,
          score: 95,
          grammarFeedback: '很好。',
          nativeNuanceAdvice: '地道。',
          refinementSuggestion: '标准1',
          mistakeDetected: false,
        },
      ],
    });
    const tool = new LearningAssessTool(repo, makeMockAdapter({ kind: 'success', text: batchJson }));
    const res = await tool.execute(
      {
        action: 'grade_batch',
        mode: 'ai',
        items: [
          { itemId: 'q1', prompt: 'p1', standardAnswer: '标准1', userSubmission: '作答1', language: 'ja' as const },
          { itemId: 'q2', prompt: 'p2', standardAnswer: '标准2', userSubmission: '作答2', language: 'ja' as const },
        ],
      },
      ctx
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const out = res.value as LearningAssessBatchOutput;
    expect(out.results.map((r) => r.itemId)).toEqual(['q1', 'q2']);
    expect(out.results[0]?.grading.isCorrect).toBe(true);
    expect(out.results[0]?.grading.source).toBe('ai');
    expect(out.results[1]?.grading.isCorrect).toBe(false);
    expect(out.summary).toEqual({
      total: 2,
      correct: 1,
      averageScore: 75,
      commonIssues: ['ZH_TRANSFER_LOCATION_DE_INSTEAD_OF_NI'],
    });
  });

  it('ai batch falls back per-item when model covers only part', async () => {
    const partialJson = JSON.stringify({
      results: [
        {
          itemId: 'q1',
          isCorrect: true,
          score: 90,
          grammarFeedback: '好。',
          nativeNuanceAdvice: '好。',
          refinementSuggestion: '标准1',
          mistakeDetected: false,
        },
      ],
    });
    const tool = new LearningAssessTool(repo, makeMockAdapter({ kind: 'success', text: partialJson }));
    const res = await tool.execute(
      {
        action: 'grade_batch',
        mode: 'ai',
        items: [
          { itemId: 'q1', prompt: 'p1', standardAnswer: '标准1', userSubmission: '作答1', language: 'en' as const },
          { itemId: 'q2', prompt: 'p2', standardAnswer: '标准2', userSubmission: '作答2', language: 'en' as const },
        ],
      },
      ctx
    );
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    const out = res.value as LearningAssessBatchOutput;
    expect(out.results[0]?.grading.source).toBe('ai');
    expect(out.results[1]?.grading.source).toBe('rule-fallback');
    expect(out.summary.total).toBe(2);
  });
});
