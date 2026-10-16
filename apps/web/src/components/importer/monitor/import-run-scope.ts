import type { ImportEvent } from '@lexdistill/document-model';

/** A file's persisted trace can contain several runs; never present them as one. */
export function selectImportRun(events: readonly ImportEvent[], jobId?: string): ImportEvent[] {
  if (jobId) return events.filter(event => event.jobId === jobId);
  const started = events.filter(event => event.category === 'task' && event.name === 'started').at(-1);
  if (!started) return [...events];
  return events.filter(event => event.sequence >= started.sequence && (!started.jobId || event.jobId === started.jobId));
}
