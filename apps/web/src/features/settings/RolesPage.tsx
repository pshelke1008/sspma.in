import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSION_GROUPS, type Permission } from '@ashram/types';
import { api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { ChartSkeleton, ErrorState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/misc';
import { cn } from '@/lib/utils/cn';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export default function RolesPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { can } = useAuth();
  const editable = can('settings.manage');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.get<{ data: Role[] }>('/roles'),
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());

  const roles = data?.data ?? [];
  const selected = roles.find((role) => role.id === selectedId) ?? roles[0];

  useEffect(() => {
    if (selected) {
      setSelectedId(selected.id);
      setDraft(new Set(selected.permissions));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, data]);

  const mutation = useMutation({
    mutationFn: (permissions: string[]) => api.put(`/roles/${selected!.id}/permissions`, { permissions }),
    onSuccess: () => {
      toast.success(t('roles.updated'), { description: t('roles.updatedText') });
      queryClient.invalidateQueries({ queryKey: queryKeys.roles });
      queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
    onError: (err) =>
      toast.error(t('roles.failed'), { description: errorMessage(t, err) }),
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  // Permission keys contain dots, so read whole maps rather than key-path lookups.
  const groupLabels = t('roles.groups', { returnObjects: true }) as Record<string, string>;
  const permissionLabels = t('roles.permissions', { returnObjects: true }) as Record<string, string>;

  const dirty =
    selected &&
    (draft.size !== selected.permissions.length || selected.permissions.some((key) => !draft.has(key)));

  function toggle(key: string, checked: boolean) {
    setDraft((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title={t('settings.rolesTitle')}
        subtitle={t('roles.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.rolesTitle') }]}
      />

      {isLoading ? (
        <ChartSkeleton height={420} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <SectionCard title={t('roles.roles')} noPadding>
            <ul className="divide-y divide-line">
              {roles.map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(role.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                      role.id === selected?.id ? 'bg-brand-light' : 'hover:bg-canvas',
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white ring-1 ring-line">
                      <ShieldCheck className="h-4 w-4 text-brand" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-[13px] font-medium', role.id === selected?.id ? 'text-brand' : 'text-ink')}>
                        {labels.roles[role.key] ?? role.name}
                      </span>
                      <span className={cn('block text-[11.5px]', role.id === selected?.id ? 'text-brand' : 'text-ink-muted')}>
                        {t('roles.summary', {
                          users: t('roles.userCount', { count: role.userCount }),
                          permissions: t('roles.permissionCount', { count: role.permissions.length }),
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </SectionCard>

          {selected && (
            <SectionCard
              title={t('roles.rolePermissions', { name: labels.roles[selected.key] ?? selected.name })}
              description={
                editable
                  ? t('roles.editText')
                  : t('roles.readOnly')
              }
              action={
                selected.isSystem ? <Badge tone="neutral">{t('roles.systemRole')}</Badge> : undefined
              }
            >
              <div className="space-y-5">
                {Object.entries(PERMISSION_GROUPS).map(([group, items]) => (
                  <fieldset key={group}>
                    <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                      {groupLabels[group] ?? group}
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {items.map((item) => (
                        <label
                          key={item.key}
                          className={cn(
                            'flex cursor-pointer items-start gap-2.5 rounded-control border px-3 py-2 transition-colors',
                            draft.has(item.key) ? 'border-brand-primary/40 bg-brand-light/50' : 'border-line bg-white',
                            !editable && 'cursor-not-allowed opacity-70',
                          )}
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={draft.has(item.key)}
                            disabled={!editable}
                            onCheckedChange={(checked) => toggle(item.key, Boolean(checked))}
                          />
                          <span className="min-w-0">
                            <span className="block text-[12.5px] font-medium text-ink">{permissionLabels[item.key] ?? item.label}</span>
                            <span className="block truncate text-[11px] text-ink-muted">{item.key as Permission}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>

              {editable && (
                <div className="sticky bottom-[var(--bottom-nav-height)] -mx-4 mt-5 flex items-center justify-between gap-3 border-t border-line bg-white/95 px-4 pt-3 backdrop-blur sm:-mx-5 sm:px-5 lg:bottom-0">
                  <p className="text-[12px] text-ink-muted tnum">{t('roles.selected', { count: draft.size })}</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={!dirty}
                      onClick={() => setDraft(new Set(selected.permissions))}
                    >
                      {t('common.reset')}
                    </Button>
                    <Button
                      loading={mutation.isPending}
                      disabled={!dirty || draft.size === 0}
                      onClick={() => mutation.mutate(Array.from(draft))}
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('roles.save')}
                    </Button>
                  </div>
                </div>
              )}
            </SectionCard>
          )}
        </div>
      )}
    </>
  );
}
