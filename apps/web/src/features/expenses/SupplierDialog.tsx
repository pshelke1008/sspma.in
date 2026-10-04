import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ApiError, api } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/common/forms';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/i18n/errors';

const schema = z.object({
  name: z.string().trim().min(2, 'supplierDialog.nameRequired'),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('validation.email').optional().or(z.literal('')),
  gstin: z.string().optional(),
  city: z.string().optional(),
});

type SupplierValues = z.infer<typeof schema>;

export function SupplierDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (supplierId: string) => void;
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SupplierValues>({ resolver: zodResolver(schema), defaultValues: { name: '' } });

  const mutation = useMutation({
    mutationFn: (values: SupplierValues) => api.post<{ data: { id: string; name: string } }>('/masters/suppliers', values),
    onSuccess: (result) => {
      toast.success(t('supplierDialog.added', { name: result.data.name }));
      queryClient.invalidateQueries({ queryKey: queryKeys.masters });
      onCreated?.(result.data.id);
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) setError(field as keyof SupplierValues, { message });
        if (Object.keys(fieldErrors).length === 0) toast.error(t('supplierDialog.failed'), { description: errorMessage(t, error) });
      } else {
        toast.error(t('supplierDialog.failed'));
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('supplierDialog.title')}</DialogTitle>
          <DialogDescription>{t('supplierDialog.text')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('supplierDialog.name')} htmlFor="supplier-name" required error={errors.name?.message} className="sm:col-span-2">
                <Input id="supplier-name" invalid={Boolean(errors.name)} {...register('name')} />
              </FormField>
              <FormField label={t('supplierDialog.contact')} htmlFor="supplier-contact">
                <Input id="supplier-contact" {...register('contactPerson')} />
              </FormField>
              <FormField label={t('common.phone')} htmlFor="supplier-phone">
                <Input id="supplier-phone" inputMode="tel" {...register('phone')} />
              </FormField>
              <FormField label={t('common.email')} htmlFor="supplier-email" error={errors.email?.message}>
                <Input id="supplier-email" type="email" invalid={Boolean(errors.email)} {...register('email')} />
              </FormField>
              <FormField label={t('common.city')} htmlFor="supplier-city">
                <Input id="supplier-city" {...register('city')} />
              </FormField>
              <FormField label={t('supplierDialog.gstin')} htmlFor="supplier-gstin" error={errors.gstin?.message} className="sm:col-span-2">
                <Input id="supplier-gstin" placeholder={t('supplierDialog.gstinPlaceholder')} {...register('gstin')} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isSubmitting || mutation.isPending}>
              {t('supplierDialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
