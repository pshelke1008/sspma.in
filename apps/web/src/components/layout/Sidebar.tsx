import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useApprovalCount } from '@/lib/api/hooks';
import { cn } from '@/lib/utils/cn';
import { NAV_ITEMS } from './navigation';
import { Brand } from './Brand';

const linkClass = (isActive: boolean) =>
  cn(
    'group relative flex items-center gap-2.5 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50',
    isActive ? 'bg-brand-light font-semibold text-brand' : 'text-ink hover:bg-ink/[0.06]',
  );

export function SidebarNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data: approvals } = useApprovalCount(can('expense.approve'));
  const items = NAV_ITEMS.filter((item) => can(...item.permission));

  return (
    <nav className={cn('flex-1 space-y-0.5 overflow-y-auto px-3 py-3', className)} aria-label={t('nav.main')}>
      {items.map((item) => {
        const Icon = item.icon;
        const badgeCount = item.badge === 'approvals' ? (approvals?.count ?? 0) : 0;
        return (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
            {() => (
              <>
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">{t(item.labelKey)}</span>
                {badgeCount > 0 && (
                  <span
                    className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-semibold text-ink"
                    aria-label={t('nav.pending', { count: badgeCount })}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        );
      })}

      {can('expense.view') && (
        <>
          <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {t('nav.operations')}
          </p>
          <NavLink to="/expenses" onClick={onNavigate} className={({ isActive }) => linkClass(isActive)}>
            <FileText className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">{t('nav.expenses')}</span>
          </NavLink>
        </>
      )}
    </nav>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-line bg-sidebar lg:flex"
      aria-label={t('nav.navigation')}
    >
      <div className="flex h-16 shrink-0 items-center border-b border-line px-4">
        <Brand tone="dark" />
      </div>
      <SidebarNav />
      <div className="border-t border-line px-4 py-3">
        <p className="truncate text-[11.5px] font-medium text-ink">{user?.organization.name}</p>
        <p className="mt-0.5 text-[10.5px] text-ink-muted">{t('brand.version')}</p>
      </div>
    </aside>
  );
}
