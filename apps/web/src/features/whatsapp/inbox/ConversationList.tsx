import { useTranslation } from 'react-i18next';
import { Check, CheckCheck, Clock, FileText, Image as ImageIcon, LayoutTemplate, Mic, Search, SearchX, Smile, Video, X, AlertCircle } from 'lucide-react';
import { SegmentedControl } from '@/components/common/SegmentedControl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { intlLocale } from '@/i18n';
import { cn } from '@/lib/utils/cn';
import {
  avatarColor,
  avatarInitials,
  conversationName,
  isSameDay,
  type Conversation,
  type ConversationFilter,
  type MediaType,
} from './api';
import type { MessageStatus } from '../api';

const FILTERS: ConversationFilter[] = ['all', 'unread', 'donors', 'unknown'];

export const MEDIA_ICONS: Record<MediaType, typeof ImageIcon> = {
  image: ImageIcon,
  document: FileText,
  audio: Mic,
  video: Video,
  sticker: Smile,
};

/** WhatsApp-style stamp: time today, "Yesterday", then a short date. */
export function listTime(value: string | null, yesterday: string): string {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (isSameDay(date, now)) return new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
  const prior = new Date(now);
  prior.setDate(now.getDate() - 1);
  if (isSameDay(date, prior)) return yesterday;
  return new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
}

export function ConversationAvatar({ name, seed, size = 'md' }: { name: string; seed: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold text-white',
        size === 'md' ? 'h-12 w-12 text-sm' : 'h-10 w-10 text-[13px]',
      )}
      style={{ backgroundColor: avatarColor(seed) }}
    >
      {avatarInitials(name)}
    </span>
  );
}

export function ConversationList({
  conversations,
  selectedPhone,
  onSelect,
  isLoading,
  isError,
  onRetry,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  unreadTotal,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  conversations: Conversation[];
  selectedPhone: string | null;
  onSelect: (conversation: Conversation) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: ConversationFilter;
  onFilterChange: (filter: ConversationFilter) => void;
  unreadTotal: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className="border-b border-line bg-white px-4 pb-3 pt-4">
        <h1 className="mb-3 text-[16px] font-semibold text-ink">{t('whatsappInbox.title')}</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('whatsappInbox.searchPlaceholder')}
            aria-label={t('whatsappInbox.searchLabel')}
            className="bg-canvas pl-9 pr-9 focus:bg-white"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label={t('whatsappInbox.clearSearch')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-line bg-white px-4 py-2.5">
        <SegmentedControl
          label={t('whatsappInbox.filterLabel')}
          value={filter}
          onChange={(value) => onFilterChange(value as ConversationFilter)}
          className="w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-2 [&>button]:text-[12px]"
          segments={FILTERS.map((key) => ({
            value: key,
            label: t(`whatsappInbox.filters.${key}`),
            count: key === 'unread' ? unreadTotal : undefined,
          }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="divide-y divide-line" aria-busy="true" aria-label={t('whatsappInbox.loadingConversations')}>
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="flex justify-between gap-2">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center px-6 py-14 text-center" role="alert">
            <AlertCircle className="mb-2 h-6 w-6 text-danger" aria-hidden="true" />
            <p className="text-[13px] font-medium text-ink">{t('whatsappInbox.loadFailed')}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-canvas">
              <SearchX className="h-6 w-6 text-ink-muted" aria-hidden="true" />
            </span>
            <p className="mb-1 text-[13px] font-medium text-ink">
              {search ? t('whatsappInbox.noResults') : t(`whatsappInbox.empty.${filter}`)}
            </p>
            <p className="text-[12px] text-ink-muted">{search ? t('whatsappInbox.noResultsHint') : t('whatsappInbox.emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line" aria-label={t('whatsappInbox.listLabel')}>
            {conversations.map((conversation) => (
              <li key={conversation.phone}>
                <ConversationRow
                  conversation={conversation}
                  selected={conversation.phone === selectedPhone}
                  onSelect={() => onSelect(conversation)}
                />
              </li>
            ))}
            {hasMore && (
              <li className="px-4 py-3 text-center">
                <Button variant="ghost" size="sm" onClick={onLoadMore} loading={loadingMore}>
                  {t('whatsappInbox.loadMoreConversations')}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}

function ConversationRow({ conversation, selected, onSelect }: { conversation: Conversation; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const name = conversationName(conversation);
  const unread = conversation.unreadCount;
  const last = conversation.lastMessage;
  const MediaIcon = last?.mediaType ? MEDIA_ICONS[last.mediaType] : null;
  const preview =
    last?.body ||
    (last?.mediaType ? t(`whatsappInbox.media.${last.mediaType}`) : last?.templateName ? t('whatsappInbox.templateNamed', { name: last.templateName }) : '');

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 border-l-[3px] px-4 py-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary/50',
        selected ? 'border-l-brand-primary bg-brand-light/60' : 'border-l-transparent hover:bg-canvas',
      )}
    >
      <span className="relative">
        <ConversationAvatar name={name} seed={conversation.phone} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#008069] px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="mb-0.5 flex items-center justify-between gap-2">
          <span className={cn('truncate text-[13.5px]', unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink')}>{name}</span>
          <span className={cn('shrink-0 text-[11px]', unread > 0 ? 'font-semibold text-[#008069]' : 'text-ink-muted')}>
            {listTime(conversation.lastMessageAt, t('whatsappInbox.yesterday'))}
          </span>
        </span>

        <span className={cn('flex items-center gap-1 text-[12px]', unread > 0 ? 'font-medium text-ink' : 'text-ink-muted')}>
          {last?.direction === 'OUTBOUND' && <PreviewTick status={last.status} />}
          {MediaIcon && <MediaIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {!MediaIcon && last?.templateName && !last.body && <LayoutTemplate className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{preview || t('whatsappInbox.noMessagesYet')}</span>
        </span>

        <span className="mt-1.5 flex items-center gap-1.5">
          {conversation.donor ? (
            <span className="inline-flex items-center rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-semibold text-brand">
              {t('whatsappInbox.donorTag')}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-ink-muted ring-1 ring-inset ring-line">
              {t('whatsappInbox.unknownTag')}
            </span>
          )}
          {unread > 0 && <span className="sr-only">{t('whatsappInbox.unreadCount', { count: unread })}</span>}
        </span>
      </span>
    </button>
  );
}

function PreviewTick({ status }: { status: MessageStatus }) {
  const { t } = useTranslation();
  const label = t(`whatsappInbox.status.${status}`);
  if (status === 'READ') return <CheckCheck className="h-3.5 w-3.5 shrink-0 text-[#53bdeb]" aria-label={label} />;
  if (status === 'DELIVERED') return <CheckCheck className="h-3.5 w-3.5 shrink-0" aria-label={label} />;
  if (status === 'SENT') return <Check className="h-3.5 w-3.5 shrink-0" aria-label={label} />;
  if (status === 'FAILED' || status === 'SKIPPED') return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" aria-label={label} />;
  if (status === 'QUEUED') return <Clock className="h-3.5 w-3.5 shrink-0" aria-label={label} />;
  return null;
}
