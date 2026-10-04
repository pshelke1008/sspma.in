import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute, RequirePermission } from '@/components/layout/ProtectedRoute';

// Route-level code splitting keeps the initial bundle small.
const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const FinancePage = lazy(() => import('@/features/finance/FinancePage'));
const ExpenseListPage = lazy(() => import('@/features/expenses/ExpenseListPage'));
const ExpenseWizardPage = lazy(() => import('@/features/expenses/ExpenseWizardPage'));
const ExpenseDetailPage = lazy(() => import('@/features/expenses/ExpenseDetailPage'));
const ApprovalsPage = lazy(() => import('@/features/approvals/ApprovalsPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const ReportViewPage = lazy(() => import('@/features/reports/ReportViewPage'));
const DonationsPage = lazy(() => import('@/features/donations/DonationsPage'));
const DonorsPage = lazy(() => import('@/features/donors/DonorsPage'));
const DonorProfilePage = lazy(() => import('@/features/donors/DonorProfilePage'));
const WhatsAppSettingsPage = lazy(() => import('@/features/whatsapp/WhatsAppSettingsPage'));
const PurchasesPage = lazy(() => import('@/features/purchases/PurchasesPage'));
const BankingPage = lazy(() => import('@/features/banking/BankingPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const OrganizationSettingsPage = lazy(() => import('@/features/settings/OrganizationSettingsPage'));
const FinancialYearPage = lazy(() => import('@/features/settings/FinancialYearPage'));
const ChartOfAccountsPage = lazy(() => import('@/features/settings/ChartOfAccountsPage'));
const UsersPage = lazy(() => import('@/features/settings/UsersPage'));
const RolesPage = lazy(() => import('@/features/settings/RolesPage'));
const AuditLogPage = lazy(() => import('@/features/settings/AuditLogPage'));
const DataToolsPage = lazy(() => import('@/features/settings/DataToolsPage'));
const ProfilePage = lazy(() => import('@/features/settings/ProfilePage'));
const NotFoundPage = lazy(() => import('@/features/NotFoundPage'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />

          <Route element={<RequirePermission permission="dashboard.view" />}>
            <Route path="/dashboard" element={<DashboardPage />} />
          </Route>

          <Route element={<RequirePermission permission="finance.view" />}>
            <Route path="/finance" element={<FinancePage />} />
          </Route>

          <Route element={<RequirePermission permission="expense.view" />}>
            <Route path="/expenses" element={<ExpenseListPage />} />
            <Route path="/expenses/:id" element={<ExpenseDetailPage />} />
          </Route>
          <Route element={<RequirePermission permission="expense.create" />}>
            <Route path="/expenses/new" element={<ExpenseWizardPage />} />
          </Route>
          <Route element={<RequirePermission permission="expense.edit" />}>
            <Route path="/expenses/:id/edit" element={<ExpenseWizardPage />} />
          </Route>

          <Route element={<RequirePermission permission={['expense.approve', 'expense.view']} />}>
            <Route path="/approvals" element={<ApprovalsPage />} />
          </Route>

          <Route element={<RequirePermission permission="report.view" />}>
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/:key" element={<ReportViewPage />} />
          </Route>

          <Route element={<RequirePermission permission="donation.view" />}>
            <Route path="/donations" element={<DonationsPage />} />
          </Route>

          <Route element={<RequirePermission permission="donor.view" />}>
            <Route path="/donors" element={<DonorsPage />} />
            <Route path="/donors/:id" element={<DonorProfilePage />} />
          </Route>

          <Route element={<RequirePermission permission="purchase.view" />}>
            <Route path="/purchases" element={<PurchasesPage />} />
          </Route>

          <Route element={<RequirePermission permission="banking.view" />}>
            <Route path="/banking" element={<BankingPage />} />
          </Route>

          <Route path="/settings/profile" element={<ProfilePage />} />
          <Route element={<RequirePermission permission="settings.view" />}>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/organization" element={<OrganizationSettingsPage />} />
            <Route path="/settings/financial-year" element={<FinancialYearPage />} />
            <Route path="/settings/chart-of-accounts" element={<ChartOfAccountsPage />} />
            <Route path="/settings/data" element={<DataToolsPage />} />
          </Route>
          <Route element={<RequirePermission permission="user.view" />}>
            <Route path="/settings/users" element={<UsersPage />} />
            <Route path="/settings/roles" element={<RolesPage />} />
          </Route>
          <Route element={<RequirePermission permission="audit.view" />}>
            <Route path="/settings/audit-logs" element={<AuditLogPage />} />
          </Route>
          <Route element={<RequirePermission permission="whatsapp.manage" />}>
            <Route path="/settings/whatsapp" element={<WhatsAppSettingsPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
