import type {
  AgentAdapter,
  AgentSession,
  CreateSessionOptions,
  AgentInput,
  AgentEvent,
  ContextSnapshot,
  ApprovalDecision,
} from '../../contracts/index.js';
import {
  ok,
  err,
  type Result,
  type BusinessError,
  translateToBusinessError,
} from '@study-studio/shared';

/**
 * 轻量单次问答会话：无外部厂商 SDK。
 * Gateway 在调用本 Adapter 前应优先尝试课程资产旁路（声调/五十音/助词）。
 * 此处负责可注入 ContextSnapshot 的通用 stub 答复。
 */
export class ResponsesSession implements AgentSession {
  constructor(public readonly sessionId: string) {}

  public async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    try {
      const msg = (input.message || '').trim();
      const reply = buildLightweightReply(msg, input.contextSnapshot);
      yield { type: 'TEXT_DELTA', delta: reply };
      yield { type: 'COMPLETED', finalOutput: reply };
    } catch (rawError) {
      yield {
        type: 'ERROR',
        error: translateToBusinessError(rawError, 'RESPONSES_SESSION:send'),
      };
    }
  }

  public async submitToolResult(
    _callId: string,
    _result: unknown
  ): Promise<Result<void, BusinessError>> {
    return ok(undefined);
  }

  public async submitApproval(
    _approvalId: string,
    _decision: boolean | ApprovalDecision
  ): Promise<Result<void, BusinessError>> {
    return ok(undefined);
  }

  public async steer(_message: string): Promise<Result<void, BusinessError>> {
    return ok(undefined);
  }

  public async interrupt(): Promise<Result<void, BusinessError>> {
    return ok(undefined);
  }

  public async close(): Promise<Result<void, BusinessError>> {
    return ok(undefined);
  }
}

export class ResponsesAdapter implements AgentAdapter {
  public readonly id = 'responses-lite';
  public readonly name = 'Responses Lightweight Adapter';

  public async createSession(
    options: CreateSessionOptions
  ): Promise<Result<AgentSession, BusinessError>> {
    try {
      return ok(new ResponsesSession(options.sessionId));
    } catch (raw) {
      return err(translateToBusinessError(raw, 'RESPONSES:createSession'));
    }
  }

  public async resumeSession(
    sessionId: string
  ): Promise<Result<AgentSession, BusinessError>> {
    try {
      return ok(new ResponsesSession(sessionId));
    } catch (raw) {
      return err(translateToBusinessError(raw, 'RESPONSES:resumeSession'));
    }
  }
}

function trackOf(snapshot?: ContextSnapshot): 'ja' | 'en' | 'ko' {
  const t = snapshot?.targetLanguage;
  if (t === 'en' || t === 'ko' || t === 'ja') return t;
  return 'ja';
}

/** 导出供单测；Gateway 课程资产旁路未命中时使用 */
export function buildLightweightReply(message: string, snapshot?: ContextSnapshot): string {
  const track = trackOf(snapshot);
  const clip = message.slice(0, 80);
  const focus = snapshot?.focus;
  const weak = snapshot?.learnerDigest?.topWeaknesses?.[0];
  const focusLine = focus?.surface
    ? `\n当前焦点：「${focus.surface}」${focus.skillTag ? ` · ${focus.skillTag}` : ''}`
    : '';
  const weakLine = weak
    ? `\n薄弱项提示：${weak.name || weak.skillId}（熟练度 ${Math.round(weak.proficiency)}）`
    : '';

  if (!message) {
    return '请给出需要快速解答的词句或客观题干，我将以轻量旁路给出简短说明。';
  }

  if (/读|発音|发音|声调|pitch|假名|五十音|pronounc|ipa|발음/i.test(message)) {
    if (track === 'en') {
      return (
        `【轻量旁路 · 英语】发音提示：优先查权威音标与词性重音；Gateway 课程词表未命中时勿臆造。` +
        `原问：${clip}${focusLine}${weakLine}`
      );
    }
    if (track === 'ko') {
      return (
        `【轻量旁路 · 韩语】发音提示：关注收音与连音；正式词典接入前勿臆造。` +
        `원문：${clip}${focusLine}${weakLine}`
      );
    }
    return (
      `【轻量旁路 · 日语】发音提示：请优先查课程资产（lookup_pitch / 五十音）；未命中时打开「声调纠音」或换词再问。` +
      `原问：${clip}${focusLine}${weakLine}`
    );
  }

  if (/助词|に|で|を|が|은\/는|에서|preposition|介词|조사/.test(message)) {
    if (track === 'en') {
      return (
        `【轻量旁路 · 英语】语法提示：先抓谓语与搭配介词，再核对从句连词。` +
        `原问：${clip}${focusLine}${weakLine}`
      );
    }
    if (track === 'ko') {
      return (
        `【轻量旁路 · 韩语】조사：동작 장소「에서」vs 존재「에」；주제「은/는」vs 초점「이/가」。` +
        `원문：${clip}${focusLine}${weakLine}`
      );
    }
    return (
      `【轻量旁路 · 日语】助词：静态存在/归着点多用「に」，动态行为发生场所多用「で」。` +
      `可问「に vs で」获取对照；原问：${clip}${focusLine}${weakLine}`
    );
  }

  const trackLabel = track === 'en' ? '英语' : track === 'ko' ? '韩语' : '日语';
  return (
    `【轻量旁路 · ${trackLabel}】已收到：${message.slice(0, 120)}。` +
    `复杂编排（出题/批改/长讲解）请走学习闭环主通路。${focusLine}${weakLine}`
  );
}
