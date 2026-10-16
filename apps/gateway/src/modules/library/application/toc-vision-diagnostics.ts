import { generateId, logger } from '@lexdistill/shared';

export interface TocVisionTraceEvent {
  at: string;
  stage: string;
  details?: Record<string, string | number | boolean | number[]>;
}

export interface TocVisionTrace {
  id: string;
  userId: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed';
  events: TocVisionTraceEvent[];
}

const traces = new Map<string, TocVisionTrace>();
const MAX_TOC_TRACES = 20;

/** 仅保留短期元数据；不记录图片、PDF 路径、课文或模型正文。 */
export function beginTocVisionTrace(userId: string) {
  const trace: TocVisionTrace = {
    id: generateId('toc_vision'),
    userId,
    startedAt: new Date().toISOString(),
    status: 'running',
    events: [],
  };
  traces.set(trace.id, trace);
  if (traces.size > MAX_TOC_TRACES) traces.delete(traces.keys().next().value!);

  const record = (stage: string, details?: TocVisionTraceEvent['details']): void => {
    trace.events.push({ at: new Date().toISOString(), stage, ...(details ? { details } : {}) });
    logger.info('[toc-vision]', { traceId: trace.id, stage, ...(details ?? {}) });
  };
  const finish = (status: 'completed' | 'failed', details?: TocVisionTraceEvent['details']): void => {
    trace.status = status;
    record(status, details);
    if (status === 'failed') logger.warn('[toc-vision] failed', { traceId: trace.id, ...(details ?? {}) });
  };
  return { id: trace.id, record, finish };
}

export function listTocVisionTraces(userId: string): TocVisionTrace[] {
  return [...traces.values()]
    .filter((trace) => trace.userId === userId)
    .reverse()
    .map((trace) => ({ ...trace, events: trace.events.map((event) => ({ ...event })) }));
}
