import { ok, err, type Result, BusinessError, generateId } from '@lexdistill/shared';
import type { TargetLanguage } from '@lexdistill/learner-core';
import type { AgentSession } from '@lexdistill/agent-runtime';

/** coach=聊天界面；learning=出题/批改/题目导师（与聊天隔离） */
export type AgentLane = 'coach' | 'learning';

export interface ActiveSession {
  id: string;
  userId: string;
  targetLanguage: TargetLanguage;
  targetLevel: string;
  /**
   * 按 lane 隔离的 Agent 会话。
   * 聊天与学习闭环可并行持有不同会话，互不污染历史。
   */
  agentByLane: Partial<Record<AgentLane, AgentSession>>;
  createdAt: number;
  lastActiveAt: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, ActiveSession>();

  public createSession(
    userId: string,
    targetLanguage: TargetLanguage,
    targetLevel: string
  ): Result<ActiveSession, BusinessError> {
    const id = generateId('sess');
    const now = Date.now();
    const session: ActiveSession = {
      id,
      userId,
      targetLanguage,
      targetLevel,
      agentByLane: {},
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(id, session);
    return ok(session);
  }

  public getSession(sessionId: string): Result<ActiveSession, BusinessError> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return err(
        new BusinessError(
          'E_SESSION_NOT_FOUND',
          '未找到指定的学习会话，请重新初始化。',
          'VALIDATION',
          false
        )
      );
    }
    session.lastActiveAt = Date.now();
    return ok(session);
  }

  public getAgentSession(
    sessionId: string,
    lane: AgentLane
  ): AgentSession | undefined {
    return this.sessions.get(sessionId)?.agentByLane[lane];
  }

  public attachAgentSession(
    sessionId: string,
    agentSession: AgentSession,
    lane: AgentLane = 'coach'
  ): Result<void, BusinessError> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return err(new BusinessError('E_SESSION_NOT_FOUND', '会话不存在', 'VALIDATION'));
    }
    session.agentByLane[lane] = agentSession;
    return ok(undefined);
  }

  public detachAgentSession(sessionId: string, lane: AgentLane): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    delete session.agentByLane[lane];
  }

  /** 按引擎会话 id 反查所属 lane（旁路通知路由用） */
  public findLaneByThreadId(
    sessionId: string,
    threadId: string
  ): AgentLane | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    for (const lane of ['coach', 'learning'] as const) {
      if (session.agentByLane[lane]?.threadId === threadId) return lane;
    }
    return undefined;
  }

  public closeSession(sessionId: string): Result<void, BusinessError> {
    const session = this.sessions.get(sessionId);
    if (session) {
      for (const lane of Object.keys(session.agentByLane) as AgentLane[]) {
        void session.agentByLane[lane]?.close();
      }
    }
    this.sessions.delete(sessionId);
    return ok(undefined);
  }
}
