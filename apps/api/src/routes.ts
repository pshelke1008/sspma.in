import { Router } from 'express';
import { requireAuth } from './middleware/auth';
import { apiLimiter } from './middleware/rateLimit';
import { authRouter } from './modules/auth/auth.routes';
import { dashboardRouter, financeRouter } from './modules/dashboard/dashboard.routes';
import { expenseRouter } from './modules/expenses/expense.routes';
import { approvalsRouter } from './modules/approvals/approvals.routes';
import { mastersRouter } from './modules/masters/masters.routes';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { rolesRouter, usersRouter } from './modules/users/users.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { donationsRouter, incomeRouter } from './modules/donations/donations.routes';
import { purchasesRouter } from './modules/purchases/purchases.routes';
import { bankingRouter } from './modules/banking/banking.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { donorsRouter } from './modules/donors/donor.routes';
import { whatsappRouter } from './modules/whatsapp/whatsapp.routes';
import { whatsappWebhookRouter } from './modules/whatsapp/webhook.routes';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ashram-management-api', time: new Date().toISOString() });
});

// Public
apiRouter.use('/auth', authRouter);
// Authenticated by Meta's request signature rather than a session.
apiRouter.use('/webhooks/whatsapp', whatsappWebhookRouter);

// Everything below requires a valid session, and every handler derives its
// organizationId from that session rather than from the request body.
apiRouter.use(requireAuth, apiLimiter);

apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/finance', financeRouter);
apiRouter.use('/expenses', expenseRouter);
apiRouter.use('/approvals', approvalsRouter);
apiRouter.use('/masters', mastersRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/audit-logs', auditRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/roles', rolesRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/donations', donationsRouter);
apiRouter.use('/income', incomeRouter);
apiRouter.use('/purchases', purchasesRouter);
apiRouter.use('/banking', bankingRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/donors', donorsRouter);
apiRouter.use('/whatsapp', whatsappRouter);
