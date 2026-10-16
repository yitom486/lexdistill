import * as React from 'react';
import { Popover as BasePopover } from '@base-ui-components/react/popover';
import { cn } from '../../lib/utils.js';

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;
export const PopoverPortal = BasePopover.Portal;
export const PopoverClose = BasePopover.Close;

export const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BasePopover.Popup> & {
    sideOffset?: number;
    align?: 'start' | 'center' | 'end';
    anchor?: React.ComponentPropsWithoutRef<typeof BasePopover.Positioner>['anchor'];
  }
>(({ className, sideOffset = 6, align = 'center', anchor, children, ...props }, ref) => (
  <BasePopover.Portal>
    <BasePopover.Positioner {...(anchor !== undefined ? { anchor } : {})} sideOffset={sideOffset} align={align} className="z-50 outline-none">
      <BasePopover.Popup
        ref={ref}
        className={cn(
          'z-50 w-72 rounded-2xl border border-line-hairline bg-surface p-4 text-ink shadow-xl outline-none transition-all',
          className
        )}
        {...props}
      >
        {children}
      </BasePopover.Popup>
    </BasePopover.Positioner>
  </BasePopover.Portal>
));
PopoverContent.displayName = 'PopoverContent';
