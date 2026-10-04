import { useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bytes } from '@/lib/utils/format';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { cn } from '@/lib/utils/cn';

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp';
const MAX_BYTES = 10 * 1024 * 1024;

export interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

/**
 * Client-side checks are a courtesy for fast feedback; the API re-validates the
 * MIME type, extension, size and magic bytes on every upload.
 */
export function validateFile(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) return i18n.t('forms.fileType', { name: file.name });
  if (file.size > MAX_BYTES) return i18n.t('forms.fileSize', { name: file.name });
  if (file.size === 0) return i18n.t('forms.fileEmpty', { name: file.name });
  return null;
}

export function FileUpload({
  files,
  onAdd,
  onRemove,
  disabled,
  label,
  capture,
  maxFiles = 5,
}: {
  files: PendingFile[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  label?: string;
  capture?: boolean;
  maxFiles?: number;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const text = label ?? t('forms.uploadLabel');
  const [dragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    onAdd(Array.from(list).slice(0, maxFiles - files.length));
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-2.5">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          'rounded-control border-2 border-dashed p-4 text-center transition-colors',
          dragging ? 'border-brand-primary bg-brand-light/50' : 'border-line bg-canvas/50',
          disabled && 'opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          {...(capture ? { capture: 'environment' as const } : {})}
          className="sr-only"
          disabled={disabled || files.length >= maxFiles}
          onChange={(event) => handleFiles(event.target.files)}
          id="file-upload-input"
          aria-label={text}
        />
        <Upload className="mx-auto h-5 w-5 text-ink-muted" aria-hidden="true" />
        <p className="mt-2 text-[12.5px] font-medium text-ink">{text}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">{t('forms.uploadHint')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={disabled || files.length >= maxFiles}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          {capture ? t('forms.takePhoto') : t('forms.chooseFiles')}
        </Button>
      </div>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-control border border-line bg-white px-3 py-2"
            >
              {item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-line"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-brand-light">
                  {item.file.type.startsWith('image/') ? (
                    <ImageIcon className="h-4 w-4 text-brand" aria-hidden="true" />
                  ) : (
                    <FileText className="h-4 w-4 text-brand" aria-hidden="true" />
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-ink">{item.file.name}</p>
                <p className="text-[11px] text-ink-muted">{bytes(item.file.size)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onRemove(item.id)}
                aria-label={t('forms.removeFile', { name: item.file.name })}
                disabled={disabled}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
