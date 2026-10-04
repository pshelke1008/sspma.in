import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RefreshCw, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: typeof Inbox;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light">
        <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-[14px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function NoResultsState({ onClear }: { onClear?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SearchX}
      title={t('states.noResultsTitle')}
      description={t('states.noResultsText')}
      action={
        onClear && (
          <Button variant="outline" size="sm" onClick={onClear}>
            {t('common.clearFilters')}
          </Button>
        )
      }
    />
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)} role="alert">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
        <AlertCircle className="h-5 w-5 text-danger" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-[14px] font-semibold text-ink">{title ?? t('states.errorTitle')}</h3>
      <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-ink-muted">
        {message ?? t('states.errorText')}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label={t('states.loadingData')}>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-3.5', columnIndex === 0 ? 'w-24' : columnIndex === 1 ? 'flex-1' : 'w-20')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)} aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-card border border-line bg-white p-4 shadow-card">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 240 }: { height?: number }) {
  return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}
