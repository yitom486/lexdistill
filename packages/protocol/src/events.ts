/**
 * WebSocket 双向通信标准事件类型枚举
 */
export const WsEventTypes = {
  // Client -> Gateway
  CLIENT_SESSION_INIT: 'client.session.init',
  CLIENT_TURN_SEND: 'client.turn.send',
  CLIENT_QUIZ_SUBMIT: 'client.quiz.submit',
  CLIENT_QUIZ_GENERATE: 'client.quiz.generate',
  CLIENT_QUIZ_GRADE_SUBJECTIVE: 'client.quiz.grade_subjective',
  CLIENT_CARD_REVIEW: 'client.card.review',
  CLIENT_TOOL_RESULT: 'client.tool.result',
  CLIENT_APPROVAL_RESPOND: 'client.approval.respond',
  CLIENT_TURN_INTERRUPT: 'client.turn.interrupt',
  CLIENT_TURN_STEER: 'client.turn.steer',
  /** 启动 thread 队列中的下一项并流式推送 */
  CLIENT_QUEUE_START: 'client.queue.start',
  CLIENT_PING: 'client.ping',
  CLIENT_PROFILE_GET: 'client.profile.get',
  CLIENT_PROFILE_UPDATE: 'client.profile.update',
  CLIENT_TASK_PROGRESS_GET: 'client.task_progress.get',
  CLIENT_TASK_ACTIVITY_RECORD: 'client.task_activity.record',

  // Gateway -> Client
  AGENT_TURN_START: 'agent.turn.start',
  AGENT_TEXT_DELTA: 'agent.text.delta',
  AGENT_REASONING_DELTA: 'agent.reasoning.delta',
  AGENT_TOOL_CALL: 'agent.tool.call',
  AGENT_APPROVAL_REQUEST: 'agent.approval.request',
  AGENT_APPROVAL_RESOLVED: 'agent.approval.resolved',
  AGENT_TURN_COMPLETED: 'agent.turn.completed',
  /** Codex thread/queue/changed 转发 */
  AGENT_QUEUE_CHANGED: 'agent.queue.changed',
  /** Codex skills/changed 转发 */
  AGENT_SKILLS_CHANGED: 'agent.skills.changed',
  /**
   * EXPERIMENTAL realtime 旁路通知（预留）。
   * 当前仅协议占位；完整音频/SDP 管线尚未接入。
   */
  AGENT_REALTIME_STARTED: 'agent.realtime.started',
  AGENT_REALTIME_CLOSED: 'agent.realtime.closed',
  AGENT_REALTIME_ERROR: 'agent.realtime.error',
  AGENT_REALTIME_TRANSCRIPT_DELTA: 'agent.realtime.transcript.delta',
  AGENT_REALTIME_TRANSCRIPT_DONE: 'agent.realtime.transcript.done',
  AGENT_REALTIME_AUDIO_DELTA: 'agent.realtime.audio.delta',
  AGENT_REALTIME_SDP: 'agent.realtime.sdp',
  AGENT_REALTIME_ITEM_ADDED: 'agent.realtime.item.added',
  AGENT_ERROR: 'agent.error',
  LEARNER_PROFILE_UPDATED: 'learner.profile.updated',
  LEARNER_DAILY_TASK_UPDATED: 'learner.daily_task.updated',
  LEARNER_MISTAKE_ADDED: 'learner.mistake.added',
  /** 整本 enrich 后台任务：逐课进度 / 终态（成功） / 终态（失败或取消） */
  IMPORT_ENRICH_PROGRESS: 'import.enrich.progress',
  IMPORT_ENRICH_COMPLETED: 'import.enrich.completed',
  IMPORT_ENRICH_FAILED: 'import.enrich.failed',
  GATEWAY_PONG: 'gateway.pong',
} as const;

export type WsEventType = typeof WsEventTypes[keyof typeof WsEventTypes];
