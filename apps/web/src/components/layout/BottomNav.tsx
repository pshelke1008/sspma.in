import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Home, MoreHorizontal, PieChart, Plus, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { NAV_ITEMS } from './navigation';
import { cn } from '@/lib/utils/cn';

const PRIMARY = [
  { labelKey: 'nav.home', to: '/dashboard', icon: Home, permission: 'dashboard.view' as const },
  { labelKey: 'nav.fundsTab', to: '/banking', icon: Wallet, permission: 'banking.view' as const },
  { labelKey: 'nav.reports', to: '/reports', icon: PieChart, permission: 'report.view' as const },
];

/** Phone-only tab bar; the centre action opens expense entry, the most common mobile task. */
export function BottomNav() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = PRIMARY.filter((item) => can(item.permission));

  const sections = [
    ...NAV_ITEMS.filter((item) => can(...item.permission)).map((item) => ({ ...item })),
    ...(can('expense.view') ? [{ labelKey: 'nav.expenses', to: '/expenses', icon: FileText }] : []),
  ];

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--bottom-nav-height)] items-stretch border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label={t('nav.main')}
      >
        {items.slice(0, 2).map((item) => (
          <BottomTab key={item.to} label={t(item.labelKey)} to={item.to} icon={item.icon} />
        ))}

        {can('expense.create') ? (
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => navigate('/expenses/new')}
              aria-label={t('nav.addExpense')}
              className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary text-white shadow-raised transition-transform active:scale-95"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {items.slice(2).map((item) => (
          <BottomTab key={item.to} label={t(item.labelKey)} to={item.to} icon={item.icon} />
        ))}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-ink-muted transition-colors active:text-brand"
        >
          <MoreHorizontal className="h-[19px] w-[19px]" aria-hidden="true" />
          <span className="text-[10.5px] font-medium">{t('nav.more')}</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle className="text-[15px] font-semibold text-ink">{t('nav.allSections')}</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <ul className="grid grid-cols-3 gap-2 pb-4">
              {sections.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        navigate(item.to);
                      }}
                      className="flex w-full flex-col items-center gap-2 rounded-card border border-line bg-white p-3 transition-colors active:bg-canvas"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-light">
                        <Icon className="h-[18px] w-[18px] text-brand" aria-hidden="true" />
                      </span>
                      <span className="text-center text-[11.5px] font-medium leading-tight text-ink">{t(item.labelKey)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

function BottomTab({ label, to, icon: Icon }: { label: string; to: string; icon: typeof Home }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn('flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors', isActive ? 'text-brand' : 'text-ink-muted')
      }
    >
      <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
      <span className="text-[10.5px] font-medium">{label}</span>
    </NavLink>
  );
}
