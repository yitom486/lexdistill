import * as React from 'react';
import { Select as BaseSelect } from '@base-ui-components/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const Select = BaseSelect.Root;
const SelectGroup = BaseSelect.Group;

const SelectValue = React.forwardRef<
  React.ComponentRef<typeof BaseSelect.Value>,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Value> & { placeholder?: string }
>(({ placeholder, children, ...props }, ref) => (
  <BaseSelect.Value ref={ref} {...props}>
    {(value) => (value ? (children || value) : placeholder || '')}
  </BaseSelect.Value>
));
SelectValue.displayName = 'SelectValue';

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof BaseSelect.Trigger>,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Trigger
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between rounded-xl border border-line-amber-900o20-amber-500o20 bg-surface-warm px-3 py-2 text-xs font-medium text-ink shadow-xs ring-offset-background placeholder:text-ink-stone-400 focus:outline-none focus:ring-1 focus:ring-tone-amber-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer transition-all hover:border-tone-amber-500o50',
      className
    )}
    {...props}
  >
    {children}
    <BaseSelect.Icon>
      <ChevronDown className="h-4 w-4 opacity-50 ml-1.5 shrink-0" />
    </BaseSelect.Icon>
  </BaseSelect.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Popup> & {
    /**
     * Base UI 默认 true：弹窗用“选中项盖住触发器”的对齐模式。
     * 该模式下 Positioner 被强制 position:fixed、且浮动锚点跟踪被关闭，
     * 弹窗位置只在打开瞬间算一次，之后祖先滚动/布局变化不再跟随，
     * 必然出现飘移脱钩。本组件默认 false，走标准 popper 锚定 + autoUpdate 跟随。
     */
    alignItemWithTrigger?: boolean;
  }
>(({ className, alignItemWithTrigger = false, children, ...props }, ref) => (
  <BaseSelect.Portal>
    <BaseSelect.Positioner
      sideOffset={6}
      alignItemWithTrigger={alignItemWithTrigger}
      className="z-50 outline-none"
    >
      <BaseSelect.Popup
        ref={ref}
        className={cn(
          'relative z-50 max-h-96 min-w-[10rem] overflow-hidden rounded-xl border border-line-amber-900o15-amber-500o20 bg-surface-paper-coal p-1 text-ink shadow-xl outline-none',
          className
        )}
        {...props}
      >
        <BaseSelect.List className="max-h-[22rem] overflow-y-auto overscroll-contain outline-none">
          {children}
        </BaseSelect.List>
      </BaseSelect.Popup>
    </BaseSelect.Positioner>
  </BaseSelect.Portal>
));
SelectContent.displayName = 'SelectContent';

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof BaseSelect.Item>,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Item>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-xs outline-none transition-colors',
      // Base UI 用 data-highlighted；避免 amber-950 在深色弹出层上糊成一团
      'data-[highlighted]:bg-tint-amber-100 data-[highlighted]:text-tone-stone-900',
      'dark:data-[highlighted]:bg-tone-stone-700 dark:data-[highlighted]:text-surface-stone-50',
      'focus:bg-tint-amber-100 focus:text-tone-stone-900',
      'dark:focus:bg-tone-stone-700 dark:focus:text-surface-stone-50',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <BaseSelect.ItemIndicator className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center text-accent-ink">
      <Check className="h-3.5 w-3.5" />
    </BaseSelect.ItemIndicator>
    <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
  </BaseSelect.Item>
));
SelectItem.displayName = 'SelectItem';

export {
  Select,
  SelectValue,
  SelectGroup,
  SelectTrigger,
  SelectContent,
  SelectItem,
};
