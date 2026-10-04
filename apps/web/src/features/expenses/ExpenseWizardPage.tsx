import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError, api } from '@/lib/api/client';
import { invalidateFinancialData, queryKeys } from '@/lib/api/queryClient';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionCard } from '@/components/common/SectionCard';
import { FormStepper } from '@/components/common/forms';
import { ErrorState } from '@/components/common/states';
import { ConfirmationDialog } from '@/components/common/ConfirmationDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { validateFile, type PendingFile } from '@/components/common/FileUpload';
import { formatCurrency } from '@/lib/utils/format';
import {
  basicInfoSchema,
  computeTotals,
  emptyItem,
  itemsSchema,
  paymentSchema,
  type ExpenseFormValues,
} from './expenseSchema';
import { StepBasicInfo } from './wizard/StepBasicInfo';
import { StepItems } from './wizard/StepItems';
import { StepPayment } from './wizard/StepPayment';
import { StepReview } from './wizard/StepReview';
import { SupplierDialog } from './SupplierDialog';
import type { ExpenseDetail } from './types';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { errorMessage } from '@/i18n/errors';

const STEPS = [
  { id: 'basic', labelKey: 'wizard.stepBasic' },
  { id: 'items', labelKey: 'wizard.stepItems' },
  { id: 'payment', labelKey: 'wizard.stepPayment' },
  { id: 'review', labelKey: 'wizard.stepReview' },
];

/** Each step validates only its own fields, so users are never blocked by a
 *  later step's requirements while still moving forward. */
const STEP_SCHEMAS = [basicInfoSchema, itemsSchema, paymentSchema, null] as const;

const STEP_FIELDS: (keyof ExpenseFormValues)[][] = [
  ['date', 'title', 'departmentId', 'fundId', 'costCenterId', 'categoryId', 'supplierId', 'description'],
  ['items'],
  ['payImmediately', 'paymentMethod', 'paymentAccountId', 'referenceNumber', 'paymentDate', 'notes'],
  [],
];

type SaveMode = 'draft' | 'submit' | 'approve';

export default function ExpenseWizardPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  // Roles trusted to approve their own requests can finish in one step.
  const canSubmitAndApprove = can('expense.approve') && can('expense.approve_own') && can('expense.submit');
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const pendingNavigation = useRef<string | null>(null);

  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

  const { data: existing, isLoading, error } = useQuery({
    queryKey: queryKeys.expense(id ?? ''),
    queryFn: () => api.get<ExpenseDetail>(`/expenses/${id}`),
    enabled: isEdit,
  });

  const form = useForm<ExpenseFormValues>({
    // Validation runs per-step via trigger(); the resolver handles the final submit.
    resolver: zodResolver(basicInfoSchema.partial()) as never,
    mode: 'onChange',
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      title: '',
      departmentId: '',
      fundId: '',
      costCenterId: '',
      categoryId: '',
      supplierId: '',
      onBehalfOfId: '',
      description: '',
      items: [emptyItem],
      payImmediately: false,
      paymentMethod: undefined,
      paymentAccountId: '',
      referenceNumber: '',
      paymentDate: new Date().toISOString().slice(0, 10),
      notes: '',
    },
  });

  const { reset, getValues, formState } = form;
  // useWatch re-renders on every nested field-array change; plain watch() lags
  // a keystroke behind and the sticky footer total would show a stale figure.
  const items = useWatch({ control: form.control, name: 'items' }) ?? [];
  const totals = useMemo(() => computeTotals(items as ExpenseFormValues['items']), [items]);

  // Load the record being edited into the form.
  useEffect(() => {
    if (!existing) return;
    reset({
      date: existing.date.slice(0, 10),
      title: existing.title,
      departmentId: existing.departmentId,
      fundId: existing.fundId,
      costCenterId: existing.costCenterId ?? '',
      categoryId: existing.categoryId,
      supplierId: existing.supplierId ?? '',
      onBehalfOfId: existing.onBehalfOfId ?? '',
      description: existing.description ?? '',
      items: existing.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit as never,
        rate: item.rate,
        taxRate: item.taxRate,
      })),
      payImmediately: existing.payImmediately,
      paymentMethod: (existing.paymentMethod ?? undefined) as never,
      paymentAccountId: existing.paymentAccountId ?? '',
      referenceNumber: existing.referenceNumber ?? '',
      paymentDate: existing.paymentDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      notes: existing.notes ?? '',
    });
    setFurthest(3);
  }, [existing, reset]);

  // Warn before a browser-level navigation loses unsaved work.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (formState.isDirty || files.length > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [formState.isDirty, files.length]);

  const addFiles = useCallback((incoming: File[]) => {
    const accepted: PendingFile[] = [];
    for (const file of incoming) {
      const problem = validateFile(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    if (accepted.length) setFiles((current) => [...current, ...accepted]);
  }, []);

  const removeFile = useCallback((fileId: string) => {
    setFiles((current) => {
      const target = current.find((item) => item.id === fileId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== fileId);
    });
  }, []);

  async function uploadAttachments(expenseId: string) {
    if (files.length === 0) return;
    const body = new FormData();
    for (const item of files) body.append('files', item.file);
    try {
      await api.post(`/expenses/${expenseId}/attachments`, body);
    } catch (uploadError) {
      toast.warning(t('wizard.uploadWarning'), { description: errorMessage(t, uploadError) });
    }
  }

  function toPayload(values: ExpenseFormValues) {
    return {
      date: values.date,
      title: values.title,
      departmentId: values.departmentId,
      fundId: values.fundId,
      costCenterId: values.costCenterId || null,
      categoryId: values.categoryId,
      supplierId: values.supplierId || null,
      onBehalfOfId: values.onBehalfOfId || null,
      description: values.description || null,
      notes: values.notes || null,
      items: values.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        rate: Number(item.rate),
        taxRate: Number(item.taxRate),
      })),
      payImmediately: values.payImmediately,
      paymentMethod: values.payImmediately ? values.paymentMethod : null,
      paymentAccountId: values.payImmediately ? values.paymentAccountId || null : null,
      referenceNumber: values.payImmediately ? values.referenceNumber || null : null,
      paymentDate: values.payImmediately ? values.paymentDate || null : null,
    };
  }

  const saveMutation = useMutation({
    mutationFn: async ({ values, mode }: { values: ExpenseFormValues; mode: SaveMode }) => {
      const payload = toPayload(values);
      const saved = isEdit
        ? await api.put<ExpenseDetail>(`/expenses/${id}`, payload)
        : await api.post<ExpenseDetail>('/expenses', payload);

      await uploadAttachments(saved.id);

      // Each step is a real workflow transition, so the audit trail records
      // submission and approval separately even when done in one click.
      if (mode !== 'draft') await api.post(`/expenses/${saved.id}/submit`, {});
      if (mode === 'approve') await api.post(`/expenses/${saved.id}/approve`, {});
      return { saved, mode };
    },
    onSuccess: ({ saved, mode }) => {
      invalidateFinancialData();
      form.reset(getValues());
      setFiles([]);
      const number = saved.expenseNumber;
      if (mode === 'approve') toast.success(t('wizard.approvedToast'), { description: t('wizard.approvedText', { number }) });
      else if (mode === 'submit') toast.success(t('expenses.submitted'), { description: t('wizard.submittedText', { number }) });
      else toast.success(t('wizard.draftSaved'), { description: t('wizard.draftSavedText', { number }) });
      navigate(`/expenses/${saved.id}`, { replace: true });
    },
    onError: (mutationError) => {
      if (mutationError instanceof ApiError) {
        const fieldErrors = mutationError.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) {
          form.setError(field.split('.')[0] as keyof ExpenseFormValues, { message });
        }
        toast.error(t('wizard.saveFailed'), { description: errorMessage(t, mutationError) });
        // Jump back to whichever step holds the first failing field.
        const firstField = Object.keys(fieldErrors)[0]?.split('.')[0];
        if (firstField) {
          const stepIndex = STEP_FIELDS.findIndex((fields) => fields.includes(firstField as keyof ExpenseFormValues));
          if (stepIndex >= 0) setStep(stepIndex);
        }
      } else {
        toast.error(t('wizard.saveFailed'));
      }
    },
  });

  async function validateStep(index: number): Promise<boolean> {
    const schema = STEP_SCHEMAS[index];
    if (!schema) return true;

    const values = getValues();
    const result = (schema as z.ZodTypeAny).safeParse(values);
    if (result.success) {
      form.clearErrors(STEP_FIELDS[index] as never);
      return true;
    }

    form.clearErrors(STEP_FIELDS[index] as never);
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      form.setError(path as never, { message: issue.message });
    }
    toast.error(t('validation.fixFields'));
    return false;
  }

  async function goNext() {
    if (!(await validateStep(step))) return;
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    setFurthest((value) => Math.max(value, next));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setStep((value) => Math.max(0, value - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSave(mode: SaveMode) {
    for (let index = 0; index < 3; index += 1) {
      if (!(await validateStep(index))) {
        setStep(index);
        return;
      }
    }
    saveMutation.mutate({ values: getValues(), mode });
  }

  function requestLeave(path: string) {
    if (form.formState.isDirty || files.length > 0) {
      pendingNavigation.current = path;
      setLeaveOpen(true);
    } else {
      navigate(path);
    }
  }

  if (isEdit && isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[420px] rounded-card" />
      </div>
    );
  }

  if (isEdit && error) {
    return <ErrorState message={errorMessage(t, error)} onRetry={() => navigate('/expenses')} />;
  }

  return (
    <FormProvider {...form}>
      <PageHeader
        title={isEdit ? t('wizard.editTitle', { number: existing?.expenseNumber ?? '' }) : t('wizard.createTitle')}
        subtitle={isEdit ? t('wizard.editSubtitle') : t('wizard.createSubtitle')}
        breadcrumbs={[{ label: t('expenses.title'), to: '/expenses' }, { label: isEdit ? t('common.edit') : t('common.new') }]}
      />

      <SectionCard noPadding>
        <div className="border-b border-line px-3 py-2.5 sm:px-4">
          <FormStepper
            steps={STEPS.map((item) => ({ id: item.id, label: t(item.labelKey) }))}
            current={step}
            furthest={furthest}
            onStepClick={async (index) => {
              if (index > step && !(await validateStep(step))) return;
              setStep(index);
            }}
          />
        </div>

        <div className="p-4 sm:p-5">
          {step === 0 && <StepBasicInfo onAddSupplier={() => setSupplierOpen(true)} />}
          {step === 1 && <StepItems />}
          {step === 2 && (
            <StepPayment files={files} onAddFiles={addFiles} onRemoveFile={removeFile} isMobile={isMobile} />
          )}
          {step === 3 && <StepReview files={files} />}
        </div>

        {/* Sticky action bar — stays reachable on long forms and on mobile. */}
        <div className="sticky bottom-[var(--bottom-nav-height)] z-10 flex flex-col gap-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-0">
          <div className="flex items-center justify-between gap-4 sm:justify-start">
            <span className="text-[12px] text-ink-muted">{t('common.total')}</span>
            <span className="text-[16px] font-semibold text-brand tnum">
              {formatCurrency(totals.total, { decimals: true })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {step === 0 ? (
              <Button type="button" variant="outline" onClick={() => requestLeave('/expenses')}>
                {t('common.cancel')}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={goBack}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                {t('common.back')}
              </Button>
            )}

            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => void goNext()}>
                {t('common.next')}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saveMutation.isPending}
                  loading={saveMutation.isPending && saveMutation.variables?.mode === 'draft'}
                  onClick={() => void handleSave('draft')}
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('wizard.saveDraft')}
                </Button>
                <Button
                  type="button"
                  variant={canSubmitAndApprove ? 'outline' : 'primary'}
                  disabled={saveMutation.isPending}
                  loading={saveMutation.isPending && saveMutation.variables?.mode === 'submit'}
                  onClick={() => void handleSave('submit')}
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('wizard.submit')}
                </Button>
                {canSubmitAndApprove && (
                  <Button
                    type="button"
                    variant="success"
                    disabled={saveMutation.isPending}
                    loading={saveMutation.isPending && saveMutation.variables?.mode === 'approve'}
                    onClick={() => void handleSave('approve')}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('wizard.submitApprove')}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </SectionCard>

      <SupplierDialog
        open={supplierOpen}
        onOpenChange={setSupplierOpen}
        onCreated={(supplierId) => form.setValue('supplierId', supplierId, { shouldValidate: true })}
      />

      <ConfirmationDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t('forms.discardTitle')}
        description={t('forms.discardText')}
        confirmLabel={t('forms.discard')}
        tone="danger"
        onConfirm={() => {
          setLeaveOpen(false);
          const path = pendingNavigation.current ?? '/expenses';
          pendingNavigation.current = null;
          navigate(path);
        }}
      />
    </FormProvider>
  );
}
