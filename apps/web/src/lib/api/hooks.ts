import { useQuery } from '@tanstack/react-query';
import { api, buildQuery } from './client';
import { queryKeys } from './queryClient';

export interface MasterOption {
  id: string;
  name: string;
  code?: string;
}

export interface MastersResponse {
  departments: (MasterOption & { budgetAmount: number; colorToken: string | null })[];
  funds: (MasterOption & { openingBalance: number; isRestricted: boolean })[];
  costCenters: (MasterOption & { departmentId: string | null })[];
  categories: (MasterOption & { accountId: string | null })[];
  suppliers: (MasterOption & { phone: string | null; contactPerson: string | null; city: string | null })[];
  bankAccounts: (MasterOption & { accountType: string; openingBalance: number; bankName: string | null })[];
  donors: MasterOption[];
  financialYears: { id: string; label: string; isActive: boolean; startDate: string; endDate: string }[];
  accounts: (MasterOption & { code: string; type: string; openingBalance: number })[];
}

/** One cached call that backs every dropdown in the application. */
export function useMasters() {
  return useQuery({
    queryKey: queryKeys.masters,
    queryFn: () => api.get<MastersResponse>('/masters'),
    staleTime: 10 * 60_000,
  });
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.get<{ data: NotificationItem[]; unreadCount: number }>('/notifications' + buildQuery({ limit: 25 })),
    refetchInterval: 60_000,
  });
}

export function useApprovalCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.approvalCount,
    queryFn: () => api.get<{ count: number }>('/approvals/count'),
    enabled,
    refetchInterval: 60_000,
  });
}
