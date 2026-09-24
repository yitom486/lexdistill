import { describe, expect, it } from 'bun:test';
import { isOk } from '@study-studio/shared';
import { ToolRegistry } from '@study-studio/tool-core';
import {
  UiNavigateTool,
  UiPresentTool,
  UiNavigateInputSchema,
  UiPresentInputSchema,
} from '../transport/tools/ui-command-tools.js';
import { registerGatewayTools } from '../transport/tools/register-tools.js';
import { DrizzleLearnerRepository } from '../infrastructure/drizzle-learner-repository.js';

/**
 * ui.* Client Tools：网关侧只做参数校验并回显，
 * 真正执行发生在前端（AGENT_TOOL_CALL 下发）。
 * 锁三样：schema 拒绝非法输入、元数据（CLIENT/WRITE）、注册表可取。
 */
describe('ui.navigate / ui.present（Client Tools）', () => {
  const ctx = { userId: 'u1', sessionId: 's1' };

  it('元数据：CLIENT 位置 + WRITE 权限', () => {
    const nav = new UiNavigateTool();
    const present = new UiPresentTool();
    expect(nav.name).toBe('ui.navigate');
    expect(present.name).toBe('ui.present');
    expect(nav.location).toBe('CLIENT');
    expect(present.location).toBe('CLIENT');
    expect(nav.permission).toBe('WRITE');
    expect(present.permission).toBe('WRITE');
  });

  it('schema 拒绝非法 target / surface', () => {
    expect(UiNavigateInputSchema.safeParse({ target: 'NOWHERE' }).success).toBe(false);
    expect(UiNavigateInputSchema.safeParse({ target: 'QUIZ', openTutor: true }).success).toBe(true);
    expect(UiPresentInputSchema.safeParse({ surface: 'email' }).success).toBe(false);
    expect(UiPresentInputSchema.safeParse({ surface: 'quiz' }).success).toBe(true);
  });

  it('execute 原样回显合法输入（副作用在前端）', async () => {
    const nav = new UiNavigateTool();
    const res = await nav.execute({ target: 'MISTAKES' }, ctx);
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    expect(res.value).toEqual({ target: 'MISTAKES' });

    const present = new UiPresentTool();
    const res2 = await present.execute({ surface: 'cards' }, ctx);
    expect(isOk(res2)).toBe(true);
    if (!isOk(res2)) return;
    expect(res2.value).toEqual({ surface: 'cards' });
  });

  it('注册表可取且非法输入在 registry 执行层被拒', async () => {
    const repo = new DrizzleLearnerRepository(':memory:');
    try {
      const registry = new ToolRegistry();
      registerGatewayTools(registry, repo);
      expect(registry.get('ui.navigate')?.name).toBe('ui.navigate');
      expect(registry.get('ui.present')?.name).toBe('ui.present');
      const bad = await registry.execute(
        'ui.navigate',
        { target: 'NOWHERE' },
        ctx
      );
      expect(isOk(bad)).toBe(false);
    } finally {
      repo.getRawDb().close();
    }
  });
});
