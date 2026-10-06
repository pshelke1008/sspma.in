import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  LayoutTemplate,
  Loader2,
  Megaphone,
  MessageCircle,
  TimerOff,
  Timer,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import { useAuth } from '@/lib/auth/AuthProvider';
import i18n, { intlLocale } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState } from '@/components/common/states';
import { cn } from '@/lib/utils/cn';
import { DonorFormDialog } from '@/features/donors/DonorFormDialog';
import { sendingProvider, useWhatsAppStatus } from '../api';
import {
  conversationName,
  fetchOlderMessages,
  formatPhone,
  isSameDay,
  markSeen,
  mediaUrl,
  refreshInbox,
  useConversation,
  useLatestMessages,
  useWhatsAppNumbers,
  type Conversation,
  type InboxMessage,
} from './api';
import { ConversationAvatar, MEDIA_ICONS } from './ConversationList';
import { MessageInput } from './MessageInput';

/** Messages by id, oldest first; a newer copy (fresh status) replaces an older one. */
function mergeMessages(current: InboxMessage[], incoming: InboxMessage[]): InboxMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id),
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export interface ChatWindowProps {
  phone: string;
  /** The list row, shown while the conversation itself loads. */
  fallback?: Conversation;
  /** Inside a donor profile: compact header, no donor link. */
  embedded?: boolean;
  /** Mobile back-to-list. */
  onBack?: () => void;
  /** Extra header action, e.g. "Open in inbox". */
  headerAction?: ReactNode;
}

/** One conversation thread (CAThrives' ChatWindow). Keyed by phone so switching resets everything. */
export function ChatWindow(props: ChatWindowProps) {
  return <ChatThread key={props.phone} {...props} />;
}

function ChatThread({ phone, fallback, embedded, onBack, headerAction }: ChatWindowProps) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const now = useNow(60_000);

  const conversationQuery = useConversation(phone);
  const conversation = conversationQuery.data?.data ?? fallback;
  const notFound = conversationQuery.error instanceof ApiError && conversationQuery.error.status === 404;

  // /whatsapp/status needs send or manage rights; without it, assume a Cloud
  // number when one is listed and let the server decide.
  const canReadStatus = can('whatsapp.send') || can('whatsapp.manage');
  const { data: status, isSuccess: statusSuccess } = useWhatsAppStatus(canReadStatus);
  const { data: numbersData } = useWhatsAppNumbers();
  const numbers = numbersData?.data ?? [];
  const provider = canReadStatus ? sendingProvider(status) : numbers.length > 0 ? 'CLOUD_API' : null;
  const statusLoaded = canReadStatus && statusSuccess;

  const latest = useLatestMessages(phone);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [ready, setReady] = useState(false);
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!latest.data) return;
    setMessages((current) => mergeMessages(current, latest.data.data));
    if (!loadedOnce.current) {
      loadedOnce.current = true;
      setHasMore(latest.data.hasMore);
    }
  }, [latest.data]);

  // ---- mark seen: on open, and whenever a new inbound message arrives ----
  const lastInboundId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].direction === 'INBOUND') return messages[index].id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (!lastInboundId || document.visibilityState === 'hidden') return;
    let cancelled = false;
    markSeen(phone)
      .then((result) => {
        if (!cancelled && result.updated > 0) refreshInbox(phone);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lastInboundId, phone]);

  // ---- scrolling ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastIdRef = useRef<string | null>(null);
  const prependRef = useRef<{ height: number; top: number } | null>(null);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (prependRef.current) {
      element.scrollTop = element.scrollHeight - prependRef.current.height + prependRef.current.top;
      prependRef.current = null;
      return;
    }
    const last = messages[messages.length - 1];
    if (!last || last.id === lastIdRef.current) return;
    const first = lastIdRef.current === null;
    lastIdRef.current = last.id;
    if (first || nearBottom.current || last.direction === 'OUTBOUND') scrollToBottom();
    if (first) setReady(true);
  }, [messages, scrollToBottom]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const result = await fetchOlderMessages(phone, oldest.id);
      const element = scrollRef.current;
      if (element) prependRef.current = { height: element.scrollHeight, top: element.scrollTop };
      setMessages((current) => mergeMessages(current, result.data));
      setHasMore(result.hasMore);
    } catch {
      setOlderError(true);
    } finally {
      setLoadingOlder(false);
    }
  }

  function onSent(message: InboxMessage) {
    setMessages((current) => mergeMessages(current, [message]));
    queryClient.invalidateQueries({ queryKey: queryKeys.inboxThread(phone) });
    refreshInbox(phone);
  }

  // ---- save as donor ----
  const [saveOpen, setSaveOpen] = useState(false);

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col bg-white">
        {onBack && <BackBar onBack={onBack} />}
        <EmptyState icon={MessageCircle} title={t('whatsappInbox.notFound')} description={t('whatsappInbox.notFoundText')} />
      </div>
    );
  }

  const name = conversation ? conversationName(conversation) : formatPhone(phone);
  const groups = groupByDay(messages);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className={cn('flex items-center gap-3 border-b border-line bg-white shadow-sm', embedded ? 'px-4 py-2.5' : 'px-3 py-2.5 sm:px-5')}>
        {onBack && (
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onBack} aria-label={t('whatsappInbox.backToList')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
        <ConversationAvatar name={name} seed={phone} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold leading-tight text-ink">{name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] leading-tight text-ink-muted">
            <span>{formatPhone(phone)}</span>
            {conversation?.donor ? (
              <span className="text-brand">
                {t('whatsappInbox.donorTag')} · {conversation.donor.code}
              </span>
            ) : conversation ? (
              <span>{t('whatsappInbox.unknownContact')}</span>
            ) : null}
            {conversation?.donor && conversation.contactName && conversation.contactName !== conversation.donor.name && (
              <span className="truncate">~{conversation.contactName}</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!embedded && conversation?.donor && can('donor.view') && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/donors/${conversation.donor.id}`}>
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t('whatsappInbox.viewDonor')}</span>
                <span className="sr-only sm:hidden">{t('whatsappInbox.viewDonor')}</span>
              </Link>
            </Button>
          )}
          {!embedded && conversation && !conversation.donor && can('donor.manage') && (
            <Button size="sm" onClick={() => setSaveOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t('whatsappInbox.saveAsDonor')}</span>
              <span className="sr-only sm:hidden">{t('whatsappInbox.saveAsDonor')}</span>
            </Button>
          )}
          {headerAction}
          <Button asChild variant="ghost" size="icon-sm">
            <a
              href={`https://wa.me/${phone}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('whatsappInbox.openInWhatsApp')}
              title={t('whatsappInbox.openInWhatsApp')}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>

      {conversation && <WindowBanner conversation={conversation} provider={provider} now={now} />}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-[#efeae2] px-3 py-3 sm:px-6"
        tabIndex={0}
        aria-label={t('whatsappInbox.threadLabel', { name })}
      >
        {latest.isLoading || (latest.data && !loadedOnce.current) ? (
          <div className="flex h-full items-center justify-center" aria-busy="true">
            <Loader2 className="h-5 w-5 animate-spin text-[#008069]" aria-hidden="true" />
            <span className="sr-only">{t('whatsappInbox.loadingMessages')}</span>
          </div>
        ) : latest.isError && messages.length === 0 ? (
          <ErrorState message={errorMessage(t, latest.error)} onRetry={() => void latest.refetch()} />
        ) : (
          <>
            <div className="mb-3 flex justify-center">
              {hasMore ? (
                <Button variant="outline" size="sm" className="rounded-full bg-white/90 shadow-sm" onClick={() => void loadOlder()} loading={loadingOlder}>
                  {olderError ? t('whatsappInbox.loadOlderFailed') : t('whatsappInbox.loadOlder')}
                </Button>
              ) : messages.length > 0 ? (
                <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] text-ink-muted shadow-sm">{t('whatsappInbox.beginning')}</span>
              ) : null}
            </div>

            {messages.length === 0 && (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/70">
                  <MessageCircle className="h-6 w-6 text-ink-muted" aria-hidden="true" />
                </span>
                <p className="text-[13px] font-medium text-ink">{t('whatsappInbox.noMessagesYet')}</p>
                <p className="mt-1 max-w-xs text-[12px] text-ink-muted">{t('whatsappInbox.startConversation', { name })}</p>
              </div>
            )}

            <div role="log" aria-live={ready ? 'polite' : 'off'} aria-relevant="additions" aria-label={t('whatsappInbox.messagesLabel')}>
            <ol className="space-y-1.5">
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <li className="sticky top-0 z-[1] flex justify-center py-1.5">
                    <span className="rounded-md bg-white/95 px-2.5 py-1 text-[11px] font-medium text-ink-muted shadow-sm">{group.label}</span>
                  </li>
                  {group.messages.map((message, index) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      grouped={index > 0 && group.messages[index - 1].direction === message.direction}
                      onMediaLoad={() => {
                        if (nearBottom.current) scrollToBottom();
                      }}
                    />
                  ))}
                </Fragment>
              ))}
            </ol>
            </div>
          </>
        )}
      </div>

      <MessageInput
        phone={phone}
        conversation={conversation}
        provider={provider}
        providerKnown={statusLoaded}
        numbers={numbers}
        onSent={onSent}
        autoFocus={!embedded}
      />

      {saveOpen && conversation && (
        <DonorFormDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          initialValues={{ name: conversation.contactName ?? '', whatsappNumber: `+${phone}` }}
          onSaved={() => {
            refreshInbox(phone);
            queryClient.invalidateQueries({ queryKey: queryKeys.inboxThread(phone) });
          }}
        />
      )}
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-line px-3 py-2 lg:hidden">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('whatsappInbox.backToList')}
      </Button>
    </div>
  );
}

// ----------------------------- 24-hour window ----------------------------------

function WindowBanner({ conversation, provider, now }: { conversation: Conversation; provider: string | null; now: number }) {
  const { t } = useTranslation();
  const donor = conversation.donor;

  if (donor && !donor.isActive) return null; // the composer explains this one

  if (conversation.windowOpen && conversation.windowExpiresAt) {
    const minutes = Math.max(1, Math.round((new Date(conversation.windowExpiresAt).getTime() - now) / 60_000));
    const left = minutes >= 60 ? t('whatsappInbox.hoursLeft', { count: Math.floor(minutes / 60) }) : t('whatsappInbox.minutesLeft', { count: minutes });
    return (
      <p className="flex items-center gap-2 border-b border-[#008069]/15 bg-[#e7f6ef] px-4 py-1.5 text-[11.5px] text-[#05603a]" role="note">
        <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">{t('whatsappInbox.windowOpen', { time: left })}</strong>{' '}
          {t('whatsappInbox.windowOpenText')}
        </span>
      </p>
    );
  }

  const consented = Boolean(donor?.whatsappOptIn);
  const text = !consented
    ? donor
      ? t('whatsappInbox.windowClosedNoConsent')
      : t('whatsappInbox.windowClosedUnknown')
    : provider === 'CLOUD_API'
      ? t('whatsappInbox.windowClosedTemplate')
      : t('whatsappInbox.windowClosedConsent');

  return (
    <p className="flex items-start gap-2 border-b border-warning/25 bg-warning/10 px-4 py-1.5 text-[11.5px] leading-relaxed text-[#7a5410]" role="note">
      <TimerOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong className="font-semibold">{t('whatsappInbox.windowClosed')}</strong> {text}
      </span>
    </p>
  );
}

// ----------------------------- Bubbles ------------------------------------------

function groupByDay(messages: InboxMessage[]) {
  const groups: { key: string; label: string; messages: InboxMessage[] }[] = [];
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const current = groups[groups.length - 1];
    if (current && current.key === key) current.messages.push(message);
    else groups.push({ key, label: dayLabel(date), messages: [message] });
  }
  return groups;
}

function dayLabel(date: Date): string {
  const t = i18n.t.bind(i18n);
  const today = new Date();
  if (isSameDay(date, today)) return t('whatsappInbox.today');
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return t('whatsappInbox.yesterday');
  return new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function timeOf(value: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function MessageBubble({ message, grouped, onMediaLoad }: { message: InboxMessage; grouped: boolean; onMediaLoad: () => void }) {
  const { t } = useTranslation();
  const outbound = message.direction === 'OUTBOUND';
  const failed = message.status === 'FAILED' || message.status === 'SKIPPED';

  return (
    <li className={cn('flex', outbound ? 'justify-end' : 'justify-start', !grouped && 'pt-1')}>
      <div
        className={cn(
          'relative max-w-[85%] rounded-lg px-2.5 pb-1.5 pt-1.5 text-ink shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] sm:max-w-[70%]',
          outbound ? 'bg-[#d9fdd3]' : 'bg-white',
          !grouped && (outbound ? 'rounded-tr-none' : 'rounded-tl-none'),
          failed && 'ring-1 ring-danger/40',
        )}
      >
        <span className="sr-only">{outbound ? t('whatsappInbox.youSaid') : t('whatsappInbox.theySaid')}</span>

        {(message.templateName || message.broadcastId) && (
          <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] font-medium text-[#008069]">
            {message.broadcastId && (
              <span className="inline-flex items-center gap-1">
                <Megaphone className="h-3 w-3" aria-hidden="true" />
                {t('whatsappInbox.broadcast')}
              </span>
            )}
            {message.templateName && (
              <span className="inline-flex items-center gap-1">
                <LayoutTemplate className="h-3 w-3" aria-hidden="true" />
                {t('whatsappInbox.templateNamed', { name: message.templateName })}
              </span>
            )}
          </p>
        )}

        {message.mediaType && <MessageMedia message={message} onLoad={onMediaLoad} />}

        {message.body ? (
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.4]">{message.body}</p>
        ) : !message.mediaType && message.templateName ? (
          <p className="text-[12.5px] italic text-ink-muted">{t('whatsappInbox.templateNoText')}</p>
        ) : null}

        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] text-ink-muted">
          {outbound && message.sentBy && <span className="mr-auto truncate pr-2">{t('whatsappInbox.sentBy', { name: message.sentBy.name })}</span>}
          <time dateTime={message.createdAt}>{timeOf(message.createdAt)}</time>
          {outbound && <StatusTick status={message.status} />}
        </div>

        {failed && (
          <p className="mt-1 flex items-start gap-1 border-t border-danger/20 pt-1 text-[11px] text-danger">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            {message.error
              ? t(`errors.${message.error}`, { defaultValue: t('whatsappInbox.failedGeneric') })
              : message.status === 'SKIPPED'
                ? t('whatsappInbox.skippedGeneric')
                : t('whatsappInbox.failedGeneric')}
            {message.errorDetail && <span className="block text-ink-muted [overflow-wrap:anywhere]">{message.errorDetail}</span>}
          </p>
        )}
      </div>
    </li>
  );
}

function StatusTick({ status }: { status: InboxMessage['status'] }) {
  const { t } = useTranslation();
  const label = t(`whatsappInbox.status.${status}`);
  const common = 'h-3.5 w-3.5 shrink-0';
  let icon: ReactNode;
  switch (status) {
    case 'READ':
      icon = <CheckCheck className={cn(common, 'text-[#53bdeb]')} aria-hidden="true" />;
      break;
    case 'DELIVERED':
      icon = <CheckCheck className={common} aria-hidden="true" />;
      break;
    case 'SENT':
      icon = <Check className={common} aria-hidden="true" />;
      break;
    case 'FAILED':
    case 'SKIPPED':
      icon = <AlertCircle className={cn(common, 'text-danger')} aria-hidden="true" />;
      break;
    default:
      icon = <Clock className={common} aria-hidden="true" />;
  }
  return (
    <span title={label} className="inline-flex">
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function MessageMedia({ message, onLoad }: { message: InboxMessage; onLoad: () => void }) {
  const { t } = useTranslation();
  const type = message.mediaType!;
  const Icon = MEDIA_ICONS[type];

  if (!message.hasMedia) {
    return (
      <p className="mb-1 flex items-center gap-2 rounded-md bg-black/5 px-2.5 py-2 text-[12px] text-ink-muted">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('whatsappInbox.mediaUnavailable', { type: t(`whatsappInbox.media.${type}`) })}
      </p>
    );
  }

  const url = mediaUrl(message.id);
  const fileName = message.mediaFileName || t(`whatsappInbox.media.${type}`);

  if (type === 'image' || type === 'sticker') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="-mx-1 mb-1 block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008069]"
        aria-label={t('whatsappInbox.openImage')}
      >
        <img
          src={url}
          alt={message.body || message.mediaFileName || t(type === 'sticker' ? 'whatsappInbox.stickerAlt' : 'whatsappInbox.imageAlt')}
          loading="lazy"
          onLoad={onLoad}
          className={cn('h-auto max-w-full object-cover', type === 'sticker' ? 'max-h-32 w-32 object-contain' : 'max-h-72 min-w-[160px]')}
        />
      </a>
    );
  }

  if (type === 'audio') {
    return (
      <div className="mb-1">
        <audio controls preload="none" src={url} className="w-64 max-w-full" aria-label={fileName}>
          <a href={url} download>
            {t('whatsappInbox.download')}
          </a>
        </audio>
      </div>
    );
  }

  if (type === 'video') {
    return (
      <div className="-mx-1 mb-1">
        <video controls preload="metadata" src={url} className="max-h-72 max-w-full rounded-md" aria-label={fileName} onLoadedMetadata={onLoad}>
          <a href={url} download>
            {t('whatsappInbox.download')}
          </a>
        </video>
      </div>
    );
  }

  return (
    <a
      href={url}
      download={message.mediaFileName ?? undefined}
      className="mb-1 flex min-w-[200px] items-center gap-2.5 rounded-md bg-black/5 px-2.5 py-2 transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008069]"
      aria-label={t('whatsappInbox.downloadFile', { name: fileName })}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-danger/10">
        <FileText className="h-5 w-5 text-danger" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{fileName}</span>
        {message.mediaMimeType && (
          <span className="block text-[10.5px] uppercase text-ink-muted">{message.mediaMimeType.split('/').pop()}</span>
        )}
      </span>
      <Download className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
    </a>
  );
}
