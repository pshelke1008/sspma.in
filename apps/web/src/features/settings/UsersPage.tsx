import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MoreHorizontal, Pencil, Plus, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { SearchInput } from '@/components/common/FilterBar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { TablePagination } from '@/components/common/DataTable';
import { FormField } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, Checkbox } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { relativeTime } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';

interface UserRow {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  designation: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; key: string; name: string };
}

interface RoleOption {
  id: string;
  key: string;
  name: string;
}

export default function UsersPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { can, user: currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deactivating, setDeactivating] = useState<UserRow | null>(null);

  const params = useMemo(() => ({ page, pageSize: 20, search: search || undefined }), [page, search]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.users(params),
    queryFn: () =>
      api.get<{ data: UserRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(
        '/users' + buildQuery(params),
      ),
    placeholderData: (previous) => previous,
  });

  const { data: roles } = useQuery({
    queryKey: queryKeys.roles,
    queryFn: () => api.get<{ data: RoleOption[] }>('/roles'),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      toast.success(t('usersPage.deactivated'), { description: t('usersPage.deactivatedText') });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeactivating(null);
    },
    onError: (err) => toast.error(t('usersPage.deactivateFailed'), { description: errorMessage(t, err) }),
  });

  if (error) return <ErrorState message={errorMessage(t, error)} onRetry={() => void refetch()} />;

  return (
    <>
      <PageHeader
        title={t('settings.usersTitle')}
        subtitle={t('usersPage.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.usersTitle') }]}
        actions={
          can('user.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('usersPage.addUser')}
            </Button>
          )
        }
      />

      <SectionCard noPadding>
        <div className="border-b border-line p-3">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder={t('usersPage.searchPlaceholder')}
            className="sm:max-w-xs"
          />
        </div>

        {isLoading ? (
          <TableSkeleton columns={5} />
        ) : !data?.data.length ? (
          <EmptyState icon={Users} title={t('usersPage.empty')} description={t('usersPage.emptyText')} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {data.data.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={row.name} src={row.avatarUrl} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-semibold text-ink">{row.name}</p>
                      <Badge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? t('common.active') : t('common.inactive')}</Badge>
                      {row.id === currentUser?.id && <Badge tone="info">{t('common.you')}</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-muted">{row.email}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">
                      {labels.roles[row.role.key] ?? row.role.name}
                      {row.designation ? ` · ${row.designation}` : ''}
                      {' · '}
                      {row.lastLoginAt ? t('usersPage.lastSignedIn', { time: relativeTime(row.lastLoginAt) }) : t('usersPage.neverSignedIn')}
                    </p>
                  </div>

                  {(can('user.edit') || can('user.delete')) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t('usersPage.actionsFor', { name: row.name })}>
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {can('user.edit') && (
                          <DropdownMenuItem onSelect={() => setEditing(row)}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('common.edit')}
                          </DropdownMenuItem>
                        )}
                        {can('user.delete') && row.isActive && row.id !== currentUser?.id && (
                          <DropdownMenuItem tone="danger" onSelect={() => setDeactivating(row)}>
                            <UserX className="h-3.5 w-3.5" aria-hidden="true" />
                            {t('usersPage.deactivate')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              ))}
            </ul>

            <TablePagination
              page={data.meta.page}
              pageSize={data.meta.pageSize}
              total={data.meta.total}
              totalPages={data.meta.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </SectionCard>

      <UserDialog
        open={creating || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        user={editing}
        roles={roles?.data ?? []}
      />

      <ConfirmationDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={t('usersPage.confirmTitle')}
        description={deactivating ? t('usersPage.confirmText', { name: deactivating.name }) : undefined}
        confirmLabel={t('usersPage.deactivate')}
        tone="danger"
        loading={deactivate.isPending}
        onConfirm={() => deactivating && deactivate.mutate(deactivating.id)}
      />
    </>
  );
}

const baseSchema = {
  name: z.string().trim().min(2, 'validation.nameRequired'),
  email: z.string().trim().email('validation.email'),
  mobile: z.string().optional(),
  designation: z.string().optional(),
  roleId: z.string().min(1, 'validation.selectRole'),
  isActive: z.boolean(),
};

const createSchema = z.object({
  ...baseSchema,
  password: z
    .string()
    .min(8, 'validation.passwordMin')
    .regex(/[a-zA-Z]/, 'validation.passwordLetter')
    .regex(/[0-9]/, 'validation.passwordNumber'),
});

const editSchema = z.object({
  ...baseSchema,
  password: z
    .string()
    .min(8, 'validation.passwordMin')
    .regex(/[a-zA-Z]/, 'validation.passwordLetter')
    .regex(/[0-9]/, 'validation.passwordNumber')
    .optional()
    .or(z.literal('')),
});

type UserValues = z.infer<typeof createSchema>;

function UserDialog({
  open,
  onOpenChange,
  user,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRow | null;
  roles: RoleOption[];
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const isEdit = Boolean(user);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserValues>({
    resolver: zodResolver(isEdit ? (editSchema as never) : createSchema),
    values: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      mobile: user?.mobile ?? '',
      designation: user?.designation ?? '',
      roleId: user?.role.id ?? '',
      isActive: user?.isActive ?? true,
      password: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: UserValues) => {
      const payload = { ...values, password: values.password || undefined };
      return isEdit ? api.put(`/users/${user!.id}`, payload) : api.post('/users', payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? t('usersPage.updated') : t('usersPage.created'));
      queryClient.invalidateQueries({ queryKey: ['users'] });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof UserValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('usersPage.saveFailed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('usersPage.saveFailed'));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? t('usersPage.editUser') : t('usersPage.addUser')}</DialogTitle>
          <DialogDescription>
            {isEdit ? t('usersPage.editText') : t('usersPage.addText')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('usersPage.fullName')} htmlFor="user-name" required error={errors.name?.message}>
                <Input id="user-name" invalid={Boolean(errors.name)} {...register('name')} />
              </FormField>
              <FormField label={t('common.email')} htmlFor="user-email" required error={errors.email?.message}>
                <Input id="user-email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
              </FormField>
              <FormField label={t('common.mobile')} htmlFor="user-mobile" error={errors.mobile?.message}>
                <Input id="user-mobile" inputMode="tel" {...register('mobile')} />
              </FormField>
              <FormField label={t('usersPage.designation')} htmlFor="user-designation">
                <Input id="user-designation" placeholder={t('usersPage.designationPlaceholder')} {...register('designation')} />
              </FormField>
              <FormField label={t('usersPage.role')} htmlFor="user-role" required error={errors.roleId?.message}>
                <SimpleSelect
                  value={watch('roleId')}
                  onValueChange={(value) => setValue('roleId', value, { shouldValidate: true })}
                  options={roles.map((role) => ({ value: role.id, label: labels.roles[role.key] ?? role.name }))}
                  placeholder={t('usersPage.selectRole')}
                  invalid={Boolean(errors.roleId)}
                  ariaLabel={t('usersPage.role')}
                />
              </FormField>
              <FormField
                label={isEdit ? t('usersPage.newPassword') : t('usersPage.password')}
                htmlFor="user-password"
                required={!isEdit}
                error={errors.password?.message}
                hint={isEdit ? t('usersPage.keepPassword') : t('usersPage.passwordRule')}
              >
                <Input
                  id="user-password"
                  type="password"
                  autoComplete="new-password"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
              </FormField>
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink sm:col-span-2">
                <Checkbox checked={watch('isActive')} onCheckedChange={(checked) => setValue('isActive', Boolean(checked))} />
                {t('usersPage.accountActive')}
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {isEdit ? t('common.saveChanges') : t('usersPage.createUser')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
