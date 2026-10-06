import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { WhatsAppProviderKey } from '@ashram/types';
import { api, buildQuery, fileUrl } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';
import type { MessageStatus, WhatsAppNumber } from '../api';

/**
 * The WhatsApp inbox (ported from CAThrives). CAThrives pushes over a
 * WebSocket; here everything polls, and TanStack Query pauses the polling
 * while the tab is hidden.
 */

export type ConversationFilter = 'all' | 'unread' | 'donors' | 'unknown';
export type MediaType = 'image' | 'document' | 'audio' | 'video' | 'sticker';

export interface ConversationDonor {
  id: string;
  name: string;
  code: string;
  whatsappOptIn: boolean;
  isActive: boolean;
}

export interface Conversation {
  /** International digits, e.g. 919820011999. */
  phone: string;
  donor: ConversationDonor | null;
  /** The contact's WhatsApp profile name. */
  contactName: string | null;
  lastMessage: {
    id: string;
    body: string | null;
    direction: 'INBOUND' | 'OUTBOUND';
    status: MessageStatus;
    mediaType: MediaType | null;
    templateName: string | null;
    createdAt: string;
  } | null;
  lastMessageAt: string | null;
  unreadCount: number;
  /** Business number this conversation last used. */
  numberId: string | null;
  windowOpen: boolean;
  windowExpiresAt: string | null;
}

export interface InboxMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  provider: WhatsAppProviderKey;
  phone: string;
  body: string | null;
  templateName: string | null;
  contactName: string | null;
  mediaType: MediaType | null;
  mediaFileName: string | null;
  mediaMimeType: string | null;
  hasMedia: boolean;
  status: MessageStatus;
  error: string | null;
  /** Meta's own words for a failure, e.g. "131042: … currency is not configured". */
  errorDetail?: string | null;
  broadcastId: string | null;
  whatsappNumberId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  sentBy: { id: string; name: string } | null;
}

export interface InboxTemplate {
  name: string;
  language: string;
  status?: string;
  category: string;
  bodyParameterCount: number;
  bodyText: string;
}

interface ConversationPage {
  data: Conversation[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const LIST_POLL_MS = 10_000;
export const THREAD_POLL_MS = 5_000;
export const BADGE_POLL_MS = 30_000;
export const THREAD_PAGE = 50;

export function useConversations(params: { search: string; filter: ConversationFilter }) {
  return useInfiniteQuery({
    queryKey: queryKeys.inboxConversations(params),
    queryFn: ({ pageParam }) =>
      api.get<ConversationPage>(
        '/whatsapp/conversations' + buildQuery({ search: params.search, filter: params.filter, page: pageParam, pageSize: 30 }),
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    refetchInterval: LIST_POLL_MS,
    staleTime: 5_000,
  });
}

export function useConversation(phone: string | null) {
  return useQuery({
    queryKey: queryKeys.inboxConversation(phone ?? ''),
    queryFn: () => api.get<{ data: Conversation }>(`/whatsapp/conversations/${phone}`),
    enabled: Boolean(phone),
    refetchInterval: LIST_POLL_MS,
    staleTime: 5_000,
  });
}

/** The newest page of a thread; older pages are fetched on demand by the chat. */
export function useLatestMessages(phone: string) {
  return useQuery({
    queryKey: queryKeys.inboxThread(phone),
    queryFn: () =>
      api.get<{ data: InboxMessage[]; hasMore: boolean }>(
        `/whatsapp/conversations/${phone}/messages` + buildQuery({ limit: THREAD_PAGE }),
      ),
    refetchInterval: THREAD_POLL_MS,
    staleTime: 2_000,
  });
}

export function fetchOlderMessages(phone: string, before: string) {
  return api.get<{ data: InboxMessage[]; hasMore: boolean }>(
    `/whatsapp/conversations/${phone}/messages` + buildQuery({ before, limit: THREAD_PAGE }),
  );
}

export function useInboxUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.inboxUnread,
    queryFn: () => api.get<{ count: number }>('/whatsapp/conversations/unread-count'),
    enabled,
    refetchInterval: BADGE_POLL_MS,
  });
}

export function useWhatsAppNumbers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inboxNumbers,
    queryFn: () => api.get<{ data: WhatsAppNumber[] }>('/whatsapp/numbers'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Approved templates of the WhatsApp Business Account behind one number. */
export function useInboxTemplates(numberId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.inboxTemplates(numberId ?? ''),
    queryFn: () => api.get<{ data: InboxTemplate[] }>('/whatsapp/cloud/templates' + buildQuery({ numberId })),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export interface SendBody {
  body?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
  numberId?: string | null;
}

export function sendMessage(phone: string, body: SendBody) {
  return api.post<{ data: InboxMessage }>(`/whatsapp/conversations/${phone}/messages`, body);
}

export function sendMedia(phone: string, file: File, caption: string, numberId: string | null) {
  const form = new FormData();
  form.append('file', file);
  if (caption) form.append('caption', caption);
  if (numberId) form.append('numberId', numberId);
  return api.post<{ data: InboxMessage }>(`/whatsapp/conversations/${phone}/media`, form);
}

export function markSeen(phone: string) {
  return api.post<{ updated: number }>(`/whatsapp/conversations/${phone}/seen`);
}

/** Refreshes the list, the badge and one conversation's header after a change. */
export function refreshInbox(phone?: string) {
  queryClient.invalidateQueries({ queryKey: ['whatsapp', 'inbox', 'conversations'] });
  queryClient.invalidateQueries({ queryKey: queryKeys.inboxUnread });
  if (phone) queryClient.invalidateQueries({ queryKey: queryKeys.inboxConversation(phone) });
}

export function mediaUrl(messageId: string): string {
  return fileUrl(`/whatsapp/messages/${messageId}/media`);
}

// ----------------------------- Presentation helpers ----------------------------

/** "+91 98200 11999" for Indian numbers, "+<digits>" otherwise. */
export function formatPhone(phone: string): string {
  if (/^91\d{10}$/.test(phone)) return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
  return `+${phone}`;
}

/** Donor name, else their WhatsApp name, else the number. */
export function conversationName(conversation: Pick<Conversation, 'donor' | 'contactName' | 'phone'>): string {
  return conversation.donor?.name || conversation.contactName || formatPhone(conversation.phone);
}

// Darker than CAThrives' palette so white initials keep 4.5:1 contrast.
const AVATAR_COLORS = ['#008069', '#2563EB', '#7C3AED', '#B45309', '#DC2626', '#0F766E', '#4F46E5', '#BE185D'];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function avatarInitials(name: string): string {
  const cleaned = name.replace(/^\+/, '').trim();
  if (/^[\d\s]+$/.test(cleaned)) return '#';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
