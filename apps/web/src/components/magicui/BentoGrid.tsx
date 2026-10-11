import React, { ReactNode } from 'react';
import { cn } from '../../lib/utils.js';

export const BentoGrid = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        'grid w-full auto-rows-[20rem] grid-cols-1 md:grid-cols-3 gap-4',
        className
      )}
    >
      {children}
    </div>
  );
};

export const BentoCard = ({
  name,
  className,
  background,
  Icon,
  description,
  children,
}: {
  name: string;
  className?: string;
  background?: ReactNode;
  Icon?: React.ComponentType<{ className?: string }>;
  description?: string;
  children?: ReactNode;
}) => {
  return (
    <div
      className={cn(
        'group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-2xl',
        'surface-card border border-line-hairline shadow-inner-hi p-6 hover:shadow-md transition-all',
        className
      )}
    >
      {background && <div className="absolute inset-0 pointer-events-none">{background}</div>}
      <div className="pointer-events-none z-10 flex transform-gpu flex-col gap-1 transition-all duration-[var(--motion-card-hover-duration)]">
        {Icon && <Icon className="h-5 w-5 text-gold-warm mb-1.5" />}
        <h3 className="text-base font-semibold font-serif text-ink tracking-tight">
          {name}
        </h3>
        {description && (
          <p className="max-w-lg text-xs text-ink-faint leading-relaxed">{description}</p>
        )}
      </div>
      <div className="z-10 mt-3">{children}</div>
    </div>
  );
};

