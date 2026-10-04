import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  CreditCard,
  HeartHandshake,
  PlusCircle,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Permission } from '@ashram/types';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';

interface QuickAction {
  labelKey: string;
  icon: LucideIcon;
  to: string;
  permission: Permission;
  tone: 'brand' | 'accent' | 'info' | 'success';
}

const ACTIONS: QuickAction[] = [
  { labelKey: 'dashboard.qaAddExpense', icon: PlusCircle, to: '/expenses/new', permission: 'expense.create', tone: 'brand' },
  { labelKey: 'dashboard.qaReceiveDonation', icon: HeartHandshake, to: '/donations?new=1', permission: 'donation.create', tone: 'accent' },
  { labelKey: 'dashboard.qaRecordIncome', icon: TrendingUp, to: '/finance?income=1', permission: 'finance.view', tone: 'success' },
  { labelKey: 'dashboard.qaCreatePayment', icon: CreditCard, to: '/expenses?status=APPROVED&paymentStatus=UNPAID', permission: 'expense.pay', tone: 'info' },
  { labelKey: 'dashboard.qaCreatePurchase', icon: ShoppingCart, to: '/purchases?new=1', permission: 'purchase.create', tone: 'brand' },
  { labelKey: 'dashboard.qaTransferMoney', icon: ArrowLeftRight, to: '/banking?transfer=1', permission: 'banking.manage', tone: 'accent' },
];

const TONES = {
  brand: 'bg-brand-light text-brand',
  accent: 'bg-accent-light text-accent-ink',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
};

/** Each tile routes to a real screen with the right mode pre-opened. */
export function QuickActions() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const actions = ACTIONS.filter((action) => can(action.permission));

  if (actions.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.to}
            type="button"
            onClick={() => navigate(action.to)}
            className="group flex flex-col items-start gap-2 rounded-card border border-line bg-white p-3 text-left transition-all hover:border-brand-primary/40 hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
          >
            <span className={cn('flex h-8 w-8 items-center justify-center rounded-[9px]', TONES[action.tone])}>
              <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
            </span>
            <span className="text-[12.5px] font-medium leading-tight text-ink">{t(action.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
