/**
 * Shared domain vocabulary for Ashram Management.
 * Imported by both the API and the web client so permission keys, workflow
 * states and labels can never drift apart between the two.
 */

// ----------------------------- Permissions ---------------------------------

export const PERMISSIONS = [
  'dashboard.view',
  'finance.view',
  'expense.view',
  'expense.create',
  'expense.edit',
  'expense.delete',
  'expense.submit',
  'expense.approve',
  'expense.reject',
  'expense.pay',
  'expense.approve_own',
  'expense.create_on_behalf',
  'donation.view',
  'donation.create',
  'donor.view',
  'donor.manage',
  'whatsapp.send',
  'whatsapp.manage',
  'purchase.view',
  'purchase.create',
  'banking.view',
  'banking.manage',
  'report.view',
  'report.export',
  'user.view',
  'user.create',
  'user.edit',
  'user.delete',
  'settings.view',
  'settings.manage',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_GROUPS: Record<string, { key: Permission; label: string }[]> = {
  Dashboard: [{ key: 'dashboard.view', label: 'View dashboard' }],
  Finance: [{ key: 'finance.view', label: 'View finance overview' }],
  Expenses: [
    { key: 'expense.view', label: 'View expenses' },
    { key: 'expense.create', label: 'Create expenses' },
    { key: 'expense.edit', label: 'Edit expenses' },
    { key: 'expense.delete', label: 'Delete expenses' },
    { key: 'expense.submit', label: 'Submit for approval' },
    { key: 'expense.approve', label: 'Approve expenses' },
    { key: 'expense.reject', label: 'Reject expenses' },
    { key: 'expense.pay', label: 'Record payments' },
    { key: 'expense.approve_own', label: 'Approve own expenses' },
    { key: 'expense.create_on_behalf', label: 'Raise expenses on behalf of others' },
  ],
  Donations: [
    { key: 'donation.view', label: 'View donations' },
    { key: 'donation.create', label: 'Record donations' },
  ],
  Donors: [
    { key: 'donor.view', label: 'View donors' },
    { key: 'donor.manage', label: 'Add and edit donors' },
  ],
  WhatsApp: [
    { key: 'whatsapp.send', label: 'Send WhatsApp messages' },
    { key: 'whatsapp.manage', label: 'Connect and configure WhatsApp' },
  ],
  Purchases: [
    { key: 'purchase.view', label: 'View purchases' },
    { key: 'purchase.create', label: 'Create purchase orders' },
  ],
  Banking: [
    { key: 'banking.view', label: 'View banking' },
    { key: 'banking.manage', label: 'Manage accounts & transfers' },
  ],
  Reports: [
    { key: 'report.view', label: 'View reports' },
    { key: 'report.export', label: 'Export reports' },
  ],
  Users: [
    { key: 'user.view', label: 'View users' },
    { key: 'user.create', label: 'Create users' },
    { key: 'user.edit', label: 'Edit users' },
    { key: 'user.delete', label: 'Deactivate users' },
  ],
  Settings: [
    { key: 'settings.view', label: 'View settings' },
    { key: 'settings.manage', label: 'Manage settings' },
  ],
  Audit: [{ key: 'audit.view', label: 'View audit logs' }],
};

// ----------------------------- Roles ---------------------------------------

export const ROLE_KEYS = ['ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT', 'APPROVER'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  ADMIN: 'Admin User',
  FINANCE_MANAGER: 'Finance Manager',
  ACCOUNTANT: 'Accountant',
  APPROVER: 'Approver',
};

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  FINANCE_MANAGER: [
    'dashboard.view',
    'finance.view',
    'expense.view',
    'expense.create',
    'expense.edit',
    'expense.delete',
    'expense.submit',
    'expense.approve',
    'expense.reject',
    'expense.pay',
    'donation.view',
    'donation.create',
    'donor.view',
    'donor.manage',
    'whatsapp.send',
    'purchase.view',
    'purchase.create',
    'banking.view',
    'banking.manage',
    'report.view',
    'report.export',
    'user.view',
    'settings.view',
    'audit.view',
  ],
  ACCOUNTANT: [
    'dashboard.view',
    'finance.view',
    'expense.view',
    'expense.create',
    'expense.edit',
    'expense.submit',
    'expense.pay',
    'donation.view',
    'donation.create',
    'donor.view',
    'donor.manage',
    'whatsapp.send',
    'purchase.view',
    'purchase.create',
    'banking.view',
    'report.view',
    'report.export',
    'settings.view',
  ],
  APPROVER: [
    'dashboard.view',
    'finance.view',
    'expense.view',
    'expense.approve',
    'expense.reject',
    'donation.view',
    'donor.view',
    'report.view',
    'report.export',
  ],
};

// ----------------------------- Workflow ------------------------------------

export const EXPENSE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PAYMENT_PENDING',
  'PAID',
  'ACCOUNTING_POSTED',
  'CANCELLED',
] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAYMENT_PENDING: 'Payment Pending',
  PAID: 'Paid',
  ACCOUNTING_POSTED: 'Accounting Posted',
  CANCELLED: 'Cancelled',
};

/**
 * The expense state machine. Any transition not listed here is rejected by the
 * service layer — e.g. PAID can never return to DRAFT.
 */
export const EXPENSE_TRANSITIONS: Record<ExpenseStatus, ExpenseStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_APPROVAL', 'DRAFT', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['PAYMENT_PENDING', 'PAID', 'CANCELLED'],
  REJECTED: ['DRAFT', 'CANCELLED'],
  PAYMENT_PENDING: ['PAID', 'CANCELLED'],
  PAID: ['ACCOUNTING_POSTED'],
  ACCOUNTING_POSTED: [],
  CANCELLED: [],
};

export function canTransition(from: ExpenseStatus, to: ExpenseStatus): boolean {
  return (EXPENSE_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuses whose financial content is locked against silent edits. */
export const LOCKED_EXPENSE_STATUSES: ExpenseStatus[] = [
  'APPROVED',
  'PAYMENT_PENDING',
  'PAID',
  'ACCOUNTING_POSTED',
  'CANCELLED',
];

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export type PaymentStatusKey = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatusKey, string> = {
  UNPAID: 'Unpaid',
  PARTIAL: 'Partially Paid',
  PAID: 'Paid',
};

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodKey, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export const DONATION_MODES = ['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'ONLINE', 'KIND'] as const;
export type DonationModeKey = (typeof DONATION_MODES)[number];

export const DONATION_MODE_LABELS: Record<DonationModeKey, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  ONLINE: 'Online',
  KIND: 'In Kind',
};

export const PURCHASE_STATUSES = [
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseStatusKey = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatusKey, string> = {
  DRAFT: 'Draft',
  ORDERED: 'Ordered',
  PARTIALLY_RECEIVED: 'Partially Received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export const UNITS = ['NOS', 'KG', 'LTR', 'MTR', 'BAG', 'BOX', 'SET', 'HRS', 'DAY', 'QTL'] as const;

// ----------------------------- Donors & messaging ----------------------------

export const DONOR_CATEGORIES = ['INDIVIDUAL', 'FAMILY', 'TRUST', 'CORPORATE', 'ORGANIZATION'] as const;
export type DonorCategoryKey = (typeof DONOR_CATEGORIES)[number];

export const WHATSAPP_PROVIDERS = ['CLOUD_API', 'WEB_QR'] as const;
export type WhatsAppProviderKey = (typeof WHATSAPP_PROVIDERS)[number];

export const WHATSAPP_CONNECTION_STATUSES = [
  'DISCONNECTED',
  'CONNECTING',
  'QR_REQUIRED',
  'CONNECTED',
  'FAILED',
] as const;
export type WhatsAppConnectionStatusKey = (typeof WHATSAPP_CONNECTION_STATUSES)[number];

/**
 * Placeholders a message body may use; each is filled per donor at send time.
 * Kept here so the composer's hint list and the server's renderer agree.
 */
export const MESSAGE_PLACEHOLDERS = ['name', 'total_donated', 'last_donation_date', 'organization'] as const;

// ----------------------------- Localisation --------------------------------

export const SUPPORTED_LOCALES = ['en', 'mr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// ----------------------------- Reports -------------------------------------

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  group: 'FINANCIAL' | 'MANAGEMENT' | 'DONATIONS' | 'PAYABLES';
  route: string;
  icon: string;
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    key: 'income-expense',
    name: 'Income & Expense',
    description: 'Month-wise income, expense and net surplus for the selected period.',
    group: 'FINANCIAL',
    route: '/reports/income-expense',
    icon: 'TrendingUp',
  },
  {
    key: 'balance-sheet',
    name: 'Balance Sheet',
    description: 'Assets, liabilities and fund balances as on a given date.',
    group: 'FINANCIAL',
    route: '/reports/balance-sheet',
    icon: 'Scale',
  },
  {
    key: 'trial-balance',
    name: 'Trial Balance',
    description: 'Ledger-wise debit and credit totals with balancing check.',
    group: 'FINANCIAL',
    route: '/reports/trial-balance',
    icon: 'Calculator',
  },
  {
    key: 'general-ledger',
    name: 'General Ledger',
    description: 'Account-wise transaction detail with running balance.',
    group: 'FINANCIAL',
    route: '/reports/general-ledger',
    icon: 'BookOpen',
  },
  {
    key: 'cash-flow',
    name: 'Cash Flow',
    description: 'Inflow, outflow and closing balance movement by month.',
    group: 'FINANCIAL',
    route: '/reports/cash-flow',
    icon: 'Waves',
  },
  {
    key: 'cash-book',
    name: 'Cash Book',
    description: 'Day book of cash and bank receipts and payments.',
    group: 'FINANCIAL',
    route: '/reports/cash-book',
    icon: 'Wallet',
  },
  {
    key: 'fund-report',
    name: 'Fund Report',
    description: 'Opening, inflow, outflow and closing balance per fund.',
    group: 'MANAGEMENT',
    route: '/reports/fund-report',
    icon: 'PiggyBank',
  },
  {
    key: 'department-pl',
    name: 'Department P&L',
    description: 'Income versus expense contribution for every department.',
    group: 'MANAGEMENT',
    route: '/reports/department-pl',
    icon: 'Building2',
  },
  {
    key: 'budget-vs-actual',
    name: 'Budget vs Actual',
    description: 'Department budget utilisation and variance tracking.',
    group: 'MANAGEMENT',
    route: '/reports/budget-vs-actual',
    icon: 'Target',
  },
  {
    key: 'expense-analysis',
    name: 'Expense Analysis',
    description: 'Category-wise expense break-up with share of total spend.',
    group: 'MANAGEMENT',
    route: '/reports/expense-analysis',
    icon: 'PieChart',
  },
  {
    key: 'donor-report',
    name: 'Donor Report',
    description: 'Donor-wise contribution totals and last donation date.',
    group: 'DONATIONS',
    route: '/reports/donor-report',
    icon: 'HeartHandshake',
  },
  {
    key: 'donation-summary',
    name: 'Donation Summary',
    description: 'Donation totals grouped by fund and receipt mode.',
    group: 'DONATIONS',
    route: '/reports/donation-summary',
    icon: 'Gift',
  },
  {
    key: 'supplier-outstanding',
    name: 'Supplier Outstanding',
    description: 'Unpaid and partially paid supplier balances by ageing.',
    group: 'PAYABLES',
    route: '/reports/supplier-outstanding',
    icon: 'Receipt',
  },
  {
    key: 'payment-report',
    name: 'Payment Report',
    description: 'All recorded payments with method, account and reference.',
    group: 'PAYABLES',
    route: '/reports/payment-report',
    icon: 'CreditCard',
  },
];

export const REPORT_GROUP_LABELS: Record<ReportDefinition['group'], string> = {
  FINANCIAL: 'Financial',
  MANAGEMENT: 'Management',
  DONATIONS: 'Donations',
  PAYABLES: 'Payables',
};

// ----------------------------- API envelopes --------------------------------

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  locale: Locale;
  mobile: string | null;
  avatarUrl: string | null;
  designation: string | null;
  role: { id: string; key: string; name: string };
  permissions: Permission[];
  organization: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    tagline: string | null;
  };
}

export * from './i18n';
