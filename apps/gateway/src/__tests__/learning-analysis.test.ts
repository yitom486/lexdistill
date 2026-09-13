import { describe, expect, it, beforeEach } from 'bun:test';
import { ok, err, isOk, type Result, BusinessError } from '@study-studio/shared';
import type { AgentAdapter, AgentSession } from '@study-studio/agent-runtime';
import type { LearnerRepository, LearnerProfileSnapshot } from '@study-studio/learner-core';
import type { Flashcard } from '@study-studio/protocol';
import {
  runLearningAnalysis,
  buildAnalysisSnapshot,
  __resetAnalysisCacheForTest,
} from '../modules/learning-progress/application/learning-analysis.js';
import { ANALYSIS_SYSTEM_PROMPT } from '@study-studio/ai-content';

// ---------- mock repo ----------
function makeMockRepo(opts: {
  weaknesses?: { skillId: string; name: string; proficiency: number; consecutiveErrors: number }[];
  dueCardsCount?: number;
  unresolvedMistakesCount?: number;
  streakDays?: number;
  dailyGoalQuizzes?: number;
}): LearnerRepository {
  const weaknesses = opts.weaknesses ?? [];
  const snapshot: LearnerProfileSnapshot = {
    userId: 'u1',
    targetLanguage: 'en',
    overallLevel: 'B1',
    profile: {
      userId: 'u1',
      targetLanguage: 'en',
      studyGoal: 'CET6',
      learnerLevel: 'INTERMEDIATE',
      streakDays: opts.streakDays ?? 0,
      dailyGoalQuizzes: opts.dailyGoalQuizzes ?? 5,
      dailyGoalCards: 10,
    } as never,
    strengths: [],
    weaknesses: weaknesses.map((w) => ({
      id: w.skillId,
      dimension: 'GRAMMAR',
      name: w.name,
      proficiency: w.proficiency,
      totalAttempts: 10,
      correctAttempts: 3,
      consecutiveErrors: w.consecutiveErrors,
      status: 'WEAKNESS',
    })),
    allMetrics: [],
    dailyTask: {
      userId: 'u1',
      activityDate: '2026-09-05',
      language: 'en',
      quizzesCount: 2,
      dailyGoalQuizzes: opts.dailyGoalQuizzes ?? 5,
      cardsReviewedCount: 0,
      dailyGoalCards: 10,
      listeningMinutes: 0,
      mistakesResolvedCount: 0,
      readingCount: 0,
      isGoalCompleted: false,
      streakDays: opts.streakDays ?? 0,
      intensityLevel: 0,
      isOvertimeBurst: false,
      completedAt: null,
    },
    updatedAt: new Date().toISOString(),
  };
  const dueCards: Flashcard[] = Array.from({ length: opts.dueCardsCount ?? 0 }, (_, i) => ({
    id: `c${i}`,
  })) as unknown as Flashcard[];
  const mistakes = Array.from({ length: opts.unresolvedMistakesCount ?? 0 }, (_, i) => ({
    id: `m${i}`,
  }));
  return {
    getProfileSnapshot: async () => ok(snapshot),
    getDueCards: async () => ok(dueCards),
    getMistakes: async () => ok(mistakes as never),
  } as unknown as LearnerRepository;
}

// ---------- mock adapter ----------
type StreamScenario = { kind: 'success'; text: string } | { kind: 'error' } | { kind: 'create-fail' };

/** M7-9 修正：记录 ai-content port 输入落到 Adapter 的实况。 */
export interface MockAdapterSpy {
  createSessionInput?: unknown;
  sendMessages?: unknown[];
}

function makeMockAdapter(scenario: StreamScenario, spy?: MockAdapterSpy): AgentAdapter {
  const session: AgentSession = {
    sessionId: 's1',
    send: async function* (...args: unknown[]) {
      spy?.sendMessages?.push(args[0]);
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
    createSession: async (...args: unknown[]) => {
      spy && (spy.createSessionInput = args[0]);
      return scenario.kind === 'create-fail'
        ? err(new BusinessError('E_CODEX_SESSION_CREATE', '建会话失败', 'AGENT_RUNTIME'))
        : ok(session);
    },
    resumeSession: async () => ok(session),
  };
}

describe('runLearningAnalysis', () => {
  beforeEach(() => __resetAnalysisCacheForTest());

  it('returns AI report on success and caches it', async () => {
    const repo = makeMockRepo({ weaknesses: [{ skillId: 's1', name: '时态', proficiency: 0.3, consecutiveErrors: 2 }] });
    const adapter = makeMockAdapter({
      kind: 'success',
      text: JSON.stringify({
        summary: '时态需加强',
        suggestions: [{ kind: 'WEAKNESS', title: '时态', detail: '多做靶向练习', skillId: 's1' }],
      }),
    });
    const res = await runLearningAnalysis({ adapter, repo, userId: 'u1' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.source).toBe('ai');
    expect(res.value.suggestions[0]?.title).toBe('时态');

    // 第二次命中缓存
    const res2 = await runLearningAnalysis({ adapter, repo, userId: 'u1' });
    expect(isOk(res2)).toBe(true);
    if (!isOk(res2)) return;
    expect(res2.value.source).toBe('cached');
  });

  it('falls back to local rules when model fails and no cache', async () => {
    const repo = makeMockRepo({ dueCardsCount: 5, unresolvedMistakesCount: 1 });
    const adapter = makeMockAdapter({ kind: 'error' });
    const res = await runLearningAnalysis({ adapter, repo, userId: 'u1' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.source).toBe('local-rules');
    expect(res.value.suggestions.some((s) => s.kind === 'PLAN')).toBe(true);
  });

  it('falls back to create-fail with local rules', async () => {
    const repo = makeMockRepo({});
    const adapter = makeMockAdapter({ kind: 'create-fail' });
    const res = await runLearningAnalysis({ adapter, repo, userId: 'u1' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.source).toBe('local-rules');
  });

  it('prefers stale cache over local rules when model fails', async () => {
    const repo = makeMockRepo({});
    // 先成功一次建立缓存
    const okAdapter = makeMockAdapter({
      kind: 'success',
      text: JSON.stringify({ summary: 'AI 总览', suggestions: [{ kind: 'TIP', title: 'AI建议', detail: 'd' }] }),
    });
    await runLearningAnalysis({ adapter: okAdapter, repo, userId: 'u1', ttlMs: 1 });
    // 缓存已过期，但模型失败时应回退到该缓存
    await new Promise((r) => setTimeout(r, 5));
    const failAdapter = makeMockAdapter({ kind: 'error' });
    const res = await runLearningAnalysis({ adapter: failAdapter, repo, userId: 'u1' });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.source).toBe('cached');
    expect(res.value.summary).toBe('AI 总览');
  });

  it('forceRefresh bypasses cache and calls model again', async () => {
    const repo = makeMockRepo({});
    const adapter = makeMockAdapter({
      kind: 'success',
      text: JSON.stringify({ summary: '新分析', suggestions: [] }),
    });
    await runLearningAnalysis({ adapter, repo, userId: 'u1' });
    const res = await runLearningAnalysis({ adapter, repo, userId: 'u1', forceRefresh: true });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.source).toBe('ai');
    expect(res.value.summary).toBe('新分析');
  });

  it('ai-content 的 systemPrompt/message/tools 原样落到 Adapter', async () => {
    const repo = makeMockRepo({});
    const spy: MockAdapterSpy = { sendMessages: [] };
    const adapter = makeMockAdapter(
      {
        kind: 'success',
        text: JSON.stringify({ summary: 's', suggestions: [] }),
      },
      spy
    );
    const res = await runLearningAnalysis({ adapter, repo, userId: 'u1' });
    expect(isOk(res)).toBe(true);
    const created = spy.createSessionInput as {
      systemPrompt?: unknown;
      tools?: unknown;
      userId?: unknown;
      sessionId?: unknown;
    };
    // systemPrompt 与 tools 来自 ai-content（非 Gateway 自造）
    expect(created.systemPrompt).toBe(ANALYSIS_SYSTEM_PROMPT);
    expect(created.tools).toEqual([]);
    expect(created.userId).toBe('u1');
    expect(typeof created.sessionId).toBe('string');
    const sent = spy.sendMessages?.[0] as { message?: unknown };
    expect(String(sent?.message)).toContain('学习快照');
    expect(String(sent?.message)).toContain('u1');
  });
});

describe('buildAnalysisSnapshot', () => {
  it('assembles snapshot from repo', async () => {
    const repo = makeMockRepo({
      weaknesses: [{ skillId: 's1', name: 'w', proficiency: 0.2, consecutiveErrors: 3 }],
      dueCardsCount: 4,
      unresolvedMistakesCount: 2,
      streakDays: 5,
    });
    const res = await buildAnalysisSnapshot(repo, 'u1');
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value.dueCardsCount).toBe(4);
    expect(res.value.unresolvedMistakesCount).toBe(2);
    expect(res.value.weaknesses[0]?.skillId).toBe('s1');
    expect(res.value.streakDays).toBe(5);
  });
});
