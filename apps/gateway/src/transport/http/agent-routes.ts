import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { isOk, BusinessError } from '@study-studio/shared';
import { formatBusinessErrorResponse } from '../../errors/http-error-handler.js';
import type { GatewayDeps } from '../../composition/gateway-deps.js';

/** Provider-neutral Agent management routes. */
export function createAgentRoutes(deps: GatewayDeps) {
  return new Hono()
  .get('/api/agent/status', async (c) => {
    const res = await deps.server.getAgentStatus();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_STATUS');
    }
    return c.json(res.value);
  })
  .get('/api/agent/models', async (c) => {
    const includeHidden = c.req.query('includeHidden') === '1';
    const res = await deps.server.listAgentModels(includeHidden);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_MODELS');
    }
    return c.json({ models: res.value });
  })
  .get('/api/agent/sessions', async (c) => {
    const limit = Number(c.req.query('limit') || 40);
    const cursor = c.req.query('cursor') || undefined;
    const searchTerm = c.req.query('q') || undefined;
    const res = await deps.server.listAgentSessions({
      limit: Number.isFinite(limit) ? limit : 40,
      ...(cursor ? { cursor } : {}),
      ...(searchTerm ? { searchTerm } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSIONS');
    }
    return c.json(res.value);
  })
  .get('/api/agent/sessions/:sessionId/items', async (c) => {
    const sessionId = c.req.param('sessionId');
    const limit = Number(c.req.query('limit') || 80);
    const res = await deps.server.listAgentSessionItems({
      sessionId,
      limit: Number.isFinite(limit) ? limit : 80,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_ITEMS');
    }
    return c.json(res.value);
  })
  .post('/api/agent/sessions/:sessionId/name', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = String(body.name || '').trim();
    if (!name) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', '缺少会话名称', 'VALIDATION'),
        'AGENT_SESSION_NAME'
      );
    }
    const res = await deps.server.setAgentSessionName(sessionId, name);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_NAME');
    }
    return c.json({ ok: true, sessionId, name });
  })
  .post('/api/agent/sessions/:sessionId/archive', async (c) => {
    const sessionId = c.req.param('sessionId');
    const res = await deps.server.archiveAgentSession(sessionId);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_ARCHIVE');
    }
    return c.json({ ok: true, sessionId });
  })
  .post('/api/agent/sessions/:sessionId/compact', async (c) => {
    const sessionId = c.req.param('sessionId');
    const res = await deps.server.compactAgentSession(sessionId);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_COMPACT');
    }
    return c.json({ ok: true, sessionId });
  })
  .get('/api/agent/collaboration-modes', async (c) => {
    const res = await deps.server.listAgentCollaborationModes();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_COLLAB_MODES');
    }
    return c.json({ modes: res.value });
  })
  .post('/api/agent/sessions/:sessionId/fork', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as {
      ephemeral?: boolean;
      model?: string;
    };
    const res = await deps.server.forkAgentSession({
      sessionId,
      ...(typeof body.ephemeral === 'boolean' ? { ephemeral: body.ephemeral } : {}),
      ...(body.model ? { model: body.model } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SESSION_FORK');
    }
    return c.json(res.value);
  })
  .get('/api/agent/sessions/:sessionId/queue', async (c) => {
    const sessionId = c.req.param('sessionId');
    const limit = Number(c.req.query('limit') || 20);
    const res = await deps.server.listAgentQueue({
      sessionId,
      limit: Number.isFinite(limit) ? limit : 20,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_LIST');
    }
    return c.json(res.value);
  })
  .post('/api/agent/sessions/:sessionId/queue', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as { message?: string };
    const message = String(body.message || '').trim();
    if (!message) {
      return formatBusinessErrorResponse(
        c,
        new BusinessError('E_INVALID_INPUT', '队列消息不能为空', 'VALIDATION'),
        'AGENT_QUEUE_ADD'
      );
    }
    const res = await deps.server.queueAgentAdd({ sessionId, message });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_ADD');
    }
    return c.json(res.value);
  })
  .delete('/api/agent/sessions/:sessionId/queue/:queuedId', async (c) => {
    const sessionId = c.req.param('sessionId');
    const queuedSubmissionId = c.req.param('queuedId');
    const res = await deps.server.deleteAgentQueueItem({
      sessionId,
      queuedSubmissionId,
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_DELETE');
    }
    return c.json({ ok: true });
  })
  .post('/api/agent/sessions/:sessionId/queue/start', async (c) => {
    const sessionId = c.req.param('sessionId');
    const body = (await c.req.json().catch(() => ({}))) as {
      queuedSubmissionId?: string;
    };
    const res = await deps.server.startAgentQueue({
      sessionId,
      ...(body.queuedSubmissionId
        ? { queuedSubmissionId: body.queuedSubmissionId }
        : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_QUEUE_START');
    }
    return c.json({ ok: true });
  })
  .get('/api/agent/skills', async (c) => {
    const forceReload = c.req.query('forceReload') === '1';
    const res = await deps.server.listAgentSkills({ forceReload });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_SKILLS');
    }
    return c.json({ skills: res.value });
  })
  .get('/api/agent/usage', async (c) => {
    const res = await deps.server.getAgentUsage();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'AGENT_USAGE');
    }
    return c.json(res.value);
  })
  .get('/api/integrations/mcp/servers', async (c) => {
    const limit = Number(c.req.query('limit') || 40);
    const cursor = c.req.query('cursor') || undefined;
    const res = await deps.server.listMcpServers({
      limit: Number.isFinite(limit) ? limit : 40,
      ...(cursor ? { cursor } : {}),
    });
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'INTEGRATION_MCP_STATUS');
    }
    return c.json(res.value);
  })
  /**
   * EXPERIMENTAL realtime（预留）
   * — 仅暴露 App Server RPC 外壳；无 UI、无音频管线、不保证可用。
   */
  .get('/api/internal/agent-adapters/codex/realtime/capability', async (c) => {
    const res = await deps.server.probeCodexRealtime();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_PROBE');
    }
    return c.json(res.value);
  })
  .get('/api/internal/agent-adapters/codex/realtime/voices', async (c) => {
    const res = await deps.server.listCodexRealtimeVoices();
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_VOICES');
    }
    return c.json({ experimental: true, voices: res.value });
  })
  .post('/api/internal/agent-adapters/codex/realtime/:threadId/start', async (c) => {
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
  .post('/api/internal/agent-adapters/codex/realtime/:threadId/stop', async (c) => {
    const threadId = c.req.param('threadId');
    const res = await deps.server.stopCodexRealtime(threadId);
    if (!isOk(res)) {
      return formatBusinessErrorResponse(c, res.error, 'CODEX_REALTIME_STOP');
    }
    return c.json({ ok: true, experimental: true });
  })
  .post('/api/internal/agent-adapters/codex/realtime/:threadId/append-text', async (c) => {
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
  .post('/api/internal/agent-adapters/codex/realtime/:threadId/append-speech', async (c) => {
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
  .post('/api/internal/agent-adapters/codex/realtime/:threadId/append-audio', async (c) => {
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
