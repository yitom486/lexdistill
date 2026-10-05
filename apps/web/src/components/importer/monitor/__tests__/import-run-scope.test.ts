import { describe, expect, it } from 'bun:test';
import { ImportEventSchema } from '@study-studio/document-model';
import { selectImportRun } from '../import-run-scope.js';

const event = (sequence: number, jobId: string | null, name: string) => ImportEventSchema.parse({
  sequence, userId: 'owner', traceId: 'reused-file-trace', jobId, name,
  category: name === 'started' ? 'task' : 'model', occurredAt: '2026-10-04T00:00:00Z',
  documentId: 'book', nodeId: null, sessionId: null, threadId: null, attemptId: null, callId: null,
});
describe('import monitor run isolation', () => {
  const records = [event(1, 'old', 'started'), event(2, 'old', 'input'), event(3, 'new', 'started'), event(4, 'old', 'input'), event(5, 'new', 'input')];
  it('uses only the active job, including when it has not recorded its first event yet', () => {
    expect(selectImportRun(records, 'new').map(item => item.sequence)).toEqual([3, 5]);
    expect(selectImportRun(records, 'next')).toEqual([]);
  });
  it('uses the newest task when opened without a job snapshot and excludes late old writes', () => {
    expect(selectImportRun(records).map(item => item.sequence)).toEqual([3, 5]);
    expect(selectImportRun([event(1, null, 'input')])).toHaveLength(1);
  });
});
