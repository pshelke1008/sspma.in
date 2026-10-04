import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CalendarRange,
  ChevronRight,
  DatabaseBackup,
  ListTree,
  MessageCircle,
  ScrollText,
  ShieldCheck,
  UserCircle,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { Permission } from '@ashram/types';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatNumber } from '@/lib/utils/format';

interface SettingsSummary {
  organization: { name: string; city: string | null; email: string | null };
  counts: { users: number; roles: number; auditLogs: number; expenses: number };
}

interface SettingItem {
  titleKey: string;
  descriptionKey: string;
  to: string;
  icon: LucideIcon;
  permission: Permission;
  badge?: (t: TFunction, summary?: SettingsSummary) => string | undefined;
}

const GROUPS: { titleKey: string; items: SettingItem[] }[] = [
  {
    titleKey: 'settings.groupOrganization',
    items: [
      {
        titleKey: 'settings.profileTitle',
        descriptionKey: 'settings.profileText',
        to: '/settings/organization',
        icon: Building2,
        permission: 'settings.view',
      },
      {
        titleKey: 'settings.fyTitle',
        descriptionKey: 'settings.fyText',
        to: '/settings/financial-year',
        icon: CalendarRange,
        permission: 'settings.view',
      },
      {
        titleKey: 'settings.coaTitle',
        descriptionKey: 'settings.coaText',
        to: '/settings/chart-of-accounts',
        icon: ListTree,
        permission: 'settings.view',
      },
    ],
  },
  {
    titleKey: 'settings.groupUsers',
    items: [
      {
        titleKey: 'settings.usersTitle',
        descriptionKey: 'settings.usersText',
        to: '/settings/users',
        icon: Users,
        permission: 'user.view',
        badge: (t, summary) => (summary ? t('settings.usersBadge', { count: summary.counts.users }) : undefined),
      },
      {
        titleKey: 'settings.rolesTitle',
        descriptionKey: 'settings.rolesText',
        to: '/settings/roles',
        icon: ShieldCheck,
        permission: 'user.view',
        badge: (t, summary) => (summary ? t('settings.rolesBadge', { count: summary.counts.roles }) : undefined),
      },
    ],
  },
  {
    titleKey: 'settings.groupCommunication',
    items: [
      {
        titleKey: 'settings.whatsappTitle',
        descriptionKey: 'settings.whatsappText',
        to: '/settings/whatsapp',
        icon: MessageCircle,
        permission: 'whatsapp.manage',
      },
    ],
  },
  {
    titleKey: 'settings.groupSystem',
    items: [
      {
        titleKey: 'settings.backupTitle',
        descriptionKey: 'settings.backupText',
        to: '/settings/data',
        icon: DatabaseBackup,
        permission: 'settings.view',
      },
      {
        titleKey: 'settings.auditTitle',
        descriptionKey: 'settings.auditText',
        to: '/settings/audit-logs',
        icon: ScrollText,
        permission: 'audit.view',
        badge: (t, summary) =>
          summary ? t('settings.auditBadge', { count: summary.counts.auditLogs, formatted: formatNumber(summary.counts.auditLogs) }) : undefined,
      },
    ],
  },
  {
    titleKey: 'settings.groupAccount',
    items: [
      {
        titleKey: 'common.myProfile',
        descriptionKey: 'settings.myProfileText',
        to: '/settings/profile',
        icon: UserCircle,
        permission: 'dashboard.view',
      },
    ],
  },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { can, user } = useAuth();

  const { data } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<SettingsSummary>('/settings'),
    enabled: can('settings.view'),
  });

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle', { name: user?.organization.name ?? t('settings.yourOrganization') })}
      />

      <div className="space-y-6">
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => can(item.permission));
          if (items.length === 0) return null;

          return (
            <section key={group.titleKey}>
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                {t(group.titleKey)}
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card">
                {items.map((item) => {
                  const Icon = item.icon;
                  const badge = item.badge?.(t, data);
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-light">
                          <Icon className="h-[18px] w-[18px] text-brand" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium text-ink">{t(item.titleKey)}</span>
                          <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">
                            {t(item.descriptionKey)}
                          </span>
                        </span>
                        {badge && (
                          <span className="hidden shrink-0 text-[11.5px] text-ink-muted sm:block">{badge}</span>
                        )}
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
