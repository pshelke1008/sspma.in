import { ExternalLink, FileText, ImageIcon, MessageSquareReply, Phone, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils/cn';
import type { TemplateButton } from './api';

/** The {{n}} placeholders replaced by the values entered so far; unfilled ones stay visible. */
export function fillVariables(text: string, values: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index: string) => values[Number(index) - 1]?.trim() || match);
}

const BUTTON_ICONS = { QUICK_REPLY: MessageSquareReply, URL: ExternalLink, PHONE_NUMBER: Phone, OTHER: MessageSquareReply } as const;

/** The file a media-header template is sent with, as far as this browser knows it. */
export interface PreviewMedia {
  kind: 'image' | 'video' | 'document';
  fileName: string;
  previewUrl?: string;
}

const MEDIA_ICONS = { image: ImageIcon, video: Video, document: FileText } as const;

function HeaderMedia({ format, media }: { format: string; media?: PreviewMedia | null }) {
  const { t } = useTranslation();
  const kind = format.toLowerCase() as PreviewMedia['kind'];
  const Icon = MEDIA_ICONS[kind] ?? ImageIcon;

  if (media?.previewUrl && media.kind === 'image') {
    return <img src={media.previewUrl} alt={media.fileName} className="mb-1.5 max-h-44 w-full rounded-[6px] object-cover" />;
  }
  if (media?.previewUrl && media.kind === 'video') {
    return <video src={media.previewUrl} className="mb-1.5 max-h-44 w-full rounded-[6px]" muted aria-label={media.fileName} />;
  }
  return (
    <div className="mb-1.5 flex h-24 items-center justify-center gap-2 rounded-[6px] bg-canvas px-2 text-[12px] text-ink-muted">
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="truncate">{media ? media.fileName : t(`whatsapp.campaign.headerPlaceholder.${kind}`, { defaultValue: format })}</span>
    </div>
  );
}

/** A template drawn the way it will look in WhatsApp: header, text, footer and buttons. */
export function TemplatePreview({
  headerFormat,
  headerMedia,
  headerText,
  bodyText,
  footerText,
  buttons = [],
  values = [],
  className,
}: {
  /** IMAGE, VIDEO or DOCUMENT draws the file (or a placeholder) above the text. */
  headerFormat?: string | null;
  headerMedia?: PreviewMedia | null;
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
  buttons?: TemplateButton[];
  values?: string[];
  className?: string;
}) {
  return (
    <div className={cn('rounded-card bg-brand-light p-3', className)}>
      <div className="max-w-[92%] rounded-[10px] rounded-tl-sm bg-white px-3 py-2 text-[13px] leading-relaxed text-ink shadow-sm">
        {headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat) && <HeaderMedia format={headerFormat} media={headerMedia} />}
        {headerText && <p className="mb-1 font-semibold [overflow-wrap:anywhere]">{headerText}</p>}
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{fillVariables(bodyText, values)}</p>
        {footerText && <p className="mt-1.5 text-[11.5px] text-ink-muted [overflow-wrap:anywhere]">{footerText}</p>}
      </div>
      {buttons.length > 0 && (
        <div className="mt-1 max-w-[92%] space-y-1">
          {buttons.map((button, index) => {
            const Icon = BUTTON_ICONS[button.type];
            return (
              <div
                key={index}
                className="flex items-center justify-center gap-1.5 rounded-[10px] bg-white px-3 py-1.5 text-[12.5px] font-medium text-info shadow-sm"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{button.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
