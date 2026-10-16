import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { SqliteQuestionGenerationRepository } from '@lexdistill/storage-sqlite';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';
import type { GatewayDeps } from '../composition/gateway-deps.js';
import { createGenerationRoutes } from '../modules/question-generation/http/generation-routes.js';
import { GenerationTaskService } from '../modules/question-generation/service.js';

const config = {
  language: 'ja', targetLevel: 'N5', modelId: 'm-x', promptVersion: 'v1',
  maxQuestions: 1, categoryLimits: { GRAMMAR: 1 }, allowedAnswerTypes: ['MULTIPLE_CHOICE'],
  maxDifficultyTier: 3, maxAudio: 0, maxAudioAttempts: 0, maxPapers: 1, maxPaperItems: 5,
  textbookScopes: [],
};

function appFor(checkRunModelEffort: (runtimeId: string | undefined, model?: string) => Promise<{ dropModel: boolean; warnings: string[] }>, calls: string[]) {
  const repo = new DrizzleLearnerRepository(':memory:');
  const bank = new SqliteQuestionGenerationRepository(repo.getRawDb());
  const service = new GenerationTaskService({ repository: bank });
  const server = { checkRunModelEffort: async (runtimeId: string | undefined, model?: string) => {
    calls.push(`${runtimeId ?? ''}:${model ?? ''}`);
    return checkRunModelEffort(runtimeId, model);
  } };
  const app = new Hono().route('/', createGenerationRoutes({ repo, generation: { service }, server } as unknown as GatewayDeps));
  return { app, repo };
}

const postTask = (app: Hono, body: unknown) => app.request('/api/generation/tasks', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const baseBody = (configOverride: unknown) => ({
  userId: 'u1', sessionId: 's1', turnId: 't1', config: configOverride,
});

describe('出题任务创建模型证伪', () => {
  it('ACP 运行时模型不匹配 → 400 E_GENERATION_MODEL_MISMATCH，不建任务', async () => {
    const calls: string[] = [];
    const { app, repo } = appFor(async () => ({ dropModel: true, warnings: ['模型 m-x 在当前运行时未生效'] }), calls);
    try {
      const res = await postTask(app, baseBody({ ...config, runtimeId: 'opencode' }));
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain('E_GENERATION_MODEL_MISMATCH');
      expect(calls).toEqual(['opencode:m-x']);
    } finally {
      repo.getRawDb().close();
    }
  });

  it('ACP 运行时模型通过 → 200 建任务', async () => {
    const calls: string[] = [];
    const { app, repo } = appFor(async () => ({ dropModel: false, warnings: [] }), calls);
    try {
      const res = await postTask(app, baseBody({ ...config, runtimeId: 'opencode' }));
      expect(res.status).toBe(200);
      expect((await res.json() as { taskId?: unknown }).taskId).toBeTruthy();
      expect(calls).toEqual(['opencode:m-x']);
    } finally {
      repo.getRawDb().close();
    }
  });

  it('缺席运行时不探针，直接建任务（执行时走默认池）', async () => {
    const calls: string[] = [];
    const { app, repo } = appFor(async () => {
      calls.push('should-not-happen');
      return { dropModel: true, warnings: ['不应被调用'] };
    }, calls);
    try {
      const res = await postTask(app, baseBody({ ...config }));
      expect(res.status).toBe(200);
      expect(calls).toEqual([]);
    } finally {
      repo.getRawDb().close();
    }
  });
});
