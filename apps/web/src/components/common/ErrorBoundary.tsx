import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, Home, RefreshCw } from 'lucide-react';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';

/**
 * After a deploy the old page's lazy chunks no longer exist on the server, so
 * navigating fails with a dynamic-import error. Only a full reload fixes that.
 */
function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      error.message,
    )
  );
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors and failed lazy-route loads so the user gets a way
 * forward instead of a blank white page. Give it a `key` that changes on
 * navigation to clear the error when the user moves to another page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; fullPage?: boolean }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const t = i18n.t.bind(i18n);
    const chunk = isChunkLoadError(error);

    return (
      <div
        className={
          this.props.fullPage
            ? 'flex min-h-screen items-center justify-center bg-canvas px-4'
            : 'flex min-h-[50vh] items-center justify-center px-4'
        }
      >
        <div className="flex max-w-md flex-col items-center text-center" role="alert">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
            <AlertCircle className="h-5 w-5 text-danger" aria-hidden="true" />
          </span>
          <h1 className="mt-3 text-[16px] font-semibold text-ink">
            {chunk ? t('states.updateTitle') : t('states.crashTitle')}
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {chunk ? t('states.updateText') : t('states.crashText')}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t('states.reload')}
            </Button>
            {!chunk && (
              <Button variant="outline" onClick={() => window.location.assign('/dashboard')}>
                <Home className="h-3.5 w-3.5" aria-hidden="true" />
                {t('states.goToDashboard')}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
