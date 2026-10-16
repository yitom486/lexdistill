import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-semibold tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-tone-amber-600 text-tone-white shadow-xs hover:bg-tone-amber-700',
        secondary:
          'border-transparent bg-line-stone-100-stone-800 text-ink hover:bg-ink-stone-200',
        destructive:
          'border-transparent bg-tone-rose-500 text-tone-white shadow-xs hover:bg-ink-rose-600',
        outline:
          'text-ink border-line-soft',
        amber:
          'border-line-amber-500o30 bg-wash-amber-500o15 text-ink-amber-900-amber-300 font-bold',
        gold:
          'border-gold-warm/25 bg-gold-warm/10 text-ink-amber-900-amber-300 font-semibold',
        emerald:
          'border-line-emerald-500o30 bg-tone-emerald-500o15 text-ink-emerald-900 dark:text-ink-emerald-300 font-bold',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
