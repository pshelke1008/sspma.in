import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        // Never retry an authorization or validation failure.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

/** Query keys are namespaced so a mutation can invalidate precisely. */
export const queryKeys = {
  session: ['session'] as const,
  masters: ['masters'] as const,
  dashboard: (params: unknown) => ['dashboard', params] as const,
  finance: (params: unknown) => ['finance', params] as const,
  expenses: (params: unknown) => ['expenses', params] as const,
  expense: (id: string) => ['expense', id] as const,
  expenseActivity: (id: string) => ['expense', id, 'activity'] as const,
  approvals: (params: unknown) => ['approvals', params] as const,
  approvalCount: ['approvals', 'count'] as const,
  notifications: ['notifications'] as const,
  donations: (params: unknown) => ['donations', params] as const,
  donationSummary: ['donations', 'summary'] as const,
  purchases: (params: unknown) => ['purchases', params] as const,
  banking: ['banking'] as const,
  bankTransfers: ['banking', 'transfers'] as const,
  reports: ['reports'] as const,
  report: (key: string, filters: unknown) => ['report', key, filters] as const,
  users: (params: unknown) => ['users', params] as const,
  roles: ['roles'] as const,
  settings: ['settings'] as const,
  auditLogs: (params: unknown) => ['audit-logs', params] as const,
  income: ['income'] as const,
  donors: (params: unknown) => ['donors', params] as const,
  donorSummary: ['donors', 'summary'] as const,
  donor: (id: string) => ['donor', id] as const,
  whatsappStatus: ['whatsapp', 'status'] as const,
  whatsappTemplates: ['whatsapp', 'templates'] as const,
  whatsappTemplatesAll: (numberId: string) => ['whatsapp', 'templates', 'all', numberId] as const,
  broadcasts: ['whatsapp', 'broadcasts'] as const,
  broadcast: (id: string) => ['whatsapp', 'broadcast', id] as const,
  broadcastMessages: (id: string, status: string, page: number) => ['whatsapp', 'broadcast', id, 'messages', status, page] as const,
  campaignTemplates: ['whatsapp', 'templates', 'campaign'] as const,
  inboxConversations: (params: unknown) => ['whatsapp', 'inbox', 'conversations', params] as const,
  inboxConversation: (phone: string) => ['whatsapp', 'inbox', 'conversation', phone] as const,
  inboxThread: (phone: string) => ['whatsapp', 'inbox', 'thread', phone] as const,
  inboxUnread: ['whatsapp', 'inbox', 'unread'] as const,
  inboxNumbers: ['whatsapp', 'inbox', 'numbers'] as const,
  inboxTemplates: (numberId: string) => ['whatsapp', 'inbox', 'templates', numberId] as const,
};

/** Called after any workflow action so every dependent view refreshes. */
export function invalidateFinancialData() {
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['finance'] });
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  queryClient.invalidateQueries({ queryKey: ['expense'] });
  queryClient.invalidateQueries({ queryKey: ['approvals'] });
  queryClient.invalidateQueries({ queryKey: ['notifications'] });
  queryClient.invalidateQueries({ queryKey: ['report'] });
  queryClient.invalidateQueries({ queryKey: ['banking'] });
  queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
}

/** Called after a donation or donor change: lists, summaries, profiles and the finance views. */
export function invalidateDonationData() {
  invalidateFinancialData();
  queryClient.invalidateQueries({ queryKey: ['donations'] });
  queryClient.invalidateQueries({ queryKey: ['donors'] });
  queryClient.invalidateQueries({ queryKey: ['donor'] });
  queryClient.invalidateQueries({ queryKey: queryKeys.masters });
}
