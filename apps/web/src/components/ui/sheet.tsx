import * as React from 'react';
import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export const Sheet = BaseDialog.Root;
export const SheetTrigger = BaseDialog.Trigger;
export const SheetPortal = BaseDialog.Portal;
export const SheetClose = BaseDialog.Close;

export const SheetOverlay = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>
>(({ className, children, ...props }, ref) => (
  <BaseDialog.Backdrop
    ref={ref}
    className={cn(
      'fixed inset-x-0 bottom-0 top-14 sm:top-15 z-50 bg-veil-blacko30 backdrop-blur-sm transition-opacity',
      className
    )}
    {...props}
  >
    {children}
  </BaseDialog.Backdrop>
));
SheetOverlay.displayName = 'SheetOverlay';

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof BaseDialog.Popup> {
  side?: 'right' | 'left';
  showClose?: boolean;
}

export const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, side = 'right', showClose = true, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <BaseDialog.Popup
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col border border-line-hairline bg-surface-hfaf9f6 shadow-2xl outline-none transition-colors dark:border-line-hairline dark:bg-surface-h1a1816 top-14 sm:top-15 bottom-0 h-[calc(100dvh-3.5rem)] sm:h-[calc(100dvh-3.75rem)] w-full max-w-lg',
          side === 'right' && 'right-0 border-l',
          side === 'left' && 'left-0 border-r',
          className
        )}
        {...props}
      >
        {children}
        {showClose && (
          <BaseDialog.Close className="absolute right-4 top-4 rounded-xl p-1.5 text-ink-faint-soft transition-colors hover:bg-surface-warm/60 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring cursor-pointer">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </SheetPortal>
  )
);
SheetContent.displayName = 'SheetContent';

export const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 border-b border-line-hairline p-4 transition-colors',
      className
    )}
    {...props}
  />
);
SheetHeader.displayName = 'SheetHeader';

export const SheetTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Title>
>(({ className, ...props }, ref) => (
  <BaseDialog.Title
    ref={ref}
    className={cn(
      'text-base font-bold font-serif leading-none tracking-tight text-ink',
      className
    )}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Description>
>(({ className, ...props }, ref) => (
  <BaseDialog.Description
    ref={ref}
    className={cn('text-xs text-ink-ghost', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';
