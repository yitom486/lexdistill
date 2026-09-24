/**
 * Codex App Server 最小协议类型（对照官方 generate-ts）。
 * 注意：sandbox / approval 必须用 kebab-case（协议真实枚举）。
 */
import path from 'node:path';
import { resolveNewestInstalledCodexBinary } from './codex-binary.js';

export interface DynamicToolFunctionSpec {
  type: 'function';
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deferLoading?: boolean;
}

export type DynamicToolSpec = DynamicToolFunctionSpec;

/** 与 protocol-gen SandboxMode 一致 */
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

/** 与 protocol-gen AskForApproval 常用字面量一致 */
export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never' | string;

/** 常见思考等级；具体可选集以 model/list 返回为准 */
export type CodexReasoningEffort = string;

export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  sandbox?: CodexSandboxMode | null;
  dynamicTools?: DynamicToolSpec[] | null;
  ephemeral?: boolean | null;
  /**
   * 官方 v2 ThreadStartParams.developerInstructions（协议原生线程级指令通道）。
   * CreateSessionOptions.systemPrompt 经此进入，不再静默丢弃。
   */
  developerInstructions?: string | null;
}

export interface ThreadStartResponse {
  thread: { id: string };
  model?: string;
}

export interface TurnStartParams {
  threadId: string;
  input: CodexTurnInputItem[];
  model?: string | null;
  effort?: CodexReasoningEffort | null;
  approvalPolicy?: CodexApprovalPolicy | null;
  summary?: string | null;
  /** 学情快照等应用上下文：不进入 userMessage 气泡 */
  additionalContext?: Record<string, { value: string; kind: 'untrusted' | 'application' }> | null;
  /** EXPERIMENTAL：{ mode, settings } */
  collaborationMode?: {
    mode: string;
    settings: {
      model: string;
      reasoning_effort: string | null;
      developer_instructions: string | null;
    };
  } | null;
}

/** turn/start 与 turn/steer 的用户输入项：纯文本 + 本地图片（精确并集，不用 any）。 */
export type CodexTurnInputItem = CodexTextInput | CodexLocalImageInput;

export interface CodexTextInput {
  type: 'text';
  text: string;
}

/**
 * 本地图片输入（App Server 读取本机路径）。
 * 路径只许由 Adapter 在本轮内临时物化（随机命名、用后删除），
 * 绝不来自外部 HTTP、长期缓存或调用方传入。
 */
export interface CodexLocalImageInput {
  type: 'localImage';
  path: string;
}

export interface TurnStartResponse {
  turn: { id: string; status?: string };
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface TurnSteerParams {
  threadId: string;
  expectedTurnId: string;
  input: CodexTurnInputItem[];
  clientUserMessageId?: string | null;
}

export interface CodexThreadSummary {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  ephemeral: boolean;
  cwd?: string;
  modelProvider?: string;
}

export interface CodexThreadItemDto {
  turnId: string;
  type: string;
  text?: string;
  id?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

export interface CodexCollaborationModeDto {
  name: string;
  mode: string | null;
  model: string | null;
  reasoningEffort: string | null;
}

export interface CodexQueuedSubmissionDto {
  id: string;
  text: string;
  clientUserMessageId: string;
}

export interface CodexSkillDto {
  name: string;
  description: string;
  enabled: boolean;
  scope?: string;
  path?: string;
}

/** account/rateLimits/read 精简视图 */
export interface CodexRateLimitsDto {
  limitId: string | null;
  limitName: string | null;
  planType: string | null;
  primaryUsedPercent: number | null;
  primaryResetsAt: number | null;
  secondaryUsedPercent: number | null;
  secondaryResetsAt: number | null;
}

/** mcpServerStatus/list 精简行 */
export interface CodexMcpServerStatusDto {
  name: string;
  authStatus: string;
  toolCount: number;
  pluginId: string | null;
}

/**
 * EXPERIMENTAL — Codex thread realtime（语音/实时会话）。
 * 协议已暴露；Lingua Studio 当前未接 UI / 音频管线，调用可能失败或行为不完整。
 */
export type CodexRealtimeOutputModality = 'text' | 'audio';
export type CodexRealtimeTextRole = 'user' | 'developer' | 'assistant';
export type CodexRealtimeTransport =
  | { type: 'websocket' }
  | { type: 'webrtc'; sdp: string };

export interface CodexRealtimeStartParams {
  threadId: string;
  outputModality: CodexRealtimeOutputModality;
  model?: string;
  voice?: string;
  prompt?: string;
  transport?: CodexRealtimeTransport;
  version?: string;
  realtimeSessionId?: string;
  realtimeStartInstructions?: string;
  realtimeEndInstructions?: string;
}

export interface CodexRealtimeAudioChunkDto {
  /** base64 PCM / 原始音频负载 */
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel?: number | null;
  itemId?: string | null;
}

export interface CodexRealtimeVoicesDto {
  v1: string[];
  v2: string[];
  defaultV1: string | null;
  defaultV2: string | null;
}

export interface CodexRealtimeCapabilityDto {
  /** 本机 App Server 是否响应了 voices 探测 */
  available: boolean;
  experimental: true;
  /** 对用户可读的说明 */
  message: string;
  voices?: CodexRealtimeVoicesDto;
}

export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  itemId: string;
  tool: string;
  arguments: unknown;
  namespace?: string | null;
}

export interface DynamicToolCallResponse {
  contentItems: Array<{ type: 'inputText'; text: string }>;
  success: boolean;
}

export interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  hidden?: boolean;
  /** 该模型支持的思考等级（来自 model/list） */
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
}

export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export interface CodexApprovalRequest {
  method: string;
  approvalId: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  action: string;
  description: string;
  riskLevel: string;
  availableDecisions?: string[];
}

export type CodexApprovalHandler = (
  request: CodexApprovalRequest
) => Promise<CodexApprovalDecision>;

export interface CodexAccountStatus {
  linked: boolean;
  requiresOpenaiAuth: boolean;
  planType?: string | null;
  email?: string | null;
  codexHome?: string;
  binary?: string;
  message: string;
}

export interface CodexAppServerConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  model?: string;
  effort?: CodexReasoningEffort;
  codexHome?: string;
  sandbox?: CodexSandboxMode;
  approvalPolicy?: CodexApprovalPolicy;
  enabled?: boolean;
}

const SANDBOX_ALIASES: Record<string, CodexSandboxMode> = {
  'read-only': 'read-only',
  readonly: 'read-only',
  'readOnly': 'read-only',
  'workspace-write': 'workspace-write',
  workspacewrite: 'workspace-write',
  'workspaceWrite': 'workspace-write',
  'danger-full-access': 'danger-full-access',
  dangerfullaccess: 'danger-full-access',
  'dangerFullAccess': 'danger-full-access',
};

const APPROVAL_ALIASES: Record<string, string> = {
  never: 'never',
  untrusted: 'untrusted',
  'on-request': 'on-request',
  onrequest: 'on-request',
  'onRequest': 'on-request',
  'on-failure': 'on-request', // 旧别名兜底到 on-request
  onfailure: 'on-request',
  'onFailure': 'on-request',
};

export function normalizeSandboxMode(raw?: string | null): CodexSandboxMode {
  if (!raw?.trim()) return 'read-only';
  const key = raw.trim();
  return SANDBOX_ALIASES[key] ?? SANDBOX_ALIASES[key.toLowerCase()] ?? 'read-only';
}

export function normalizeApprovalPolicy(raw?: string | null): CodexApprovalPolicy {
  if (!raw?.trim()) return 'never';
  const key = raw.trim();
  return APPROVAL_ALIASES[key] ?? APPROVAL_ALIASES[key.toLowerCase()] ?? key;
}

export function resolveUserHome(): string | undefined {
  const home = process.env.USERPROFILE || process.env.HOME || process.env.HOMEPATH;
  return home?.trim() || undefined;
}

export function resolveCodexHome(explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.CODEX_HOME?.trim()) return process.env.CODEX_HOME.trim();
  const home = resolveUserHome();
  if (!home) return undefined;
  return path.join(home, '.codex');
}

export function resolveCodexBinary(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.CODEX_BIN?.trim()) return process.env.CODEX_BIN.trim();
  if (process.env.CODEX_PATH?.trim()) return process.env.CODEX_PATH.trim();

  return resolveNewestInstalledCodexBinary(resolveUserHome(), process.env.LOCALAPPDATA) ?? 'codex';
}

export function buildCodexProcessEnv(
  config: CodexAppServerConfig,
  extra?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  const home = resolveUserHome();
  if (home) {
    if (!env.USERPROFILE) env.USERPROFILE = home;
    if (!env.HOME) env.HOME = home;
  }
  const codexHome = resolveCodexHome(config.codexHome);
  if (codexHome) {
    env.CODEX_HOME = codexHome;
  }
  return env;
}

export function loadCodexConfigFromEnv(): CodexAppServerConfig {
  const enabledRaw = (process.env.STUDY_STUDIO_CODEX ?? '1').trim().toLowerCase();
  const config: CodexAppServerConfig = {
    command: resolveCodexBinary(),
    args: ['app-server', '--listen', 'stdio://'],
    cwd: process.env.STUDY_STUDIO_CODEX_CWD || process.cwd(),
    sandbox: normalizeSandboxMode(process.env.STUDY_STUDIO_CODEX_SANDBOX || 'read-only'),
    approvalPolicy: normalizeApprovalPolicy(process.env.STUDY_STUDIO_CODEX_APPROVAL || 'never'),
    enabled: !(enabledRaw === '0' || enabledRaw === 'false' || enabledRaw === 'off'),
  };
  const codexHome = resolveCodexHome();
  if (codexHome) config.codexHome = codexHome;
  const model = process.env.STUDY_STUDIO_CODEX_MODEL?.trim();
  if (model) config.model = model;
  const effort = process.env.STUDY_STUDIO_CODEX_EFFORT?.trim();
  if (effort) config.effort = effort;
  return config;
}

/** UI / 兜底用的常见思考等级 */
export const DEFAULT_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
