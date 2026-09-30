import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PreferencesState {
  theme: 'light' | 'dark';
  furiganaEnabled: boolean;
  maskTextEnabled: boolean;
  sidebarCollapsed: boolean;
  /** 阅读双栏左侧（文章）宽度占比 0.28–0.72 */
  readingSplitRatio: number;
  /** 自由教练面板宽度（px），可拖拽 */
  coachPanelWidthPx: number;
  /** 自由教练面板是否打开（刷新后恢复显隐；关闭不清会话） */
  coachPanelOpen: boolean;
  /** 题目导师抽屉是否打开（关闭保留上下文快照） */
  tutorDrawerOpen: boolean;
  /** 题目导师上下文快照（刷新 / 关抽屉后可 resume） */
  tutorContextSnapshot: {
    questionText: string;
    userAnswer?: string;
    correctAnswer: string;
    skillTag: string;
    explanation: string;
  } | null;
  /** 题目导师抽屉宽度（px） */
  tutorPanelWidthPx: number;
  /** Study Coach 选用的 Codex 模型 id；空=本机默认 */
  coachModelId: string;
  /** 思考等级（turn/start.effort） */
  coachEffort: string;
  /** 审批策略：never | on-request | untrusted */
  coachApprovalPolicy: string;
  /** 恢复的 Codex thread id；空=新建 */
  coachThreadId: string;
  /** 学习闭环（题目导师 / 出题批改）Codex thread；与聊天隔离 */
  learningThreadId: string;
  /** false=ephemeral 临时；true=落盘持久化 */
  coachPersistThread: boolean;
  /** collaborationMode：default | plan | 服务端返回的 name */
  coachCollaborationMode: string;
  /** 复习页卡片模板 id（默认 study-basic；持久化偏好） */
  reviewCardFormatId: string;
  /** 目录 AI 审核模型 id；空=使用默认（环境变量 > 适配器默认） */
  tocReviewModel: string;
  /** 目录 AI 审核思考等级；空=使用默认 */
  tocReviewEffort: string;
  /** 教材正文提炼专职模型 id；空=使用本机 Codex 默认配置 */
  pipelineModel: string;
  pipelineEffort: string;
  /** 教材提炼 Worker 并发度；默认 '3' */
  pipelinePoolSize: string;

  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;
  setFuriganaEnabled: (enabled: boolean) => void;
  toggleFurigana: () => void;
  setMaskTextEnabled: (enabled: boolean) => void;
  toggleMaskText: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setReadingSplitRatio: (ratio: number) => void;
  setCoachPanelWidthPx: (widthPx: number) => void;
  setCoachPanelOpen: (open: boolean) => void;
  setTutorDrawerOpen: (open: boolean) => void;
  setTutorContextSnapshot: (
    ctx: PreferencesState['tutorContextSnapshot']
  ) => void;
  setTutorPanelWidthPx: (widthPx: number) => void;

  setCoachModelId: (modelId: string) => void;
  setCoachEffort: (effort: string) => void;
  setCoachApprovalPolicy: (policy: string) => void;
  setCoachThreadId: (threadId: string) => void;
  setLearningThreadId: (threadId: string) => void;
  setCoachPersistThread: (persist: boolean) => void;
  setCoachCollaborationMode: (mode: string) => void;
  setReviewCardFormatId: (formatId: string) => void;
  setTocReviewModel: (model: string) => void;
  setTocReviewEffort: (effort: string) => void;
  setPipelineModel: (model: string) => void;
  setPipelineEffort: (effort: string) => void;
  setPipelinePoolSize: (poolSize: string) => void;
}

const applyThemeToDom = (theme: 'light' | 'dark') => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
};

/**
 * Change the theme as one document-level visual transition when supported by
 * the browser/WebView. The callback remains synchronous for Zustand state
 * updates and falls back safely on older WebViews.
 */
const runThemeTransition = (update: () => void) => {
  if (typeof document === 'undefined') {
    update();
    return;
  }

  type ViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  const viewTransitionDocument = document as ViewTransitionDocument;
  if (typeof viewTransitionDocument.startViewTransition !== 'function') {
    update();
    return;
  }

  try {
    viewTransitionDocument.startViewTransition(update);
  } catch {
    update();
  }
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      furiganaEnabled: true,
      maskTextEnabled: false,
      sidebarCollapsed: false,
      readingSplitRatio: 0.58,
      coachPanelWidthPx: 420,
      coachPanelOpen: false,
      tutorDrawerOpen: false,
      tutorContextSnapshot: null,
      tutorPanelWidthPx: 448,
      coachModelId: '',
      coachEffort: 'medium',
      coachApprovalPolicy: 'never',
      coachThreadId: '',
      learningThreadId: '',
      coachPersistThread: true,
      coachCollaborationMode: '',
      reviewCardFormatId: 'study-basic',
      tocReviewModel: '',
      tocReviewEffort: '',
      pipelineModel: '',
      pipelineEffort: '',
      pipelinePoolSize: '3',

      setTheme: (theme: 'light' | 'dark') => {
        runThemeTransition(() => {
          applyThemeToDom(theme);
          set({ theme });
        });
      },

      toggleTheme: () => {
        const next = get().theme === 'light' ? 'dark' : 'light';
        runThemeTransition(() => {
          applyThemeToDom(next);
          set({ theme: next });
        });
      },

      setFuriganaEnabled: (enabled: boolean) => set({ furiganaEnabled: enabled }),
      toggleFurigana: () => set((state) => ({ furiganaEnabled: !state.furiganaEnabled })),

      setMaskTextEnabled: (enabled: boolean) => set({ maskTextEnabled: enabled }),
      toggleMaskText: () => set((state) => ({ maskTextEnabled: !state.maskTextEnabled })),

      setSidebarCollapsed: (collapsed: boolean) => set({ sidebarCollapsed: collapsed }),

      setReadingSplitRatio: (ratio: number) =>
        set({ readingSplitRatio: Math.min(0.72, Math.max(0.28, ratio)) }),

      setCoachPanelWidthPx: (widthPx: number) =>
        set({
          coachPanelWidthPx: Math.min(960, Math.max(320, Math.round(widthPx))),
        }),
      setCoachPanelOpen: (coachPanelOpen: boolean) => set({ coachPanelOpen }),
      setTutorDrawerOpen: (tutorDrawerOpen: boolean) => set({ tutorDrawerOpen }),
      setTutorContextSnapshot: (tutorContextSnapshot) => set({ tutorContextSnapshot }),
      setTutorPanelWidthPx: (widthPx: number) =>
        set({
          tutorPanelWidthPx: Math.min(960, Math.max(320, Math.round(widthPx))),
        }),

      setCoachModelId: (coachModelId: string) => set({ coachModelId }),
      setCoachEffort: (coachEffort: string) => set({ coachEffort }),
      setCoachApprovalPolicy: (coachApprovalPolicy: string) => set({ coachApprovalPolicy }),
      setCoachThreadId: (coachThreadId: string) => set({ coachThreadId }),
      setLearningThreadId: (learningThreadId: string) => set({ learningThreadId }),
      setCoachPersistThread: (coachPersistThread: boolean) => set({ coachPersistThread }),
      setCoachCollaborationMode: (coachCollaborationMode: string) =>
        set({ coachCollaborationMode }),
      setReviewCardFormatId: (reviewCardFormatId: string) => set({ reviewCardFormatId }),
      setTocReviewModel: (tocReviewModel: string) => set({ tocReviewModel }),
      setTocReviewEffort: (tocReviewEffort: string) => set({ tocReviewEffort }),
      setPipelineModel: (pipelineModel: string) => set({ pipelineModel }),
      setPipelineEffort: (pipelineEffort: string) => set({ pipelineEffort }),
      setPipelinePoolSize: (pipelinePoolSize: string) => set({ pipelinePoolSize }),
    }),
    {
      name: 'study_studio_user_preferences',
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyThemeToDom(state.theme);
        }
      },
    }
  )
);
