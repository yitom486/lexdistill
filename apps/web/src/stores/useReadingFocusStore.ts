import { create } from 'zustand';

/**
 * 当前阅读焦点（P3-3；瞬态，不 persist）。
 * TextbookCurriculum 在打开某书某课时写入，卸载时清空；
 * AgentChatPanel 仅当本 store 非空时在 turn 快照里附 focus，其他页面保持 undefined。
 */
interface ReadingFocusState {
  documentId: string | null;
  lessonId: string | null;
  surface: string | null;
  setReadingFocus: (focus: { documentId: string; lessonId?: string; surface?: string }) => void;
  clearReadingFocus: () => void;
}

export const useReadingFocusStore = create<ReadingFocusState>((set) => ({
  documentId: null,
  lessonId: null,
  surface: null,
  setReadingFocus: (focus) =>
    set({
      documentId: focus.documentId,
      lessonId: focus.lessonId ?? null,
      surface: focus.surface ?? null,
    }),
  clearReadingFocus: () => set({ documentId: null, lessonId: null, surface: null }),
}));
