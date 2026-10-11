import {
  Zap,
  Layers,
  BookOpen,
  Headphones,
  Mic,
  AlertTriangle,
  TrendingUp,
  Newspaper,
  PenLine,
  User,
  Flame,
  Sparkles,
  CalendarCheck,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import type { SidebarIconKey } from '../../config/sidebar-nav.js';

/** 侧栏图标注册表：SidebarIconKey → Lucide 组件，导航与“即将推出”共用 */
export const SIDEBAR_ICONS: Record<SidebarIconKey, LucideIcon> = {
  Zap,
  Layers,
  BookOpen,
  Headphones,
  Mic,
  AlertTriangle,
  TrendingUp,
  Newspaper,
  PenLine,
  User,
  Flame,
  Sparkles,
  CalendarCheck,
  ClipboardList,
};

export type { LucideIcon };
