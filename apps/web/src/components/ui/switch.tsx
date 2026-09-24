import * as React from 'react';
import { Switch as BaseSwitch } from '@base-ui-components/react/switch';
import { cn } from '../../lib/utils.js';

export const Switch = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>
>(({ className, ...props }, ref) => (
  <BaseSwitch.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-[1.125rem] w-8 shrink-0 items-center rounded-full border border-transparent transition-colors cursor-pointer',
      'data-[checked]:bg-tone-amber-500 data-[checked]:border-line-amber-600o40',
      'data-[unchecked]:bg-tone-stone-300 dark:data-[unchecked]:bg-tone-stone-700',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-halo-amber-500o60',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    <BaseSwitch.Thumb className="pointer-events-none block h-3.5 w-3.5 rounded-full bg-tone-white shadow-sm transition-transform ease-out data-[checked]:translate-x-[15px] data-[unchecked]:translate-x-[2px]" />
  </BaseSwitch.Root>
));
Switch.displayName = 'Switch';
