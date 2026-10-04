import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { FormField } from '@/components/common/forms';
import { ChartSkeleton } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';

const schema = z.object({
  name: z.string().trim().min(2, 'orgSettings.nameRequired'),
  legalName: z.string().optional(),
  registrationNo: z.string().optional(),
  panNumber: z.string().optional(),
  email: z.string().email('validation.email').optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  tagline: z.string().optional(),
});

type OrgValues = z.infer<typeof schema>;

export default function OrganizationSettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const editable = can('settings.manage');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api.get<{ organization: OrgValues }>('/settings'),
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<OrgValues>({ resolver: zodResolver(schema), defaultValues: { name: '' } });

  useEffect(() => {
    if (data?.organization) {
      reset({
        ...data.organization,
        legalName: data.organization.legalName ?? '',
        registrationNo: data.organization.registrationNo ?? '',
        panNumber: data.organization.panNumber ?? '',
        email: data.organization.email ?? '',
        phone: data.organization.phone ?? '',
        website: data.organization.website ?? '',
        addressLine1: data.organization.addressLine1 ?? '',
        addressLine2: data.organization.addressLine2 ?? '',
        city: data.organization.city ?? '',
        state: data.organization.state ?? '',
        postalCode: data.organization.postalCode ?? '',
        country: data.organization.country ?? 'India',
        tagline: data.organization.tagline ?? '',
      });
    }
  }, [data, reset]);

  const mutation = useMutation({
    mutationFn: (values: OrgValues) => api.put('/settings/organization', values),
    onSuccess: () => {
      toast.success(t('orgSettings.updated'));
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof OrgValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('orgSettings.saveFailed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('orgSettings.saveFailed'));
      }
    },
  });

  return (
    <>
      <PageHeader
        title={t('settings.profileTitle')}
        subtitle={t('orgSettings.subtitle')}
        breadcrumbs={[{ label: t('settings.title'), to: '/settings' }, { label: t('settings.profileTitle') }]}
      />

      {isLoading ? (
        <ChartSkeleton height={420} />
      ) : (
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
          <SectionCard title={t('orgSettings.identity')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('orgSettings.organizationName')} htmlFor="org-name" required error={errors.name?.message}>
                <Input id="org-name" disabled={!editable} invalid={Boolean(errors.name)} {...register('name')} />
              </FormField>
              <FormField label={t('orgSettings.legalName')} htmlFor="org-legal">
                <Input id="org-legal" disabled={!editable} {...register('legalName')} />
              </FormField>
              <FormField label={t('orgSettings.registrationNo')} htmlFor="org-reg">
                <Input id="org-reg" disabled={!editable} {...register('registrationNo')} />
              </FormField>
              <FormField label={t('orgSettings.pan')} htmlFor="org-pan">
                <Input id="org-pan" disabled={!editable} {...register('panNumber')} />
              </FormField>
              <FormField label={t('orgSettings.tagline')} htmlFor="org-tagline" className="sm:col-span-2">
                <Input id="org-tagline" disabled={!editable} {...register('tagline')} />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard title={t('orgSettings.contact')} className="mt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('common.email')} htmlFor="org-email" error={errors.email?.message}>
                <Input id="org-email" type="email" disabled={!editable} invalid={Boolean(errors.email)} {...register('email')} />
              </FormField>
              <FormField label={t('common.phone')} htmlFor="org-phone">
                <Input id="org-phone" disabled={!editable} {...register('phone')} />
              </FormField>
              <FormField label={t('orgSettings.website')} htmlFor="org-website" className="sm:col-span-2">
                <Input id="org-website" disabled={!editable} {...register('website')} />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard title={t('orgSettings.address')} className="mt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('orgSettings.addressLine1')} htmlFor="org-addr1" className="sm:col-span-2">
                <Input id="org-addr1" disabled={!editable} {...register('addressLine1')} />
              </FormField>
              <FormField label={t('orgSettings.addressLine2')} htmlFor="org-addr2" className="sm:col-span-2">
                <Input id="org-addr2" disabled={!editable} {...register('addressLine2')} />
              </FormField>
              <FormField label={t('common.city')} htmlFor="org-city">
                <Input id="org-city" disabled={!editable} {...register('city')} />
              </FormField>
              <FormField label={t('common.state')} htmlFor="org-state">
                <Input id="org-state" disabled={!editable} {...register('state')} />
              </FormField>
              <FormField label={t('orgSettings.postalCode')} htmlFor="org-postal">
                <Input id="org-postal" disabled={!editable} {...register('postalCode')} />
              </FormField>
              <FormField label={t('common.country')} htmlFor="org-country">
                <Input id="org-country" disabled={!editable} {...register('country')} />
              </FormField>
            </div>
          </SectionCard>

          {editable && (
            <div className="sticky bottom-[var(--bottom-nav-height)] mt-4 flex justify-end rounded-card border border-line bg-white/95 px-4 py-3 shadow-card backdrop-blur lg:bottom-0">
              <Button type="submit" loading={isSubmitting || mutation.isPending} disabled={!isDirty}>
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.saveChanges')}
              </Button>
            </div>
          )}
        </form>
      )}
    </>
  );
}
