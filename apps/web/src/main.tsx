import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import App from './App';
import { queryClient } from './lib/api/queryClient';
import { AuthProvider } from './lib/auth/AuthProvider';
import './index.css';
import './i18n';
import { SkipLink } from './components/layout/SkipLink';
import { ErrorBoundary } from './components/common/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipPrimitive.Provider delayDuration={250}>
            <SkipLink />
            <ErrorBoundary fullPage>
              <App />
            </ErrorBoundary>
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{
                style: { fontSize: '13px', borderRadius: '10px' },
              }}
            />
          </TooltipPrimitive.Provider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
