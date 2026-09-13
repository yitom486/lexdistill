import {
  ok,
  err,
  isOk,
  type Result,
  BusinessError,
} from '@study-studio/shared';
import {
  type CodexAccountStatus,
  type CodexModelInfo,
  type CodexThreadSummary,
  type CodexThreadItemDto,
  type CodexCollaborationModeDto,
  type CodexQueuedSubmissionDto,
  type CodexSkillDto,
  type CodexRateLimitsDto,
  type CodexMcpServerStatusDto,
  type CodexRealtimeStartParams,
  type CodexRealtimeAudioChunkDto,
  type CodexRealtimeVoicesDto,
  type CodexRealtimeCapabilityDto,
  type CodexRealtimeTextRole,
  resolveCodexHome,
  resolveCodexBinary,
} from '../app-server-protocol.js';
import type { CodexAppServerConnection } from '../app-server-client.js';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** 列出本机 Codex 账号可见模型（复用 login 会话）。 */
export async function listModels(
  conn: CodexAppServerConnection,
  params?: {
    includeHidden?: boolean;
  }
): Promise<Result<CodexModelInfo[], BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{ data?: Array<Record<string, unknown>> }>('model/list', {
    includeHidden: params?.includeHidden ?? false,
  });
  if (!isOk(res)) return res;
  const rows = Array.isArray(res.value?.data) ? res.value.data : [];
  const models: CodexModelInfo[] = rows
    .map((row) => {
      const info: CodexModelInfo = {
        id: String(row.id ?? row.model ?? ''),
        model: String(row.model ?? row.id ?? ''),
        displayName: String(row.displayName ?? row.model ?? row.id ?? 'model'),
        isDefault: Boolean(row.isDefault),
        hidden: Boolean(row.hidden),
      };
      if (row.description) info.description = String(row.description);
      const effortsRaw = row.supportedReasoningEfforts;
      if (Array.isArray(effortsRaw)) {
        info.supportedReasoningEfforts = effortsRaw
          .map((e) => {
            if (typeof e === 'string') return e;
            if (e && typeof e === 'object' && 'reasoningEffort' in e) {
              return String((e as { reasoningEffort: unknown }).reasoningEffort);
            }
            return '';
          })
          .filter(Boolean);
      }
      if (row.defaultReasoningEffort) {
        info.defaultReasoningEffort = String(row.defaultReasoningEffort);
      }
      return info;
    })
    .filter((m) => m.id || m.model);
  return ok(models);
}

/** thread/list — 本机持久化会话 */
export async function listThreads(
  conn: CodexAppServerConnection,
  params?: {
    limit?: number;
    cursor?: string;
    searchTerm?: string;
    archived?: boolean;
  }
): Promise<
  Result<{ threads: CodexThreadSummary[]; nextCursor: string | null }, BusinessError>
> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{
    data?: Array<Record<string, unknown>>;
    nextCursor?: string | null;
  }>('thread/list', {
    limit: params?.limit ?? 40,
    cursor: params?.cursor ?? null,
    searchTerm: params?.searchTerm ?? null,
    archived: params?.archived ?? false,
    sortKey: 'updated_at',
    sortDirection: 'desc',
  });
  if (!isOk(res)) return res;
  const rows = Array.isArray(res.value?.data) ? res.value.data : [];
  const threads: CodexThreadSummary[] = rows
    .map((row) => {
      const t: CodexThreadSummary = {
        id: String(row.id ?? ''),
        preview: String(row.preview ?? ''),
        name: row.name != null ? String(row.name) : null,
        createdAt: Number(row.createdAt ?? 0),
        updatedAt: Number(row.updatedAt ?? 0),
        ephemeral: Boolean(row.ephemeral),
      };
      if (row.cwd != null) t.cwd = String(row.cwd);
      if (row.modelProvider != null) t.modelProvider = String(row.modelProvider);
      return t;
    })
    .filter((t) => t.id);
  return ok({
    threads,
    nextCursor: res.value?.nextCursor ?? null,
  });
}

/** thread/items/list — 恢复气泡用 */
export async function listThreadItems(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    limit?: number;
  }
): Promise<Result<{ items: CodexThreadItemDto[]; nextCursor: string | null }, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{
    data?: Array<{ turnId?: string; item?: Record<string, unknown> }>;
    nextCursor?: string | null;
  }>('thread/items/list', {
    threadId: params.threadId,
    limit: params.limit ?? 80,
    sortDirection: 'asc',
  });
  if (!isOk(res)) return res;
  const rows = Array.isArray(res.value?.data) ? res.value.data : [];
  const items: CodexThreadItemDto[] = [];
  for (const row of rows) {
    const item = row.item;
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type ?? 'unknown');
    const dto: CodexThreadItemDto = {
      turnId: String(row.turnId ?? ''),
      type,
    };
    if (item.id != null) dto.id = String(item.id);
    if (type === 'agentMessage' && typeof item.text === 'string') {
      dto.text = item.text;
    } else if (type === 'userMessage' && Array.isArray(item.content)) {
      const texts = item.content
        .map((c) => {
          if (c && typeof c === 'object' && 'text' in c) return String((c as { text: unknown }).text ?? '');
          return '';
        })
        .filter(Boolean);
      dto.text = texts.join('\n');
    } else if (type === 'reasoning' && Array.isArray(item.summary)) {
      dto.text = item.summary.map(String).join('\n');
    } else if (type === 'dynamicToolCall') {
      dto.toolName = String(item.tool ?? 'tool');
      if (item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)) {
        dto.arguments = item.arguments as Record<string, unknown>;
      }
    } else if (type === 'mcpToolCall') {
      const server = item.server ? String(item.server) : '';
      const tool = item.tool ? String(item.tool) : 'mcp';
      dto.toolName = server ? `${server}.${tool}` : tool;
      if (item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments)) {
        dto.arguments = item.arguments as Record<string, unknown>;
      }
    } else if (type === 'commandExecution') {
      dto.toolName = 'command';
      if (typeof item.command === 'string') dto.text = item.command;
    }
    items.push(dto);
  }
  return ok({ items, nextCursor: res.value?.nextCursor ?? null });
}

export async function setThreadName(
  conn: CodexAppServerConnection,
  threadId: string,
  name: string
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request('thread/name/set', { threadId, name });
  if (!isOk(res)) {
    // 兼容旧方法名
    const alt = await conn.rpc.request('thread/setName', { threadId, name });
    if (!isOk(alt)) return alt;
  }
  return ok(undefined);
}

export async function archiveThread(
  conn: CodexAppServerConnection,
  threadId: string
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request('thread/archive', { threadId });
  if (!isOk(res)) return res;
  return ok(undefined);
}

/** thread/compact/start — 压缩上下文（异步，App Server 侧执行） */
export async function compactThread(
  conn: CodexAppServerConnection,
  threadId: string
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request('thread/compact/start', { threadId });
  if (!isOk(res)) return res;
  return ok(undefined);
}

/** thread/fork — 从已有会话分叉 */
export async function forkThread(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    ephemeral?: boolean;
    model?: string;
  }
): Promise<Result<{ threadId: string }, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const body: Record<string, unknown> = {
    threadId: params.threadId,
    excludeTurns: true,
  };
  if (typeof params.ephemeral === 'boolean') body.ephemeral = params.ephemeral;
  if (params.model) body.model = params.model;
  const res = await conn.rpc.request<{ thread?: { id?: string } }>('thread/fork', body);
  if (!isOk(res)) return res;
  const threadId = res.value?.thread?.id;
  if (!threadId) {
    return err(
      new BusinessError('E_CODEX_THREAD', 'thread/fork 未返回 thread.id', 'AGENT_RUNTIME', true)
    );
  }
  return ok({ threadId });
}

/** thread/queue/add */
export async function queueAdd(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    message: string;
    clientUserMessageId?: string;
  }
): Promise<Result<CodexQueuedSubmissionDto, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const clientUserMessageId =
    params.clientUserMessageId || `q_${Date.now().toString(36)}`;
  const res = await conn.rpc.request<{
    queuedSubmission?: {
      id?: string;
      clientUserMessageId?: string;
      input?: Array<{ type?: string; text?: string }>;
    };
  }>('thread/queue/add', {
    threadId: params.threadId,
    clientUserMessageId,
    input: [{ type: 'text', text: params.message }],
  });
  if (!isOk(res)) return res;
  const q = res.value?.queuedSubmission;
  if (!q?.id) {
    return err(
      new BusinessError('E_CODEX_QUEUE', 'thread/queue/add 未返回队列项', 'AGENT_RUNTIME', true)
    );
  }
  const text =
    Array.isArray(q.input) && q.input[0]?.text
      ? String(q.input[0].text)
      : params.message;
  return ok({
    id: String(q.id),
    text,
    clientUserMessageId: String(q.clientUserMessageId ?? clientUserMessageId),
  });
}

export async function queueList(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    limit?: number;
  }
): Promise<
  Result<{ items: CodexQueuedSubmissionDto[]; nextCursor: string | null }, BusinessError>
> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{
    data?: Array<{
      id?: string;
      clientUserMessageId?: string;
      input?: Array<{ type?: string; text?: string }>;
    }>;
    nextCursor?: string | null;
  }>('thread/queue/list', {
    threadId: params.threadId,
    limit: params.limit ?? 20,
  });
  if (!isOk(res)) return res;
  const rows = Array.isArray(res.value?.data) ? res.value.data : [];
  const items: CodexQueuedSubmissionDto[] = rows
    .map((row) => {
      const text =
        Array.isArray(row.input) && row.input[0]?.text
          ? String(row.input[0].text)
          : '';
      return {
        id: String(row.id ?? ''),
        text,
        clientUserMessageId: String(row.clientUserMessageId ?? ''),
      };
    })
    .filter((i) => i.id);
  return ok({ items, nextCursor: res.value?.nextCursor ?? null });
}

export async function queueDelete(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    queuedSubmissionId: string;
  }
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request('thread/queue/delete', {
    threadId: params.threadId,
    queuedSubmissionId: params.queuedSubmissionId,
  });
  if (!isOk(res)) return res;
  return ok(undefined);
}

export async function queueStart(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    queuedSubmissionId?: string;
  }
): Promise<Result<{ turnId: string }, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const body: Record<string, unknown> = { threadId: params.threadId };
  if (params.queuedSubmissionId) body.queuedSubmissionId = params.queuedSubmissionId;
  const res = await conn.rpc.request<{ turn?: { id?: string } }>('thread/queue/start', body);
  if (!isOk(res)) return res;
  const turnId = res.value?.turn?.id;
  if (!turnId) {
    return err(
      new BusinessError(
        'E_CODEX_QUEUE',
        'thread/queue/start 未返回 turn.id',
        'AGENT_RUNTIME',
        true
      )
    );
  }
  return ok({ turnId: String(turnId) });
}

/** skills/list */
export async function listSkills(
  conn: CodexAppServerConnection,
  params?: {
    forceReload?: boolean;
  }
): Promise<Result<CodexSkillDto[], BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{
    data?: Array<{
      skills?: Array<Record<string, unknown>>;
    }>;
  }>('skills/list', {
    forceReload: params?.forceReload ?? false,
  });
  if (!isOk(res)) return res;
  const groups = Array.isArray(res.value?.data) ? res.value.data : [];
  const skills: CodexSkillDto[] = [];
  for (const g of groups) {
    const rows = Array.isArray(g.skills) ? g.skills : [];
    for (const row of rows) {
      const s: CodexSkillDto = {
        name: String(row.name ?? ''),
        description: String(row.description ?? row.shortDescription ?? ''),
        enabled: Boolean(row.enabled),
      };
      if (row.scope != null) s.scope = String(row.scope);
      if (row.path != null) s.path = String(row.path);
      if (s.name) skills.push(s);
    }
  }
  return ok(skills);
}

/** collaborationMode/list */
export async function listCollaborationModes(
  conn: CodexAppServerConnection
): Promise<
  Result<CodexCollaborationModeDto[], BusinessError>
> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{ data?: Array<Record<string, unknown>> }>(
    'collaborationMode/list',
    {}
  );
  if (!isOk(res)) return res;
  const rows = Array.isArray(res.value?.data) ? res.value.data : [];
  return ok(
    rows.map((row) => ({
      name: String(row.name ?? row.mode ?? 'default'),
      mode: row.mode != null ? String(row.mode) : null,
      model: row.model != null ? String(row.model) : null,
      reasoningEffort:
        row.reasoning_effort != null
          ? String(row.reasoning_effort)
          : row.reasoningEffort != null
            ? String(row.reasoningEffort)
            : null,
    }))
  );
}

/** 探测本机 Codex 登录态（不读取/复制密钥，只问 App Server）。 */
export async function readAccountStatus(
  conn: CodexAppServerConnection
): Promise<Result<CodexAccountStatus, BusinessError>> {
  const binary = conn.config.command || resolveCodexBinary();
  const codexHome = resolveCodexHome(conn.config.codexHome);
  const authHint = Boolean(codexHome && existsSync(path.join(codexHome, 'auth.json')));

  const ready = await conn.connect();
  if (!isOk(ready)) {
    const status: CodexAccountStatus = {
      linked: false,
      requiresOpenaiAuth: true,
      binary,
      message: ready.error.userMessage || ready.error.message,
    };
    if (codexHome) status.codexHome = codexHome;
    return ok(status);
  }

  const res = await conn.rpc.request<{
    account?: { email?: string; planType?: string } | null;
    requiresOpenaiAuth?: boolean;
  }>('account/read', {});
  if (!isOk(res)) {
    const status: CodexAccountStatus = {
      linked: authHint,
      requiresOpenaiAuth: true,
      binary,
      message: res.error.userMessage || res.error.message,
    };
    if (codexHome) status.codexHome = codexHome;
    return ok(status);
  }

  const account = res.value?.account ?? null;
  const requires = Boolean(res.value?.requiresOpenaiAuth);
  const linked = Boolean(account) || (authHint && !requires);
  const status: CodexAccountStatus = {
    linked,
    requiresOpenaiAuth: requires,
    planType: account?.planType ?? null,
    email: account?.email ?? null,
    binary,
    message: linked
      ? '已联动本机 Codex 登录态'
      : requires
        ? '本机 Codex 尚未登录，请先在终端执行 codex login'
        : '已检测到本机 Codex 配置，可直接发起对话',
  };
  if (codexHome) status.codexHome = codexHome;
  return ok(status);
}

/** account/rateLimits/read */
export async function readRateLimits(
  conn: CodexAppServerConnection
): Promise<Result<CodexRateLimitsDto, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{
    rateLimits?: {
      limitId?: string | null;
      limitName?: string | null;
      planType?: string | null;
      primary?: { usedPercent?: number; resetsAt?: number | null } | null;
      secondary?: { usedPercent?: number; resetsAt?: number | null } | null;
    };
  }>('account/rateLimits/read', {});
  if (!isOk(res)) return res;
  const snap = res.value?.rateLimits;
  return ok({
    limitId: snap?.limitId ?? null,
    limitName: snap?.limitName ?? null,
    planType: snap?.planType != null ? String(snap.planType) : null,
    primaryUsedPercent:
      typeof snap?.primary?.usedPercent === 'number' ? snap.primary.usedPercent : null,
    primaryResetsAt:
      typeof snap?.primary?.resetsAt === 'number' ? snap.primary.resetsAt : null,
    secondaryUsedPercent:
      typeof snap?.secondary?.usedPercent === 'number'
        ? snap.secondary.usedPercent
        : null,
    secondaryResetsAt:
      typeof snap?.secondary?.resetsAt === 'number' ? snap.secondary.resetsAt : null,
  });
}

/** mcpServerStatus/list — 只读观测本机 Codex 已配置的 MCP（非学习域工具总线） */
export async function listMcpServerStatus(
  conn: CodexAppServerConnection,
  params?: {
    cursor?: string;
    limit?: number;
  }
): Promise<
  Result<{ servers: CodexMcpServerStatusDto[]; nextCursor: string | null }, BusinessError>
> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const body: Record<string, unknown> = {
    limit: params?.limit ?? 40,
  };
  if (params?.cursor) body.cursor = params.cursor;
  const res = await conn.rpc.request<{
    data?: Array<{
      name?: string;
      pluginId?: string | null;
      authStatus?: string | { status?: string };
      tools?: Record<string, unknown>;
    }>;
    nextCursor?: string | null;
  }>('mcpServerStatus/list', body);
  if (!isOk(res)) return res;
  const rows = Array.isArray(res.value?.data) ? res.value.data : [];
  const servers: CodexMcpServerStatusDto[] = rows.map((row) => {
    const auth =
      typeof row.authStatus === 'string'
        ? row.authStatus
        : row.authStatus && typeof row.authStatus === 'object'
          ? String((row.authStatus as { status?: string }).status ?? 'unknown')
          : 'unknown';
    return {
      name: String(row.name ?? ''),
      authStatus: auth,
      toolCount: row.tools ? Object.keys(row.tools).length : 0,
      pluginId: row.pluginId != null ? String(row.pluginId) : null,
    };
  }).filter((s) => s.name);
  return ok({
    servers,
    nextCursor: res.value?.nextCursor ?? null,
  });
}

/**
 * EXPERIMENTAL — thread/realtime/listVoices + 能力探测。
 * 成功仅代表本机 App Server 识别该 RPC；不代表 Lingua Studio 已接音频 UI。
 */
export async function probeRealtimeCapability(
  conn: CodexAppServerConnection
): Promise<
  Result<CodexRealtimeCapabilityDto, BusinessError>
> {
  const voicesRes = await listRealtimeVoices(conn);
  if (!isOk(voicesRes)) {
    return ok({
      available: false,
      experimental: true,
      message:
        voicesRes.error.userMessage ||
        voicesRes.error.message ||
        '本机 Codex 暂未响应 realtime voices；接口已预留，待引擎支持后再用。',
    });
  }
  return ok({
    available: true,
    experimental: true,
    message:
      '本机 App Server 已响应 realtime voices（实验性）。Lingua Studio 尚未接 UI/音频管线，请勿当作可用产品能力。',
    voices: voicesRes.value,
  });
}

export async function listRealtimeVoices(
  conn: CodexAppServerConnection
): Promise<Result<CodexRealtimeVoicesDto, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request<{
    voices?: {
      v1?: string[];
      v2?: string[];
      defaultV1?: string;
      defaultV2?: string;
    };
  }>('thread/realtime/listVoices', {});
  if (!isOk(res)) return res;
  const v = res.value?.voices;
  return ok({
    v1: Array.isArray(v?.v1) ? v.v1.map(String) : [],
    v2: Array.isArray(v?.v2) ? v.v2.map(String) : [],
    defaultV1: v?.defaultV1 != null ? String(v.defaultV1) : null,
    defaultV2: v?.defaultV2 != null ? String(v.defaultV2) : null,
  });
}

/** EXPERIMENTAL — thread/realtime/start */
export async function startRealtime(
  conn: CodexAppServerConnection,
  params: CodexRealtimeStartParams
): Promise<Result<{ ok: true }, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const body: Record<string, unknown> = {
    threadId: params.threadId,
    outputModality: params.outputModality,
  };
  if (params.model) body.model = params.model;
  if (params.voice) body.voice = params.voice;
  if (params.prompt) body.prompt = params.prompt;
  if (params.transport) body.transport = params.transport;
  if (params.version) body.version = params.version;
  if (params.realtimeSessionId) body.realtimeSessionId = params.realtimeSessionId;
  if (params.realtimeStartInstructions) {
    body.realtimeStartInstructions = params.realtimeStartInstructions;
  }
  if (params.realtimeEndInstructions) {
    body.realtimeEndInstructions = params.realtimeEndInstructions;
  }
  const res = await conn.rpc.request('thread/realtime/start', body);
  if (!isOk(res)) return res;
  return ok({ ok: true });
}

/** EXPERIMENTAL — thread/realtime/stop */
export async function stopRealtime(
  conn: CodexAppServerConnection,
  threadId: string
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request('thread/realtime/stop', { threadId });
  if (!isOk(res)) return res;
  return ok(undefined);
}

/** EXPERIMENTAL — thread/realtime/appendText */
export async function appendRealtimeText(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    text: string;
    role?: CodexRealtimeTextRole;
  }
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request('thread/realtime/appendText', {
    threadId: params.threadId,
    text: params.text,
    role: params.role ?? 'user',
  });
  if (!isOk(res)) return res;
  return ok(undefined);
}

/** EXPERIMENTAL — thread/realtime/appendSpeech */
export async function appendRealtimeSpeech(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    text: string;
  }
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const res = await conn.rpc.request('thread/realtime/appendSpeech', {
    threadId: params.threadId,
    text: params.text,
  });
  if (!isOk(res)) return res;
  return ok(undefined);
}

/** EXPERIMENTAL — thread/realtime/appendAudio */
export async function appendRealtimeAudio(
  conn: CodexAppServerConnection,
  params: {
    threadId: string;
    audio: CodexRealtimeAudioChunkDto;
  }
): Promise<Result<void, BusinessError>> {
  const ready = await conn.connect();
  if (!isOk(ready)) return ready;
  const audio: Record<string, unknown> = {
    data: params.audio.data,
    sampleRate: params.audio.sampleRate,
    numChannels: params.audio.numChannels,
    samplesPerChannel: params.audio.samplesPerChannel ?? null,
    itemId: params.audio.itemId ?? null,
  };
  const res = await conn.rpc.request('thread/realtime/appendAudio', {
    threadId: params.threadId,
    audio,
  });
  if (!isOk(res)) return res;
  return ok(undefined);
}
