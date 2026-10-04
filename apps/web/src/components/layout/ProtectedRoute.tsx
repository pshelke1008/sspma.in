import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, ShieldAlert } from 'lucide-react';
import type { Permission } from '@ashram/types';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Button } from '@/components/ui/button';

/** Gate for authenticated areas; unauthenticated users go back to /login. */
export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/**
 * Route-level permission gate. The API enforces the same rule independently —
 * this only avoids showing a page the user could not use.
 */
export function RequirePermission({ permission }: { permission: Permission | Permission[] }) {
  const { can } = useAuth();
  const permissions = Array.isArray(permission) ? permission : [permission];
  if (!can(...permissions)) return <AccessDenied />;
  return <Outlet />;
}

export function FullPageLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-brand-primary" aria-hidden="true" />
        <p className="text-[12.5px] text-ink-muted">{t('auth.loadingApp')}</p>
      </div>
    </div>
  );
}

export function AccessDenied() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-danger/10">
        <ShieldAlert className="h-6 w-6 text-danger" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-[18px] font-semibold text-ink">{t('auth.noAccessTitle')}</h1>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">{t('auth.noAccessText')}</p>
      <Button asChild variant="outline" className="mt-5">
        <a href="/dashboard">{t('auth.backToDashboard')}</a>
      </Button>
    </div>
  );
}
