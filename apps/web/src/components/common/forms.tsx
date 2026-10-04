import { forwardRef, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a control with its label, hint and error message, and wires up the
 * aria-describedby relationship screen readers rely on.
 */
export function FormField({ label, htmlFor, required, error, hint, children, className }: FormFieldProps) {
  const { t } = useTranslation();
  const describedBy = [error ? `${htmlFor}-error` : null, hint && !error ? `${htmlFor}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      <div aria-describedby={describedBy || undefined}>{children}</div>
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-[11.5px] text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1 text-[11.5px] font-medium text-danger">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          {/* Client schemas use message keys; server messages pass through untouched. */}
          {t(error, { defaultValue: error })}
        </p>
      )}
    </div>
  );
}

export const DateInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      type="date"
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-9 w-full rounded-control border bg-white px-3 py-1.5 text-[13px] text-ink transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary',
        '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60',
        invalid ? 'border-danger' : 'border-line',
        className,
      )}
      {...props}
    />
  ),
);
DateInput.displayName = 'DateInput';

/** Numeric input tuned for money: right-aligned, tabular figures, no spinner. */
export const MoneyInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  ({ className, invalid, ...props }, ref) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-muted">₹</span>
      <input
        ref={ref}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        aria-invalid={invalid || undefined}
        className={cn(
          'flex h-9 w-full rounded-control border bg-white py-1.5 pl-6 pr-3 text-right text-[13px] text-ink tnum transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          invalid ? 'border-danger' : 'border-line',
          className,
        )}
        {...props}
      />
    </div>
  ),
);
MoneyInput.displayName = 'MoneyInput';

export interface Step {
  id: string;
  label: string;
  description?: string;
}

/**
 * Horizontal stepper for the expense wizard. Completed steps stay clickable so
 * a user can jump back without losing anything already entered.
 */
export function FormStepper({
  steps,
  current,
  onStepClick,
  furthest,
}: {
  steps: Step[];
  current: number;
  furthest: number;
  onStepClick?: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <ol className="flex items-center gap-1 overflow-x-auto no-scrollbar" aria-label={t('forms.progress')}>
      {steps.map((step, index) => {
        const isActive = index === current;
        const isDone = index < furthest;
        const clickable = onStepClick && index <= furthest;

        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onStepClick(index) : undefined}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-2 text-left transition-colors',
                clickable && !isActive && 'hover:bg-canvas',
                !clickable && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  isActive
                    ? 'bg-brand-primary text-white'
                    : isDone
                      ? 'bg-brand-light text-brand'
                      : 'bg-canvas text-ink-muted ring-1 ring-line',
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[12.5px] font-medium',
                    isActive ? 'text-ink' : isDone ? 'text-brand' : 'text-ink-muted',
                  )}
                >
                  {step.label}
                </span>
              </span>
            </button>
            {index < steps.length - 1 && (
              <span
                className={cn('hidden h-px w-4 shrink-0 sm:block', isDone ? 'bg-brand-primary/40' : 'bg-line')}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
