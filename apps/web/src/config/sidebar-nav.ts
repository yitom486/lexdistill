/**
 * 侧栏导航静态配置（用户视角的单一入口，不再设“资料 AST”第二套树）。
 * 运行时 badge 由 AppSidebar 注入，勿在 TSX 内再写死菜单树。
 * 分组按新手学习流排序：今日 → 练习 → 记忆与课文 → 听说；进阶的听说默认收起。
 */
import type { NavigationTab } from '../stores/useStudySessionStore.js';
import type { TrackLanguage } from '../learning/learning-shell.js';

/** 角标：静态文案，或由运行时计数/进度填充 */
export type SidebarBadgeSpec =
  | { kind: 'static'; value: string }
  | { kind: 'quizProgress' }
  | { kind: 'cardCount' }
  | { kind: 'mistakeCount' }
  | { kind: 'planProgress' };

export type SidebarIconKey =
  | 'Zap'
  | 'Layers'
  | 'BookOpen'
  | 'Headphones'
  | 'Mic'
  | 'AlertTriangle'
  | 'TrendingUp'
  | 'Newspaper'
  | 'PenLine'
  | 'Newspaper'
  | 'User'
  | 'Flame'
  | 'Sparkles'
  | 'CalendarCheck'
  | 'ClipboardList';

export interface SidebarNavItemDef {
  id: NavigationTab;
  label: string;
  icon: SidebarIconKey;
  badge?: SidebarBadgeSpec | undefined;
  /** 限定可见轨道；缺省时全轨道通用 */
  tracks?: TrackLanguage[] | undefined;
}

export interface SidebarNavGroupDef {
  id: string;
  label: string;
  /** 默认是否展开 */
  defaultOpen: boolean;
  items: SidebarNavItemDef[];
}

/** 单一功能导航（今日 / 练习 / 记忆与课文 / 听说），不再设第二套树，同一 Tab 只出现一次 */
export const SIDEBAR_NAV_GROUPS: SidebarNavGroupDef[] = [
  {
    id: 'today',
    label: '今日',
    defaultOpen: true,
    items: [
      { id: 'TODAY', label: '今日学习', icon: 'CalendarCheck', badge: { kind: 'planProgress' } },
      { id: 'PRACTICE_PLAN', label: '练习计划', icon: 'ClipboardList', badge: { kind: 'static', value: '自定义' } },
      { id: 'RADAR', label: '我的学情', icon: 'TrendingUp', badge: { kind: 'static', value: '画像' } },
    ],
  },
  {
    id: 'practice',
    label: '练习',
    defaultOpen: true,
    items: [
      { id: 'QUIZ', label: '自适应做题', icon: 'Zap', badge: { kind: 'quizProgress' } },
      { id: 'GENERATION', label: 'AI 出题', icon: 'Sparkles', badge: { kind: 'static', value: 'AI' } },
      { id: 'READING', label: '阅读理解', icon: 'Newspaper', badge: { kind: 'static', value: '双栏' } },
      { id: 'WRITING', label: '写作翻译', icon: 'PenLine', badge: { kind: 'static', value: 'AI' } },
      {
        id: 'MISTAKES',
        label: '错题本',
        icon: 'AlertTriangle',
        badge: { kind: 'mistakeCount' },
      },
    ],
  },
  {
    id: 'memory',
    label: '记忆与课文',
    defaultOpen: true,
    items: [
      { id: 'KANA', label: '五十音工作室', icon: 'Sparkles', badge: { kind: 'static', value: '假名' }, tracks: ['ja'] },
      { id: 'HANGUL', label: '谚文工作室', icon: 'Sparkles', tracks: ['ko'] },
      { id: 'CARDS', label: '生词闪卡', icon: 'Layers', badge: { kind: 'cardCount' } },
      { id: 'TEXTBOOK', label: '教材精读', icon: 'BookOpen', badge: { kind: 'static', value: '课文' }, tracks: ['ja'] },
    ],
  },
  {
    id: 'listen',
    label: '听力',
    defaultOpen: false,
    items: [
      { id: 'SHADOWING', label: '精听与听写', icon: 'Headphones' },
      { id: 'PITCH', label: '声调纠音', icon: 'Mic', badge: { kind: 'static', value: 'AI' }, tracks: ['ja'] },
    ],
  },
];

export interface SidebarRuntimeCounts {
  quizProgress?: string | undefined;
  cardCount?: number | undefined;
  unresolvedMistakeCount?: number | undefined;
  planProgress?: string | undefined;
}

export function resolveSidebarBadge(
  spec: SidebarBadgeSpec | undefined,
  runtime: SidebarRuntimeCounts
): string | undefined {
  if (!spec) return undefined;
  switch (spec.kind) {
    case 'static':
      return spec.value;
    case 'quizProgress':
      return runtime.quizProgress;
    case 'cardCount':
      return runtime.cardCount !== undefined ? String(runtime.cardCount) : undefined;
    case 'mistakeCount':
      return runtime.unresolvedMistakeCount !== undefined
        ? String(runtime.unresolvedMistakeCount)
        : undefined;
    case 'planProgress':
      return runtime.planProgress;
    default:
      return undefined;
  }
}

/** 由配置生成折叠区初始 open map */
export function buildSidebarOpenState(): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const g of SIDEBAR_NAV_GROUPS) {
    state[g.id] = g.defaultOpen;
  }
  return state;
}
