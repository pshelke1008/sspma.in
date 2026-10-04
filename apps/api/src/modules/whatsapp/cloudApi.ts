/**
 * WhatsApp Cloud API (Meta Graph) client.
 *
 * The official channel: a business number, approved message templates, and
 * delivery receipts through the signed webhook. Outside the 24-hour window
 * after a donor's last message, only approved templates may be sent.
 */
import { env } from '../../env';
import { WhatsAppError, WhatsAppErrorCode } from './errors';

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
}

function mapGraphError(status: number, body: GraphErrorBody): WhatsAppError {
  const code = body.error?.code;
  if (status === 401 || code === 190 || code === 10 || code === 200) {
    return new WhatsAppError(WhatsAppErrorCode.CLOUD_AUTH_FAILED);
  }
  if (code === 131047) return new WhatsAppError(WhatsAppErrorCode.OUTSIDE_WINDOW);
  if (code === 131026) return new WhatsAppError(WhatsAppErrorCode.NOT_ON_WHATSAPP);
  if (code === 131030) return new WhatsAppError(WhatsAppErrorCode.RECIPIENT_NOT_ALLOWED);
  if (code === 132001 || code === 132000) return new WhatsAppError(WhatsAppErrorCode.TEMPLATE_NOT_FOUND);
  if (code === 100 && body.error?.error_subcode === 33) return new WhatsAppError(WhatsAppErrorCode.CLOUD_AUTH_FAILED);
  return new WhatsAppError(WhatsAppErrorCode.SEND_FAILED);
}

async function graph<T>(
  path: string,
  token: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string> } = {},
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
    throw mapGraphError(response.status, payload);
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

export interface MessageTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  /** How many {{n}} body parameters the template expects. */
  bodyParameterCount: number;
  bodyText: string;
}

export async function listApprovedTemplates(businessAccountId: string, token: string): Promise<MessageTemplate[]> {
  const result = await graph<{
    data: { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] }[];
  }>(`${businessAccountId}/message_templates`, token, {
    query: { fields: 'name,language,status,category,components', limit: '200' },
  });

  return result.data
    .filter((template) => template.status === 'APPROVED')
    .map((template) => {
      const body = template.components?.find((component) => component.type === 'BODY')?.text ?? '';
      const placeholders = new Set(body.match(/\{\{\d+\}\}/g) ?? []);
      return {
        name: template.name,
        language: template.language,
        status: template.status,
        category: template.category,
        bodyParameterCount: placeholders.size,
        bodyText: body,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
  template: { name: string; language: string; bodyParams: string[] },
): Promise<string> {
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
        ...(template.bodyParams.length
          ? {
              components: [
                { type: 'body', parameters: template.bodyParams.map((text) => ({ type: 'text', text })) },
              ],
            }
          : {}),
      },
    },
  });
  return result.messages?.[0]?.id ?? '';
}
