import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  filters,
  className,
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  filters?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('mb-4', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label={t('forms.breadcrumb')} className="mb-1.5">
          <ol className="flex flex-wrap items-center gap-1 text-[11.5px] text-ink-muted">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {crumb.to ? (
                  <Link to={crumb.to} className="rounded transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand-primary/50">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-ink">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-ink sm:text-[24px]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-ink-muted sm:text-[13px]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {filters && <div className="mt-3 flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
  );
}
