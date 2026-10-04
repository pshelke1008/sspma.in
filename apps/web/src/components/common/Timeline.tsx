import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2,
  CircleDollarSign,
  FileEdit,
  FilePlus2,
  Send,
  Trash2,
  XCircle,
  BookCheck,
  RotateCcw,
  Paperclip,
  LogIn,
  Settings,
  UserPlus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatDate, relativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

export interface TimelineEntry {
  id: string;
  action: string;
  entityLabel?: string | null;
  timestamp: string;
  user?: { name: string; designation?: string | null } | null;
  newValue?: unknown;
  oldValue?: unknown;
}

const ACTION_META: Record<string, { icon: LucideIcon; tone: string }> = {
  'expense.created': { icon: FilePlus2, tone: 'bg-brand-light text-brand' },
  'expense.updated': { icon: FileEdit, tone: 'bg-info/10 text-info' },
  'expense.submitted': { icon: Send, tone: 'bg-accent-light text-accent-ink' },
  'expense.approved': { icon: CheckCircle2, tone: 'bg-success/10 text-success' },
  'expense.rejected': { icon: XCircle, tone: 'bg-danger/10 text-danger' },
  'expense.deleted': { icon: Trash2, tone: 'bg-danger/10 text-danger' },
  'expense.revised': { icon: RotateCcw, tone: 'bg-warning/10 text-[#986812]' },
  'expense.attachment_added': { icon: Paperclip, tone: 'bg-canvas text-ink-muted' },
  'expense.attachment_removed': { icon: Paperclip, tone: 'bg-canvas text-ink-muted' },
  'payment.recorded': { icon: CircleDollarSign, tone: 'bg-brand-light text-brand' },
  'accounting.posted': { icon: BookCheck, tone: 'bg-brand-light text-brand' },
  'user.login': { icon: LogIn, tone: 'bg-canvas text-ink-muted' },
  'user.created': { icon: UserPlus, tone: 'bg-brand-light text-brand' },
  'settings.changed': { icon: Settings, tone: 'bg-canvas text-ink-muted' },
};

function describe(action: string, t: TFunction) {
  const meta = ACTION_META[action] ?? { icon: FileEdit, tone: 'bg-canvas text-ink-muted' };
  const fallback = action.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  // Action keys contain dots, so look them up without key-path splitting.
  const actions = t('timeline.actions', { returnObjects: true }) as Record<string, string>;
  return { ...meta, label: actions[action] ?? fallback };
}

export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return <p className="py-6 text-center text-[12.5px] text-ink-muted">{t('timeline.empty')}</p>;
  }

  return (
    <ol className={cn('relative space-y-0', className)}>
      {entries.map((entry, index) => {
        const meta = describe(entry.action, t);
        const Icon = meta.icon;
        const isLast = index === entries.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-line" aria-hidden="true" />}
            <span className={cn('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', meta.tone)}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-[13px] font-medium text-ink">{meta.label}</p>
                <time className="text-[11.5px] text-ink-muted" dateTime={entry.timestamp}>
                  {relativeTime(entry.timestamp)}
                </time>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                {entry.user?.name ?? t('timeline.system')}
                {entry.user?.designation ? ` · ${entry.user.designation}` : ''} · {formatDate(entry.timestamp, 'long')}
              </p>
              <ChangeSummary entry={entry} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ChangeSummary({ entry }: { entry: TimelineEntry }) {
  const value = entry.newValue as Record<string, unknown> | null | undefined;
  if (!value || typeof value !== 'object') return null;

  const interesting = ['reason', 'comments', 'amount', 'method', 'status', 'total'];
  const parts = interesting
    .filter((key) => value[key] !== undefined && value[key] !== null && value[key] !== '')
    .map((key) => `${key}: ${String(value[key])}`);

  if (parts.length === 0) return null;

  return (
    <p className="mt-1 rounded-control bg-canvas px-2 py-1 text-[11.5px] text-ink-muted">
      {parts.join(' · ')}
    </p>
  );
}
