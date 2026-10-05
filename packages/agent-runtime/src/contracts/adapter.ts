import type { AgentSession } from './session.js';
import type { ToolDefinition } from '@study-studio/tool-core';
import type { Result, BusinessError } from '@study-studio/shared';

export interface CreateSessionOptions {
  sessionId: string;
  userId: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** 可选：覆盖本轮 / 本会话模型（Codex App Server thread/start.model） */
  model?: string;
  /** 可选：thread/start.approvalPolicy（never / on-request / untrusted） */
  approvalPolicy?: string;
  /** 恢复已有 Codex thread（thread/resume），而非 thread/start */
  resumeThreadId?: string;
  /** false=落盘持久化；默认 true（临时） */
  ephemeral?: boolean;
  /** Local task workspace; materials live below it and are owned by Gateway. */
  workingDirectory?: string;
  sandboxMode?: 'read-only' | 'workspace-write';
}

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;

  /**
   * 图片输入能力查询（可选；缺席 = 不支持）。
   * Gateway 在发送带 attachments 的 Turn 前必须查询：不支持时明确拒绝
   * （E_AGENT_CAPABILITY），禁止静默丢图或退化成纯文本。
   */
  supportsImageInput?(): boolean;
  /** Native file/command reading, without binary PDF message attachments. */
  supportsLocalFileInput?(): boolean;

  createSession(
    options: CreateSessionOptions
  ): Promise<Result<AgentSession, BusinessError>>;

  resumeSession(
    sessionId: string
  ): Promise<Result<AgentSession, BusinessError>>;
}
