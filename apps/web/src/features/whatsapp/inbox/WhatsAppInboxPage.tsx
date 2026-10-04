import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageCircle, Settings } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { useConversations, useInboxUnreadCount, type Conversation, type ConversationFilter } from './api';
import { ConversationList } from './ConversationList';
import { ChatWindow } from './ChatWindow';

const FILTERS: ConversationFilter[] = ['all', 'unread', 'donors', 'unknown'];

/**
 * WhatsApp inbox (ported from CAThrives): conversations on the left, the open
 * thread on the right; one pane at a time on phones. `?phone=<digits>` opens a
 * conversation, so other screens can deep-link into it.
 */
export default function WhatsAppInboxPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPhone = searchParams.get('phone')?.replace(/\D/g, '') || null;
  const filterParam = searchParams.get('filter') as ConversationFilter | null;
  const filter: ConversationFilter = filterParam && FILTERS.includes(filterParam) ? filterParam : 'all';

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const list = useConversations({ search, filter });
  const { data: unread } = useInboxUnreadCount(true);

  const conversations = useMemo(() => {
    const seen = new Set<string>();
    const rows: Conversation[] = [];
    for (const page of list.data?.pages ?? []) {
      for (const row of page.data) {
        if (seen.has(row.phone)) continue;
        seen.add(row.phone);
        rows.push(row);
      }
    }
    return rows;
  }, [list.data]);

  const selectedRow = conversations.find((row) => row.phone === selectedPhone);

  function updateParams(next: { phone?: string | null; filter?: ConversationFilter }, replace = false) {
    const params = new URLSearchParams(searchParams);
    if (next.phone !== undefined) {
      if (next.phone) params.set('phone', next.phone);
      else params.delete('phone');
    }
    if (next.filter !== undefined) {
      if (next.filter === 'all') params.delete('filter');
      else params.set('filter', next.filter);
    }
    setSearchParams(params, { replace });
  }

  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-card border border-line bg-white shadow-card',
        // Fill the space between the header and the bottom bar / page padding.
        'h-[calc(100dvh-58px-2rem-var(--bottom-nav-height))] min-h-[420px] lg:h-[calc(100dvh-4rem-3rem)] lg:min-h-[520px]',
      )}
    >
      <aside
        aria-label={t('whatsappInbox.conversationsLabel')}
        className={cn(
          'w-full shrink-0 flex-col border-r border-line bg-white lg:flex lg:w-[340px] xl:w-[380px]',
          selectedPhone ? 'hidden' : 'flex',
        )}
      >
        <ConversationList
          conversations={conversations}
          selectedPhone={selectedPhone}
          onSelect={(row) => updateParams({ phone: row.phone })}
          isLoading={list.isLoading}
          isError={list.isError && conversations.length === 0}
          onRetry={() => void list.refetch()}
          search={searchDraft}
          onSearchChange={setSearchDraft}
          filter={filter}
          onFilterChange={(next) => updateParams({ filter: next }, true)}
          unreadTotal={unread?.count ?? 0}
          hasMore={Boolean(list.hasNextPage)}
          loadingMore={list.isFetchingNextPage}
          onLoadMore={() => void list.fetchNextPage()}
        />
      </aside>

      <section
        aria-label={t('whatsappInbox.threadRegion')}
        className={cn('min-w-0 flex-1 flex-col bg-[#efeae2]', selectedPhone ? 'flex' : 'hidden lg:flex')}
      >
        {selectedPhone ? (
          <ChatWindow phone={selectedPhone} fallback={selectedRow} onBack={() => updateParams({ phone: null })} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="relative mb-6">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/70 shadow-sm">
                <MessageCircle className="h-11 w-11 text-ink-muted" aria-hidden="true" />
              </div>
              <div className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#008069] shadow">
                <MessageCircle className="h-4 w-4 text-white" aria-hidden="true" />
              </div>
            </div>
            <h2 className="mb-2 text-[18px] font-semibold text-ink">{t('whatsappInbox.title')}</h2>
            <p className="mb-6 max-w-xs text-[13px] text-ink-muted">{t('whatsappInbox.selectPrompt')}</p>
            <ul className="flex flex-wrap items-center justify-center gap-2">
              {(['featureReplies', 'featureDonors', 'featureTemplates'] as const).map((key) => (
                <li key={key} className="flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-[11.5px] text-ink shadow-sm">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#008069]" aria-hidden="true" />
                  {t(`whatsappInbox.${key}`)}
                </li>
              ))}
            </ul>
            {can('whatsapp.manage') && (
              <Button asChild variant="outline" size="sm" className="mt-6 bg-white/80">
                <Link to="/settings/whatsapp">
                  <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('whatsappInbox.settingsLink')}
                </Link>
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
