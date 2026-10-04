import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Copy, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError, api, downloadFile } from '@/lib/api/client';
import { invalidateDonationData } from '@/lib/api/queryClient';
import { errorMessage } from '@/i18n/errors';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { bytes, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/** Mirrors the API caps in donor.import.parse.ts; the server enforces them. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_MB = MAX_BYTES / 1024 / 1024;
/** Rows rendered at once — enough to review, light enough for a phone. */
const VISIBLE_ROWS = 300;

type RowStatus = 'valid' | 'invalid' | 'duplicate';
type DuplicateStrategy = 'skip' | 'update';

interface RowError {
  field: string;
  code: string;
  message: string;
}

type DuplicateMatch =
  | { source: 'existing'; field: 'phone' | 'pan'; donorId: string; code: string; name: string; isActive: boolean }
  | { source: 'file'; field: 'phone' | 'pan'; rowNumber: number };

interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  name: string;
  phone: string | null;
  whatsappNumber: string | null;
  panNumber: string | null;
  email: string | null;
  village: string | null;
  district: string | null;
  state: string | null;
  errors: RowError[];
  match: DuplicateMatch | null;
}

interface ImportPreview {
  fileName: string;
  totalRows: number;
  counts: { valid: number; invalid: number; duplicate: number; duplicateExisting: number; duplicateInFile: number };
  unknownColumns: string[];
  rows: PreviewRow[];
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  total: number;
}

function importError(t: TFunction, error: unknown): string | undefined {
  if (error instanceof ApiError) {
    const translated = t(`donorImport.errors.${error.code}`, { defaultValue: '', size: MAX_MB, rows: formatNumber(MAX_ROWS) });
    if (translated) return translated;
  }
  return errorMessage(t, error);
}

/**
 * Bulk donor import: upload a CSV, review every row (valid / errors /
 * duplicate of an existing donor or an earlier row), choose what happens to
 * duplicates, then commit. The server re-checks everything on commit.
 */
export function DonorImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip');
  const [filter, setFilter] = useState<'all' | RowStatus>('all');
  const [downloading, setDownloading] = useState(false);

  function resetAll() {
    setFile(null);
    setFileError(null);
    setPreview(null);
    setResult(null);
    setStrategy('skip');
    setFilter('all');
  }

  // Start fresh each time the dialog opens.
  useEffect(() => {
    if (open) resetAll();
  }, [open]);

  const previewMutation = useMutation({
    mutationFn: (selected: File) => {
      const body = new FormData();
      body.append('file', selected);
      return api.post<{ data: ImportPreview }>('/donors/import/preview', body);
    },
    onSuccess: (response) => {
      setPreview(response.data);
      setFilter('all');
    },
    onError: (error) => {
      setFile(null);
      setFileError(importError(t, error) ?? t('donorImport.previewFailed'));
    },
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('file', file as File);
      body.append('duplicates', strategy);
      return api.post<{ data: ImportResult }>('/donors/import/commit', body);
    },
    onSuccess: (response) => {
      setResult(response.data);
      invalidateDonationData();
      toast.success(t('donorImport.doneTitle'), {
        description: t('donorImport.doneToast', {
          created: formatNumber(response.data.created),
          updated: formatNumber(response.data.updated),
        }),
      });
    },
    onError: (error) => {
      toast.error(t('donorImport.failed'), { description: importError(t, error) });
    },
  });

  function choose(selected: File | undefined) {
    if (!selected) return;
    setFileError(null);
    if (!/\.csv$/i.test(selected.name)) return setFileError(t('donorImport.errors.IMPORT_NOT_CSV'));
    if (selected.size > MAX_BYTES) return setFileError(t('donorImport.errors.IMPORT_TOO_LARGE', { size: MAX_MB }));
    if (selected.size === 0) return setFileError(t('donorImport.errors.IMPORT_EMPTY'));
    setFile(selected);
    previewMutation.mutate(selected);
  }

  async function downloadTemplate() {
    setDownloading(true);
    try {
      await downloadFile('/donors/import/template', 'donor-import-template.csv');
    } catch (error) {
      toast.error(t('donorImport.templateFailed'), { description: errorMessage(t, error) });
    } finally {
      setDownloading(false);
    }
  }

  const importable = preview
    ? preview.counts.valid + (strategy === 'update' ? preview.counts.duplicateExisting : 0)
    : 0;
  const step = result ? 'done' : preview ? 'review' : 'upload';
  const busy = commitMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t('donorImport.title')}</DialogTitle>
          <DialogDescription>{t('donorImport.description')}</DialogDescription>
          <Steps current={step} />
        </DialogHeader>

        {step === 'upload' && (
          <>
            <DialogBody className="space-y-4">
              <UploadStep
                onChoose={choose}
                checking={previewMutation.isPending ? file?.name ?? '' : null}
                error={fileError}
                onDownloadTemplate={() => void downloadTemplate()}
                downloading={downloading}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'review' && preview && (
          <>
            <DialogBody className="space-y-4">
              <ReviewStep
                preview={preview}
                fileSize={file?.size ?? 0}
                filter={filter}
                onFilter={setFilter}
                strategy={strategy}
                onStrategy={setStrategy}
                disabled={busy}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetAll} disabled={busy}>
                {t('donorImport.chooseAnother')}
              </Button>
              <Button type="button" onClick={() => commitMutation.mutate()} loading={busy} disabled={importable === 0}>
                {importable === 0
                  ? t('donorImport.nothingToImport')
                  : t('donorImport.importCount', { count: importable, formatted: formatNumber(importable) })}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'done' && result && (
          <>
            <DialogBody>
              <DoneStep result={result} />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetAll}>
                {t('donorImport.importAnother')}
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Steps({ current }: { current: 'upload' | 'review' | 'done' }) {
  const { t } = useTranslation();
  const steps = [
    { key: 'upload', label: t('donorImport.stepUpload') },
    { key: 'review', label: t('donorImport.stepReview') },
    { key: 'done', label: t('donorImport.stepDone') },
  ] as const;
  const index = steps.findIndex((step) => step.key === current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[11.5px]" aria-label={t('donorImport.stepsLabel')}>
      {steps.map((step, position) => (
        <li
          key={step.key}
          aria-current={position === index ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5',
            position === index ? 'font-semibold text-brand' : position < index ? 'text-ink' : 'text-ink-muted',
          )}
        >
          <span
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded-full border text-[10.5px] tnum',
              position <= index ? 'border-brand-primary bg-brand-light' : 'border-line',
            )}
            aria-hidden="true"
          >
            {position + 1}
          </span>
          {step.label}
          {position < steps.length - 1 && <span className="ml-1 text-ink-muted" aria-hidden="true">›</span>}
        </li>
      ))}
    </ol>
  );
}

function UploadStep({
  onChoose,
  checking,
  error,
  onDownloadTemplate,
  downloading,
}: {
  onChoose: (file: File | undefined) => void;
  checking: string | null;
  error: string | null;
  onDownloadTemplate: () => void;
  downloading: boolean;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <section className="rounded-control border border-line bg-canvas/50 p-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-ink">{t('donorImport.templateTitle')}</h3>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{t('donorImport.templateText')}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onDownloadTemplate} loading={downloading} className="shrink-0">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('donorImport.downloadTemplate')}
          </Button>
        </div>
        <ul className="mt-3 grid gap-1 text-[11.5px] leading-relaxed text-ink-muted sm:grid-cols-2">
          {(['formatPhone', 'formatCategory', 'formatLanguage', 'formatTags', 'formatOptIn', 'formatDuplicates'] as const).map(
            (key) => (
              <li key={key} className="flex gap-1.5">
                <span aria-hidden="true">•</span>
                <span>{t(`donorImport.${key}`)}</span>
              </li>
            ),
          )}
        </ul>
      </section>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!checking) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!checking) onChoose(event.dataTransfer.files[0]);
        }}
        className={cn(
          'rounded-control border-2 border-dashed p-6 text-center transition-colors',
          dragging ? 'border-brand-primary bg-brand-light/50' : 'border-line bg-canvas/40',
        )}
      >
        <input
          ref={inputRef}
          id="donor-import-file"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label={t('donorImport.fileLabel')}
          aria-describedby="donor-import-limits"
          onChange={(event) => {
            onChoose(event.target.files?.[0]);
            event.target.value = '';
          }}
          disabled={Boolean(checking)}
        />
        <FileSpreadsheet className="mx-auto h-7 w-7 text-ink-muted" aria-hidden="true" />
        <p className="mt-2 text-[13px] font-medium text-ink">
          {checking !== null ? t('donorImport.checking', { name: checking }) : t('donorImport.dropTitle')}
        </p>
        <p id="donor-import-limits" className="mt-1 text-[12px] text-ink-muted">
          {t('donorImport.dropLimits', { size: MAX_MB, rows: formatNumber(MAX_ROWS) })}
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-4"
          onClick={() => inputRef.current?.click()}
          loading={checking !== null}
        >
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          {t('donorImport.chooseFile')}
        </Button>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/5 px-3 py-2.5 text-[12.5px] text-danger">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </>
  );
}

function ReviewStep({
  preview,
  fileSize,
  filter,
  onFilter,
  strategy,
  onStrategy,
  disabled,
}: {
  preview: ImportPreview;
  fileSize: number;
  filter: 'all' | RowStatus;
  onFilter: (value: 'all' | RowStatus) => void;
  strategy: DuplicateStrategy;
  onStrategy: (value: DuplicateStrategy) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { counts } = preview;

  const filtered = useMemo(
    () => (filter === 'all' ? preview.rows : preview.rows.filter((row) => row.status === filter)),
    [preview.rows, filter],
  );
  const visible = filtered.slice(0, VISIBLE_ROWS);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
          <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{preview.fileName}</span>
        </span>
        <span>{bytes(fileSize)}</span>
        <span>{t('donorImport.rows', { count: preview.totalRows, formatted: formatNumber(preview.totalRows) })}</span>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        <Count label={t('donorImport.statusValid')} value={counts.valid} tone="success" />
        <Count label={t('donorImport.statusDuplicate')} value={counts.duplicate} tone="warning" />
        <Count label={t('donorImport.statusInvalid')} value={counts.invalid} tone="danger" />
      </dl>

      {preview.unknownColumns.length > 0 && (
        <p className="flex items-start gap-2 rounded-control border border-info/25 bg-info/5 px-3 py-2.5 text-[12px] text-info">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('donorImport.unknownColumns', { columns: preview.unknownColumns.join(', ') })}
        </p>
      )}

      {counts.duplicate > 0 && (
        <fieldset className="rounded-control border border-line p-3.5" disabled={disabled}>
          <legend className="px-1 text-[12.5px] font-semibold text-ink">{t('donorImport.duplicatesTitle')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['skip', 'update'] as const).map((option) => (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-control border p-2.5 transition-colors',
                  strategy === option ? 'border-brand-primary bg-brand-light/40' : 'border-line hover:bg-canvas',
                )}
              >
                <input
                  type="radio"
                  name="donor-import-duplicates"
                  value={option}
                  checked={strategy === option}
                  onChange={() => onStrategy(option)}
                  className="mt-0.5 h-4 w-4 accent-brand-primary"
                />
                <span>
                  <span className="block text-[12.5px] font-medium text-ink">
                    {option === 'skip' ? t('donorImport.duplicatesSkip') : t('donorImport.duplicatesUpdate')}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                    {option === 'skip' ? t('donorImport.duplicatesSkipText') : t('donorImport.duplicatesUpdateText')}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {counts.duplicateInFile > 0 && (
            <p className="mt-2 text-[11.5px] text-ink-muted">
              {t('donorImport.inFileNote', { count: counts.duplicateInFile, formatted: formatNumber(counts.duplicateInFile) })}
            </p>
          )}
        </fieldset>
      )}

      {counts.invalid > 0 && <p className="text-[12px] text-ink-muted">{t('donorImport.invalidNote')}</p>}

      <SegmentedControl
        value={filter}
        onChange={(value) => onFilter(value as 'all' | RowStatus)}
        label={t('donorImport.filterLabel')}
        segments={[
          { value: 'all', label: t('donorImport.filterAll'), count: preview.totalRows },
          { value: 'valid', label: t('donorImport.statusValid'), count: counts.valid },
          { value: 'duplicate', label: t('donorImport.statusDuplicate'), count: counts.duplicate },
          { value: 'invalid', label: t('donorImport.statusInvalid'), count: counts.invalid },
        ]}
      />

      {visible.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-ink-muted">{t('donorImport.noRowsInFilter')}</p>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line" aria-label={t('donorImport.rowsLabel')}>
          {visible.map((row) => (
            <PreviewRowItem key={row.rowNumber} row={row} />
          ))}
        </ul>
      )}
      {filtered.length > visible.length && (
        <p className="text-center text-[11.5px] text-ink-muted">
          {t('donorImport.showingFirst', { shown: formatNumber(visible.length), total: formatNumber(filtered.length) })}
        </p>
      )}
    </>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="rounded-control border border-line bg-white px-3 py-2">
      <dt className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-ink-muted">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-danger',
          )}
          aria-hidden="true"
        />
        {label}
      </dt>
      <dd className="mt-0.5 text-[16px] font-semibold text-ink tnum">{formatNumber(value)}</dd>
    </div>
  );
}

function PreviewRowItem({ row }: { row: PreviewRow }) {
  const { t } = useTranslation();
  const details = [row.phone, row.whatsappNumber && row.whatsappNumber !== row.phone ? row.whatsappNumber : null, row.panNumber, [row.village, row.district].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' · ');
  const fieldName = (field: 'phone' | 'pan') => (field === 'phone' ? t('donorImport.fieldPhone') : t('donorImport.fieldPan'));

  return (
    <li className="flex gap-3 px-3 py-2.5">
      <span className="w-10 shrink-0 pt-px text-[11.5px] text-ink-muted tnum">#{row.rowNumber}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[13px] font-medium text-ink">{row.name || t('donorImport.noName')}</span>
          <Badge tone={row.status === 'valid' ? 'success' : row.status === 'duplicate' ? 'warning' : 'danger'}>
            {row.status === 'valid'
              ? t('donorImport.statusValid')
              : row.status === 'duplicate'
                ? t('donorImport.statusDuplicate')
                : t('donorImport.statusInvalid')}
          </Badge>
        </div>
        {details && <p className="mt-0.5 truncate text-[11.5px] text-ink-muted">{details}</p>}

        {row.match && (
          <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-[#986812]">
            <Copy className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              {row.match.source === 'existing'
                ? t('donorImport.matchesExisting', {
                    code: row.match.code,
                    name: row.match.name,
                    field: fieldName(row.match.field),
                  }) + (row.match.isActive ? '' : ` ${t('donorImport.inactive')}`)
                : t('donorImport.matchesRow', { row: row.match.rowNumber, field: fieldName(row.match.field) })}
            </span>
          </p>
        )}

        {row.errors.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {row.errors.map((error) => (
              <li key={`${error.field}-${error.code}`} className="flex items-start gap-1.5 text-[11.5px] text-danger">
                <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-medium">{t(`donorImport.fields.${error.field}`, { defaultValue: error.field })}:</span>{' '}
                  {t(`donorImport.rowErrors.${error.code}`, { defaultValue: error.message })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function DoneStep({ result }: { result: ImportResult }) {
  const { t } = useTranslation();
  const items = [
    { key: 'created', label: t('donorImport.created'), value: result.created },
    { key: 'updated', label: t('donorImport.updated'), value: result.updated },
    { key: 'skipped', label: t('donorImport.skipped'), value: result.skipped },
    { key: 'failed', label: t('donorImport.failedCount'), value: result.failed },
  ];
  return (
    <div className="py-2 text-center" role="status">
      <CheckCircle2 className="mx-auto h-9 w-9 text-success" aria-hidden="true" />
      <p className="mt-2 text-[14px] font-semibold text-ink">{t('donorImport.doneTitle')}</p>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        {t('donorImport.doneText', { count: result.total, formatted: formatNumber(result.total) })}
      </p>
      <dl className="mx-auto mt-4 grid max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.key} className="rounded-control border border-line bg-canvas/50 px-3 py-2">
            <dt className="text-[10.5px] uppercase tracking-wide text-ink-muted">{item.label}</dt>
            <dd className="mt-0.5 text-[16px] font-semibold text-ink tnum">{formatNumber(item.value)}</dd>
          </div>
        ))}
      </dl>
      {result.failed > 0 && <p className="mt-3 text-[12px] text-ink-muted">{t('donorImport.failedNote')}</p>}
    </div>
  );
}
