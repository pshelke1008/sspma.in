import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { DONOR_CATEGORIES, SUPPORTED_LOCALES } from '@ashram/types';
import { ApiError, api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { DateInput, FormField } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils/format';
import type { Donor } from './types';

/** Mirrors the server: 10–15 digits once spaces, dashes and a leading 0 are ignored. */
const phone = z
  .string()
  .trim()
  .refine((value) => {
    if (!value) return true;
    let digits = value.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return digits.length >= 10 && digits.length <= 15;
  }, 'validation.phone');

const schema = z.object({
  name: z.string().trim().min(2, 'donors.nameRequired').max(160),
  category: z.enum(DONOR_CATEGORIES),
  phone,
  whatsappNumber: phone,
  alternatePhone: phone,
  email: z.string().trim().email('validation.email').or(z.literal('')),
  panNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{5}[0-9]{4}[A-Z])?$/, 'donors.panInvalid'),
  addressLine1: z.string().max(200),
  addressLine2: z.string().max(200),
  city: z.string().max(80),
  state: z.string().max(80),
  postalCode: z.string().max(12),
  country: z.string().max(80),
  dateOfBirth: z.string(),
  anniversaryDate: z.string(),
  preferredLanguage: z.enum(SUPPORTED_LOCALES),
  tags: z.array(z.string()),
  notes: z.string().max(2000),
  whatsappOptIn: z.boolean(),
});

type DonorValues = z.infer<typeof schema>;

function toValues(donor: Donor | null | undefined): DonorValues {
  return {
    name: donor?.name ?? '',
    category: donor?.category ?? 'INDIVIDUAL',
    phone: donor?.phone ?? '',
    whatsappNumber: donor?.whatsappNumber ?? '',
    alternatePhone: donor?.alternatePhone ?? '',
    email: donor?.email ?? '',
    panNumber: donor?.panNumber ?? '',
    addressLine1: donor?.addressLine1 ?? '',
    addressLine2: donor?.addressLine2 ?? '',
    city: donor?.city ?? '',
    state: donor?.state ?? '',
    postalCode: donor?.postalCode ?? '',
    country: donor?.country ?? 'India',
    dateOfBirth: donor?.dateOfBirth ? formatDate(donor.dateOfBirth, 'input') : '',
    anniversaryDate: donor?.anniversaryDate ? formatDate(donor.anniversaryDate, 'input') : '',
    preferredLanguage: donor?.preferredLanguage ?? 'mr',
    tags: donor?.tags ?? [],
    notes: donor?.notes ?? '',
    whatsappOptIn: donor?.whatsappOptIn ?? false,
  };
}

export function DonorFormDialog({
  open,
  onOpenChange,
  donor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  donor?: Donor | null;
  onSaved?: (donor: Donor) => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const isEdit = Boolean(donor);
  const [tagDraft, setTagDraft] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DonorValues>({ resolver: zodResolver(schema), defaultValues: toValues(donor) });

  // Each opening starts from the donor being edited, or a blank form. Keyed on
  // the id so a background refetch of the same donor never wipes what is typed.
  useEffect(() => {
    if (open) {
      reset(toValues(donor));
      setTagDraft('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, donor?.id, reset]);

  const tags = watch('tags');

  const mutation = useMutation({
    mutationFn: (values: DonorValues) =>
      isEdit
        ? api.put<{ data: Donor }>(`/donors/${donor!.id}`, values)
        : api.post<{ data: Donor }>('/donors', values),
    onSuccess: (result) => {
      toast.success(isEdit ? t('donors.updated') : t('donors.created'), { description: result.data.name });
      queryClient.invalidateQueries({ queryKey: ['donors'] });
      queryClient.invalidateQueries({ queryKey: ['donor'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.masters });
      onSaved?.(result.data);
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof DonorValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('donors.saveFailed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('donors.saveFailed'));
      }
    },
  });

  function addTag(raw: string) {
    const next = raw
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (next.length === 0) return;
    setValue('tags', Array.from(new Set([...tags, ...next])).slice(0, 20), { shouldDirty: true });
    setTagDraft('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('donors.editDonor') : t('donors.addDonor')}</DialogTitle>
          <DialogDescription>{isEdit ? `${donor!.code} · ${donor!.name}` : t('donors.addText')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((values) => mutation.mutate({ ...values, tags: tagDraft.trim() ? Array.from(new Set([...values.tags, tagDraft.trim()])) : values.tags }))}
          noValidate
          className="flex min-h-0 flex-1 flex-col"
        >
          <DialogBody>
            <div className="space-y-5">
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:col-span-2">
                  {t('donors.sectionIdentity')}
                </legend>
                <FormField label={t('donors.fullName')} htmlFor="donor-name" required error={errors.name?.message}>
                  <Input id="donor-name" autoComplete="off" invalid={Boolean(errors.name)} {...register('name')} />
                </FormField>
                <FormField label={t('common.category')} htmlFor="donor-category" required>
                  <SimpleSelect
                    value={watch('category')}
                    onValueChange={(value) => setValue('category', value as DonorValues['category'], { shouldDirty: true })}
                    options={DONOR_CATEGORIES.map((item) => ({ value: item, label: labels.donorCategory[item] }))}
                    ariaLabel={t('common.category')}
                  />
                </FormField>
                <FormField label={t('donors.pan')} htmlFor="donor-pan" error={errors.panNumber?.message} hint={t('donors.panHint')}>
                  <Input id="donor-pan" className="uppercase" maxLength={10} placeholder="ABCDE1234F" invalid={Boolean(errors.panNumber)} {...register('panNumber')} />
                </FormField>
                <FormField label={t('donors.preferredLanguage')} htmlFor="donor-language" hint={t('donors.preferredLanguageHint')}>
                  <SimpleSelect
                    value={watch('preferredLanguage')}
                    onValueChange={(value) => setValue('preferredLanguage', value as DonorValues['preferredLanguage'], { shouldDirty: true })}
                    options={SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: t(`language.${locale}`) }))}
                    ariaLabel={t('donors.preferredLanguage')}
                  />
                </FormField>
                <FormField label={t('donors.dateOfBirth')} htmlFor="donor-dob">
                  <DateInput id="donor-dob" max={new Date().toISOString().slice(0, 10)} {...register('dateOfBirth')} />
                </FormField>
                <FormField label={t('donors.anniversary')} htmlFor="donor-anniversary">
                  <DateInput id="donor-anniversary" {...register('anniversaryDate')} />
                </FormField>
              </fieldset>

              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:col-span-2">
                  {t('donors.sectionContact')}
                </legend>
                <FormField label={t('common.mobile')} htmlFor="donor-phone" error={errors.phone?.message}>
                  <Input id="donor-phone" type="tel" inputMode="tel" placeholder="+91 98200 11223" invalid={Boolean(errors.phone)} {...register('phone')} />
                </FormField>
                <FormField
                  label={t('donors.whatsappNumber')}
                  htmlFor="donor-whatsapp"
                  error={errors.whatsappNumber?.message}
                  hint={t('donors.whatsappNumberHint')}
                >
                  <Input id="donor-whatsapp" type="tel" inputMode="tel" invalid={Boolean(errors.whatsappNumber)} {...register('whatsappNumber')} />
                </FormField>
                <FormField label={t('donors.alternatePhone')} htmlFor="donor-alt" error={errors.alternatePhone?.message}>
                  <Input id="donor-alt" type="tel" inputMode="tel" invalid={Boolean(errors.alternatePhone)} {...register('alternatePhone')} />
                </FormField>
                <FormField label={t('common.email')} htmlFor="donor-email" error={errors.email?.message}>
                  <Input id="donor-email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
                </FormField>

                <div className="rounded-control border border-line bg-canvas/50 px-3 py-2.5 sm:col-span-2">
                  <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-ink">
                    <Checkbox
                      className="mt-0.5"
                      checked={watch('whatsappOptIn')}
                      onCheckedChange={(checked) => setValue('whatsappOptIn', Boolean(checked), { shouldDirty: true })}
                    />
                    <span>
                      <span className="block font-medium">{t('donors.optInLabel')}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">{t('donors.optInHint')}</span>
                    </span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:col-span-2">
                  {t('orgSettings.address')}
                </legend>
                <FormField label={t('orgSettings.addressLine1')} htmlFor="donor-addr1" className="sm:col-span-2">
                  <Input id="donor-addr1" {...register('addressLine1')} />
                </FormField>
                <FormField label={t('orgSettings.addressLine2')} htmlFor="donor-addr2" className="sm:col-span-2">
                  <Input id="donor-addr2" {...register('addressLine2')} />
                </FormField>
                <FormField label={t('common.city')} htmlFor="donor-city">
                  <Input id="donor-city" {...register('city')} />
                </FormField>
                <FormField label={t('common.state')} htmlFor="donor-state">
                  <Input id="donor-state" {...register('state')} />
                </FormField>
                <FormField label={t('orgSettings.postalCode')} htmlFor="donor-postal">
                  <Input id="donor-postal" inputMode="numeric" {...register('postalCode')} />
                </FormField>
                <FormField label={t('common.country')} htmlFor="donor-country">
                  <Input id="donor-country" {...register('country')} />
                </FormField>
              </fieldset>

              <fieldset className="grid gap-3">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  {t('donors.sectionOther')}
                </legend>
                <FormField label={t('donors.tags')} htmlFor="donor-tags" hint={t('donors.tagsHint')}>
                  <div className="space-y-2">
                    {tags.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5" aria-label={t('donors.tags')}>
                        {tags.map((tag) => (
                          <li key={tag} className="inline-flex items-center gap-1 rounded-full bg-brand-light py-0.5 pl-2.5 pr-1 text-[11.5px] text-brand">
                            {tag}
                            <button
                              type="button"
                              className="rounded-full p-0.5 hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                              aria-label={t('donors.removeTag', { tag })}
                              onClick={() => setValue('tags', tags.filter((item) => item !== tag), { shouldDirty: true })}
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Input
                      id="donor-tags"
                      value={tagDraft}
                      placeholder={t('donors.tagsPlaceholder')}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value.includes(',')) addTag(value);
                        else setTagDraft(value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addTag(tagDraft);
                        } else if (event.key === 'Backspace' && !tagDraft && tags.length) {
                          setValue('tags', tags.slice(0, -1), { shouldDirty: true });
                        }
                      }}
                      onBlur={() => addTag(tagDraft)}
                    />
                  </div>
                </FormField>
                <FormField label={t('common.notes')} htmlFor="donor-notes" error={errors.notes?.message}>
                  <Textarea id="donor-notes" rows={3} maxLength={2000} placeholder={t('donors.notesPlaceholder')} {...register('notes')} />
                </FormField>
              </fieldset>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {isEdit ? t('common.saveChanges') : t('donors.addDonor')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
