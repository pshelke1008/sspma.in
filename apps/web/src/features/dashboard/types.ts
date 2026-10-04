export interface DashboardData {
  period: { financialYear: string; month: string; start: string; end: string };
  stats: { totalBalance: number; income: number; expenses: number; payables: number; netSurplus: number };
  charts: {
    incomeVsExpenses: { month: string; key: string; income: number; expenses: number }[];
    departmentExpenses: { id: string; name: string; code: string; amount: number; budget: number }[];
  };
  fundBalances: { id: string; name: string; code: string; received: number; spent: number; balance: number }[];
  pendingActions: { expenses: number; payments: number; approvals: number };
  recentExpenses: {
    id: string;
    expenseNumber: string;
    title: string;
    date: string;
    total: number;
    status: string;
    department: { name: string };
  }[];
}
