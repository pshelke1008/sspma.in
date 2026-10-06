/**
 * WhatsApp Cloud API (Meta Graph) client.
 *
 * The official channel: a business number, approved message templates, and
 * delivery receipts through the signed webhook. Outside the 24-hour window
 * after a donor's last message, only approved templates may be sent.
 */
import { env } from '../../env';
import { WhatsAppError, WhatsAppErrorCode, codeForMetaError, metaErrorDetail } from './errors';
import {
  buildCreatePayload,
  parseTemplate,
  type CreateTemplateInput,
  type MessageTemplate,
  type RawTemplate,
} from './templates';

export type { MessageTemplate } from './templates';

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    error_data?: { details?: string };
  };
}

function mapGraphError(status: number, body: GraphErrorBody, explain = false): WhatsAppError {
  const code = body.error?.code;
  if (status === 401 || code === 190 || code === 10 || code === 200) {
    return new WhatsAppError(WhatsAppErrorCode.CLOUD_AUTH_FAILED);
  }
  // Template management: Meta's own wording ("name already exists in this
  // language", "body cannot start with a variable") is what the user must act on.
  if (explain) {
    const detail = body.error?.error_user_msg ?? body.error?.error_data?.details ?? body.error?.message;
    return new WhatsAppError(WhatsAppErrorCode.TEMPLATE_INVALID, detail?.slice(0, 300));
  }
  if (code === 100 && body.error?.error_subcode === 33) return new WhatsAppError(WhatsAppErrorCode.CLOUD_AUTH_FAILED);
  return new WhatsAppError(
    codeForMetaError(code),
    undefined,
    metaErrorDetail({ code, message: body.error?.error_user_msg ?? body.error?.error_data?.details ?? body.error?.message }),
  );
}

async function graph<T>(
  path: string,
  token: string,
  init: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: unknown;
    query?: Record<string, string>;
    /** Surface Meta's own explanation on failure (template management only). */
    explain?: boolean;
  } = {},
): Promise<T> {
  const url = new URL(`${env.whatsapp.graphUrl}/${env.whatsapp.graphVersion}/${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new WhatsAppError(WhatsAppErrorCode.CLOUD_UNREACHABLE);
  }

  const payload = (await response.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!response.ok || payload.error) {
    // Logged without the token; the payload only carries Meta's error object.
    console.warn('[whatsapp] Graph API error', { path: path.split('/')[1] ?? path, status: response.status, code: payload.error?.code });
    throw mapGraphError(response.status, payload, init.explain);
  }
  return payload;
}

export interface PhoneNumberInfo {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

export function verifyPhoneNumber(phoneNumberId: string, token: string) {
  return graph<PhoneNumberInfo>(phoneNumberId, token, {
    query: { fields: 'display_phone_number,verified_name,quality_rating' },
  });
}

const TEMPLATE_PAGE_SIZE = '100';
/** Guards against a runaway cursor; 10 pages is 1,000 templates. */
const TEMPLATE_MAX_PAGES = 10;

/** Every template of the business account, whatever its review status. */
export async function listTemplates(businessAccountId: string, token: string): Promise<MessageTemplate[]> {
  type Page = { data: RawTemplate[]; paging?: { cursors?: { after?: string }; next?: string } };
  const templates: MessageTemplate[] = [];
  let after: string | undefined;

  for (let page = 0; page < TEMPLATE_MAX_PAGES; page += 1) {
    const result = await graph<Page>(`${businessAccountId}/message_templates`, token, {
      query: {
        fields: 'id,name,language,status,category,parameter_format,rejected_reason,components',
        limit: TEMPLATE_PAGE_SIZE,
        ...(after ? { after } : {}),
      },
    });
    templates.push(...result.data.map(parseTemplate));
    after = result.paging?.next ? result.paging.cursors?.after : undefined;
    if (!after) break;
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
}

/** Submits a new template for Meta's review. It stays PENDING until approved. */
export async function createTemplate(
  businessAccountId: string,
  token: string,
  input: CreateTemplateInput,
): Promise<{ id: string; status: string; category: string }> {
  return graph(`${businessAccountId}/message_templates`, token, {
    method: 'POST',
    body: buildCreatePayload(input),
    explain: true,
  });
}

/** Deletes one language of a template when `templateId` is given, otherwise every language. */
export async function deleteTemplate(
  businessAccountId: string,
  token: string,
  name: string,
  templateId?: string,
): Promise<void> {
  await graph(`${businessAccountId}/message_templates`, token, {
    method: 'DELETE',
    query: { name, ...(templateId ? { hsm_id: templateId } : {}) },
    explain: true,
  });
}

/**
 * Meta's resumable upload of the sample file a media-header template is
 * reviewed with. Returns the handle that goes in the template's header example.
 */
export async function uploadTemplateSample(
  token: string,
  file: { buffer: Buffer; mimeType: string; fileName: string },
): Promise<string> {
  const appId = env.whatsapp.appId;
  if (!appId) throw new WhatsAppError(WhatsAppErrorCode.OAUTH_NOT_CONFIGURED);

  const session = await graph<{ id?: string }>(`${appId}/uploads`, token, {
    method: 'POST',
    query: { file_name: file.fileName, file_length: String(file.buffer.length), file_type: file.mimeType },
    explain: true,
  });
  if (!session.id) throw new WhatsAppError(WhatsAppErrorCode.TEMPLATE_INVALID);

  let response: Response;
  try {
    response = await fetch(`${env.whatsapp.graphUrl}/${env.whatsapp.graphVersion}/${session.id}`, {
      method: 'POST',
      // Meta's upload endpoint wants the "OAuth" scheme rather than "Bearer".
      headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
      body: file.buffer,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new WhatsAppError(WhatsAppErrorCode.CLOUD_UNREACHABLE);
  }
  const payload = (await response.json().catch(() => ({}))) as { h?: string } & GraphErrorBody;
  if (!response.ok || payload.error || !payload.h) throw mapGraphError(response.status, payload, true);
  return payload.h;
}

interface SendResult {
  messages?: { id: string }[];
}

export async function sendText(phoneNumberId: string, token: string, to: string, body: string): Promise<string> {
  const result = await graph<SendResult>(`${phoneNumberId}/messages`, token, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    },
  });
  return result.messages?.[0]?.id ?? '';
}

export async function sendTemplate(
  phoneNumberId: string,
  token: string,
  to: string,
  template: {
    name: string;
    language: string;
    bodyParams: string[];
    /** An uploaded file for a template whose header is an image, video or document. */
    headerMedia?: { kind: 'image' | 'video' | 'document'; mediaId: string; fileName?: string | null } | null;
  },
): Promise<string> {
  const components: Record<string, unknown>[] = [];
  if (template.headerMedia) {
    const { kind, mediaId, fileName } = template.headerMedia;
    components.push({
      type: 'header',
      parameters: [{ type: kind, [kind]: { id: mediaId, ...(kind === 'document' && fileName ? { filename: fileName } : {}) } }],
    });
  }
  if (template.bodyParams.length) {
    components.push({ type: 'body', parameters: template.bodyParams.map((text) => ({ type: 'text', text })) });
  }
  const result = await graph<SendResult>(`${phoneNumberId}/messages`, token, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(components.length ? { components } : {}),
      },
    },
  });
  return result.messages?.[0]?.id ?? '';
}

// ----------------------------- Media ------------------------------------------

export type MediaKind = 'image' | 'document' | 'audio' | 'video' | 'sticker';

/** Uploads a file to Meta for this number and returns the media id to send. */
export async function uploadMedia(phoneNumberId: string, token: string, file: { buffer: Buffer; mimeType: string; fileName: string }) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', file.mimeType);
  form.append('file', new Blob([file.buffer], { type: file.mimeType }), file.fileName);
  let response: Response;
  try {
    response = await fetch(`${env.whatsapp.graphUrl}/${env.whatsapp.graphVersion}/${phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new WhatsAppError(WhatsAppErrorCode.CLOUD_UNREACHABLE);
  }
  const payload = (await response.json().catch(() => ({}))) as { id?: string } & GraphErrorBody;
  if (!response.ok || payload.error || !payload.id) throw mapGraphError(response.status, payload);
  return payload.id;
}

export async function sendMedia(
  phoneNumberId: string,
  token: string,
  to: string,
  media: { kind: 'image' | 'document'; mediaId: string; caption?: string | null; fileName?: string | null },
): Promise<string> {
  const object: Record<string, string> = { id: media.mediaId };
  if (media.caption) object.caption = media.caption;
  if (media.kind === 'document' && media.fileName) object.filename = media.fileName;
  const result = await graph<SendResult>(`${phoneNumberId}/messages`, token, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: media.kind, [media.kind]: object },
  });
  return result.messages?.[0]?.id ?? '';
}

/**
 * Downloads an inbound media file. Meta returns a short-lived URL that itself
 * needs the bearer token; files are capped at 25 MB.
 */
export async function downloadMedia(mediaId: string, token: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const meta = await graph<{ url?: string; mime_type?: string; file_size?: number }>(mediaId, token);
  if (!meta.url) throw new WhatsAppError(WhatsAppErrorCode.SEND_FAILED);
  if ((meta.file_size ?? 0) > 25 * 1024 * 1024) throw new WhatsAppError(WhatsAppErrorCode.SEND_FAILED);
  const response = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new WhatsAppError(WhatsAppErrorCode.CLOUD_UNREACHABLE);
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: meta.mime_type ?? response.headers.get('content-type') ?? 'application/octet-stream' };
}
