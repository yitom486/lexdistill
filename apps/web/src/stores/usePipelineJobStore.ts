import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TextbookPipelineJobSnapshot } from '@study-studio/protocol';

export interface PipelineJobState {
  /** 当前选定或正在跟踪的任务 ID */
  activeJobId: string | null;
  /** 当前任务最新实时内存快照（由 SSE 持续推送或初次响应提供） */
  activeJob: TextbookPipelineJobSnapshot | null;
  /** 全局悬浮组件是否处于极简小球态（true=小悬浮球，false=展开进度胶囊） */
  isWidgetMinimized: boolean;
  /** 全局教材导入模态框显隐 */
  isImporterModalOpen: boolean;

  setActiveJobId: (jobId: string | null) => void;
  setActiveJob: (job: TextbookPipelineJobSnapshot | null) => void;
  setIsWidgetMinimized: (minimized: boolean) => void;
  toggleWidgetMinimized: () => void;
  setIsImporterModalOpen: (open: boolean) => void;
  clearActiveJob: () => void;
}

export const usePipelineJobStore = create<PipelineJobState>()(
  persist(
    (set, get) => ({
      activeJobId: null,
      activeJob: null,
      isWidgetMinimized: false,
      isImporterModalOpen: false,

      setActiveJobId: (activeJobId: string | null) => set({ activeJobId }),
      setActiveJob: (activeJob: TextbookPipelineJobSnapshot | null) => {
        set((state) => ({
          activeJob,
          activeJobId: activeJob ? activeJob.jobId : state.activeJobId,
        }));
      },
      setIsWidgetMinimized: (isWidgetMinimized: boolean) => set({ isWidgetMinimized }),
      toggleWidgetMinimized: () =>
        set((state) => ({ isWidgetMinimized: !state.isWidgetMinimized })),
      setIsImporterModalOpen: (isImporterModalOpen: boolean) => set({ isImporterModalOpen }),
      clearActiveJob: () => set({ activeJobId: null, activeJob: null }),
    }),
    {
      name: 'study_studio_pipeline_job_state',
      // 仅持久化 jobId 与最小化偏好；具体内存快照在重连时由 SSE 或接口恢复
      partialize: (state) => ({
        activeJobId: state.activeJobId,
        isWidgetMinimized: state.isWidgetMinimized,
      }),
    }
  )
);
