/**
 * CMD-LINGUA-P5D2D：import session 纯逻辑（无 React、无 fetch、无存储）。
 *
 * - prepare 守门：preview 全部可执行才允许（unresolved/无 end/空计划/超窗全拒绝）；
 * - chunk 执行守门：只认服务端 status 指定的 next，不自动、不跳过；
 * - 后端负载收窄（prepare/status/execute 结果）；
 * - sessionId 只活在组件 state，刷新即失；恢复只能靠同 plan 重 prepare（reused）。
 */

import type { PreviewResponseData } from './toc-anchor-flow.js';

export const SESSION_CHUNK_MAX_PAGES = 30;

export type SessionStatusView =
  | 'prepared'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'target_deleted';

export type SessionChunkStatusView = 'prepared' | 'running' | 'completed' | 'failed';

/** session 状态中性中文解释（展示用，无动作含义）。 */
export function sessionStatusLabel(status: string): string {
  switch (status) {
    case 'prepared':
      return '已准备（尚未导入内容）';
    case 'running':
      return '执行中（可继续下一课）';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败（可检查后重备）';
    case 'cancelled':
      return '已取消';
    case 'target_deleted':
      return '目标已删除（不可恢复）';
    default:
      return '未知状态';
  }
}

/** chunk 状态中性中文解释。 */
export function sessionChunkStatusLabel(status: string): string {
  switch (status) {
    case 'prepared':
      return '待执行';
    case 'running':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '未知状态';
  }
}

export interface SessionChunkView {
  ordinal: number;
  lessonIndex: number;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
  status: SessionChunkStatusView;
  attempts: number;
}

export interface SessionNextView {
  ordinal: number;
  lessonIndex: number;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
}

export interface SessionView {
  sessionId: string;
  status: SessionStatusView;
  documentId: string | null;
  totalChunks: number;
  completedChunks: number;
  chunks: SessionChunkView[];
  /** 服务端指定的 next executable，无则 null（终态/全完成）。 */
  next: SessionNextView | null;
}

export type SessionPrepareDecision = { ok: true } | { ok: false; message: string };

/**
 * prepare 守门（纯函数）：preview 全部可执行才允许。
 * ok:false 即不得显示准备按钮 / 不得发请求（后端仍是最终事实源）。
 */
export function decideSessionPrepare(
  preview: PreviewResponseData | null,
  previewValid: boolean
): SessionPrepareDecision {
  if (!preview || !previewValid) {
    return { ok: false, message: '请先得到有效的分段预览' };
  }
  if (!preview.fingerprint) {
    return { ok: false, message: '预览指纹缺失，请重新请求分段预览' };
  }
  if (preview.diagnostics.unresolvedCount !== 0) {
    return { ok: false, message: '当前目录不能自动导入；请补充或修正 anchor' };
  }
  if (preview.diagnostics.lessonsWithoutEnd !== 0) {
    return { ok: false, message: '存在没有终点的课，不能准备导入' };
  }
  if (preview.lessons.length === 0 || preview.chunks.length === 0) {
    return { ok: false, message: '没有可导入的课与分段' };
  }
  for (const lesson of preview.lessons) {
    if (lesson.status !== 'mapped' || lesson.physicalStart === null || lesson.physicalEnd === null) {
      return { ok: false, message: `“${lesson.title}”尚未映射到确定范围` };
    }
  }
  for (const chunk of preview.chunks) {
    const pages = chunk.physicalTo - chunk.physicalFrom + 1;
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > SESSION_CHUNK_MAX_PAGES) {
      return { ok: false, message: '存在超过单次上限的分段，不能准备导入' };
    }
  }
  return { ok: true };
}

export type ChunkExecuteDecision =
  | {
      ok: true;
      lesson: { lessonIndex: number; title: string; printedStart: number; physicalStart: number; physicalEnd: number };
      chunk: SessionNextView;
      via: 'execute-first' | 'execute-next';
    }
  | { ok: false; message: string };

/**
 * chunk 执行守门（纯函数）：只认服务端指定的 next，不自动、不跳过。
 * - 会话终态（failed/cancelled/target_deleted/completed）一律拒绝并给原因；
 * - running 缺 target 即数据异常，拒绝；
 * - lesson 非单完整 chunk / 超 30 即 blocker（long/multi 不动）。
 */
export function decideChunkExecute(
  view: SessionView | null,
  preview: PreviewResponseData | null,
  previewValid: boolean,
  ordinal: number
): ChunkExecuteDecision {
  if (!view) {
    return { ok: false, message: '请先准备导入会话' };
  }
  if (!view.next || view.next.ordinal !== ordinal) {
    return { ok: false, message: '只能执行服务端指定的下一个分段' };
  }
  if (view.status === 'target_deleted') {
    return { ok: false, message: '目标已删除，该会话不可恢复、不可执行' };
  }
  if (view.status === 'failed') {
    return { ok: false, message: '会话已失败，请检查后重新准备' };
  }
  if (view.status === 'cancelled') {
    return { ok: false, message: '会话已取消，不可执行' };
  }
  if (view.status === 'completed') {
    return { ok: false, message: '会话已完成，无可执行分段' };
  }
  if (view.status !== 'prepared' && view.status !== 'running') {
    return { ok: false, message: '会话当前不可执行' };
  }
  if (view.status === 'running' && !view.documentId) {
    return { ok: false, message: '会话缺目标文档（数据异常），不可执行' };
  }
  if (!preview || !previewValid || !preview.fingerprint) {
    return { ok: false, message: '请先得到有效的分段预览' };
  }
  const chunk = view.next;
  const lesson = preview.lessons.find((l) => l.lessonIndex === chunk.lessonIndex);
  if (!lesson || lesson.status !== 'mapped' || lesson.physicalStart === null || lesson.physicalEnd === null) {
    return { ok: false, message: '该课尚未映射到确定范围' };
  }
  const lessonChunks = preview.chunks.filter((c) => c.lessonIndex === lesson.lessonIndex);
  const only = lessonChunks[0];
  if (
    lessonChunks.length !== 1 ||
    !only ||
    only.physicalFrom !== lesson.physicalStart ||
    only.physicalTo !== lesson.physicalEnd ||
    only.physicalFrom !== chunk.range.fromPage ||
    only.physicalTo !== chunk.range.toPage
  ) {
    return { ok: false, message: '该课不是一个完整 chunk，不能执行' };
  }
  const pages = lesson.physicalEnd - lesson.physicalStart + 1;
  if (pages < 1 || pages > SESSION_CHUNK_MAX_PAGES) {
    return { ok: false, message: `该课共 ${pages} 页（单次上限 ${SESSION_CHUNK_MAX_PAGES} 页），不能执行` };
  }
  return {
    ok: true,
    lesson: {
      lessonIndex: lesson.lessonIndex,
      title: lesson.title,
      printedStart: lesson.printedStart,
      physicalStart: lesson.physicalStart,
      physicalEnd: lesson.physicalEnd,
    },
    chunk,
    via: view.documentId ? 'execute-next' : 'execute-first',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SESSION_STATUSES = ['prepared', 'running', 'completed', 'failed', 'cancelled', 'target_deleted'];
const CHUNK_STATUSES = ['prepared', 'running', 'completed', 'failed'];

/** session status 端点负载收窄（纯函数；白名单字段外一律丢弃）。 */
export function narrowSessionView(payload: unknown): SessionView | null {
  if (!isRecord(payload)) return null;
  const { sessionId, status, documentId, totalChunks, completedChunks, chunks, next } = payload;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (typeof status !== 'string' || !SESSION_STATUSES.includes(status)) return null;
  if (documentId !== null && typeof documentId !== 'string') return null;
  if (typeof totalChunks !== 'number' || typeof completedChunks !== 'number') return null;
  if (!Array.isArray(chunks)) return null;
  const narrowedChunks: SessionChunkView[] = [];
  for (const item of chunks) {
    if (!isRecord(item)) return null;
    if (typeof item.ordinal !== 'number' || typeof item.lessonIndex !== 'number') return null;
    if (typeof item.lessonTitle !== 'string') return null;
    if (!isRecord(item.range) || typeof item.range.fromPage !== 'number' || typeof item.range.toPage !== 'number') {
      return null;
    }
    if (typeof item.status !== 'string' || !CHUNK_STATUSES.includes(item.status)) return null;
    if (typeof item.attempts !== 'number') return null;
    narrowedChunks.push({
      ordinal: item.ordinal,
      lessonIndex: item.lessonIndex,
      lessonTitle: item.lessonTitle,
      range: { fromPage: item.range.fromPage, toPage: item.range.toPage },
      status: item.status as SessionChunkStatusView,
      attempts: item.attempts,
    });
  }
  let narrowedNext: SessionNextView | null = null;
  if (next !== null && next !== undefined) {
    if (!isRecord(next)) return null;
    if (typeof next.ordinal !== 'number' || typeof next.lessonIndex !== 'number') return null;
    if (typeof next.lessonTitle !== 'string') return null;
    if (!isRecord(next.range) || typeof next.range.fromPage !== 'number' || typeof next.range.toPage !== 'number') {
      return null;
    }
    narrowedNext = {
      ordinal: next.ordinal,
      lessonIndex: next.lessonIndex,
      lessonTitle: next.lessonTitle,
      range: { fromPage: next.range.fromPage, toPage: next.range.toPage },
    };
  }
  return {
    sessionId,
    status: status as SessionStatusView,
    documentId,
    totalChunks,
    completedChunks,
    chunks: narrowedChunks,
    next: narrowedNext,
  };
}

export interface SessionPrepareResult {
  sessionId: string;
  status: string;
  reused: boolean;
}

/** prepare 端点负载收窄（纯函数；只要 session 标识与复用标志）。 */
export function narrowPrepareResult(payload: unknown): SessionPrepareResult | null {
  if (!isRecord(payload)) return null;
  const session = payload.session;
  if (!isRecord(session) || typeof session.id !== 'string' || !session.id) return null;
  if (typeof payload.reused !== 'boolean') return null;
  return {
    sessionId: session.id,
    status: typeof session.status === 'string' ? session.status : '',
    reused: payload.reused,
  };
}

export interface SessionExecuteResult {
  documentId: string;
  lessonId: string;
  lessonTitle: string;
  range: { fromPage: number; toPage: number };
}

/** execute 端点负载收窄（纯函数）。 */
export function narrowExecuteResult(payload: unknown): SessionExecuteResult | null {
  if (!isRecord(payload)) return null;
  const { documentId, lessonId, lessonTitle, range } = payload;
  if (typeof documentId !== 'string' || !documentId) return null;
  if (typeof lessonId !== 'string' || !lessonId) return null;
  if (typeof lessonTitle !== 'string' || !lessonTitle) return null;
  if (!isRecord(range) || typeof range.fromPage !== 'number' || typeof range.toPage !== 'number') return null;
  return { documentId, lessonId, lessonTitle, range: { fromPage: range.fromPage, toPage: range.toPage } };
}
