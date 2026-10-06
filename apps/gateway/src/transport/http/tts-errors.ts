import { LocalTTSError, type TTSProvider } from 'gemini-tts-studio/server';

/** Inspect SDK error fields before the TTS package replaces them with a generic message. */
function errorDetails(error: unknown): { statuses: number[]; text: string } {
  const statuses: number[] = [];
  const messages: string[] = [];
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (depth > 8 || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of ['status', 'statusCode', 'code']) {
      const field = record[key];
      if (typeof field === 'number') statuses.push(field);
      else if (typeof field === 'string') {
        messages.push(field);
        if (/^\d{3}$/.test(field)) statuses.push(Number(field));
      }
    }
    for (const key of ['message', 'reason', 'quotaId', 'quotaMetric', 'description']) {
      const field = record[key];
      if (typeof field !== 'string') continue;
      messages.push(field);
      // Google SDK may put the entire REST error envelope in Error.message.
      try { visit(JSON.parse(field), depth + 1); } catch { /* Plain text error. */ }
    }
    for (const key of ['error', 'cause', 'details', 'violations']) visit(record[key], depth + 1);
  }
  visit(error, 0);
  const text = messages.join('\n');
  // Azure/local adapters sometimes retain HTTP status only in their error message.
  for (const match of text.matchAll(/(?:HTTP\s+|\()(401|403|429)(?=[\s)·.:]|$)/gi)) {
    statuses.push(Number(match[1]));
  }
  return { statuses, text };
}

function synthesisError(error: unknown): LocalTTSError {
  console.error('[TTS Gateway] 语音合成调用失败:', error);
  const { statuses, text } = errorDetails(error);
  const limited = statuses.includes(429) || /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|insufficient_quota/i.test(text);
  if (limited) {
    if (/per[\s_-]*day|per[\s_-]*month|daily|monthly|insufficient_quota|billing[\s_-]*hard[\s_-]*limit|credit[\s_-]*balance/i.test(text)) {
      return new LocalTTSError('E_TTS_QUOTA', '当前语音服务的可用额度已用尽。请检查服务额度，或在语音设置中选择其他服务。', 429, false);
    }
    if (/per[\s_-]*minute|per[\s_-]*second|RATE_LIMIT_EXCEEDED|too many requests|requests too frequent/i.test(text)) {
      return new LocalTTSError('E_TTS_RATE_LIMIT', '语音请求过于频繁，请稍后再试。', 429, true);
    }
    return new LocalTTSError('E_TTS_USAGE_LIMIT', '当前语音服务触发使用限制，暂时无法朗读。请稍后重试；若持续出现，请检查服务额度。', 429, true);
  }
  if (error instanceof LocalTTSError) return error;
  if (statuses.includes(401) || statuses.includes(403)) {
    return new LocalTTSError('E_TTS_AUTH', '语音服务未授权。请在语音设置中检查 API Key 和服务权限。', 401, false);
  }
  return new LocalTTSError('E_TTS_UPSTREAM', '语音服务暂时无法生成音频，请稍后再试。', 502, true);
}

/** Preserve the existing provider and request path; translate synthesis failures only. */
export function withTtsErrorMessages(provider: TTSProvider): TTSProvider {
  const stream = provider.synthesizeStream;
  return {
    ...provider,
    async synthesize(...args) {
      try { return await provider.synthesize(...args); }
      catch (error) { throw synthesisError(error); }
    },
    ...(stream ? {
      async synthesizeStream(...args: Parameters<NonNullable<TTSProvider['synthesizeStream']>>) {
        try { return await stream.call(provider, ...args); }
        catch (error) { throw synthesisError(error); }
      },
    } : {}),
  };
}
