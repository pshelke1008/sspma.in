import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, CreditCard, PiggyBank, Receipt, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { api, buildQuery } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { SectionCard } from '@/components/common/SectionCard';
import { CardGridSkeleton, ChartSkeleton, ErrorState } from '@/components/common/states';
import { StatusBadge } from '@/components/common/StatusBadge';
import { SimpleSelect } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { BarChart, DonutChart } from '@/components/charts';
import { currentFinancialYear, financialYearOptions, formatCurrency, formatDate, formatMonthKey, monthOptions } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { QuickActions } from './QuickActions';
import { MobileDashboard } from './MobileDashboard';
import type { DashboardData } from './types';
import { errorMessage } from '@/i18n/errors';

export default function DashboardPage() {
  const { t } = useTranslation();
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());
  const [month, setMonth] = useState('all');

  const params = useMemo(() => ({ financialYear, month }), [financialYear, month]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.dashboard(params),
    queryFn: () => api.get<DashboardData>('/dashboard' + buildQuery(params)),
  });

  if (error) {
    return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;
  }

  return (
    <>
      {/* Phone gets a purpose-built layout */}
      <MobileDashboard data={data} isLoading={isLoading} />

      {/* Tablet and desktop */}
      <div className="hidden lg:block">
        <PageHeader
          title={t('dashboard.title')}
          subtitle={t('dashboard.subtitle')}
          actions={
            <div className="flex items-center gap-2">
              <SimpleSelect
                value={financialYear}
                onValueChange={setFinancialYear}
                options={financialYearOptions().map((year) => ({ value: year, label: t('common.financialYearShort', { year }) }))}
                className="w-[140px]"
                ariaLabel={t('dashboard.financialYear')}
              />
              <SimpleSelect
                value={month}
                onValueChange={setMonth}
                options={monthOptions()}
                className="w-[140px]"
                ariaLabel={t('common.month')}
              />
            </div>
          }
        />

        {isLoading ? (
          <CardGridSkeleton />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('dashboard.totalBalance')} value={data?.stats.totalBalance ?? 0} icon={Wallet} tone="brand" hint={t('dashboard.totalBalanceHint')} />
            <StatCard label={t('dashboard.income')} value={data?.stats.income ?? 0} icon={TrendingUp} tone="success" hint={t('dashboard.incomeHint')} />
            <StatCard label={t('dashboard.expenses')} value={data?.stats.expenses ?? 0} icon={TrendingDown} tone="accent" hint={t('dashboard.expensesHint')} />
            <StatCard label={t('dashboard.payables')} value={data?.stats.payables ?? 0} icon={Receipt} tone="danger" hint={t('dashboard.payablesHint')} />
          </div>
        )}

        <section className="mt-5">
          <h2 className="mb-2.5 text-[15px] font-semibold text-ink">{t('dashboard.quickActions')}</h2>
          <QuickActions />
        </section>

        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          <SectionCard title={t('dashboard.incomeVsExpenses')} description={t('dashboard.incomeVsExpensesHint')} className="xl:col-span-2">
            {isLoading ? (
              <ChartSkeleton height={280} />
            ) : (
              <BarChart
                data={(data?.charts.incomeVsExpenses ?? []).map((point) => ({ ...point, month: formatMonthKey(point.key) }))}
                xKey="month"
                height={280}
                series={[
                  { key: 'income', label: t('dashboard.income'), color: '#0866FF' },
                  { key: 'expenses', label: t('dashboard.expenses'), color: '#F59E0B' },
                ]}
              />
            )}
          </SectionCard>

          <SectionCard title={t('dashboard.departmentExpenses')} description={t('dashboard.departmentExpensesHint')}>
            {isLoading ? (
              <ChartSkeleton height={280} />
            ) : (
              <DonutChart
                height={220}
                data={(data?.charts.departmentExpenses ?? []).map((item) => ({ name: item.name, value: item.amount }))}
                centerLabel={{ title: t('common.total'), value: formatCurrency(data?.stats.expenses ?? 0, { compact: true }) }}
              />
            )}
          </SectionCard>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <SectionCard
            title={t('dashboard.fundBalances')}
            description={t('dashboard.fundBalancesHint')}
            className="xl:col-span-2"
            noPadding
          >
            {isLoading ? (
              <div className="p-5">
                <ChartSkeleton height={180} />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas/60">
                      <th scope="col" className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{t('common.fund')}</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{t('dashboard.received')}</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{t('dashboard.spent')}</th>
                      <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{t('dashboard.balance')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {(data?.fundBalances ?? []).map((fund) => (
                      <tr key={fund.id} className="transition-colors hover:bg-canvas/60">
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <PiggyBank className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
                            <span className="text-[12.5px] font-medium text-ink">{fund.name}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[12.5px] text-success tnum">{formatCurrency(fund.received)}</td>
                        <td className="px-4 py-2.5 text-right text-[12.5px] text-ink-muted tnum">{formatCurrency(fund.spent)}</td>
                        <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">{formatCurrency(fund.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-brand-primary/25 bg-brand-light/40">
                    <tr>
                      <td className="px-4 py-2.5 text-[12.5px] font-semibold text-ink">{t('common.total')}</td>
                      <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">
                        {formatCurrency((data?.fundBalances ?? []).reduce((sum, f) => sum + f.received, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">
                        {formatCurrency((data?.fundBalances ?? []).reduce((sum, f) => sum + f.spent, 0))}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">
                        {formatCurrency((data?.fundBalances ?? []).reduce((sum, f) => sum + f.balance, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title={t('dashboard.pendingActions')} description={t('dashboard.pendingActionsHint')}>
            <ul className="space-y-2">
              <PendingRow
                label={t('dashboard.draftExpenses')}
                description={t('dashboard.draftExpensesHint')}
                count={data?.pendingActions.expenses ?? 0}
                to="/expenses?status=DRAFT"
                icon={Receipt}
              />
              <PendingRow
                label={t('dashboard.paymentsDue')}
                description={t('dashboard.paymentsDueHint')}
                count={data?.pendingActions.payments ?? 0}
                to="/expenses?status=APPROVED"
                icon={CreditCard}
              />
              <PendingRow
                label={t('dashboard.approvals')}
                description={t('dashboard.approvalsHint')}
                count={data?.pendingActions.approvals ?? 0}
                to="/approvals"
                icon={Banknote}
              />
            </ul>
          </SectionCard>
        </div>

        <SectionCard
          title={t('dashboard.recentExpenses')}
          className="mt-4"
          noPadding
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/expenses">
                {t('common.viewAll')}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-line bg-canvas/60">
                  {[t('dashboard.expenseNumber'), t('dashboard.expense'), t('common.department'), t('common.date'), t('common.amount'), t('common.status')].map((heading, index) => (
                    <th
                      key={heading}
                      scope="col"
                      className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${index === 4 ? 'text-right' : 'text-left'}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(data?.recentExpenses ?? []).map((expense) => (
                  <tr key={expense.id} className="transition-colors hover:bg-canvas/60">
                    <td className="px-4 py-2.5">
                      <Link to={`/expenses/${expense.id}`} className="text-[12.5px] font-medium text-brand-primary hover:underline">
                        {expense.expenseNumber}
                      </Link>
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-2.5 text-[12.5px] text-ink">{expense.title}</td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-muted">{expense.department.name}</td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-muted">{formatDate(expense.date)}</td>
                    <td className="px-4 py-2.5 text-right text-[12.5px] font-semibold text-ink tnum">{formatCurrency(expense.total)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={expense.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function PendingRow({
  label,
  description,
  count,
  to,
  icon: Icon,
}: {
  label: string;
  description: string;
  count: number;
  to: string;
  icon: typeof Receipt;
}) {
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 rounded-control border border-line px-3 py-2.5 transition-colors hover:border-brand-primary/40 hover:bg-brand-light/30"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-brand-light">
          <Icon className="h-4 w-4 text-brand" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-ink">{label}</span>
          <span className="block text-[11.5px] text-ink-muted">{description}</span>
        </span>
        <span className={`shrink-0 text-[17px] font-semibold tnum ${count > 0 ? 'text-accent-ink' : 'text-ink-muted'}`}>
          {count}
        </span>
      </Link>
    </li>
  );
}
