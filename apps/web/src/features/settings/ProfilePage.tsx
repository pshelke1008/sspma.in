import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { KeyRound, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { FormField } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, Separator } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'profile.currentRequired'),
    newPassword: z
      .string()
      .min(8, 'validation.passwordMin')
      .regex(/[a-zA-Z]/, 'validation.passwordLetter')
      .regex(/[0-9]/, 'validation.passwordNumber'),
    confirmPassword: z.string().min(1, 'profile.confirmRequired'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'validation.passwordMatch',
  });

type PasswordValues = z.infer<typeof schema>;

export default function ProfilePage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(schema) });

  const mutation = useMutation({
    mutationFn: (values: PasswordValues) => api.post('/auth/change-password', values),
    onSuccess: async () => {
      toast.success(t('profile.passwordUpdated'), {
        description: t('profile.passwordUpdatedText'),
      });
      reset();
      await logout();
      navigate('/login', { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors))
          setError(field as keyof PasswordValues, { message });
        if (Object.keys(fieldErrors).length === 0) {
          setError('currentPassword', { message: errorMessage(t, error) });
        }
      } else {
        toast.error(t('profile.passwordFailed'));
      }
    },
  });

  async function handleSignOut() {
    setSigningOut(true);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <PageHeader
        title={t('common.myProfile')}
        subtitle={t('profile.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('common.myProfile') }]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t('profile.account')}>
          <div className="flex items-center gap-4">
            <Avatar name={user?.name ?? '?'} src={user?.avatarUrl} size="lg" className="h-14 w-14" />
            <div className="min-w-0">
              <p className="text-[16px] font-semibold text-ink">{user?.name}</p>
              <p className="text-[12.5px] text-ink-muted">{user?.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="brand">{user ? (labels.roles[user.role.key] ?? user.role.name) : null}</Badge>
                {user?.designation && <Badge tone="neutral">{user.designation}</Badge>}
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                {t('profile.organization')}
              </dt>
              <dd className="mt-0.5 text-[13px] font-medium text-ink">{user?.organization.name}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{t('common.mobile')}</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-ink">{user?.mobile ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                {t('profile.permissionsGranted')}
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {(user?.permissions ?? []).map((permission) => (
                  <Badge key={permission} tone="neutral" className="font-mono text-[10px]">
                    {permission}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>

          <Separator className="my-4" />

          <Button variant="outline" loading={signingOut} onClick={() => void handleSignOut()}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common.signOut')}
          </Button>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title={t('profile.preferences')} description={t('profile.preferencesText')}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-ink">{t('language.label')}</span>
              <LanguageSwitcher signedIn />
            </div>
          </SectionCard>

          <SectionCard title={t('profile.changePassword')} description={t('profile.changePasswordText')}>
            <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="space-y-4">
              <FormField
                label={t('profile.currentPassword')}
                htmlFor="current-password"
                required
                error={errors.currentPassword?.message}
              >
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  invalid={Boolean(errors.currentPassword)}
                  {...register('currentPassword')}
                />
              </FormField>
              <FormField
                label={t('profile.newPassword')}
                htmlFor="new-password"
                required
                error={errors.newPassword?.message}
                hint={t('usersPage.passwordRule')}
              >
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  invalid={Boolean(errors.newPassword)}
                  {...register('newPassword')}
                />
              </FormField>
              <FormField
                label={t('profile.confirmPassword')}
                htmlFor="confirm-password"
                required
                error={errors.confirmPassword?.message}
              >
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  invalid={Boolean(errors.confirmPassword)}
                  {...register('confirmPassword')}
                />
              </FormField>

              <Button type="submit" loading={isSubmitting || mutation.isPending}>
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                {t('profile.updatePassword')}
              </Button>
            </form>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
