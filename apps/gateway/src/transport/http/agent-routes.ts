import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../composition/gateway-deps.js';

/** Codex Agent 管理路由（G2：由 index.ts 链式注册迁移而来，行为不变）。 */
export function createAgentRoutes(deps: GatewayDeps) {
  return new Hono()
  .get('/api/agent/codex/status', async (c) => {
    const res = await deps.server.getCodexAccountStatus();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_STATUS');
    }
    return c.json(res.value);
  })
  .get('/api/agent/codex/models', async (c) => {
    const includeHidden = c.req.query('includeHidden') === '1';
    const res = await deps.server.listCodexModels(includeHidden);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_MODELS');
    }
    return c.json({ models: res.value });
  })
  .get('/api/agent/codex/threads', async (c) => {
    const limit = Number(c.req.query('limit') || 40);
    const cursor = c.req.query('cursor') || undefined;
    const searchTerm = c.req.query('q') || undefined;
    const res = await deps.server.listCodexThreads({
      limit: Number.isFinite(limit) ? limit : 40,
      ...(cursor ? { cursor } : {}),
      ...(searchTerm ? { searchTerm } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_THREADS');
    }
    return c.json(res.value);
  })
  .get('/api/agent/codex/threads/:threadId/items', async (c) => {
    const threadId = c.req.param('threadId');
    const limit = Number(c.req.query('limit') || 80);
    const res = await deps.server.listCodexThreadItems({
      threadId,
      limit: Number.isFinite(limit) ? limit : 80,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_THREAD_ITEMS');
    }
    return c.json(res.value);
  })
  .post('/api/agent/codex/threads/:threadId/name', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name || '').trim();
    if (!name) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', '缺少会话名称', 'VALIDATION'),
        'CODEX_THREAD_NAME'
      );
    }
    const res = await deps.server.setCodexThreadName(threadId, name);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_THREAD_NAME');
    }
    return c.json({ ok: true, threadId, name });
  })
  .post('/api/agent/codex/threads/:threadId/archive', async (c) => {
    const threadId = c.req.param('threadId');
    const res = await deps.server.archiveCodexThread(threadId);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_THREAD_ARCHIVE');
    }
    return c.json({ ok: true, threadId });
  })
  .post('/api/agent/codex/threads/:threadId/compact', async (c) => {
    const threadId = c.req.param('threadId');
    const res = await deps.server.compactCodexThread(threadId);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_THREAD_COMPACT');
    }
    return c.json({ ok: true, threadId });
  })
  .get('/api/agent/codex/collaboration-modes', async (c) => {
    const res = await deps.server.listCodexCollaborationModes();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_COLLAB_MODES');
    }
    return c.json({ modes: res.value });
  })
  .post('/api/agent/codex/threads/:threadId/fork', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as {
      ephemeral?: boolean;
      model?: string;
    };
    const res = await deps.server.forkCodexThread({
      threadId,
      ...(typeof body.ephemeral === 'boolean' ? { ephemeral: body.ephemeral } : {}),
      ...(body.model ? { model: body.model } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_THREAD_FORK');
    }
    return c.json(res.value);
  })
  .get('/api/agent/codex/threads/:threadId/queue', async (c) => {
    const threadId = c.req.param('threadId');
    const limit = Number(c.req.query('limit') || 20);
    const res = await deps.server.listCodexQueue({
      threadId,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_QUEUE_LIST');
    }
    return c.json(res.value);
  })
  .post('/api/agent/codex/threads/:threadId/queue', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as { message?: string };
    const message = String(body.message || '').trim();
    if (!message) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', '队列消息不能为空', 'VALIDATION'),
        'CODEX_QUEUE_ADD'
      );
    }
    const res = await deps.server.queueCodexAdd({ threadId, message });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_QUEUE_ADD');
    }
    return c.json(res.value);
  })
  .delete('/api/agent/codex/threads/:threadId/queue/:queuedId', async (c) => {
    const threadId = c.req.param('threadId');
    const queuedSubmissionId = c.req.param('queuedId');
    const res = await deps.server.deleteCodexQueueItem({
      threadId,
      queuedSubmissionId,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_QUEUE_DELETE');
    }
    return c.json({ ok: true });
  })
  .post('/api/agent/codex/threads/:threadId/queue/start', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as {
      queuedSubmissionId?: string;
    };
    const res = await deps.server.startCodexQueue({
      threadId,
      ...(body.queuedSubmissionId
        ? { queuedSubmissionId: body.queuedSubmissionId }
        : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_QUEUE_START');
    }
    return c.json({ ok: true });
  })
  .get('/api/agent/codex/skills', async (c) => {
    const forceReload = c.req.query('forceReload') === '1';
    const res = await deps.server.listCodexSkills({ forceReload });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_SKILLS');
    }
    return c.json({ skills: res.value });
  })
  .get('/api/agent/codex/rate-limits', async (c) => {
    const res = await deps.server.getCodexRateLimits();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_RATE_LIMITS');
    }
    return c.json(res.value);
  })
  .get('/api/agent/codex/mcp-servers', async (c) => {
    const limit = Number(c.req.query('limit') || 40);
    const cursor = c.req.query('cursor') || undefined;
    const res = await deps.server.listCodexMcpServers({
      limit: Number.isFinite(limit) ? limit : 40,
      ...(cursor ? { cursor } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_MCP_STATUS');
    }
    return c.json(res.value);
  })
  /**
   * EXPERIMENTAL realtime（预留）
   * — 仅暴露 App Server RPC 外壳；无 UI、无音频管线、不保证可用。
   */
  .get('/api/agent/codex/realtime/capability', async (c) => {
    const res = await deps.server.probeCodexRealtime();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_PROBE');
    }
    return c.json(res.value);
  })
  .get('/api/agent/codex/realtime/voices', async (c) => {
    const res = await deps.server.listCodexRealtimeVoices();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_VOICES');
    }
    return c.json({ experimental: true, voices: res.value });
  })
  .post('/api/agent/codex/realtime/:threadId/start', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as {
      outputModality?: 'text' | 'audio';
      model?: string;
      voice?: string;
      prompt?: string;
      transport?: { type: 'websocket' } | { type: 'webrtc'; sdp: string };
      version?: string;
      realtimeSessionId?: string;
      realtimeStartInstructions?: string;
      realtimeEndInstructions?: string;
    };
    const outputModality = body.outputModality === 'audio' ? 'audio' : 'text';
    const res = await deps.server.startCodexRealtime({
      threadId,
      outputModality,
      ...(body.model ? { model: body.model } : {}),
      ...(body.voice ? { voice: body.voice } : {}),
      ...(body.prompt ? { prompt: body.prompt } : {}),
      ...(body.transport ? { transport: body.transport } : {}),
      ...(body.version ? { version: body.version } : {}),
      ...(body.realtimeSessionId ? { realtimeSessionId: body.realtimeSessionId } : {}),
      ...(body.realtimeStartInstructions
        ? { realtimeStartInstructions: body.realtimeStartInstructions }
        : {}),
      ...(body.realtimeEndInstructions
        ? { realtimeEndInstructions: body.realtimeEndInstructions }
        : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_START');
    }
    return c.json({
      ok: true,
      experimental: true,
      warning: 'Realtime 为实验性预留接口，Lingua Studio 尚未接 UI/音频管线。',
    });
  })
  .post('/api/agent/codex/realtime/:threadId/stop', async (c) => {
    const threadId = c.req.param('threadId');
    const res = await deps.server.stopCodexRealtime(threadId);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_STOP');
    }
    return c.json({ ok: true, experimental: true });
  })
  .post('/api/agent/codex/realtime/:threadId/append-text', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      role?: 'user' | 'developer' | 'assistant';
    };
    const text = String(body.text || '').trim();
    if (!text) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', 'realtime 文本不能为空', 'VALIDATION'),
        'CODEX_REALTIME_APPEND_TEXT'
      );
    }
    const res = await deps.server.appendCodexRealtimeText({
      threadId,
      text,
      ...(body.role ? { role: body.role } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_APPEND_TEXT');
    }
    return c.json({ ok: true, experimental: true });
  })
  .post('/api/agent/codex/realtime/:threadId/append-speech', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as { text?: string };
    const text = String(body.text || '').trim();
    if (!text) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', 'realtime speech 文本不能为空', 'VALIDATION'),
        'CODEX_REALTIME_APPEND_SPEECH'
      );
    }
    const res = await deps.server.appendCodexRealtimeSpeech({ threadId, text });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_APPEND_SPEECH');
    }
    return c.json({ ok: true, experimental: true });
  })
  .post('/api/agent/codex/realtime/:threadId/append-audio', async (c) => {
    const threadId = c.req.param('threadId');
    const body = (await c.req.json().catch(() => ({}))) as {
      audio?: {
        data?: string;
        sampleRate?: number;
        numChannels?: number;
        samplesPerChannel?: number | null;
        itemId?: string | null;
      };
    };
    const audio = body.audio;
    if (!audio?.data || typeof audio.sampleRate !== 'number' || typeof audio.numChannels !== 'number') {
      return formatBusinessErrorResponse(
        c,
        new BusinessError(
          'E_INVALID_INPUT',
          '缺少有效 audio 负载（data / sampleRate / numChannels）',
          'VALIDATION'
        ),
        'CODEX_REALTIME_APPEND_AUDIO'
      );
    }
    const res = await deps.server.appendCodexRealtimeAudio({
      threadId,
      audio: {
        data: String(audio.data),
        sampleRate: audio.sampleRate,
        numChannels: audio.numChannels,
        ...(audio.samplesPerChannel !== undefined
          ? { samplesPerChannel: audio.samplesPerChannel }
          : {}),
        ...(audio.itemId !== undefined ? { itemId: audio.itemId } : {}),
      },
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_APPEND_AUDIO');
    }
    return c.json({ ok: true, experimental: true });
  })
;
}
