import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { DONATION_MODES, DONOR_CATEGORIES, SUPPORTED_LOCALES, isValidAadhaar, normalizeAadhaar } from '@ashram/types';
import { ApiError, api } from '@/lib/api/client';
import { invalidateDonationData } from '@/lib/api/queryClient';
import { useMasters } from '@/lib/api/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';
import { useLabels } from '@/i18n/useLabels';
import { DateInput, FormField, MoneyInput } from '@/components/common/forms';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { SimpleSelect } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, todayLocal } from '@/lib/utils/format';
import type { Donor } from './types';

type SavedDonor = Donor & { donation: { id: string; receiptNumber: string } | null };
import { useDonorLocations } from './useDonorLocations';
import { DISTRICTS_BY_STATE, INDIAN_STATES } from './indianStates';

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
  /** Typed by the user; the stored number is never sent back to the form. */
  aadhaarNumber: z.string().trim().refine((value) => !value || isValidAadhaar(value), 'donors.aadhaarInvalid'),
  removeAadhaar: z.boolean(),
  addressLine1: z.string().max(200),
  addressLine2: z.string().max(200),
  state: z.string().max(80),
  district: z.string().max(80),
  village: z.string().max(120),
  postalCode: z.string().max(12),
  country: z.string().max(80),
  dateOfBirth: z.string(),
  anniversaryDate: z.string(),
  preferredLanguage: z.enum(SUPPORTED_LOCALES),
  tags: z.array(z.string()),
  notes: z.string().max(2000),
  whatsappOptIn: z.boolean(),
  /** Record a donation in the same save. */
  addDonation: z.boolean(),
  donation: z.object({
    date: z.string(),
    amount: z.coerce.number(),
    mode: z.enum(DONATION_MODES),
    fundId: z.string(),
    departmentId: z.string(),
    bankAccountId: z.string(),
    purpose: z.string().max(300),
    referenceNumber: z.string().max(80),
    is80GEligible: z.boolean(),
  }),
}).superRefine((values, ctx) => {
  if (!values.addDonation) return;
  if (!values.donation.date) ctx.addIssue({ code: 'custom', path: ['donation', 'date'], message: 'validation.selectDate' });
  if (!(values.donation.amount > 0)) ctx.addIssue({ code: 'custom', path: ['donation', 'amount'], message: 'validation.amountPositive' });
  if (!values.donation.fundId) ctx.addIssue({ code: 'custom', path: ['donation', 'fundId'], message: 'validation.selectFund' });
});

type DonorValues = z.infer<typeof schema>;

const NO_STATE = '__none';
const OTHER_DISTRICT = '__other';
const DEFAULT_STATE = 'Maharashtra';

function blankDonation(): DonorValues['donation'] {
  return {
    date: todayLocal(),
    amount: 0,
    mode: 'CASH',
    fundId: '',
    departmentId: '',
    bankAccountId: '',
    purpose: '',
    referenceNumber: '',
    is80GEligible: true,
  };
}

/** The API body: the donation travels only when asked for, with blank optionals dropped. */
function toPayload({ addDonation, donation, aadhaarNumber, removeAadhaar, ...rest }: DonorValues) {
  // Aadhaar travels only when typed (or explicitly removed), so saving a donor
  // without touching it keeps the stored number.
  const donor = {
    ...rest,
    ...(aadhaarNumber ? { aadhaarNumber: normalizeAadhaar(aadhaarNumber) } : removeAadhaar ? { aadhaarNumber: '' } : {}),
  };
  if (!addDonation) return donor;
  return {
    ...donor,
    donation: {
      ...donation,
      departmentId: donation.departmentId || null,
      bankAccountId: donation.bankAccountId || null,
      purpose: donation.purpose || null,
      referenceNumber: donation.referenceNumber || null,
    },
  };
}

/** Prefill for a new donor, e.g. a WhatsApp contact being saved from the inbox. */
export type DonorFormInitialValues = Partial<Omit<DonorValues, 'donation' | 'addDonation' | 'aadhaarNumber' | 'removeAadhaar'>>;

function toValues(donor: Donor | null | undefined, initialValues?: DonorFormInitialValues): DonorValues {
  // Prefill applies only when adding; an edit always starts from the donor.
  const prefill = donor ? {} : (initialValues ?? {});
  return {
    ...toBaseValues(donor),
    ...prefill,
  };
}

function toBaseValues(donor: Donor | null | undefined): DonorValues {
  return {
    name: donor?.name ?? '',
    category: donor?.category ?? 'INDIVIDUAL',
    phone: donor?.phone ?? '',
    whatsappNumber: donor?.whatsappNumber ?? '',
    alternatePhone: donor?.alternatePhone ?? '',
    email: donor?.email ?? '',
    panNumber: donor?.panNumber ?? '',
    aadhaarNumber: '',
    removeAadhaar: false,
    addressLine1: donor?.addressLine1 ?? '',
    addressLine2: donor?.addressLine2 ?? '',
    // New donors are almost always local, so the form starts in Maharashtra.
    state: donor ? (donor.state ?? '') : DEFAULT_STATE,
    district: donor?.district ?? '',
    village: donor?.village ?? '',
    postalCode: donor?.postalCode ?? '',
    country: donor?.country ?? 'India',
    dateOfBirth: donor?.dateOfBirth ? formatDate(donor.dateOfBirth, 'input') : '',
    anniversaryDate: donor?.anniversaryDate ? formatDate(donor.anniversaryDate, 'input') : '',
    preferredLanguage: donor?.preferredLanguage ?? 'mr',
    tags: donor?.tags ?? [],
    notes: donor?.notes ?? '',
    whatsappOptIn: donor?.whatsappOptIn ?? false,
    addDonation: false,
    donation: blankDonation(),
  };
}

export function DonorFormDialog({
  open,
  onOpenChange,
  donor,
  onSaved,
  initialValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  donor?: Donor | null;
  onSaved?: (donor: Donor) => void;
  /** Starting values when adding a donor (ignored when editing). */
  initialValues?: DonorFormInitialValues;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const { can } = useAuth();
  const canRecordDonation = can('donation.create') && (!donor || donor.isActive);
  const { data: masters } = useMasters();
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
  } = useForm<DonorValues>({ resolver: zodResolver(schema), defaultValues: toValues(donor, initialValues) });

  const watchedState = watch('state');
  const watchedDistrict = watch('district');
  const { data: locations } = useDonorLocations({ state: watchedState.trim(), district: watchedDistrict.trim() }, open);
  // Recorded values (including any spelling outside the standard list) stay
  // selectable, so editing an older donor never blanks their state.
  const stateOptions = Array.from(
    new Set([...INDIAN_STATES, ...(locations?.states ?? []).map((item) => item.value), ...(watchedState ? [watchedState] : [])]),
  ).sort((a, b) => a.localeCompare(b));
  const addDonation = watch('addDonation');
  const removeAadhaar = watch('removeAadhaar');

  // District list: the state's official districts, plus any already recorded
  // on donors and the donor's own value, so nothing saved goes missing.
  const districtOptions = Array.from(
    new Set([
      ...(DISTRICTS_BY_STATE[watchedState] ?? []),
      ...(watchedState ? (locations?.districts ?? []).map((item) => item.value) : []),
      ...(watchedDistrict ? [watchedDistrict] : []),
    ]),
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  // Free typing for a district not in the list ("Other…"), or a state with no list yet.
  const [districtTyping, setDistrictTyping] = useState(false);
  useEffect(() => {
    setDistrictTyping(districtOptions.length === 0);
    // Re-evaluated only when the state changes or the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedState, open]);

  // Each opening starts from the donor being edited, or a blank form. Keyed on
  // the id so a background refetch of the same donor never wipes what is typed.
  useEffect(() => {
    if (open) {
      reset(toValues(donor, initialValues));
      setTagDraft('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, donor?.id, reset]);

  const tags = watch('tags');

  const mutation = useMutation({
    mutationFn: (values: DonorValues) =>
      isEdit
        ? api.put<{ data: SavedDonor }>(`/donors/${donor!.id}`, toPayload(values))
        : api.post<{ data: SavedDonor }>('/donors', toPayload(values)),
    onSuccess: (result) => {
      const receipt = result.data.donation?.receiptNumber;
      toast.success(isEdit ? t('donors.updated') : t('donors.created'), {
        description: receipt ? t('donors.savedWithDonation', { name: result.data.name, receipt }) : result.data.name,
      });
      invalidateDonationData();
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
                <FormField
                  label={t('donors.aadhaar')}
                  htmlFor="donor-aadhaar"
                  error={errors.aadhaarNumber?.message}
                  hint={
                    donor?.aadhaarMasked && !removeAadhaar
                      ? t('donors.aadhaarKeep', { masked: donor.aadhaarMasked })
                      : t('donors.aadhaarHint')
                  }
                >
                  <div className="flex gap-2">
                    <Input
                      id="donor-aadhaar"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={14}
                      placeholder={donor?.aadhaarMasked && !removeAadhaar ? donor.aadhaarMasked : '1234 5678 9012'}
                      invalid={Boolean(errors.aadhaarNumber)}
                      {...register('aadhaarNumber')}
                    />
                    {donor?.aadhaarMasked && !removeAadhaar && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setValue('removeAadhaar', true, { shouldDirty: true });
                          setValue('aadhaarNumber', '');
                        }}
                      >
                        {t('donors.aadhaarRemove')}
                      </Button>
                    )}
                  </div>
                </FormField>
              </fieldset>

              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:col-span-2">
                  {t('donors.sectionContact')}
                </legend>
                <FormField
                  label={t('donors.whatsappNumber')}
                  htmlFor="donor-whatsapp"
                  error={errors.whatsappNumber?.message}
                  hint={t('donors.whatsappNumberHint')}
                >
                  <Input
                    id="donor-whatsapp"
                    type="tel"
                    inputMode="tel"
                    placeholder="+91 98200 11223"
                    invalid={Boolean(errors.whatsappNumber)}
                    {...register('whatsappNumber')}
                  />
                </FormField>
                <FormField label={t('donors.alternatePhone')} htmlFor="donor-alt" error={errors.alternatePhone?.message}>
                  <Input id="donor-alt" type="tel" inputMode="tel" invalid={Boolean(errors.alternatePhone)} {...register('alternatePhone')} />
                </FormField>
                <FormField label={t('common.email')} htmlFor="donor-email" error={errors.email?.message}>
                  <Input id="donor-email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
                </FormField>

                <div className="self-end rounded-control border border-line bg-canvas/50 px-3 py-2.5">
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

              <fieldset className="grid gap-3 sm:grid-cols-3">
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:col-span-3">
                  {t('orgSettings.address')}
                </legend>
                {/* Village → district → state. District offers the state's list and
                    village suggests names already in use, so one village isn't
                    recorded under three spellings and split in the filters. */}
                <FormField label={t('donors.village')} htmlFor="donor-village">
                  <Input id="donor-village" list="donor-village-options" autoComplete="address-level3" {...register('village')} />
                  <datalist id="donor-village-options">
                    {(locations?.villages ?? []).map((item) => (
                      <option key={item.value} value={item.value} />
                    ))}
                  </datalist>
                </FormField>
                <FormField label={t('donors.district')} htmlFor="donor-district">
                  {districtTyping ? (
                    <div className="flex gap-2">
                      <Input
                        id="donor-district"
                        autoFocus
                        autoComplete="address-level2"
                        placeholder={t('donors.districtTypePlaceholder')}
                        {...register('district')}
                      />
                      {districtOptions.length > 0 && (
                        <Button type="button" variant="outline" onClick={() => setDistrictTyping(false)}>
                          {t('donors.chooseFromList')}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <SimpleSelect
                      value={watchedDistrict || undefined}
                      onValueChange={(value) => {
                        if (value === OTHER_DISTRICT) {
                          setValue('district', '', { shouldDirty: true });
                          setDistrictTyping(true);
                          return;
                        }
                        if (value !== watchedDistrict) setValue('village', '', { shouldDirty: true });
                        setValue('district', value, { shouldDirty: true });
                      }}
                      options={[
                        ...districtOptions.map((value) => ({ value, label: value })),
                        { value: OTHER_DISTRICT, label: t('donors.districtOther') },
                      ]}
                      placeholder={t('donors.selectDistrict')}
                      ariaLabel={t('donors.district')}
                    />
                  )}
                </FormField>
                <FormField label={t('common.state')} htmlFor="donor-state">
                  <SimpleSelect
                    value={watchedState || NO_STATE}
                    onValueChange={(value) => {
                      const next = value === NO_STATE ? '' : value;
                      if (next !== watchedState) {
                        // A district belongs to one state.
                        setValue('district', '', { shouldDirty: true });
                        setValue('village', '', { shouldDirty: true });
                      }
                      setValue('state', next, { shouldDirty: true });
                    }}
                    options={[{ value: NO_STATE, label: t('donors.stateNotSet') }, ...stateOptions.map((value) => ({ value, label: value }))]}
                    ariaLabel={t('common.state')}
                  />
                </FormField>
                <FormField label={t('orgSettings.postalCode')} htmlFor="donor-postal">
                  <Input id="donor-postal" inputMode="numeric" autoComplete="postal-code" {...register('postalCode')} />
                </FormField>
              </fieldset>

              {canRecordDonation && (
                <fieldset className="grid gap-3 sm:grid-cols-2">
                  <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted sm:col-span-2">
                    {t('donors.sectionDonation')}
                  </legend>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-control border border-line bg-canvas/50 p-3 text-[12.5px] text-ink sm:col-span-2">
                    <Checkbox
                      className="mt-0.5"
                      checked={addDonation}
                      onCheckedChange={(checked) => setValue('addDonation', Boolean(checked), { shouldDirty: true })}
                    />
                    <span>
                      <span className="block font-medium">{t('donors.addDonationLabel')}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">{t('donors.addDonationHint')}</span>
                    </span>
                  </label>

                  {addDonation && (
                    <>
                      <FormField label={t('common.amount')} htmlFor="donor-don-amount" required error={errors.donation?.amount?.message}>
                        <MoneyInput id="donor-don-amount" invalid={Boolean(errors.donation?.amount)} {...register('donation.amount')} />
                      </FormField>
                      <FormField label={t('common.date')} htmlFor="donor-don-date" required error={errors.donation?.date?.message}>
                        <DateInput id="donor-don-date" max={todayLocal()} invalid={Boolean(errors.donation?.date)} {...register('donation.date')} />
                      </FormField>
                      <FormField label={t('common.fund')} htmlFor="donor-don-fund" required error={errors.donation?.fundId?.message}>
                        <SimpleSelect
                          value={watch('donation.fundId')}
                          onValueChange={(value) => setValue('donation.fundId', value, { shouldValidate: true })}
                          options={(masters?.funds ?? []).map((fund) => ({ value: fund.id, label: fund.name }))}
                          placeholder={t('wizard.selectFund')}
                          invalid={Boolean(errors.donation?.fundId)}
                          ariaLabel={t('common.fund')}
                        />
                      </FormField>
                      <FormField label={t('donations.mode')} htmlFor="donor-don-mode" required>
                        <SimpleSelect
                          value={watch('donation.mode')}
                          onValueChange={(value) => setValue('donation.mode', value as DonorValues['donation']['mode'])}
                          options={DONATION_MODES.map((item) => ({ value: item, label: labels.donationMode[item] }))}
                          ariaLabel={t('donations.mode')}
                        />
                      </FormField>
                      <FormField label={t('donations.receivedIn')} htmlFor="donor-don-account">
                        <SimpleSelect
                          value={watch('donation.bankAccountId')}
                          onValueChange={(value) => setValue('donation.bankAccountId', value)}
                          options={(masters?.bankAccounts ?? []).map((account) => ({ value: account.id, label: account.name }))}
                          placeholder={t('common.cashInHand')}
                          ariaLabel={t('donations.receivedIn')}
                        />
                      </FormField>
                      <FormField label={t('common.department')} htmlFor="donor-don-department">
                        <SimpleSelect
                          value={watch('donation.departmentId')}
                          onValueChange={(value) => setValue('donation.departmentId', value)}
                          options={(masters?.departments ?? []).map((item) => ({ value: item.id, label: item.name }))}
                          placeholder={t('common.optional')}
                          ariaLabel={t('common.department')}
                        />
                      </FormField>
                      <FormField label={t('donations.purpose')} htmlFor="donor-don-purpose">
                        <Input id="donor-don-purpose" placeholder={t('donations.purposePlaceholder')} {...register('donation.purpose')} />
                      </FormField>
                      <FormField label={t('common.referenceNumber')} htmlFor="donor-don-reference">
                        <Input id="donor-don-reference" placeholder={t('finance.referencePlaceholder')} {...register('donation.referenceNumber')} />
                      </FormField>
                      <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink sm:col-span-2">
                        <Checkbox
                          checked={watch('donation.is80GEligible')}
                          onCheckedChange={(checked) => setValue('donation.is80GEligible', Boolean(checked))}
                        />
                        {t('donations.eligible80G')}
                      </label>
                    </>
                  )}
                </fieldset>
              )}

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
              {addDonation
                ? isEdit
                  ? t('donors.saveAndRecord')
                  : t('donors.addAndRecord')
                : isEdit
                  ? t('common.saveChanges')
                  : t('donors.addDonor')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
