import * as React from 'react';
import { cn } from '../../lib/utils.js';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  indicatorClassName?: string;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, max = 100, indicatorClassName, ...props }, ref) => {
    const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cn(
          'relative h-1.5 w-full overflow-hidden rounded-full bg-tone-stone-200o80-stone-800',
          className
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full rounded-full bg-gold-warm transition-[width] duration-[var(--motion-progress-width-duration)] ease-out',
            indicatorClassName
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = 'Progress';

export { Progress };
