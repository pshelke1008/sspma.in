import {
  Banknote,
  CheckSquare,
  Contact,
  FileText,
  HeartHandshake,
  LayoutDashboard,
  MessageCircle,
  LayoutTemplate,
  Megaphone,
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
  badge?: 'approvals' | 'whatsapp';
  end?: boolean;
}

/** Sidebar order follows the reference layout, with Donors beside Donations. */
export const NAV_ITEMS: NavItem[] = [
  { labelKey: 'nav.dashboard', to: '/dashboard', icon: LayoutDashboard, permission: ['dashboard.view'], end: true },
  { labelKey: 'nav.finance', to: '/finance', icon: Wallet, permission: ['finance.view'] },
  { labelKey: 'nav.donations', to: '/donations', icon: HeartHandshake, permission: ['donation.view'] },
  { labelKey: 'nav.donors', to: '/donors', icon: Contact, permission: ['donor.view'] },
  // `end`: the inbox lives at /whatsapp exactly, so it is not lit up on the broadcast pages below it.
  { labelKey: 'whatsappInbox.navLabel', to: '/whatsapp', icon: MessageCircle, permission: ['whatsapp.inbox'], badge: 'whatsapp', end: true },
  { labelKey: 'nav.broadcasts', to: '/whatsapp/broadcasts', icon: Megaphone, permission: ['whatsapp.send'] },
  { labelKey: 'nav.templates', to: '/whatsapp/templates', icon: LayoutTemplate, permission: ['whatsapp.manage'] },
  { labelKey: 'nav.purchases', to: '/purchases', icon: ShoppingCart, permission: ['purchase.view'] },
  { labelKey: 'nav.banking', to: '/banking', icon: Banknote, permission: ['banking.view'] },
  { labelKey: 'nav.reports', to: '/reports', icon: FileText, permission: ['report.view'] },
  { labelKey: 'nav.approvals', to: '/approvals', icon: CheckSquare, permission: ['expense.approve', 'expense.view'], badge: 'approvals' },
  { labelKey: 'nav.settings', to: '/settings', icon: Settings, permission: ['settings.view'] },
];
