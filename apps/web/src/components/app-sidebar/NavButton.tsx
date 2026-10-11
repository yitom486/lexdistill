import { cn } from '../../lib/utils.js';
import { sound } from '../../utils/audio.js';
import type { NavigationTab } from '../../stores/useStudySessionStore.js';
import type { LucideIcon } from './sidebar-icons.js';

export interface NavItem {
  id: NavigationTab;
  label: string;
  icon: LucideIcon;
  badge?: string | undefined;
}

interface NavButtonProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}

/**
 * Linear-caliber 导航项。
 * 激活态：surface-card 底 + 左侧 2px 古籍金微柱；未激活态：中灰文字，hover 才浮现表面。
 * 角标只承载动态业务计数，无计数时右侧完全留白。
 */
export function NavButton({ item, active, collapsed, onSelect }: NavButtonProps) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      title={item.label}
      onClick={() => {
        sound.playClick();
        onSelect();
      }}
      className={cn(
        'relative w-full flex items-center gap-2.5 rounded-xl text-left text-xs font-medium transition-all duration-150 cursor-pointer select-none active:scale-[0.98]',
        collapsed ? 'justify-center px-2 py-2.5' : 'px-2.5 py-2',
        active
          ? 'surface-card text-ink font-semibold'
          : 'text-ink-faint-soft hover:text-ink hover:bg-surface-coal/60 border border-transparent'
      )}
    >
      {active && !collapsed && (
        <span
          aria-hidden
          className="absolute left-1.5 w-0.5 h-4.5 rounded-full bg-gold-warm"
        />
      )}
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate flex-1">{item.label}</span>
          {item.badge && (
            <span className="font-mono text-[10px] px-1.5 py-px rounded-full bg-line-stone-100-stone-800 text-ink-faint-soft border border-line-hairline pointer-events-none shrink-0">
              {item.badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}
