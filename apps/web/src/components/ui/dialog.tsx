import * as React from 'react';
import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogPortal = BaseDialog.Portal;
export const DialogClose = BaseDialog.Close;

export const DialogOverlay = React.forwardRef<
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
DialogOverlay.displayName = 'DialogOverlay';

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof BaseDialog.Popup> {
  showCloseButton?: boolean;
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, showCloseButton = true, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <BaseDialog.Popup
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[calc(50%+1.75rem)] sm:top-[calc(50%+1.875rem)] z-50 grid w-full max-w-lg max-h-[calc(100dvh-4.5rem)] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 surface-modal text-ink p-6 rounded-3xl outline-none shadow-2xl',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <BaseDialog.Close className="absolute right-4 top-4 rounded-xl p-1 text-ink-faint-soft hover:text-ink hover:bg-surface-warm/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring cursor-pointer">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </DialogPortal>
  )
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

export const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Title>
>(({ className, ...props }, ref) => (
  <BaseDialog.Title
    ref={ref}
    className={cn(
      'text-lg font-bold font-serif leading-none tracking-tight text-ink',
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof BaseDialog.Description>
>(({ className, ...props }, ref) => (
  <BaseDialog.Description
    ref={ref}
    className={cn('text-xs text-ink-ghost', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

export const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';
