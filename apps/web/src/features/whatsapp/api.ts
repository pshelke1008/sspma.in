import { useQuery } from '@tanstack/react-query';
import type { WhatsAppConnectionStatusKey, WhatsAppProviderKey } from '@ashram/types';
import type { BadgeProps } from '@/components/ui/badge';
import { api, buildQuery } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/queryClient';

export interface WhatsAppStatus {
  configured: boolean;
  activeProvider: WhatsAppProviderKey | null;
  cloud: {
    status: WhatsAppConnectionStatusKey;
    /** Every connected Cloud API number; the first is the default sender. */
    numbers: WhatsAppNumber[];
    phoneNumberId: string | null;
    businessAccountId: string | null;
    displayNumber: string | null;
    verifiedName: string | null;
    connectedAt: string | null;
    lastError: string | null;
    webhookPath: string;
    webhookReady: boolean;
    /** Whether "Connect with Facebook" is set up on the server. */
    oauthAvailable: boolean;
    connectMethod: 'MANUAL' | 'OAUTH' | null;
    accessExpiresAt: string | null;
    qualityRating: string | null;
    webhookSubscribed: boolean;
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

export type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'OTHER';

export interface TemplateButton {
  type: TemplateButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
}

export type UnsendableReason = 'UNSUPPORTED_HEADER' | 'HEADER_VARIABLE' | 'BUTTON_PARAMETER' | 'NAMED_PARAMETERS' | 'OTHER_COMPONENT';

export interface MessageTemplate {
  /** Meta's template ID. */
  id: string;
  name: string;
  language: string;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED … as Meta reports it. */
  status: string;
  category: string;
  rejectedReason: string | null;
  /** TEXT, IMAGE, VIDEO, DOCUMENT or LOCATION; null with no header. */
  headerFormat: string | null;
  /** An image, video or document header: each send brings the file. */
  requiresHeaderMedia: boolean;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  bodyParameterCount: number;
  /** False when the template needs something this app cannot supply. */
  sendable: boolean;
  unsendableReason: UnsendableReason | null;
}

/** Colours for Meta's review status; anything unknown stays neutral. */
export const TEMPLATE_STATUS_TONES: Record<string, NonNullable<BadgeProps['tone']>> = {
  APPROVED: 'success',
  PENDING: 'warning',
  IN_APPEAL: 'warning',
  PAUSED: 'warning',
  REJECTED: 'danger',
  DISABLED: 'danger',
};

export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED' | 'RECEIVED';
export type BroadcastStatus = 'SCHEDULED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';

export interface WhatsAppMessage {
  id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  provider: WhatsAppProviderKey;
  phone: string;
  body: string | null;
  templateName: string | null;
  status: MessageStatus;
  error: string | null;
  /** Meta's own words for a failure, e.g. "131042: … currency is not configured". */
  errorDetail?: string | null;
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
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  skippedCount: number;
  /** Wizard broadcasts: when it was due to start, how recipients were chosen, a rough cost. */
  scheduledAt: string | null;
  audienceMode: 'ALL' | 'FILTER' | 'SELECT' | 'UPLOAD' | null;
  templateLanguage: string | null;
  templateCategory: string | null;
  estimatedCost: string | null;
  headerFormat: string | null;
  headerMediaName: string | null;
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

/**
 * Approved templates that can be sent from here; only meaningful once the Cloud
 * API is connected. `hidden` counts approved ones left out (header media, …).
 */
export function useTemplates(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.whatsappTemplates,
    queryFn: () => api.get<{ data: MessageTemplate[]; hidden: number }>('/whatsapp/cloud/templates'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Every template with its review status, for the management card. */
export function useAllTemplates(numberId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.whatsappTemplatesAll(numberId ?? ''),
    queryFn: () => api.get<{ data: MessageTemplate[] }>('/whatsapp/templates' + buildQuery({ numberId })),
    enabled,
  });
}

export interface CreateTemplateBody {
  numberId?: string | null;
  name: string;
  language: string;
  category: 'UTILITY' | 'MARKETING';
  headerText?: string | null;
  headerFormat?: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null;
  headerHandle?: string | null;
  bodyText: string;
  bodyExamples: string[];
  footerText?: string | null;
  buttons: TemplateButton[];
}

/** Template lists everywhere (picker, inbox, management) are stale after a change. */
export function invalidateTemplates() {
  void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'templates'] });
  void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'inbox', 'templates'] });
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
  SCHEDULED: 'accent',
  QUEUED: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'success',
  CANCELLED: 'warning',
};

/** A connected WhatsApp Business number (Cloud API). Tokens never leave the server. */
export interface WhatsAppNumber {
  id: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  connectMethod: 'MANUAL' | 'OAUTH';
  accessExpiresAt: string | null;
  webhookSubscribed: boolean;
  connectedAt: string;
}

/** A Facebook sign-in waiting for the admin to choose a number. */
export interface PendingConnection {
  id: string;
  expiresAt: string;
  businessAccounts: {
    id: string;
    name: string | null;
    phoneNumbers: { id: string; displayNumber: string | null; verifiedName: string | null; qualityRating: string | null }[];
  }[];
}

/** Days until the Cloud API token stops working; null when it does not expire. */
export function tokenDaysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}
