import { Suspense, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileDrawer } from './MobileDrawer';
import { BottomNav } from './BottomNav';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar />
      <MobileDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      <div className="flex min-h-screen flex-col lg:pl-[240px]">
        <Header onOpenMenu={() => setDrawerOpen(true)} />
        <main id="main-content" className="flex-1 px-3 pb-[calc(var(--bottom-nav-height)+1rem)] pt-4 sm:px-5 lg:pb-8">
          {/* Keyed by path so moving to another page clears a caught error. */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[50vh] items-center justify-center" aria-live="polite" aria-busy="true">
      <Loader2 className="h-5 w-5 animate-spin text-brand-primary" aria-hidden="true" />
      <span className="sr-only">{t('auth.loadingPage')}</span>
    </div>
  );
}
