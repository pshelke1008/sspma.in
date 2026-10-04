import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  noPadding,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
}) {
  return (
    <section className={cn('rounded-card border border-line bg-white shadow-card', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-[14.5px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn(noPadding ? '' : 'p-4 sm:p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
