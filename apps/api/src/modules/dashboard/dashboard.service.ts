import { prisma } from '../../db';
import { round2, toNumber } from '../../lib/money';
import { financialYearRange, monthsBetween, currentFinancialYearLabel } from '../../lib/dates';

export interface DashboardQuery {
  financialYear?: string;
  month?: string; // 'all' | '1'..'12'
}

function resolveRange(query: DashboardQuery) {
  const label = query.financialYear ?? currentFinancialYearLabel();
  const fy = financialYearRange(label);
  if (!query.month || query.month === 'all') return { label, ...fy };

  const monthNumber = Number.parseInt(query.month, 10);
  if (!Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return { label, ...fy };

  // April–December belong to the first calendar year of the FY.
  const startYear = Number.parseInt(label.split('-')[0], 10);
  const year = monthNumber >= 4 ? startYear : startYear + 1;
  const start = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, monthNumber, 0, 23, 59, 59, 999);
  return { label, start, end };
}

/** Everything the dashboard renders, computed from the ledger, not hard-coded. */
export async function getDashboard(organizationId: string, query: DashboardQuery) {
  const { label, start, end } = resolveRange(query);
  const dateFilter = { gte: start, lte: end };

  const [
    donationsAgg,
    incomeAgg,
    expenseAgg,
    payableAgg,
    bankAccounts,
    departments,
    funds,
    pendingExpenses,
    pendingApprovals,
    pendingPayments,
    recentExpenses,
  ] = await Promise.all([
    prisma.donation.aggregate({ where: { organizationId, date: dateFilter }, _sum: { amount: true } }),
    prisma.incomeEntry.aggregate({ where: { organizationId, date: dateFilter }, _sum: { amount: true } }),
    prisma.expense.aggregate({
      where: { organizationId, date: dateFilter, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
      _sum: { total: true },
    }),
    prisma.expense.aggregate({
      where: {
        organizationId,
        status: { in: ['APPROVED', 'PAYMENT_PENDING'] },
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      },
      _sum: { total: true, paidAmount: true },
    }),
    prisma.bankAccount.findMany({ where: { organizationId, isActive: true } }),
    prisma.department.findMany({ where: { organizationId, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.fund.findMany({ where: { organizationId, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.expense.count({ where: { organizationId, status: 'DRAFT' } }),
    prisma.expense.count({ where: { organizationId, status: 'PENDING_APPROVAL' } }),
    prisma.expense.count({
      where: { organizationId, status: { in: ['APPROVED', 'PAYMENT_PENDING'] }, paymentStatus: { not: 'PAID' } },
    }),
    prisma.expense.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        expenseNumber: true,
        title: true,
        date: true,
        total: true,
        status: true,
        department: { select: { name: true } },
      },
    }),
  ]);

  const income = round2(toNumber(donationsAgg._sum.amount) + toNumber(incomeAgg._sum.amount));
  const expenses = toNumber(expenseAgg._sum.total);
  const payables = round2(toNumber(payableAgg._sum.total) - toNumber(payableAgg._sum.paidAmount));

  // Balance = opening balances + all money in − all money out, across the FY.
  const [allDonations, allIncome, allPaid, openingSum] = await Promise.all([
    prisma.donation.aggregate({ where: { organizationId }, _sum: { amount: true } }),
    prisma.incomeEntry.aggregate({ where: { organizationId }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { organizationId }, _sum: { amount: true } }),
    Promise.resolve(bankAccounts.reduce((sum, account) => sum + toNumber(account.openingBalance), 0)),
  ]);

  const totalBalance = round2(
    openingSum + toNumber(allDonations._sum.amount) + toNumber(allIncome._sum.amount) - toNumber(allPaid._sum.amount),
  );

  // Income vs expenses by month
  const months = monthsBetween(start, end);
  const series = await Promise.all(
    months.map(async (month) => {
      const range = { gte: month.start, lte: month.end };
      const [d, i, e] = await Promise.all([
        prisma.donation.aggregate({ where: { organizationId, date: range }, _sum: { amount: true } }),
        prisma.incomeEntry.aggregate({ where: { organizationId, date: range }, _sum: { amount: true } }),
        prisma.expense.aggregate({
          where: { organizationId, date: range, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
          _sum: { total: true },
        }),
        ]);
      return {
        month: month.label.split(' ')[0],
        key: month.key,
        income: round2(toNumber(d._sum.amount) + toNumber(i._sum.amount)),
        expenses: toNumber(e._sum.total),
      };
    }),
  );

  // Department spend
  const departmentGroups = await prisma.expense.groupBy({
    by: ['departmentId'],
    where: { organizationId, date: dateFilter, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
    _sum: { total: true },
  });
  const departmentMap = new Map(departmentGroups.map((g) => [g.departmentId, toNumber(g._sum.total)]));
  const departmentExpenses = departments
    .map((department) => ({
      id: department.id,
      name: department.name,
      code: department.code,
      amount: departmentMap.get(department.id) ?? 0,
      budget: toNumber(department.budgetAmount),
    }))
    .sort((a, b) => b.amount - a.amount);

  // Fund balances: opening + inflow − outflow
  const [fundDonations, fundIncome, fundExpenses] = await Promise.all([
    prisma.donation.groupBy({ by: ['fundId'], where: { organizationId }, _sum: { amount: true } }),
    prisma.incomeEntry.groupBy({ by: ['fundId'], where: { organizationId }, _sum: { amount: true } }),
    prisma.expense.groupBy({
      by: ['fundId'],
      where: { organizationId, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
      _sum: { total: true },
    }),
  ]);
  const inflow = new Map<string, number>();
  for (const row of fundDonations) inflow.set(row.fundId, (inflow.get(row.fundId) ?? 0) + toNumber(row._sum.amount));
  for (const row of fundIncome) inflow.set(row.fundId, (inflow.get(row.fundId) ?? 0) + toNumber(row._sum.amount));
  const outflow = new Map(fundExpenses.map((row) => [row.fundId, toNumber(row._sum.total)]));

  const fundBalances = funds.map((fund) => {
    const received = round2(inflow.get(fund.id) ?? 0);
    const spent = round2(outflow.get(fund.id) ?? 0);
    return {
      id: fund.id,
      name: fund.name,
      code: fund.code,
      received,
      spent,
      balance: round2(toNumber(fund.openingBalance) + received - spent),
    };
  });

  return {
    period: { financialYear: label, month: query.month ?? 'all', start, end },
    stats: {
      totalBalance,
      income,
      expenses,
      payables,
      netSurplus: round2(income - expenses),
    },
    charts: { incomeVsExpenses: series, departmentExpenses },
    fundBalances,
    pendingActions: {
      expenses: pendingExpenses,
      payments: pendingPayments,
      approvals: pendingApprovals,
    },
    recentExpenses: recentExpenses.map((expense) => ({ ...expense, total: toNumber(expense.total) })),
  };
}

/** Finance Overview: income by source, expenses by department, transactions. */
export async function getFinanceOverview(organizationId: string, query: DashboardQuery) {
  const { label, start, end } = resolveRange(query);
  const dateFilter = { gte: start, lte: end };

  const [donations, incomeEntries, expenseAgg, departments, categories] = await Promise.all([
    prisma.donation.aggregate({ where: { organizationId, date: dateFilter }, _sum: { amount: true } }),
    prisma.incomeEntry.findMany({ where: { organizationId, date: dateFilter }, select: { source: true, amount: true } }),
    prisma.expense.aggregate({
      where: { organizationId, date: dateFilter, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
      _sum: { total: true },
    }),
    prisma.department.findMany({ where: { organizationId, isActive: true } }),
    prisma.expenseCategory.findMany({ where: { organizationId, isActive: true } }),
  ]);

  const incomeBySourceMap = new Map<string, number>();
  incomeBySourceMap.set('Donations', toNumber(donations._sum.amount));
  for (const entry of incomeEntries) {
    incomeBySourceMap.set(entry.source, round2((incomeBySourceMap.get(entry.source) ?? 0) + toNumber(entry.amount)));
  }

  const departmentGroups = await prisma.expense.groupBy({
    by: ['departmentId'],
    where: { organizationId, date: dateFilter, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
    _sum: { total: true },
  });
  const departmentNames = new Map(departments.map((d) => [d.id, d.name]));

  const categoryGroups = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { organizationId, date: dateFilter, status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED'] } },
    _sum: { total: true },
  });
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  // Recent transactions across donations, income and expenses.
  const [recentDonations, recentIncome, recentExpenses] = await Promise.all([
    prisma.donation.findMany({
      where: { organizationId, date: dateFilter },
      orderBy: { date: 'desc' },
      take: 12,
      select: { id: true, receiptNumber: true, date: true, donorName: true, amount: true },
    }),
    prisma.incomeEntry.findMany({
      where: { organizationId, date: dateFilter },
      orderBy: { date: 'desc' },
      take: 12,
      select: { id: true, entryNumber: true, date: true, source: true, amount: true },
    }),
    prisma.expense.findMany({
      where: { organizationId, date: dateFilter, status: { notIn: ['DRAFT'] } },
      orderBy: { date: 'desc' },
      take: 12,
      select: { id: true, expenseNumber: true, date: true, title: true, total: true, status: true },
    }),
  ]);

  const transactions = [
    ...recentDonations.map((d) => ({
      id: d.id,
      reference: d.receiptNumber,
      date: d.date,
      particulars: `Donation — ${d.donorName}`,
      amount: toNumber(d.amount),
      direction: 'IN' as const,
      status: 'Received',
      link: '/donations',
    })),
    ...recentIncome.map((i) => ({
      id: i.id,
      reference: i.entryNumber,
      date: i.date,
      particulars: `Income — ${i.source}`,
      amount: toNumber(i.amount),
      direction: 'IN' as const,
      status: 'Received',
      link: '/finance',
    })),
    ...recentExpenses.map((e) => ({
      id: e.id,
      reference: e.expenseNumber,
      date: e.date,
      particulars: e.title,
      amount: toNumber(e.total),
      direction: 'OUT' as const,
      status: e.status,
      link: `/expenses/${e.id}`,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 15);

  const income = round2(
    toNumber(donations._sum.amount) + incomeEntries.reduce((sum, e) => sum + toNumber(e.amount), 0),
  );
  const expense = toNumber(expenseAgg._sum.total);

  return {
    period: { financialYear: label, month: query.month ?? 'all', start, end },
    stats: { income, expense, netSurplus: round2(income - expense) },
    charts: {
      incomeBySource: Array.from(incomeBySourceMap.entries())
        .filter(([, amount]) => amount > 0)
        .map(([name, amount]) => ({ name, amount })),
      expensesByDepartment: departmentGroups
        .map((group) => ({
          name: departmentNames.get(group.departmentId) ?? 'Unassigned',
          amount: toNumber(group._sum.total),
        }))
        .filter((row) => row.amount > 0)
        .sort((a, b) => b.amount - a.amount),
      expensesByCategory: categoryGroups
        .map((group) => ({
          name: categoryNames.get(group.categoryId) ?? 'Uncategorised',
          amount: toNumber(group._sum.total),
        }))
        .filter((row) => row.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8),
    },
    transactions,
  };
}
