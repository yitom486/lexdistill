import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMigratedStorage } from './store-storage.js';
import { DEFAULT_TEXTBOOK_PIPELINE_SETTINGS, TextbookPipelineSettingsSchema, type TextbookPipelineSettings } from '@lexdistill/document-model';

/**
 * 单一语种的聊天作用域。
 *
 * 一个「会话」的身份 = 语言 + 运行时 + 会话 id：切换语言或运行时都必须换一套状态，
 * 否则上一语言的消息/队列/审批会串到下一语言里。
 */
export interface CoachScope {
  /** 该语言上次使用的运行时；空=跟随全局 agentRuntimeId */
  runtimeId: string;
  /** 该语言当前会话 id；空=未开始 */
  threadId: string;
  modelId: string;
  effort: string;
  approvalPolicy: string;
  collaborationMode: string;
  persistThread: boolean;
}

export function defaultCoachScope(fallback: {
  runtimeId: string;
  threadId: string;
  modelId: string;
  effort: string;
  approvalPolicy: string;
  collaborationMode: string;
  persistThread: boolean;
}): CoachScope {
  return { ...fallback };
}

/** 读取某语言的聊天作用域；未建过就沿用旧版全局字段（升级兼容），不会凭空串语言。 */
export function coachScopeOf(
  state: Pick<
    PreferencesState,
    | 'coachScopes'
    | 'agentRuntimeId'
    | 'coachThreadId'
    | 'coachModelId'
    | 'coachEffort'
    | 'coachApprovalPolicy'
    | 'coachCollaborationMode'
    | 'coachPersistThread'
  >,
  language: string
): CoachScope {
  const scoped = state.coachScopes[language];
  if (scoped) return scoped;
  return defaultCoachScope({
    runtimeId: state.agentRuntimeId,
    threadId: state.coachThreadId,
    modelId: state.coachModelId,
    effort: state.coachEffort,
    approvalPolicy: state.coachApprovalPolicy,
    collaborationMode: state.coachCollaborationMode,
    persistThread: state.coachPersistThread,
  });
}

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
  /** Study Coach 选用的 Agent 模型 id；空=运行时默认 */
  coachModelId: string;
  /** Agent 运行时 id（codex-acp 默认；与 acp-client 内置运行时对齐） */
  agentRuntimeId: string;
  /** 按运行时记忆的模型/思考深度（id 不跨运行时通用，切换时存取，互不串味） */
  runtimeModels: Record<string, string>;
  runtimeEfforts: Record<string, string>;
  /** 思考等级（turn/start.effort） */
  coachEffort: string;
  /** 审批策略：never | on-request | untrusted */
  coachApprovalPolicy: string;
  /** 恢复的 Agent 会话 id；空=新建 */
  coachThreadId: string;
  /** 按语言隔离的聊天作用域：每种语言各有运行时、会话、模型与审批 */
  coachScopes: Record<string, CoachScope>;
  setCoachScope: (language: string, patch: Partial<CoachScope>) => void;
  /** 首次进入某语言时，把旧版全局字段固化成该语言的作用域（幂等） */
  ensureCoachScope: (language: string) => void;
  /** 学习闭环（题目导师 / 出题批改）Agent 会话；与聊天隔离 */
  learningThreadId: string;
  /** false=ephemeral 临时；true=落盘持久化 */
  coachPersistThread: boolean;
  /** collaborationMode：default | plan | 服务端返回的 name */
  coachCollaborationMode: string;
  /** 复习页卡片模板 id（默认 study-basic；持久化偏好） */
  reviewCardFormatId: string;
  /** 界面音效开关（click/success 等短音；关闭时不发声，不影响学习朗读/录音） */
  soundEffectsEnabled: boolean;
  /** 目录识别专属 Agent 运行时；空=跟随全局 agentRuntimeId */
  tocReviewRuntimeId: string;
  /** 目录 AI 审核模型 id；空=使用默认（环境变量 > 适配器默认） */
  tocReviewModel: string;
  /** 目录 AI 审核思考等级；空=使用默认 */
  tocReviewEffort: string;
  /** 教材正文提炼专属 Agent 运行时；空=跟随全局 agentRuntimeId */
  pipelineRuntimeId: string;
  /** 教材正文提炼专职模型 id；空=使用运行时默认配置 */
  pipelineModel: string;
  pipelineEffort: string;
  /** 教材提炼 Worker 并发度；默认 '3' */
  pipelinePoolSize: string;
  pipelineSettings: TextbookPipelineSettings;
  pipelineLanguage: 'ja' | 'en' | 'ko';
  setPipelineSettings: (settings: Partial<TextbookPipelineSettings>) => void;
  setPipelineLanguage: (language: 'ja' | 'en' | 'ko') => void;

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
  setAgentRuntimeId: (runtimeId: string) => void;
  setRuntimeModel: (runtimeId: string, modelId: string) => void;
  setRuntimeEffort: (runtimeId: string, effort: string) => void;
  setCoachEffort: (effort: string) => void;
  setCoachApprovalPolicy: (policy: string) => void;
  setCoachThreadId: (threadId: string) => void;
  setLearningThreadId: (threadId: string) => void;
  setCoachPersistThread: (persist: boolean) => void;
  setCoachCollaborationMode: (mode: string) => void;
  setReviewCardFormatId: (formatId: string) => void;
  setSoundEffectsEnabled: (enabled: boolean) => void;
  setTocReviewRuntimeId: (runtimeId: string) => void;
  setTocReviewModel: (model: string) => void;
  setTocReviewEffort: (effort: string) => void;
  setPipelineRuntimeId: (runtimeId: string) => void;
  setPipelineModel: (model: string) => void;
  setPipelineEffort: (effort: string) => void;
  setPipelinePoolSize: (poolSize: string) => void;
}

/**
 * 浏览器支持 View Transitions 且用户未开启“减少动态效果”时才做交叉淡化。
 */
export function canAnimateThemeSwitch(
  doc: Document = typeof document !== 'undefined' ? document : ({} as Document),
  win: Window = typeof window !== 'undefined' ? window : ({} as Window)
): boolean {
  type ViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  if (typeof (doc as ViewTransitionDocument).startViewTransition !== 'function') {
    return false;
  }
  try {
    return !win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export const applyThemeToDom = (theme: 'light' | 'dark') => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.colorScheme = theme;
    root.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }
};

/**
 * 应用主题视觉过渡（双层帧同步防撕裂机制）：
 * 1. 根节点添加 .theme-transitioning，强行切断所有 DOM 元素私有的局部 transition，
 *    避免与全局交叉淡化叠加导致局部不同步、脏斑与撕裂；
 * 2. 在支持 View Transitions 且用户未开启“减少动态效果”时，由浏览器底层捕获新旧双帧
 *    快照并执行平滑的整页交叉淡化；
 * 3. 待新样式在 GPU 显存完全渲染稳定后，通过双重 requestAnimationFrame 安全移除
 *    .theme-transitioning 类，无缝恢复日常交互过渡。
 */
export const runThemeTransition = (update: () => void) => {
  if (typeof document === 'undefined') {
    update();
    return;
  }

  const root = document.documentElement;
  root.classList.add('theme-transitioning');

  const cleanup = () => {
    // 双重 requestAnimationFrame：等新样式在 GPU 显存完全渲染稳定后再移除，避免恢复瞬间重新触发 transition
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          root.classList.remove('theme-transitioning');
        });
      });
    } else {
      root.classList.remove('theme-transitioning');
    }
  };

  let updateCalled = false;
  const wrappedUpdate = () => {
    updateCalled = true;
    update();
  };

  if (canAnimateThemeSwitch()) {
    try {
      type ViewTransition = {
        finished: Promise<unknown>;
      };
      type ViewTransitionDocument = Document & {
        startViewTransition?: (callback: () => void) => ViewTransition;
      };
      const vt = (document as ViewTransitionDocument).startViewTransition?.(wrappedUpdate);
      if (vt && typeof vt.finished?.finally === 'function') {
        vt.finished.finally(cleanup);
        return;
      }
    } catch {
      // 异常时安全回退到瞬时更新
    }
  }

  if (!updateCalled) {
    wrappedUpdate();
  }
  cleanup();
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
      agentRuntimeId: 'codex-acp',
      runtimeModels: {},
      runtimeEfforts: {},
      coachEffort: 'medium',
      coachApprovalPolicy: 'never',
      coachThreadId: '',
      coachScopes: {},
      learningThreadId: '',
      coachPersistThread: true,
      coachCollaborationMode: '',
      reviewCardFormatId: 'study-basic',
      soundEffectsEnabled: true,
      tocReviewRuntimeId: '',
      tocReviewModel: '',
      tocReviewEffort: '',
      pipelineRuntimeId: '',
      pipelineModel: '',
      pipelineEffort: '',
      pipelinePoolSize: String(DEFAULT_TEXTBOOK_PIPELINE_SETTINGS.poolSize),
      pipelineSettings: DEFAULT_TEXTBOOK_PIPELINE_SETTINGS,
      pipelineLanguage: 'ja',

      setTheme: (theme: 'light' | 'dark') => {
        if (get().theme === theme) return;
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
      setAgentRuntimeId: (agentRuntimeId: string) => set({ agentRuntimeId }),
      setRuntimeModel: (runtimeId: string, modelId: string) => set((state) => ({
        runtimeModels: { ...state.runtimeModels, [runtimeId]: modelId },
      })),
      setRuntimeEffort: (runtimeId: string, effort: string) => set((state) => ({
        runtimeEfforts: { ...state.runtimeEfforts, [runtimeId]: effort },
      })),
      setCoachEffort: (coachEffort: string) => set({ coachEffort }),
      setCoachApprovalPolicy: (coachApprovalPolicy: string) => set({ coachApprovalPolicy }),
      setCoachThreadId: (coachThreadId: string) => set({ coachThreadId }),
      setCoachScope: (language: string, patch: Partial<CoachScope>) =>
        set((state) => ({
          coachScopes: {
            ...state.coachScopes,
            [language]: { ...coachScopeOf(state, language), ...patch },
          },
        })),
      ensureCoachScope: (language: string) =>
        set((state) => {
          if (state.coachScopes[language]) return {};
          return {
            coachScopes: {
              ...state.coachScopes,
              [language]: coachScopeOf(state, language),
            },
          };
        }),
      setLearningThreadId: (learningThreadId: string) => set({ learningThreadId }),
      setCoachPersistThread: (coachPersistThread: boolean) => set({ coachPersistThread }),
      setCoachCollaborationMode: (coachCollaborationMode: string) =>
        set({ coachCollaborationMode }),
      setReviewCardFormatId: (reviewCardFormatId: string) => set({ reviewCardFormatId }),
      setSoundEffectsEnabled: (soundEffectsEnabled: boolean) => set({ soundEffectsEnabled }),
      setTocReviewRuntimeId: (tocReviewRuntimeId: string) => set((state) => {
        const model = state.runtimeModels[tocReviewRuntimeId] ?? '';
        const effort = state.runtimeEfforts[tocReviewRuntimeId] ?? '';
        return { tocReviewRuntimeId, tocReviewModel: model, tocReviewEffort: effort };
      }),
      setTocReviewModel: (tocReviewModel: string) => set((state) => {
        const currentRuntime = state.tocReviewRuntimeId || state.agentRuntimeId || 'codex-acp';
        return {
          tocReviewModel,
          runtimeModels: { ...state.runtimeModels, [currentRuntime]: tocReviewModel },
        };
      }),
      setTocReviewEffort: (tocReviewEffort: string) => set((state) => {
        const currentRuntime = state.tocReviewRuntimeId || state.agentRuntimeId || 'codex-acp';
        return {
          tocReviewEffort,
          runtimeEfforts: { ...state.runtimeEfforts, [currentRuntime]: tocReviewEffort },
        };
      }),
      setPipelineRuntimeId: (pipelineRuntimeId: string) => set((state) => {
        const model = state.runtimeModels[pipelineRuntimeId] ?? '';
        const effort = state.runtimeEfforts[pipelineRuntimeId] ?? '';
        return { pipelineRuntimeId, pipelineModel: model, pipelineEffort: effort };
      }),
      setPipelineModel: (pipelineModel: string) => set((state) => {
        const currentRuntime = state.pipelineRuntimeId || state.agentRuntimeId || 'codex-acp';
        return {
          pipelineModel,
          runtimeModels: { ...state.runtimeModels, [currentRuntime]: pipelineModel },
        };
      }),
      setPipelineEffort: (pipelineEffort: string) => set((state) => {
        const currentRuntime = state.pipelineRuntimeId || state.agentRuntimeId || 'codex-acp';
        return {
          pipelineEffort,
          runtimeEfforts: { ...state.runtimeEfforts, [currentRuntime]: pipelineEffort },
        };
      }),
      setPipelinePoolSize: (pipelinePoolSize: string) => set({ pipelinePoolSize }),
      setPipelineSettings: (settings) => set((state) => ({ pipelineSettings: { ...state.pipelineSettings, ...settings } })),
      setPipelineLanguage: (pipelineLanguage) => set({ pipelineLanguage }),
    }),
    {
      name: 'lexdistill_user_preferences',
      storage: createMigratedStorage(['study_studio_user_preferences']),
      version: 3,
      migrate: (persisted) => {
        const stored = typeof persisted === 'object' && persisted !== null ? persisted : {};
        const settings = TextbookPipelineSettingsSchema.safeParse('pipelineSettings' in stored ? stored.pipelineSettings : {});
        // User-approved switch of the previous default; subsequent manual choices persist.
        const previous = settings.success ? settings.data : DEFAULT_TEXTBOOK_PIPELINE_SETTINGS;
        const previousPool = 'pipelinePoolSize' in stored ? String(stored.pipelinePoolSize) : '';
        return { ...stored,
          pipelinePoolSize: !previousPool || previousPool === '3' || previousPool === '4' ? '6' : previousPool,
          pipelineSettings: { ...previous, poolSize: previous.poolSize === 3 || previous.poolSize === 4 ? 6 : previous.poolSize },
        };
      },
      merge: (persisted, current) => {
        const stored = typeof persisted === 'object' && persisted !== null ? persisted : {};
        const parsed = TextbookPipelineSettingsSchema.safeParse('pipelineSettings' in stored ? stored.pipelineSettings : {});
        return { ...current, ...stored, pipelineSettings: parsed.success ? parsed.data : DEFAULT_TEXTBOOK_PIPELINE_SETTINGS };
      },
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyThemeToDom(state.theme);
        }
      },
    }
  )
);
