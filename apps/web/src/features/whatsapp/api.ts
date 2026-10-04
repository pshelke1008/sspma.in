import { useQuery } from '@tanstack/react-query';
import type { WhatsAppConnectionStatusKey, WhatsAppProviderKey } from '@ashram/types';
import type { BadgeProps } from '@/components/ui/badge';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';

export interface WhatsAppStatus {
  configured: boolean;
  activeProvider: WhatsAppProviderKey | null;
  cloud: {
    status: WhatsAppConnectionStatusKey;
    phoneNumberId: string | null;
    businessAccountId: string | null;
    displayNumber: string | null;
    verifiedName: string | null;
    connectedAt: string | null;
    lastError: string | null;
    webhookPath: string;
    webhookReady: boolean;
  };
  web: {
    enabled: boolean;
    status: WhatsAppConnectionStatusKey;
    qrDataUrl: string | null;
    phoneNumber: string | null;
    displayName: string | null;
    connectedAt: string | null;
    lastActiveAt: string | null;
    lastError: string | null;
    messagesSent: number;
    monthlyLimit: number;
  };
}

export interface MessageTemplate {
  name: string;
  language: string;
  category: string;
  bodyParameterCount: number;
  bodyText: string;
}

export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED' | 'RECEIVED';
export type BroadcastStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';

export interface WhatsAppMessage {
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  provider: WhatsAppProviderKey;
  phone: string;
  body: string | null;
  templateName: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  sentBy: { id: string; name: string } | null;
  donor?: { id: string; name: string; code: string } | null;
}

export interface Broadcast {
  id: string;
  name: string;
  provider: WhatsAppProviderKey;
  body: string | null;
  templateName: string | null;
  status: BroadcastStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: { id: string; name: string } | null;
}

export interface BroadcastDetail extends Broadcast {
  messages: WhatsAppMessage[];
}

/** What the composer sends; exactly one of body or templateName is set. */
export interface MessageContent {
  body?: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
}

export interface BroadcastPreview {
  provider: WhatsAppProviderKey | null;
  selected: number;
  found: number;
  eligible: number;
  skipped: { INACTIVE: number; NO_NUMBER: number; NOT_OPTED_IN: number };
  quota: { limit: number; remaining: number } | null;
  sample: { donorName: string; body: string | null; templateParams: string[] } | null;
}

const PENDING: WhatsAppConnectionStatusKey[] = ['CONNECTING', 'QR_REQUIRED'];

/**
 * Connection status. Polls quickly only while a link is being made, so a
 * scanned QR flips to "connected" within a couple of seconds.
 */
export function useWhatsAppStatus(enabled = true) {
  return useQuery({
    queryKey: queryKeys.whatsappStatus,
    queryFn: () => api.get<WhatsAppStatus>('/whatsapp/status'),
    enabled,
    refetchInterval: (query) => (query.state.data && PENDING.includes(query.state.data.web.status) ? 2000 : 30_000),
  });
}

/** Approved Cloud API templates; only meaningful once the Cloud API is connected. */
export function useTemplates(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.whatsappTemplates,
    queryFn: () => api.get<{ data: MessageTemplate[] }>('/whatsapp/cloud/templates'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The provider a send would use right now, mirroring the server's choice. */
export function sendingProvider(status: WhatsAppStatus | undefined): WhatsAppProviderKey | null {
  if (!status?.configured) return null;
  const cloud = status.cloud.status === 'CONNECTED';
  const web = status.web.status === 'CONNECTED';
  if (status.activeProvider === 'CLOUD_API' && cloud) return 'CLOUD_API';
  if (status.activeProvider === 'WEB_QR' && web) return 'WEB_QR';
  if (cloud) return 'CLOUD_API';
  if (web) return 'WEB_QR';
  return null;
}

type Tone = NonNullable<BadgeProps['tone']>;

export const CONNECTION_TONES: Record<WhatsAppConnectionStatusKey, Tone> = {
  DISCONNECTED: 'neutral',
  CONNECTING: 'info',
  QR_REQUIRED: 'accent',
  CONNECTED: 'success',
  FAILED: 'danger',
};

export const MESSAGE_TONES: Record<MessageStatus, Tone> = {
  QUEUED: 'neutral',
  SENT: 'info',
  DELIVERED: 'brand',
  READ: 'success',
  FAILED: 'danger',
  SKIPPED: 'warning',
  RECEIVED: 'accent',
};

export const BROADCAST_TONES: Record<BroadcastStatus, Tone> = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'success',
  CANCELLED: 'warning',
};
