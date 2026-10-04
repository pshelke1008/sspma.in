/**
 * WhatsApp message templates — parsing what Meta returns, deciding whether a
 * template can be sent from here, and building the payload that submits a new
 * one for approval.
 *
 * Pure functions only (no network, no database), so the rules are unit-tested.
 */
import { WhatsAppError, WhatsAppErrorCode } from './errors';

export const TEMPLATE_CATEGORIES = ['UTILITY', 'MARKETING'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'OTHER';
  text: string;
  url?: string;
  phoneNumber?: string;
}

/** Why a template cannot be sent from this app. The browser translates these. */
export type UnsendableReason =
  | 'UNSUPPORTED_HEADER'
  | 'HEADER_VARIABLE'
  | 'BUTTON_PARAMETER'
  | 'NAMED_PARAMETERS'
  | 'OTHER_COMPONENT';

export interface MessageTemplate {
  /** Meta's template ID; needed to delete a single language. */
  id: string;
  name: string;
  language: string;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED … as Meta reports it. */
  status: string;
  category: string;
  rejectedReason: string | null;
  /** TEXT, IMAGE, VIDEO, DOCUMENT or LOCATION; null when the template has no header. */
  headerFormat: string | null;
  headerText: string | null;
  /** True for image/video/document headers: each send must bring the file. */
  requiresHeaderMedia: boolean;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
  /** Highest {{n}} in the body — the number of values a send must supply. */
  bodyParameterCount: number;
  /** False when the template needs something this app cannot supply (see reason). */
  sendable: boolean;
  unsendableReason: UnsendableReason | null;
}

interface RawComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: { type?: string; text?: string; url?: string; phone_number?: string }[];
}

export interface RawTemplate {
  id?: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameter_format?: string;
  rejected_reason?: string;
  components?: RawComponent[];
}

const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

/** The {{n}} indexes used in a text, sorted and de-duplicated. */
export function placeholderIndexes(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(PLACEHOLDER)) found.add(Number(match[1]));
  return [...found].sort((a, b) => a - b);
}

export function parameterCount(text: string): number {
  const indexes = placeholderIndexes(text);
  return indexes.length ? indexes[indexes.length - 1] : 0;
}

/** Header formats a send can fill: text, or a file the sender provides. */
export const MEDIA_HEADER_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'] as const;
const HEADER_FORMATS: string[] = ['TEXT', ...MEDIA_HEADER_FORMATS];

const hasVariable = (text: string | undefined) => Boolean(text && /\{\{/.test(text));

function buttonOf(raw: NonNullable<RawComponent['buttons']>[number]): TemplateButton {
  const text = raw.text ?? '';
  if (raw.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text };
  if (raw.type === 'URL') return { type: 'URL', text, url: raw.url };
  if (raw.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text, phoneNumber: raw.phone_number };
  return { type: 'OTHER', text };
}

export function parseTemplate(raw: RawTemplate): MessageTemplate {
  const components = raw.components ?? [];
  const find = (type: string) => components.find((component) => component.type === type);
  const header = find('HEADER');
  const bodyText = find('BODY')?.text ?? '';
  const buttons = (find('BUTTONS')?.buttons ?? []).map(buttonOf);

  let unsendableReason: UnsendableReason | null = null;
  if (raw.parameter_format === 'NAMED') unsendableReason = 'NAMED_PARAMETERS';
  else if (header?.format && !HEADER_FORMATS.includes(header.format)) unsendableReason = 'UNSUPPORTED_HEADER';
  else if (header && hasVariable(header.text)) unsendableReason = 'HEADER_VARIABLE';
  else if (buttons.some((button) => button.type === 'OTHER' || hasVariable(button.url))) {
    unsendableReason = 'BUTTON_PARAMETER';
  } else if (components.some((component) => !['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(component.type ?? ''))) {
    unsendableReason = 'OTHER_COMPONENT';
  }

  return {
    id: raw.id ?? '',
    name: raw.name,
    language: raw.language,
    status: raw.status,
    category: raw.category,
    rejectedReason: raw.rejected_reason && raw.rejected_reason !== 'NONE' ? raw.rejected_reason : null,
    headerFormat: header ? (header.format ?? 'TEXT') : null,
    headerText: header && (!header.format || header.format === 'TEXT') ? (header.text ?? null) : null,
    requiresHeaderMedia: Boolean(header?.format && (MEDIA_HEADER_FORMATS as readonly string[]).includes(header.format)),
    bodyText,
    footerText: find('FOOTER')?.text ?? null,
    buttons,
    bodyParameterCount: parameterCount(bodyText),
    sendable: unsendableReason === null,
    unsendableReason,
  };
}

/** The template's body with {{n}} replaced by the values that will be sent. */
export function renderTemplateText(text: string, params: string[]): string {
  return text.replace(PLACEHOLDER, (match, index: string) => params[Number(index) - 1] ?? match);
}

/**
 * Checks a template against what the caller wants to send. Meta answers a bad
 * send with an opaque error per recipient; failing here turns it into one clear
 * message before anything is queued.
 */
export function assertTemplateUsable(
  template: MessageTemplate | undefined,
  params: string[],
  options: { headerMedia?: boolean } = {},
): asserts template is MessageTemplate {
  if (!template || template.status !== 'APPROVED') throw new WhatsAppError(WhatsAppErrorCode.TEMPLATE_NOT_FOUND);
  if (!template.sendable) throw new WhatsAppError(WhatsAppErrorCode.TEMPLATE_UNSUPPORTED);
  if (template.requiresHeaderMedia && !options.headerMedia) {
    throw new WhatsAppError(WhatsAppErrorCode.TEMPLATE_HEADER_MEDIA_REQUIRED);
  }
  if (params.length !== template.bodyParameterCount || params.some((param) => !param.trim())) {
    throw new WhatsAppError(WhatsAppErrorCode.TEMPLATE_PARAMS_MISMATCH);
  }
}

// ----------------------------- Creating a template ----------------------------

export interface TemplateButtonInput {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: TemplateCategory;
  headerText?: string | null;
  /** An image, video or document header: needs `headerHandle` from the sample upload. */
  headerFormat?: (typeof MEDIA_HEADER_FORMATS)[number] | null;
  headerHandle?: string | null;
  bodyText: string;
  /** One sample value per {{n}} in the body; Meta requires them for review. */
  bodyExamples: string[];
  footerText?: string | null;
  buttons: TemplateButtonInput[];
}

/** Body variables must be {{1}} … {{n}} with no gaps, and not at either end of the text. */
export function bodyProblem(bodyText: string): 'GAPS' | 'EDGE' | null {
  const indexes = placeholderIndexes(bodyText);
  if (indexes.some((value, position) => value !== position + 1)) return 'GAPS';
  const trimmed = bodyText.trim();
  if (/^\{\{\s*\d+\s*\}\}/.test(trimmed) || /\{\{\s*\d+\s*\}\}$/.test(trimmed)) return 'EDGE';
  return null;
}

/** The body of Meta's `POST /{waba}/message_templates`. */
export function buildCreatePayload(input: CreateTemplateInput) {
  const components: Record<string, unknown>[] = [];

  if (input.headerFormat && input.headerHandle) {
    components.push({ type: 'HEADER', format: input.headerFormat, example: { header_handle: [input.headerHandle] } });
  } else if (input.headerText?.trim()) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText.trim() });
  }

  const count = parameterCount(input.bodyText);
  components.push({
    type: 'BODY',
    text: input.bodyText.trim(),
    ...(count > 0 ? { example: { body_text: [input.bodyExamples.slice(0, count).map((value) => value.trim())] } } : {}),
  });

  if (input.footerText?.trim()) components.push({ type: 'FOOTER', text: input.footerText.trim() });

  if (input.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((button) => {
        if (button.type === 'URL') return { type: 'URL', text: button.text.trim(), url: button.url?.trim() };
        if (button.type === 'PHONE_NUMBER') {
          return { type: 'PHONE_NUMBER', text: button.text.trim(), phone_number: button.phoneNumber?.trim() };
        }
        return { type: 'QUICK_REPLY', text: button.text.trim() };
      }),
    });
  }

  return { name: input.name, language: input.language, category: input.category, components };
}
