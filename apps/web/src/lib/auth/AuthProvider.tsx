import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Permission, SessionUser } from '@ashram/types';
import { ApiError, api } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { applyLocale } from '@/i18n';

interface AuthContextValue {
  user: SessionUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: { identifier: string; password: string; rememberMe?: boolean }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (...permissions: Permission[]) => boolean;
  canAll: (...permissions: Permission[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.session,
    // The endpoint answers with `user: null` when nobody is signed in, so this
    // probe is a normal successful request on the login screen too.
    queryFn: async () => {
      const result = await api.get<{ user: SessionUser | null }>('/auth/me');
      // Switch language before the signed-in layout renders. Applied later from
      // an effect, the change races components mounting in the same commit, and
      // under StrictMode's re-run of effects they can miss it and stay in the
      // previous language until the next reload.
      if (result.user?.locale) await applyLocale(result.user.locale);
      return result;
    },
    retry: false,
    staleTime: 5 * 60_000,
    throwOnError: false,
  });

  const user = data?.user ?? null;

  const loginMutation = useMutation({
    mutationFn: async (input: { identifier: string; password: string; rememberMe?: boolean }) => {
      const result = await api.post<{ user: SessionUser }>('/auth/login', input);
      if (result.user.locale) await applyLocale(result.user.locale);
      return result;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.session, result);
    },
  });

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    queryClient.setQueryData(queryKeys.session, null);
    queryClient.clear();
  }, []);

  // A session that expires mid-session drops the user back to the login screen
  // rather than leaving a half-broken page behind.
  useEffect(() => {
    function handleExpiry() {
      queryClient.setQueryData(queryKeys.session, null);
    }
    window.addEventListener('ashram:session-expired', handleExpiry);
    return () => window.removeEventListener('ashram:session-expired', handleExpiry);
  }, []);

  const permissionSet = useMemo(() => new Set(user?.permissions ?? []), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login: async (input) => (await loginMutation.mutateAsync(input)).user,
      logout,
      can: (...permissions) => permissions.some((permission) => permissionSet.has(permission)),
      canAll: (...permissions) => permissions.every((permission) => permissionSet.has(permission)),
    }),
    [user, isLoading, loginMutation, logout, permissionSet],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
