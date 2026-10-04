import type { ExpenseStatus as PrismaExpenseStatus } from '@prisma/client';
import { REPORT_DEFINITIONS } from '@ashram/types';
import { prisma } from '../../db';
import { badRequest } from '../../lib/errors';
import { round2, toNumber } from '../../lib/money';
import { currentFinancialYearLabel, financialYearRange, monthsBetween } from '../../lib/dates';
import { ledgerBalances, isDebitNatured } from '../../lib/accounting';
import type { ReportFilters, ReportResult } from './report.types';

// Only expenses that have cleared the workflow contribute to reported figures.
const POSTED_STATUSES: PrismaExpenseStatus[] = ['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'PAYMENT_PENDING', 'PAID', 'ACCOUNTING_POSTED'];
const POSTED = { in: POSTED_STATUSES };

function resolvePeriod(filters: ReportFilters) {
  const label = filters.financialYear ?? currentFinancialYearLabel();
  const fy = financialYearRange(label);
  const from = filters.from ?? fy.start;
  const to = filters.to ?? fy.end;
  return { label, from, to };
}

async function describeFilters(organizationId: string, filters: ReportFilters) {
  const applied: Record<string, string> = {};
  if (filters.financialYear) applied['Financial Year'] = filters.financialYear;

  const lookups: [keyof ReportFilters, string, () => Promise<{ name: string } | null>][] = [
    ['departmentId', 'Department', () => prisma.department.findFirst({ where: { id: filters.departmentId, organizationId }, select: { name: true } })],
    ['fundId', 'Fund', () => prisma.fund.findFirst({ where: { id: filters.fundId, organizationId }, select: { name: true } })],
    ['categoryId', 'Category', () => prisma.expenseCategory.findFirst({ where: { id: filters.categoryId, organizationId }, select: { name: true } })],
    ['supplierId', 'Supplier', () => prisma.supplier.findFirst({ where: { id: filters.supplierId, organizationId }, select: { name: true } })],
    ['accountId', 'Account', () => prisma.account.findFirst({ where: { id: filters.accountId, organizationId }, select: { name: true } })],
    ['donorId', 'Donor', () => prisma.donor.findFirst({ where: { id: filters.donorId, organizationId }, select: { name: true } })],
  ];

  for (const [key, label, lookup] of lookups) {
    if (filters[key]) {
      const record = await lookup();
      if (record) applied[label] = record.name;
    }
  }
  return applied;
}

function expenseWhere(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  return {
    organizationId,
    date: { gte: from, lte: to },
    status: POSTED,
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.fundId ? { fundId: filters.fundId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
  };
}

function incomeWhere(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  return {
    organizationId,
    date: { gte: from, lte: to },
    ...(filters.fundId ? { fundId: filters.fundId } : {}),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
  };
}

/** Builds any of the fourteen reports from live ledger data. */
export async function generateReport(
  organizationId: string,
  key: string,
  filters: ReportFilters,
): Promise<ReportResult> {
  const definition = REPORT_DEFINITIONS.find((r) => r.key === key);
  if (!definition) throw badRequest(`Unknown report "${key}"`);

  const { label, from, to } = resolvePeriod(filters);
  const base = {
    key,
    name: definition.name,
    description: definition.description,
    generatedAt: new Date().toISOString(),
    period: { from: from.toISOString(), to: to.toISOString(), label },
    filtersApplied: await describeFilters(organizationId, filters),
  };

  switch (key) {
    case 'income-expense':
      return { ...base, ...(await incomeExpense(organizationId, filters, from, to)) };
    case 'balance-sheet':
      return { ...base, ...(await balanceSheet(organizationId, to)) };
    case 'trial-balance':
      return { ...base, ...(await trialBalance(organizationId, from, to)) };
    case 'general-ledger':
      return { ...base, ...(await generalLedger(organizationId, filters, from, to)) };
    case 'cash-flow':
      return { ...base, ...(await cashFlow(organizationId, filters, from, to)) };
    case 'cash-book':
      return { ...base, ...(await cashBook(organizationId, from, to)) };
    case 'fund-report':
      return { ...base, ...(await fundReport(organizationId, filters, from, to)) };
    case 'department-pl':
      return { ...base, ...(await departmentPL(organizationId, filters, from, to)) };
    case 'budget-vs-actual':
      return { ...base, ...(await budgetVsActual(organizationId, filters, from, to)) };
    case 'expense-analysis':
      return { ...base, ...(await expenseAnalysis(organizationId, filters, from, to)) };
    case 'donor-report':
      return { ...base, ...(await donorReport(organizationId, filters, from, to)) };
    case 'donation-summary':
      return { ...base, ...(await donationSummary(organizationId, filters, from, to)) };
    case 'supplier-outstanding':
      return { ...base, ...(await supplierOutstanding(organizationId, filters)) };
    case 'payment-report':
      return { ...base, ...(await paymentReport(organizationId, filters, from, to)) };
    default:
      throw badRequest(`Report "${key}" is not implemented`);
  }
}

// ----------------------------- 1. Income & Expense -------------------------

async function incomeExpense(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const months = monthsBetween(from, to);

  const rows = await Promise.all(
    months.map(async (month) => {
      const range = { gte: month.start, lte: month.end };
      const [donations, income, expenses] = await Promise.all([
        prisma.donation.aggregate({
          where: { ...incomeWhere(organizationId, filters, month.start, month.end), date: range },
          _sum: { amount: true },
        }),
        prisma.incomeEntry.aggregate({
          where: { ...incomeWhere(organizationId, filters, month.start, month.end), date: range },
          _sum: { amount: true },
        }),
        prisma.expense.aggregate({
          where: expenseWhere(organizationId, filters, month.start, month.end),
          _sum: { total: true },
        }),
      ]);
      const incomeTotal = round2(toNumber(donations._sum.amount) + toNumber(income._sum.amount));
      const expenseTotal = toNumber(expenses._sum.total);
      return {
        month: month.label,
        income: incomeTotal,
        expense: expenseTotal,
        net: round2(incomeTotal - expenseTotal),
      };
    }),
  );

  const totalIncome = round2(rows.reduce((sum, r) => sum + r.income, 0));
  const totalExpense = round2(rows.reduce((sum, r) => sum + r.expense, 0));

  return {
    columns: [
      { key: 'month', label: 'Month', type: 'text' as const },
      { key: 'income', label: 'Income', type: 'currency' as const, align: 'right' as const },
      { key: 'expense', label: 'Expense', type: 'currency' as const, align: 'right' as const },
      { key: 'net', label: 'Net', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      month: 'Total',
      income: totalIncome,
      expense: totalExpense,
      net: round2(totalIncome - totalExpense),
    },
    summary: [
      { label: 'Total Income', value: totalIncome, type: 'currency' as const, tone: 'positive' as const },
      { label: 'Total Expense', value: totalExpense, type: 'currency' as const, tone: 'negative' as const },
      {
        label: 'Net Surplus',
        value: round2(totalIncome - totalExpense),
        type: 'currency' as const,
        tone: 'accent' as const,
      },
    ],
    charts: [
      {
        type: 'bar' as const,
        title: 'Income vs Expense',
        data: rows,
        xKey: 'month',
        series: [
          { key: 'income', label: 'Income', color: '#0866FF' },
          { key: 'expense', label: 'Expense', color: '#F59E0B' },
        ],
      },
    ],
  };
}

// ----------------------------- 2. Balance Sheet ----------------------------

async function balanceSheet(organizationId: string, asOn: Date) {
  const balances = await prisma.$transaction(async (tx) => ledgerBalances(tx, organizationId, { to: asOn }));

  const sections = [
    { type: 'ASSET', label: 'Assets' },
    { type: 'LIABILITY', label: 'Liabilities' },
    { type: 'EQUITY', label: 'Funds & Reserves' },
  ];

  const rows: Record<string, unknown>[] = [];
  const sectionTotals: Record<string, number> = {};

  for (const section of sections) {
    const accounts = balances.filter((b) => b.type === section.type && Math.abs(b.balance) > 0.009);
    for (const account of accounts) {
      rows.push({
        section: section.label,
        code: account.code,
        account: account.name,
        amount: Math.abs(account.balance),
      });
    }
    sectionTotals[section.type] = round2(accounts.reduce((sum, a) => sum + Math.abs(a.balance), 0));
  }

  // Surplus for the period flows into funds, keeping the statement balanced.
  const incomeTotal = round2(
    balances.filter((b) => b.type === 'INCOME').reduce((sum, b) => sum + b.balance, 0),
  );
  const expenseTotal = round2(
    balances.filter((b) => b.type === 'EXPENSE').reduce((sum, b) => sum + b.balance, 0),
  );
  const surplus = round2(incomeTotal - expenseTotal);

  if (Math.abs(surplus) > 0.009) {
    rows.push({ section: 'Funds & Reserves', code: '3999', account: 'Surplus for the period', amount: surplus });
    sectionTotals.EQUITY = round2((sectionTotals.EQUITY ?? 0) + surplus);
  }

  const assets = sectionTotals.ASSET ?? 0;
  const liabilitiesAndFunds = round2((sectionTotals.LIABILITY ?? 0) + (sectionTotals.EQUITY ?? 0));

  return {
    columns: [
      { key: 'section', label: 'Section', type: 'text' as const },
      { key: 'code', label: 'Code', type: 'text' as const },
      { key: 'account', label: 'Account', type: 'text' as const },
      { key: 'amount', label: 'Amount', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: null,
    summary: [
      { label: 'Total Assets', value: assets, type: 'currency' as const, tone: 'positive' as const },
      { label: 'Liabilities', value: sectionTotals.LIABILITY ?? 0, type: 'currency' as const, tone: 'negative' as const },
      { label: 'Funds & Reserves', value: sectionTotals.EQUITY ?? 0, type: 'currency' as const, tone: 'accent' as const },
      { label: 'Difference', value: round2(assets - liabilitiesAndFunds), type: 'currency' as const },
    ],
    charts: [
      {
        type: 'donut' as const,
        title: 'Composition',
        data: [
          { name: 'Assets', value: assets },
          { name: 'Liabilities', value: sectionTotals.LIABILITY ?? 0 },
          { name: 'Funds', value: sectionTotals.EQUITY ?? 0 },
        ].filter((d) => d.value > 0),
        xKey: 'name',
        series: [{ key: 'value', label: 'Amount' }],
      },
    ],
  };
}

// ----------------------------- 3. Trial Balance ----------------------------

async function trialBalance(organizationId: string, from: Date, to: Date) {
  const balances = await prisma.$transaction(async (tx) => ledgerBalances(tx, organizationId, { to }));
  const active = balances.filter((b) => b.debit > 0.009 || b.credit > 0.009);

  const rows = active.map((account) => ({
    code: account.code,
    account: account.name,
    type: account.type,
    debit: isDebitNatured(account.type) ? Math.max(0, account.balance) : 0,
    credit: isDebitNatured(account.type) ? 0 : Math.max(0, account.balance),
  }));

  const totalDebit = round2(rows.reduce((sum, r) => sum + r.debit, 0));
  const totalCredit = round2(rows.reduce((sum, r) => sum + r.credit, 0));

  return {
    columns: [
      { key: 'code', label: 'Code', type: 'text' as const },
      { key: 'account', label: 'Account', type: 'text' as const },
      { key: 'type', label: 'Type', type: 'text' as const },
      { key: 'debit', label: 'Debit', type: 'currency' as const, align: 'right' as const },
      { key: 'credit', label: 'Credit', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: { code: '', account: 'Total', type: '', debit: totalDebit, credit: totalCredit },
    summary: [
      { label: 'Total Debit', value: totalDebit, type: 'currency' as const },
      { label: 'Total Credit', value: totalCredit, type: 'currency' as const },
      {
        label: 'Difference',
        value: round2(totalDebit - totalCredit),
        type: 'currency' as const,
        tone: Math.abs(totalDebit - totalCredit) < 0.01 ? ('positive' as const) : ('negative' as const),
      },
    ],
    charts: [],
  };
}

// ----------------------------- 4. General Ledger ---------------------------

async function generalLedger(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const lines = await prisma.transactionLine.findMany({
    where: {
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      transaction: { organizationId, date: { gte: from, lte: to } },
    },
    include: {
      account: { select: { code: true, name: true, type: true } },
      transaction: { select: { voucherNumber: true, date: true, narration: true, type: true } },
    },
    orderBy: [{ transaction: { date: 'asc' } }, { id: 'asc' }],
    take: 2000,
  });

  let running = 0;
  const rows = lines.map((line) => {
    const debit = toNumber(line.debit);
    const credit = toNumber(line.credit);
    running = round2(running + debit - credit);
    return {
      date: line.transaction.date.toISOString(),
      voucher: line.transaction.voucherNumber,
      account: `${line.account.code} ${line.account.name}`,
      particulars: line.description ?? line.transaction.narration ?? '',
      debit,
      credit,
      balance: filters.accountId ? running : 0,
    };
  });

  const totalDebit = round2(rows.reduce((sum, r) => sum + r.debit, 0));
  const totalCredit = round2(rows.reduce((sum, r) => sum + r.credit, 0));

  const columns = [
    { key: 'date', label: 'Date', type: 'date' as const },
    { key: 'voucher', label: 'Voucher', type: 'text' as const },
    { key: 'account', label: 'Account', type: 'text' as const },
    { key: 'particulars', label: 'Particulars', type: 'text' as const },
    { key: 'debit', label: 'Debit', type: 'currency' as const, align: 'right' as const },
    { key: 'credit', label: 'Credit', type: 'currency' as const, align: 'right' as const },
  ];
  if (filters.accountId) {
    columns.push({ key: 'balance', label: 'Balance', type: 'currency' as const, align: 'right' as const });
  }

  return {
    columns,
    rows,
    totalsRow: { date: '', voucher: '', account: '', particulars: 'Total', debit: totalDebit, credit: totalCredit },
    summary: [
      { label: 'Entries', value: rows.length, type: 'number' as const },
      { label: 'Total Debit', value: totalDebit, type: 'currency' as const },
      { label: 'Total Credit', value: totalCredit, type: 'currency' as const },
    ],
    charts: [],
  };
}

// ----------------------------- 5. Cash Flow --------------------------------

async function cashFlow(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const months = monthsBetween(from, to);
  const openingAccounts = await prisma.bankAccount.findMany({ where: { organizationId } });
  let running = round2(openingAccounts.reduce((sum, a) => sum + toNumber(a.openingBalance), 0));

  const rows = [];
  for (const month of months) {
    const range = { gte: month.start, lte: month.end };
    const [donations, income, payments] = await Promise.all([
      prisma.donation.aggregate({ where: { organizationId, date: range }, _sum: { amount: true } }),
      prisma.incomeEntry.aggregate({ where: { organizationId, date: range }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { organizationId, date: range }, _sum: { amount: true } }),
    ]);
    const inflow = round2(toNumber(donations._sum.amount) + toNumber(income._sum.amount));
    const outflow = toNumber(payments._sum.amount);
    const opening = running;
    running = round2(running + inflow - outflow);
    rows.push({
      month: month.label,
      opening,
      inflow,
      outflow,
      net: round2(inflow - outflow),
      closing: running,
    });
  }

  const totalIn = round2(rows.reduce((sum, r) => sum + r.inflow, 0));
  const totalOut = round2(rows.reduce((sum, r) => sum + r.outflow, 0));

  return {
    columns: [
      { key: 'month', label: 'Month', type: 'text' as const },
      { key: 'opening', label: 'Opening', type: 'currency' as const, align: 'right' as const },
      { key: 'inflow', label: 'Inflow', type: 'currency' as const, align: 'right' as const },
      { key: 'outflow', label: 'Outflow', type: 'currency' as const, align: 'right' as const },
      { key: 'net', label: 'Net', type: 'currency' as const, align: 'right' as const },
      { key: 'closing', label: 'Closing', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      month: 'Total',
      opening: '',
      inflow: totalIn,
      outflow: totalOut,
      net: round2(totalIn - totalOut),
      closing: running,
    },
    summary: [
      { label: 'Total Inflow', value: totalIn, type: 'currency' as const, tone: 'positive' as const },
      { label: 'Total Outflow', value: totalOut, type: 'currency' as const, tone: 'negative' as const },
      { label: 'Closing Balance', value: running, type: 'currency' as const, tone: 'accent' as const },
    ],
    charts: [
      {
        type: 'line' as const,
        title: 'Cash Movement',
        data: rows,
        xKey: 'month',
        series: [
          { key: 'inflow', label: 'Inflow', color: '#0866FF' },
          { key: 'outflow', label: 'Outflow', color: '#F59E0B' },
          { key: 'closing', label: 'Closing', color: '#3182CE' },
        ],
      },
    ],
  };
}

// ----------------------------- 6. Cash Book --------------------------------

async function cashBook(organizationId: string, from: Date, to: Date) {
  const range = { gte: from, lte: to };
  const [donations, income, payments, transfers] = await Promise.all([
    prisma.donation.findMany({
      where: { organizationId, date: range },
      include: { bankAccount: { select: { name: true } } },
    }),
    prisma.incomeEntry.findMany({
      where: { organizationId, date: range },
      include: { bankAccount: { select: { name: true } } },
    }),
    prisma.payment.findMany({
      where: { organizationId, date: range },
      include: {
        bankAccount: { select: { name: true } },
        expense: { select: { expenseNumber: true, title: true } },
      },
    }),
    prisma.bankTransfer.findMany({
      where: { organizationId, date: range },
      include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
    }),
  ]);

  const entries = [
    ...donations.map((d) => ({
      date: d.date,
      reference: d.receiptNumber,
      particulars: `Donation — ${d.donorName}`,
      account: d.bankAccount?.name ?? 'Cash in Hand',
      receipt: toNumber(d.amount),
      payment: 0,
    })),
    ...income.map((i) => ({
      date: i.date,
      reference: i.entryNumber,
      particulars: `Income — ${i.source}`,
      account: i.bankAccount?.name ?? 'Cash in Hand',
      receipt: toNumber(i.amount),
      payment: 0,
    })),
    ...payments.map((p) => ({
      date: p.date,
      reference: p.paymentNumber,
      particulars: p.expense ? `${p.expense.expenseNumber} — ${p.expense.title}` : 'Payment',
      account: p.bankAccount?.name ?? 'Cash in Hand',
      receipt: 0,
      payment: toNumber(p.amount),
    })),
    ...transfers.map((t) => ({
      date: t.date,
      reference: t.transferNumber,
      particulars: `Transfer ${t.fromAccount.name} → ${t.toAccount.name}`,
      account: t.fromAccount.name,
      receipt: 0,
      payment: toNumber(t.amount),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  let balance = 0;
  const rows = entries.map((entry) => {
    balance = round2(balance + entry.receipt - entry.payment);
    return { ...entry, date: entry.date.toISOString(), balance };
  });

  const totalReceipt = round2(rows.reduce((sum, r) => sum + r.receipt, 0));
  const totalPayment = round2(rows.reduce((sum, r) => sum + r.payment, 0));

  return {
    columns: [
      { key: 'date', label: 'Date', type: 'date' as const },
      { key: 'reference', label: 'Reference', type: 'text' as const },
      { key: 'particulars', label: 'Particulars', type: 'text' as const },
      { key: 'account', label: 'Account', type: 'text' as const },
      { key: 'receipt', label: 'Receipt', type: 'currency' as const, align: 'right' as const },
      { key: 'payment', label: 'Payment', type: 'currency' as const, align: 'right' as const },
      { key: 'balance', label: 'Balance', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      date: '',
      reference: '',
      particulars: 'Total',
      account: '',
      receipt: totalReceipt,
      payment: totalPayment,
      balance,
    },
    summary: [
      { label: 'Receipts', value: totalReceipt, type: 'currency' as const, tone: 'positive' as const },
      { label: 'Payments', value: totalPayment, type: 'currency' as const, tone: 'negative' as const },
      { label: 'Net Movement', value: balance, type: 'currency' as const, tone: 'accent' as const },
    ],
    charts: [],
  };
}

// ----------------------------- 7. Fund Report ------------------------------

async function fundReport(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const funds = await prisma.fund.findMany({
    where: { organizationId, ...(filters.fundId ? { id: filters.fundId } : {}) },
    orderBy: { name: 'asc' },
  });

  const rows = await Promise.all(
    funds.map(async (fund) => {
      const range = { gte: from, lte: to };
      const [donations, income, expenses, priorDonations, priorIncome, priorExpenses] = await Promise.all([
        prisma.donation.aggregate({ where: { organizationId, fundId: fund.id, date: range }, _sum: { amount: true } }),
        prisma.incomeEntry.aggregate({ where: { organizationId, fundId: fund.id, date: range }, _sum: { amount: true } }),
        prisma.expense.aggregate({
          where: { organizationId, fundId: fund.id, date: range, status: POSTED },
          _sum: { total: true },
        }),
        prisma.donation.aggregate({
          where: { organizationId, fundId: fund.id, date: { lt: from } },
          _sum: { amount: true },
        }),
        prisma.incomeEntry.aggregate({
          where: { organizationId, fundId: fund.id, date: { lt: from } },
          _sum: { amount: true },
        }),
        prisma.expense.aggregate({
          where: { organizationId, fundId: fund.id, date: { lt: from }, status: POSTED },
          _sum: { total: true },
        }),
      ]);

      const opening = round2(
        toNumber(fund.openingBalance) +
          toNumber(priorDonations._sum.amount) +
          toNumber(priorIncome._sum.amount) -
          toNumber(priorExpenses._sum.total),
      );
      const inflow = round2(toNumber(donations._sum.amount) + toNumber(income._sum.amount));
      const outflow = toNumber(expenses._sum.total);

      return {
        fund: fund.name,
        code: fund.code,
        opening,
        inflow,
        outflow,
        closing: round2(opening + inflow - outflow),
      };
    }),
  );

  return {
    columns: [
      { key: 'fund', label: 'Fund', type: 'text' as const },
      { key: 'code', label: 'Code', type: 'text' as const },
      { key: 'opening', label: 'Opening', type: 'currency' as const, align: 'right' as const },
      { key: 'inflow', label: 'Inflow', type: 'currency' as const, align: 'right' as const },
      { key: 'outflow', label: 'Outflow', type: 'currency' as const, align: 'right' as const },
      { key: 'closing', label: 'Closing', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      fund: 'Total',
      code: '',
      opening: round2(rows.reduce((s, r) => s + r.opening, 0)),
      inflow: round2(rows.reduce((s, r) => s + r.inflow, 0)),
      outflow: round2(rows.reduce((s, r) => s + r.outflow, 0)),
      closing: round2(rows.reduce((s, r) => s + r.closing, 0)),
    },
    summary: [
      { label: 'Total Inflow', value: round2(rows.reduce((s, r) => s + r.inflow, 0)), type: 'currency' as const, tone: 'positive' as const },
      { label: 'Total Outflow', value: round2(rows.reduce((s, r) => s + r.outflow, 0)), type: 'currency' as const, tone: 'negative' as const },
      { label: 'Closing Balance', value: round2(rows.reduce((s, r) => s + r.closing, 0)), type: 'currency' as const, tone: 'accent' as const },
    ],
    charts: [
      {
        type: 'donut' as const,
        title: 'Fund Balances',
        data: rows.filter((r) => r.closing > 0).map((r) => ({ name: r.fund, value: r.closing })),
        xKey: 'name',
        series: [{ key: 'value', label: 'Closing' }],
      },
    ],
  };
}

// ----------------------------- 8. Department P&L ---------------------------

async function departmentPL(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const departments = await prisma.department.findMany({
    where: { organizationId, ...(filters.departmentId ? { id: filters.departmentId } : {}) },
    orderBy: { name: 'asc' },
  });
  const range = { gte: from, lte: to };

  const rows = await Promise.all(
    departments.map(async (department) => {
      const [donations, income, expenses] = await Promise.all([
        prisma.donation.aggregate({
          where: { organizationId, departmentId: department.id, date: range },
          _sum: { amount: true },
        }),
        prisma.incomeEntry.aggregate({
          where: { organizationId, departmentId: department.id, date: range },
          _sum: { amount: true },
        }),
        prisma.expense.aggregate({
          where: { organizationId, departmentId: department.id, date: range, status: POSTED },
          _sum: { total: true },
        }),
      ]);
      const incomeTotal = round2(toNumber(donations._sum.amount) + toNumber(income._sum.amount));
      const expenseTotal = toNumber(expenses._sum.total);
      return {
        department: department.name,
        income: incomeTotal,
        expense: expenseTotal,
        net: round2(incomeTotal - expenseTotal),
      };
    }),
  );

  return {
    columns: [
      { key: 'department', label: 'Department', type: 'text' as const },
      { key: 'income', label: 'Income', type: 'currency' as const, align: 'right' as const },
      { key: 'expense', label: 'Expense', type: 'currency' as const, align: 'right' as const },
      { key: 'net', label: 'Net', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      department: 'Total',
      income: round2(rows.reduce((s, r) => s + r.income, 0)),
      expense: round2(rows.reduce((s, r) => s + r.expense, 0)),
      net: round2(rows.reduce((s, r) => s + r.net, 0)),
    },
    summary: [
      { label: 'Income', value: round2(rows.reduce((s, r) => s + r.income, 0)), type: 'currency' as const, tone: 'positive' as const },
      { label: 'Expense', value: round2(rows.reduce((s, r) => s + r.expense, 0)), type: 'currency' as const, tone: 'negative' as const },
      { label: 'Net', value: round2(rows.reduce((s, r) => s + r.net, 0)), type: 'currency' as const, tone: 'accent' as const },
    ],
    charts: [
      {
        type: 'bar' as const,
        title: 'Department Income vs Expense',
        data: rows,
        xKey: 'department',
        series: [
          { key: 'income', label: 'Income', color: '#0866FF' },
          { key: 'expense', label: 'Expense', color: '#F59E0B' },
        ],
      },
    ],
  };
}

// ----------------------------- 9. Budget vs Actual -------------------------

async function budgetVsActual(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const departments = await prisma.department.findMany({
    where: { organizationId, ...(filters.departmentId ? { id: filters.departmentId } : {}) },
    orderBy: { name: 'asc' },
  });

  const rows = await Promise.all(
    departments.map(async (department) => {
      const actual = await prisma.expense.aggregate({
        where: { organizationId, departmentId: department.id, date: { gte: from, lte: to }, status: POSTED },
        _sum: { total: true },
      });
      const budget = toNumber(department.budgetAmount);
      const spent = toNumber(actual._sum.total);
      return {
        department: department.name,
        budget,
        actual: spent,
        variance: round2(budget - spent),
        utilisation: budget > 0 ? round2((spent / budget) * 100) : 0,
      };
    }),
  );

  return {
    columns: [
      { key: 'department', label: 'Department', type: 'text' as const },
      { key: 'budget', label: 'Budget', type: 'currency' as const, align: 'right' as const },
      { key: 'actual', label: 'Actual', type: 'currency' as const, align: 'right' as const },
      { key: 'variance', label: 'Variance', type: 'currency' as const, align: 'right' as const },
      { key: 'utilisation', label: 'Utilised', type: 'percent' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      department: 'Total',
      budget: round2(rows.reduce((s, r) => s + r.budget, 0)),
      actual: round2(rows.reduce((s, r) => s + r.actual, 0)),
      variance: round2(rows.reduce((s, r) => s + r.variance, 0)),
      utilisation: '',
    },
    summary: [
      { label: 'Total Budget', value: round2(rows.reduce((s, r) => s + r.budget, 0)), type: 'currency' as const },
      { label: 'Total Spent', value: round2(rows.reduce((s, r) => s + r.actual, 0)), type: 'currency' as const, tone: 'negative' as const },
      { label: 'Remaining', value: round2(rows.reduce((s, r) => s + r.variance, 0)), type: 'currency' as const, tone: 'positive' as const },
    ],
    charts: [
      {
        type: 'bar' as const,
        title: 'Budget vs Actual',
        data: rows,
        xKey: 'department',
        series: [
          { key: 'budget', label: 'Budget', color: '#0657D6' },
          { key: 'actual', label: 'Actual', color: '#F59E0B' },
        ],
      },
    ],
  };
}

// ----------------------------- 10. Expense Analysis ------------------------

async function expenseAnalysis(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const groups = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: expenseWhere(organizationId, filters, from, to),
    _sum: { total: true },
    _count: { _all: true },
  });
  const categories = await prisma.expenseCategory.findMany({ where: { organizationId } });
  const names = new Map(categories.map((c) => [c.id, c.name]));

  const total = round2(groups.reduce((sum, g) => sum + toNumber(g._sum.total), 0));

  const rows = groups
    .map((group) => {
      const amount = toNumber(group._sum.total);
      return {
        category: names.get(group.categoryId) ?? 'Uncategorised',
        count: group._count._all,
        amount,
        share: total > 0 ? round2((amount / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    columns: [
      { key: 'category', label: 'Category', type: 'text' as const },
      { key: 'count', label: 'Entries', type: 'number' as const, align: 'right' as const },
      { key: 'amount', label: 'Amount', type: 'currency' as const, align: 'right' as const },
      { key: 'share', label: 'Share', type: 'percent' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      category: 'Total',
      count: rows.reduce((s, r) => s + r.count, 0),
      amount: total,
      share: 100,
    },
    summary: [
      { label: 'Total Expense', value: total, type: 'currency' as const, tone: 'negative' as const },
      { label: 'Categories', value: rows.length, type: 'number' as const },
      { label: 'Entries', value: rows.reduce((s, r) => s + r.count, 0), type: 'number' as const },
    ],
    charts: [
      {
        type: 'donut' as const,
        title: 'Expense by Category',
        data: rows.slice(0, 8).map((r) => ({ name: r.category, value: r.amount })),
        xKey: 'name',
        series: [{ key: 'value', label: 'Amount' }],
      },
    ],
  };
}

// ----------------------------- 11. Donor Report ----------------------------

async function donorReport(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const donations = await prisma.donation.findMany({
    where: {
      organizationId,
      date: { gte: from, lte: to },
      ...(filters.fundId ? { fundId: filters.fundId } : {}),
      ...(filters.donorId ? { donorId: filters.donorId } : {}),
    },
    orderBy: { date: 'desc' },
  });

  const grouped = new Map<string, { donor: string; count: number; amount: number; last: Date }>();
  for (const donation of donations) {
    const key = donation.donorId ?? donation.donorName;
    const existing = grouped.get(key);
    const amount = toNumber(donation.amount);
    if (existing) {
      existing.count += 1;
      existing.amount = round2(existing.amount + amount);
      if (donation.date > existing.last) existing.last = donation.date;
    } else {
      grouped.set(key, { donor: donation.donorName, count: 1, amount, last: donation.date });
    }
  }

  const rows = Array.from(grouped.values())
    .map((row) => ({
      donor: row.donor,
      count: row.count,
      amount: row.amount,
      lastDonation: row.last.toISOString(),
    }))
    .sort((a, b) => b.amount - a.amount);

  const total = round2(rows.reduce((s, r) => s + r.amount, 0));

  return {
    columns: [
      { key: 'donor', label: 'Donor', type: 'text' as const },
      { key: 'count', label: 'Donations', type: 'number' as const, align: 'right' as const },
      { key: 'amount', label: 'Total Amount', type: 'currency' as const, align: 'right' as const },
      { key: 'lastDonation', label: 'Last Donation', type: 'date' as const },
    ],
    rows,
    totalsRow: { donor: 'Total', count: rows.reduce((s, r) => s + r.count, 0), amount: total, lastDonation: '' },
    summary: [
      { label: 'Total Received', value: total, type: 'currency' as const, tone: 'positive' as const },
      { label: 'Donors', value: rows.length, type: 'number' as const },
      { label: 'Donations', value: rows.reduce((s, r) => s + r.count, 0), type: 'number' as const },
    ],
    charts: [
      {
        type: 'bar' as const,
        title: 'Top Donors',
        data: rows.slice(0, 10),
        xKey: 'donor',
        series: [{ key: 'amount', label: 'Amount', color: '#0866FF' }],
      },
    ],
  };
}

// ----------------------------- 12. Donation Summary ------------------------

async function donationSummary(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const where = {
    organizationId,
    date: { gte: from, lte: to },
    ...(filters.fundId ? { fundId: filters.fundId } : {}),
  };

  const [byFund, byMode, funds] = await Promise.all([
    prisma.donation.groupBy({ by: ['fundId'], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.donation.groupBy({ by: ['mode'], where, _sum: { amount: true }, _count: { _all: true } }),
    prisma.fund.findMany({ where: { organizationId } }),
  ]);

  const fundNames = new Map(funds.map((f) => [f.id, f.name]));
  const total = round2(byFund.reduce((sum, g) => sum + toNumber(g._sum.amount), 0));

  const rows = [
    ...byFund.map((group) => ({
      grouping: 'Fund',
      name: fundNames.get(group.fundId) ?? 'Unknown',
      count: group._count._all,
      amount: toNumber(group._sum.amount),
      share: total > 0 ? round2((toNumber(group._sum.amount) / total) * 100) : 0,
    })),
    ...byMode.map((group) => ({
      grouping: 'Mode',
      name: group.mode,
      count: group._count._all,
      amount: toNumber(group._sum.amount),
      share: total > 0 ? round2((toNumber(group._sum.amount) / total) * 100) : 0,
    })),
  ];

  return {
    columns: [
      { key: 'grouping', label: 'Grouped By', type: 'text' as const },
      { key: 'name', label: 'Name', type: 'text' as const },
      { key: 'count', label: 'Count', type: 'number' as const, align: 'right' as const },
      { key: 'amount', label: 'Amount', type: 'currency' as const, align: 'right' as const },
      { key: 'share', label: 'Share', type: 'percent' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: null,
    summary: [
      { label: 'Total Donations', value: total, type: 'currency' as const, tone: 'positive' as const },
      { label: 'Receipts', value: byFund.reduce((s, g) => s + g._count._all, 0), type: 'number' as const },
      { label: 'Funds', value: byFund.length, type: 'number' as const },
    ],
    charts: [
      {
        type: 'donut' as const,
        title: 'Donations by Fund',
        data: byFund.map((g) => ({ name: fundNames.get(g.fundId) ?? 'Unknown', value: toNumber(g._sum.amount) })),
        xKey: 'name',
        series: [{ key: 'value', label: 'Amount' }],
      },
    ],
  };
}

// ----------------------------- 13. Supplier Outstanding ----------------------

async function supplierOutstanding(organizationId: string, filters: ReportFilters) {
  const expenses = await prisma.expense.findMany({
    where: {
      organizationId,
      status: { in: ['APPROVED', 'PAYMENT_PENDING'] },
      paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    },
    include: { supplier: { select: { id: true, name: true } } },
  });

  const now = Date.now();
  const grouped = new Map<
    string,
    { supplier: string; count: number; outstanding: number; current: number; days30: number; days60: number; days90: number }
  >();

  for (const expense of expenses) {
    const key = expense.supplierId ?? 'unassigned';
    const name = expense.supplier?.name ?? 'No supplier';
    const outstanding = round2(toNumber(expense.total) - toNumber(expense.paidAmount));
    if (outstanding <= 0) continue;

    const ageDays = Math.floor((now - expense.date.getTime()) / 86_400_000);
    const row =
      grouped.get(key) ?? { supplier: name, count: 0, outstanding: 0, current: 0, days30: 0, days60: 0, days90: 0 };

    row.count += 1;
    row.outstanding = round2(row.outstanding + outstanding);
    if (ageDays <= 30) row.current = round2(row.current + outstanding);
    else if (ageDays <= 60) row.days30 = round2(row.days30 + outstanding);
    else if (ageDays <= 90) row.days60 = round2(row.days60 + outstanding);
    else row.days90 = round2(row.days90 + outstanding);

    grouped.set(key, row);
  }

  const rows = Array.from(grouped.values()).sort((a, b) => b.outstanding - a.outstanding);
  const total = round2(rows.reduce((s, r) => s + r.outstanding, 0));

  return {
    columns: [
      { key: 'supplier', label: 'Supplier', type: 'text' as const },
      { key: 'count', label: 'Bills', type: 'number' as const, align: 'right' as const },
      { key: 'current', label: '0–30 days', type: 'currency' as const, align: 'right' as const },
      { key: 'days30', label: '31–60 days', type: 'currency' as const, align: 'right' as const },
      { key: 'days60', label: '61–90 days', type: 'currency' as const, align: 'right' as const },
      { key: 'days90', label: '90+ days', type: 'currency' as const, align: 'right' as const },
      { key: 'outstanding', label: 'Outstanding', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      supplier: 'Total',
      count: rows.reduce((s, r) => s + r.count, 0),
      current: round2(rows.reduce((s, r) => s + r.current, 0)),
      days30: round2(rows.reduce((s, r) => s + r.days30, 0)),
      days60: round2(rows.reduce((s, r) => s + r.days60, 0)),
      days90: round2(rows.reduce((s, r) => s + r.days90, 0)),
      outstanding: total,
    },
    summary: [
      { label: 'Total Outstanding', value: total, type: 'currency' as const, tone: 'negative' as const },
      { label: 'Suppliers', value: rows.length, type: 'number' as const },
      { label: 'Open Bills', value: rows.reduce((s, r) => s + r.count, 0), type: 'number' as const },
    ],
    charts: [
      {
        type: 'bar' as const,
        title: 'Outstanding by Supplier',
        data: rows.slice(0, 10),
        xKey: 'supplier',
        series: [{ key: 'outstanding', label: 'Outstanding', color: '#D64545' }],
      },
    ],
  };
}

// ----------------------------- 14. Payment Report --------------------------

async function paymentReport(organizationId: string, filters: ReportFilters, from: Date, to: Date) {
  const payments = await prisma.payment.findMany({
    where: { organizationId, date: { gte: from, lte: to } },
    orderBy: { date: 'desc' },
    include: {
      bankAccount: { select: { name: true } },
      createdBy: { select: { name: true } },
      expense: { select: { expenseNumber: true, title: true, supplier: { select: { name: true } } } },
    },
    take: 2000,
  });

  const rows = payments.map((payment) => ({
    date: payment.date.toISOString(),
    paymentNumber: payment.paymentNumber,
    expense: payment.expense?.expenseNumber ?? '—',
    particulars: payment.expense?.title ?? 'Payment',
    supplier: payment.expense?.supplier?.name ?? '—',
    method: payment.method,
    account: payment.bankAccount?.name ?? 'Cash in Hand',
    reference: payment.referenceNumber ?? '—',
    amount: toNumber(payment.amount),
  }));

  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const byMethod = new Map<string, number>();
  for (const row of rows) byMethod.set(row.method, round2((byMethod.get(row.method) ?? 0) + row.amount));

  return {
    columns: [
      { key: 'date', label: 'Date', type: 'date' as const },
      { key: 'paymentNumber', label: 'Payment #', type: 'text' as const },
      { key: 'expense', label: 'Expense #', type: 'text' as const },
      { key: 'particulars', label: 'Particulars', type: 'text' as const },
      { key: 'supplier', label: 'Supplier', type: 'text' as const },
      { key: 'method', label: 'Method', type: 'text' as const },
      { key: 'account', label: 'Account', type: 'text' as const },
      { key: 'reference', label: 'Reference', type: 'text' as const },
      { key: 'amount', label: 'Amount', type: 'currency' as const, align: 'right' as const },
    ],
    rows,
    totalsRow: {
      date: '',
      paymentNumber: '',
      expense: '',
      particulars: 'Total',
      supplier: '',
      method: '',
      account: '',
      reference: '',
      amount: total,
    },
    summary: [
      { label: 'Total Paid', value: total, type: 'currency' as const, tone: 'negative' as const },
      { label: 'Payments', value: rows.length, type: 'number' as const },
    ],
    charts: [
      {
        type: 'donut' as const,
        title: 'Payments by Method',
        data: Array.from(byMethod.entries()).map(([name, value]) => ({ name, value })),
        xKey: 'name',
        series: [{ key: 'value', label: 'Amount' }],
      },
    ],
  };
}
