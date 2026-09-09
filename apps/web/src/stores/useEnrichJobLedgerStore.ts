import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 整本 enrich 任务 ID 台账（文档 → jobId）。
 * 任务跑在网关进程，刷新/重进页面后凭此续看进度；任务终态后清掉。
 */
interface EnrichJobLedgerState {
  jobByDocument: Record<string, string>;
  track: (documentId: string, jobId: string) => void;
  untrack: (documentId: string) => void;
}

export const useEnrichJobLedgerStore = create<EnrichJobLedgerState>()(
  persist(
    (set) => ({
      jobByDocument: {},
      track: (documentId, jobId) =>
        set((s) => ({ jobByDocument: { ...s.jobByDocument, [documentId]: jobId } })),
      untrack: (documentId) =>
        set((s) => {
          if (!(documentId in s.jobByDocument)) return s;
          const next = { ...s.jobByDocument };
          delete next[documentId];
          return { jobByDocument: next };
        }),
    }),
    { name: 'study_studio_enrich_jobs' }
  )
);
