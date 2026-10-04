import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatCurrency, formatNumber } from '@/lib/utils/format';
import { Skeleton } from '@/components/ui/misc';

export interface StatCardProps {
  label: string;
  value: number;
  /** Amounts by default; head-counts and other tallies use `number`. */
  format?: 'currency' | 'number';
  icon: LucideIcon;
  tone?: 'brand' | 'success' | 'accent' | 'danger' | 'info';
  hint?: string;
  trend?: { value: number; label: string };
  loading?: boolean;
  compact?: boolean;
  onClick?: () => void;
}

const TONES = {
  brand: { chip: 'bg-brand-light text-brand', accentBar: 'bg-brand-primary' },
  success: { chip: 'bg-success/10 text-success', accentBar: 'bg-success' },
  accent: { chip: 'bg-accent-light text-accent-ink', accentBar: 'bg-accent' },
  danger: { chip: 'bg-danger/10 text-danger', accentBar: 'bg-danger' },
  info: { chip: 'bg-info/10 text-info', accentBar: 'bg-info' },
};

export function StatCard({
  label,
  value,
  format = 'currency',
  icon: Icon,
  tone = 'brand',
  hint,
  trend,
  loading,
  compact,
  onClick,
}: StatCardProps) {
  const tones = TONES[tone];
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'group relative overflow-hidden rounded-card border border-line bg-white p-4 text-left shadow-card transition-shadow',
        onClick && 'cursor-pointer hover:shadow-raised focus-visible:ring-2 focus-visible:ring-brand-primary/50',
      )}
    >
      <span className={cn('absolute inset-x-0 top-0 h-0.5', tones.accentBar)} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-ink-muted">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-28" />
          ) : (
            <p className={cn('mt-1.5 font-semibold tracking-tight text-ink tnum', compact ? 'text-[19px]' : 'text-[22px]')}>
              {format === 'number' ? formatNumber(value) : formatCurrency(value, { compact })}
            </p>
          )}
          {hint && !loading && <p className="mt-1 truncate text-[11.5px] text-ink-muted">{hint}</p>}
          {trend && !loading && (
            <p
              className={cn(
                'mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium',
                trend.value >= 0 ? 'text-success' : 'text-danger',
              )}
            >
              {trend.value >= 0 ? (
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
              )}
              {Math.abs(trend.value).toFixed(1)}% {trend.label}
            </p>
          )}
        </div>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', tones.chip)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
      </div>
    </Wrapper>
  );
}
