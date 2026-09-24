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
        'group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-3xl',
        'bg-paper-soft border border-line-accent p-6 shadow-sm hover:shadow-md transition-all',
        className
      )}
    >
      {background && <div className="absolute inset-0 pointer-events-none">{background}</div>}
      <div className="pointer-events-none z-10 flex transform-gpu flex-col gap-1 transition-all duration-[var(--motion-card-hover-duration)]">
        {Icon && <Icon className="h-6 w-6 text-tone-amber-600 mb-1" />}
        <h3 className="text-lg font-bold font-serif text-ink">
          {name}
        </h3>
        {description && (
          <p className="max-w-lg text-xs text-ink-ghost">{description}</p>
        )}
      </div>
      <div className="z-10 mt-3">{children}</div>
    </div>
  );
};
