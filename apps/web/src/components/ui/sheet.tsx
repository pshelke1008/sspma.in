import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import i18n from '@/i18n';
import { cn } from '@/lib/utils/cn';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Drawers slide in from the right on desktop; on mobile contextual actions use
 * the `bottom` side so they behave like a native bottom sheet.
 */
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'right' | 'left' | 'bottom';
    width?: string;
  }
>(({ className, children, side = 'right', width = 'sm:max-w-md', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 flex flex-col bg-white shadow-pop',
        side === 'right' && `inset-y-0 right-0 w-full ${width} border-l border-line data-[state=open]:animate-slide-in-right`,
        side === 'left' && `inset-y-0 left-0 w-full ${width} border-r border-line`,
        side === 'bottom' &&
          'inset-x-0 bottom-0 max-h-[88vh] rounded-t-2xl border-t border-line data-[state=open]:animate-slide-up',
        className,
      )}
      {...props}
    >
      {side === 'bottom' && (
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line" aria-hidden="true" />
      )}
      {children}
      <DialogPrimitive.Close
        className="absolute right-3 top-3 rounded-md p-1 text-ink-muted transition-colors hover:bg-canvas hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
        aria-label={i18n.t('common.close')}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 space-y-1 border-b border-line px-5 py-4 pr-12', className)} {...props} />;
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 overflow-y-auto px-5 py-4', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('shrink-0 flex gap-2 border-t border-line px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]', className)}
      {...props}
    />
  );
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
