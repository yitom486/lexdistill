import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils.js';
import { sound } from '../../utils/audio.js';
import type { NavigationTab } from '../../stores/useStudySessionStore.js';
import type { SidebarIconKey } from '../../config/sidebar-nav.js';
import { SIDEBAR_ICONS, type LucideIcon } from './sidebar-icons.js';
import { NavButton, type NavItem } from './NavButton.js';

export interface SidebarGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export interface ComingSoonItem {
  tab: NavigationTab;
  label: string;
  hint: string;
  icon: SidebarIconKey;
}

interface SidebarGroupsProps {
  groups: SidebarGroup[];
  collapsed: boolean;
  activeTab: NavigationTab;
  openGroups: Record<string, boolean>;
  comingSoon: ComingSoonItem[];
  trackName: string;
  onToggleGroup: (id: string) => void;
  onSelect: (tab: NavigationTab) => void;
}

/** 分组导航列表 + “即将推出”占位。纯展示：展开态与选择回调由容器注入。 */
export function SidebarGroups({
  groups,
  collapsed,
  activeTab,
  openGroups,
  comingSoon,
  trackName,
  onToggleGroup,
  onSelect,
}: SidebarGroupsProps) {
  return (
    <>
      {groups.map((group) => {
        const expanded = openGroups[group.id] !== false;
        return (
          <div key={group.id}>
            {!collapsed && (
              <button
                type="button"
                onClick={() => {
                  sound.playClick();
                  onToggleGroup(group.id);
                }}
                className="w-full flex items-center gap-1 px-2 py-1.5 font-mono text-[10px] tracking-wider uppercase text-ink-stone-400 font-semibold hover:text-ink cursor-pointer transition-colors"
              >
                {expanded ? (
                  <ChevronDown className="w-3 h-3 shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 shrink-0" />
                )}
                {group.label}
              </button>
            )}
            {(collapsed || expanded) && (
              <div className="space-y-0.5 mt-0.5">
                {group.items.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={activeTab === item.id}
                    collapsed={collapsed}
                    onSelect={() => onSelect(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {comingSoon.length > 0 && (
        <div>
          {!collapsed && (
            <div className="px-2 py-1.5 font-mono text-[10px] tracking-wider uppercase text-ink-stone-400 font-semibold">
              即将推出 · {trackName}
            </div>
          )}
          <div className="space-y-0.5 mt-0.5">
            {comingSoon.map((mod) => {
              const Icon: LucideIcon = SIDEBAR_ICONS[mod.icon];
              return (
                <button
                  key={mod.tab}
                  type="button"
                  title={mod.hint}
                  onClick={() => {
                    sound.playClick();
                    toast.message(mod.hint, {
                      description: `${trackName}轨道 interim · ${mod.label}`,
                    });
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg text-[11px] transition-colors cursor-pointer',
                    'text-ink-hint opacity-70',
                    'hover:bg-surface-coal/60 hover:opacity-100',
                    collapsed ? 'justify-center px-0 py-2' : 'px-2 py-1.5'
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="truncate flex-1 text-left">{mod.label}</span>
                      <span className="font-mono text-[9px] px-1 py-px rounded border border-line-hairline text-ink-faint-soft shrink-0">
                        即将
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
