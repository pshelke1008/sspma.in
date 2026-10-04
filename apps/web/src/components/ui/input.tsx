import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-9 w-full rounded-control border bg-white px-3 py-1.5 text-[13px] text-ink transition-colors',
        'placeholder:text-ink-muted/70 disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-muted',
        'focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary',
        invalid ? 'border-danger focus:ring-danger/40 focus:border-danger' : 'border-line',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      'flex min-h-[72px] w-full rounded-control border bg-white px-3 py-2 text-[13px] text-ink transition-colors',
      'placeholder:text-ink-muted/70 disabled:cursor-not-allowed disabled:bg-canvas',
      'focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary',
      invalid ? 'border-danger focus:ring-danger/40' : 'border-line',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
