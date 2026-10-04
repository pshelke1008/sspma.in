import type { ReactNode } from 'react';
import type { Permission } from '@ashram/types';
import { useAuth } from '../auth/AuthProvider';

/**
 * Renders children only when the user holds one of the permissions.
 * This controls what is *shown*; the API independently controls what is
 * *allowed*, so hiding a control is never the security boundary.
 */
export function Can({
  permission,
  fallback = null,
  children,
}: {
  permission: Permission | Permission[];
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { can } = useAuth();
  const permissions = Array.isArray(permission) ? permission : [permission];
  return can(...permissions) ? <>{children}</> : <>{fallback}</>;
}

export function usePermission(...permissions: Permission[]): boolean {
  const { can } = useAuth();
  return can(...permissions);
}
