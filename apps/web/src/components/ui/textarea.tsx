import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/** Standard shadcn textarea: native form semantics, centralized theme styles. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('w-full resize-y rounded-xl border border-line-soft bg-surface-warm p-4 text-sm leading-7 outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', className)} {...props} />;
}
