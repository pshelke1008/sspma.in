import { useQuery } from '@tanstack/react-query';
import type { VariableMapping } from '@ashram/types';
import { api, buildQuery } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryClient';
import type { Broadcast, MessageStatus, MessageTemplate, TemplateButton } from '../api';

export type AudienceMode = 'ALL' | 'FILTER' | 'SELECT' | 'UPLOAD';
export type HeaderKind = 'image' | 'video' | 'document';

/** A file uploaded to Meta to head the template. `previewUrl` exists only in this browser. */
export interface HeaderMedia {
  mediaId: string;
  fileName: string;
  kind: HeaderKind;
  previewUrl?: string;
}

export interface UploadedRecipient {
  donorId: string;
  donorName: string;
  phone: string;
  eligible: boolean;
  row: Record<string, string>;
}

export interface UploadResult {
  columns: string[];
  phoneColumn: string;
  recipients: UploadedRecipient[];
  unmatched: { rowNumber: number; phone: string }[];
  stats: { rows: number; matched: number; unmatched: number; invalid: number; duplicates: number; notOptedIn: number };
}

export interface DonorFilters {
  category: string;
  tag: string;
  state: string;
  district: string;
  village: string;
}

export const EMPTY_FILTERS: DonorFilters = { category: '', tag: '', state: '', district: '', village: '' };
export const hasFilters = (filters: DonorFilters) => Object.values(filters).some(Boolean);

/** Most recipients one broadcast can have; the server enforces the same limit. */
export const MAX_RECIPIENTS = 5000;

export interface WizardState {
  name: string;
  templateKey: string;
  headerMedia: HeaderMedia | null;
  /** Nothing is chosen until the user picks how to choose recipients — never a silent "everyone". */
  audience: AudienceMode | null;
  filters: DonorFilters;
  /** FILTER: everyone matching the filters (resolved on the Audience step). SELECT: the ticked donors. */
  donorIds: string[];
  upload: UploadResult | null;
  mapping: VariableMapping;
  schedule: { mode: 'now' | 'later'; at: string };
}

export const EMPTY_WIZARD: WizardState = {
  name: '',
  templateKey: '',
  headerMedia: null,
  audience: null,
  filters: EMPTY_FILTERS,
  donorIds: [],
  upload: null,
  mapping: {},
  schedule: { mode: 'now', at: '' },
};

export const templateKeyOf = (template: Pick<MessageTemplate, 'name' | 'language'>) => `${template.name}|${template.language}`;

/** What the review step and "send" post to the server. */
export interface CampaignRequest {
  templateName: string;
  templateLanguage: string;
  audienceMode: AudienceMode;
  donorIds?: string[];
  recipients?: { donorId: string; row: Record<string, string> }[];
  variableMapping: VariableMapping;
  headerMedia?: { mediaId: string; fileName: string; kind: HeaderKind } | null;
}

/** Only the sheet columns a variable uses travel back to the server. */
export function buildRequest(state: WizardState, template: MessageTemplate): CampaignRequest {
  const used = new Set(Object.values(state.mapping).flatMap((source) => (source.source === 'column' ? [source.column] : [])));
  const base = {
    templateName: template.name,
    templateLanguage: template.language,
    variableMapping: state.mapping,
    headerMedia: template.requiresHeaderMedia && state.headerMedia
      ? { mediaId: state.headerMedia.mediaId, fileName: state.headerMedia.fileName, kind: state.headerMedia.kind }
      : null,
  };
  const mode: AudienceMode = state.audience ?? 'SELECT';
  if (mode === 'UPLOAD') {
    return {
      ...base,
      audienceMode: 'UPLOAD',
      recipients: (state.upload?.recipients ?? []).map((recipient) => ({
        donorId: recipient.donorId,
        row: Object.fromEntries([...used].map((column) => [column, recipient.row[column] ?? ''])),
      })),
    };
  }
  return { ...base, audienceMode: mode, donorIds: state.donorIds };
}

export interface CampaignPreview {
  provider: 'CLOUD_API';
  template: {
    name: string;
    language: string;
    category: string;
    headerFormat: string | null;
    headerText: string | null;
    bodyText: string;
    footerText: string | null;
    buttons: TemplateButton[];
    parameterCount: number;
  };
  selected: number;
  found: number;
  willReceive: number;
  skipped: { INACTIVE: number; NO_NUMBER: number; NOT_OPTED_IN: number; MISSING_DATA: number };
  estimatedCost: number;
  samples: { donorId: string; donorName: string; phone: string; status: 'OK' | 'INACTIVE' | 'NO_NUMBER' | 'NOT_OPTED_IN' | 'MISSING_DATA'; body: string }[];
}

/** Approved templates the wizard can send, including those with a media header. */
export function useCampaignTemplates(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.campaignTemplates,
    queryFn: () => api.get<{ data: MessageTemplate[]; hidden: number }>('/whatsapp/cloud/templates?media=1'),
    enabled,
    staleTime: 60_000,
  });
}

export const isLiveBroadcast = (broadcast: Pick<Broadcast, 'status'>) => ['SCHEDULED', 'QUEUED', 'RUNNING'].includes(broadcast.status);

export function useBroadcast(id: string) {
  return useQuery({
    queryKey: queryKeys.broadcast(`${id}-summary`),
    queryFn: () => api.get<{ data: Broadcast }>(`/whatsapp/broadcasts/${id}?summary=1`),
    refetchInterval: (query) => (query.state.data && isLiveBroadcast(query.state.data.data) ? 4000 : false),
  });
}

export interface BroadcastMessageRow {
  id: string;
  phone: string;
  status: MessageStatus;
  error: string | null;
  /** Meta's own words for a failure, e.g. "131042: … currency is not configured". */
  errorDetail?: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  donor: { id: string; name: string; code: string } | null;
}

export function useBroadcastMessages(id: string, status: string, page: number, live: boolean) {
  return useQuery({
    queryKey: queryKeys.broadcastMessages(id, status, page),
    queryFn: () =>
      api.get<{ data: BroadcastMessageRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(
        `/whatsapp/broadcasts/${id}/messages` + buildQuery({ status: status === 'all' ? undefined : status, page, pageSize: 15 }),
      ),
    placeholderData: (previous) => previous,
    refetchInterval: live ? 4000 : false,
  });
}
