import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-gold-warm text-tone-stone-950 font-bold shadow-inner-hi-strong hover:shadow-[0_0_18px_0_var(--line-glow-hover)]',
        destructive:
          'bg-tone-rose-500 text-tone-white shadow-xs hover:bg-ink-rose-600',
        outline:
          'border border-line-hairline bg-transparent text-ink-faint-soft hover:text-ink hover:bg-surface-warm/60 shadow-inner-hi',
        secondary:
          'bg-tone-stone-200o80-stone-800 text-ink-soft hover:bg-line-stone-300o80-stone-700 shadow-inner-hi',
        ghost:
          'text-ink-faint-soft hover:text-ink hover:bg-surface-warm/60',
        link:
          'text-accent-ink-warm underline-offset-4 hover:underline',
        amber:
          'bg-wash-amber-500o15 border border-line-amber-500o30 text-ink-amber-900-amber-300 hover:bg-tone-amber-500o25',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-11 rounded-2xl px-6 text-sm',
        icon: 'h-9 w-9 rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
