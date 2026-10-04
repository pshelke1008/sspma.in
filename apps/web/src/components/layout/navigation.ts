import {
  Banknote,
  CheckSquare,
  Contact,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Permission } from '@ashram/types';

export interface NavItem {
  labelKey: string;
  to: string;
  icon: LucideIcon;
  permission: Permission[];
  badge?: 'approvals';
  end?: boolean;
}

/** Sidebar order follows the reference layout, with Donors beside Donations. */
export const NAV_ITEMS: NavItem[] = [
  { labelKey: 'nav.dashboard', to: '/dashboard', icon: LayoutDashboard, permission: ['dashboard.view'], end: true },
  { labelKey: 'nav.finance', to: '/finance', icon: Wallet, permission: ['finance.view'] },
  { labelKey: 'nav.donations', to: '/donations', icon: HeartHandshake, permission: ['donation.view'] },
  { labelKey: 'nav.donors', to: '/donors', icon: Contact, permission: ['donor.view'] },
  { labelKey: 'nav.purchases', to: '/purchases', icon: ShoppingCart, permission: ['purchase.view'] },
  { labelKey: 'nav.banking', to: '/banking', icon: Banknote, permission: ['banking.view'] },
  { labelKey: 'nav.reports', to: '/reports', icon: FileText, permission: ['report.view'] },
  { labelKey: 'nav.approvals', to: '/approvals', icon: CheckSquare, permission: ['expense.approve', 'expense.view'], badge: 'approvals' },
  { labelKey: 'nav.settings', to: '/settings', icon: Settings, permission: ['settings.view'] },
];
