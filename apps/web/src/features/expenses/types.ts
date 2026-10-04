import type { ExpenseAbilities } from './abilities';

export interface ExpenseListRow {
  id: string;
  expenseNumber: string;
  date: string;
  title: string;
  total: number;
  paidAmount: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  department: { id: string; name: string; code: string };
  fund: { id: string; name: string; code: string };
  category: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  onBehalfOf: { id: string; name: string } | null;
}

export interface ExpenseListResponse {
  data: ExpenseListRow[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    totalAmount: number;
    paidAmount: number;
  };
}

export interface ExpenseItem {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
  sortOrder: number;
}

export interface ExpenseAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: string;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

export interface ExpensePayment {
  id: string;
  paymentNumber: string;
  date: string;
  amount: number;
  method: string;
  referenceNumber: string | null;
  notes: string | null;
  bankAccount: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
}

export interface ExpenseApproval {
  id: string;
  level: number;
  decision: string;
  comments: string | null;
  requestedAt: string;
  decidedAt: string | null;
  requestedBy: { id: string; name: string; designation: string | null };
  actor: { id: string; name: string; designation: string | null } | null;
}

export interface ExpenseTransactionLine {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
  account: { id: string; code: string; name: string; type: string };
}

export interface ExpenseTransaction {
  id: string;
  voucherNumber: string;
  date: string;
  type: string;
  narration: string | null;
  amount: number;
  isReversal: boolean;
  lines: ExpenseTransactionLine[];
}

export interface ExpenseDetail extends Omit<ExpenseListRow, 'department' | 'fund' | 'category' | 'supplier'> {
  subtotal: number;
  tax: number;
  balanceDue: number;
  description: string | null;
  notes: string | null;
  referenceNumber: string | null;
  paymentMethod: string | null;
  paymentAccountId: string | null;
  paymentDate: string | null;
  payImmediately: boolean;
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  revisionOf: string | null;
  revisionNumber: number;
  costCenterId: string | null;
  departmentId: string;
  fundId: string;
  categoryId: string;
  supplierId: string | null;
  onBehalfOfId: string | null;
  department: { id: string; name: string; code: string };
  fund: { id: string; name: string; code: string };
  category: { id: string; name: string; account: { id: string; code: string; name: string } | null };
  costCenter: { id: string; name: string } | null;
  supplier: { id: string; name: string; phone: string | null; contactPerson: string | null } | null;
  createdBy: { id: string; name: string; email: string; designation: string | null };
  onBehalfOf: { id: string; name: string; email: string; designation: string | null } | null;
  approvedBy: { id: string; name: string; email: string; designation: string | null } | null;
  items: ExpenseItem[];
  payments: ExpensePayment[];
  attachments: ExpenseAttachment[];
  approvals: ExpenseApproval[];
  transactions: ExpenseTransaction[];
  abilities: ExpenseAbilities;
}
