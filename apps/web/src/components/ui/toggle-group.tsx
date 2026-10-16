import type { ComponentProps } from 'react';
import { ToggleGroup as BaseToggleGroup } from '@base-ui-components/react/toggle-group';
import { Toggle as BaseToggle } from '@base-ui-components/react/toggle';
import { cn } from '../../lib/utils.js';

/** shadcn-style wrapper; Base UI owns selection, keyboard navigation and accessibility. */
export function ToggleGroup({ className, ...props }: ComponentProps<typeof BaseToggleGroup>) {
  return <BaseToggleGroup className={cn('flex gap-2', className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof BaseToggle>) {
  return <BaseToggle className={cn('inline-flex items-center gap-3 rounded-xl border border-line-soft bg-paper-soft px-4 py-3 text-sm text-ink transition-colors hover:bg-surface-warm data-[pressed]:border-line-accent data-[pressed]:bg-wash-amber-500o10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 cursor-pointer', className)} {...props} />;
}
