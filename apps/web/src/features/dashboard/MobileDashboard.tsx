import { Link } from 'react-router-dom';
import { ArrowRight, Bell, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { Brand } from '@/components/layout/Brand';
import { compactNumber, formatCurrency } from '@/lib/utils/format';
import { StatusBadge } from '@/components/common/StatusBadge';
import { seriesColor } from '@/components/charts/palette';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';
import type { DashboardData } from './types';

/**
 * A purpose-built phone layout — not the desktop grid scaled down. Big
 * available-funds card, a spend breakdown, and the two lists that matter.
 */
export function MobileDashboard({ data, isLoading }: { data?: DashboardData; isLoading: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const funds = data?.fundBalances ?? [];
  const availableFunds = funds.reduce((sum, fund) => sum + fund.balance, 0);
  const departments = data?.charts.departmentExpenses ?? [];
  const totalSpend = departments.reduce((sum, department) => sum + department.amount, 0);

  return (
    <div className="lg:hidden">
      {/* Brand + profile strip */}
      <header className="-mx-3 -mt-4 mb-4 bg-brand px-4 pb-16 pt-4 text-white">
        <div className="flex items-center justify-between">
          <Brand size="sm" showTagline={false} />
          <div className="flex items-center gap-2">
            <Link
              to="/approvals"
              className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/12"
              aria-label={t('nav.approvals')}
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {(data?.pendingActions.approvals ?? 0) > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9.5px] font-semibold">
                  {data?.pendingActions.approvals}
                </span>
              )}
            </Link>
            <Link to="/settings/profile" aria-label={t('dashboard.profile')}>
              <Avatar name={user?.name ?? '?'} src={user?.avatarUrl} />
            </Link>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[19px] font-semibold leading-tight">{t('dashboard.namaste', { name: user?.name.split(' ')[0] })}</p>
          <p className="mt-0.5 text-[12.5px] text-white/80">{t('dashboard.summary')}</p>
        </div>
      </header>

      {/* Available funds hero card, pulled up over the header */}
      <div className="-mt-[4.5rem] mb-3">
        <div className="rounded-card border border-line bg-white p-4 shadow-raised">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-brand-light">
              <Wallet className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
            </span>
            <p className="text-[12px] font-medium text-ink-muted">{t('dashboard.availableFunds')}</p>
          </div>
          {isLoading ? (
            <Skeleton className="mt-2.5 h-8 w-40" />
          ) : (
            <p className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-ink tnum">
              ₹{compactNumber(availableFunds)}
            </p>
          )}
          <p className="mt-1.5 text-[11.5px] text-ink-muted">
            {t('dashboard.acrossFunds', { count: funds.length })}
          </p>
        </div>
      </div>

      {/* Income / Expense / Net */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <MiniStat label={t('dashboard.income')} value={data?.stats.income} tone="success" icon={TrendingUp} loading={isLoading} />
        <MiniStat label={t('dashboard.expenses')} value={data?.stats.expenses} tone="accent" icon={TrendingDown} loading={isLoading} />
        <MiniStat label={t('dashboard.net')} value={data?.stats.netSurplus} tone="brand" icon={Wallet} loading={isLoading} />
      </div>

      {/* Where money was spent */}
      <section className="mb-4 rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-[14px] font-semibold text-ink">{t('dashboard.whereSpent')}</h2>
        {isLoading ? (
          <div className="mt-3 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9" />
            ))}
          </div>
        ) : departments.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-ink-muted">{t('dashboard.noSpending')}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {departments.map((department, index) => {
              const share = totalSpend > 0 ? (department.amount / totalSpend) * 100 : 0;
              return (
                <li key={department.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12.5px] font-medium text-ink">{department.name}</span>
                    <span className="shrink-0 text-[12.5px] font-semibold text-ink tnum">
                      {formatCurrency(department.amount)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(share, 2)}%`, backgroundColor: seriesColor(index) }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted tnum">{t('dashboard.shareOfSpend', { share: share.toFixed(1) })}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pending actions */}
      <section className="mb-4 grid grid-cols-3 gap-2">
        <PendingTile label={t('dashboard.drafts')} count={data?.pendingActions.expenses} to="/expenses?status=DRAFT" loading={isLoading} />
        <PendingTile label={t('dashboard.payments')} count={data?.pendingActions.payments} to="/expenses?status=APPROVED" loading={isLoading} />
        <PendingTile label={t('dashboard.approvals')} count={data?.pendingActions.approvals} to="/approvals" loading={isLoading} />
      </section>

      {/* Recent expenses */}
      <section className="rounded-card border border-line bg-white shadow-card">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold text-ink">{t('dashboard.recentExpenses')}</h2>
          <Link to="/expenses" className="flex items-center gap-1 text-[12px] font-medium text-brand-primary">
            {t('common.viewAll')}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </header>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : !data?.recentExpenses.length ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-ink-muted">{t('dashboard.noExpenses')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recentExpenses.map((expense) => (
              <li key={expense.id}>
                <Link to={`/expenses/${expense.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-canvas">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{expense.title}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                      {expense.expenseNumber} · {expense.department.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[13px] font-semibold text-ink tnum">{formatCurrency(expense.total)}</span>
                    <StatusBadge status={expense.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
  icon: Icon,
  loading,
}: {
  label: string;
  value?: number;
  tone: 'success' | 'accent' | 'brand';
  icon: typeof Wallet;
  loading: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-white p-3 shadow-card">
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-[7px]',
          tone === 'success' && 'bg-success/10 text-success',
          tone === 'accent' && 'bg-accent-light text-accent-ink',
          tone === 'brand' && 'bg-brand-light text-brand',
        )}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
      </span>
      <p className="mt-1.5 text-[11px] text-ink-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-5 w-14" />
      ) : (
        <p className="mt-0.5 text-[15px] font-semibold text-ink tnum">₹{compactNumber(value ?? 0)}</p>
      )}
    </div>
  );
}

function PendingTile({
  label,
  count,
  to,
  loading,
}: {
  label: string;
  count?: number;
  to: string;
  loading: boolean;
}) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center justify-center rounded-card border border-line bg-white p-3 text-center shadow-card active:bg-canvas"
    >
      {loading ? (
        <Skeleton className="h-6 w-8" />
      ) : (
        <span className={cn('text-[19px] font-semibold tnum', (count ?? 0) > 0 ? 'text-accent-ink' : 'text-ink')}>
          {count ?? 0}
        </span>
      )}
      <span className="mt-0.5 text-[11px] text-ink-muted">{label}</span>
    </Link>
  );
}
