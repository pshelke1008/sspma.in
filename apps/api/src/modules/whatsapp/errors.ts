import { AppError } from '../../lib/errors';

/**
 * Stable codes the interface translates into Marathi or English. A raw Baileys
 * or Graph API message never reaches the browser: those carry library
 * internals and give a user nothing to act on.
 */
export const WhatsAppErrorCode = {
  NOT_CONFIGURED: 'WHATSAPP_NOT_CONFIGURED',
  WEB_DISABLED: 'WHATSAPP_WEB_DISABLED',
  NOT_CONNECTED: 'WHATSAPP_NOT_CONNECTED',
  CLOUD_AUTH_FAILED: 'WHATSAPP_CLOUD_AUTH_FAILED',
  CLOUD_UNREACHABLE: 'WHATSAPP_CLOUD_UNREACHABLE',
  OUTSIDE_WINDOW: 'WHATSAPP_OUTSIDE_WINDOW',
  TEMPLATE_NOT_FOUND: 'WHATSAPP_TEMPLATE_NOT_FOUND',
  TEMPLATE_UNSUPPORTED: 'WHATSAPP_TEMPLATE_UNSUPPORTED',
  TEMPLATE_PARAMS_MISMATCH: 'WHATSAPP_TEMPLATE_PARAMS_MISMATCH',
  TEMPLATE_HEADER_MEDIA_REQUIRED: 'WHATSAPP_TEMPLATE_HEADER_MEDIA_REQUIRED',
  MISSING_DATA: 'WHATSAPP_MISSING_DATA',
  MEDIA_INVALID: 'WHATSAPP_MEDIA_INVALID',
  SCHEDULE_INVALID: 'WHATSAPP_SCHEDULE_INVALID',
  UPLOAD_INVALID: 'WHATSAPP_UPLOAD_INVALID',
  TEMPLATE_PAUSED: 'WHATSAPP_TEMPLATE_PAUSED',
  TEMPLATE_INVALID: 'WHATSAPP_TEMPLATE_INVALID',
  RATE_LIMITED: 'WHATSAPP_RATE_LIMITED',
  PAYMENT_ISSUE: 'WHATSAPP_PAYMENT_ISSUE',
  ACCOUNT_RESTRICTED: 'WHATSAPP_ACCOUNT_RESTRICTED',
  ENGAGEMENT_LIMIT: 'WHATSAPP_ENGAGEMENT_LIMIT',
  DISPLAY_NAME_PENDING: 'WHATSAPP_DISPLAY_NAME_PENDING',
  MEDIA_FAILED: 'WHATSAPP_MEDIA_FAILED',
  RECIPIENT_NOT_ALLOWED: 'WHATSAPP_RECIPIENT_NOT_ALLOWED',
  INVALID_NUMBER: 'WHATSAPP_INVALID_NUMBER',
  NOT_ON_WHATSAPP: 'WHATSAPP_NOT_ON_WHATSAPP',
  NOT_OPTED_IN: 'WHATSAPP_NOT_OPTED_IN',
  DONOR_INACTIVE: 'WHATSAPP_DONOR_INACTIVE',
  MONTHLY_LIMIT: 'WHATSAPP_MONTHLY_LIMIT',
  NUMBER_IN_USE: 'WHATSAPP_NUMBER_IN_USE',
  SEND_FAILED: 'WHATSAPP_SEND_FAILED',
  UNLINKED: 'WHATSAPP_UNLINKED',
  QR_EXPIRED: 'WHATSAPP_QR_EXPIRED',
  CONNECTION_LOST: 'WHATSAPP_CONNECTION_LOST',
  LINK_FAILED: 'WHATSAPP_LINK_FAILED',
  TEMPLATE_NEEDS_CLOUD: 'WHATSAPP_TEMPLATE_NEEDS_CLOUD',
  EMPTY_MESSAGE: 'WHATSAPP_EMPTY_MESSAGE',
  NO_RECIPIENTS: 'WHATSAPP_NO_RECIPIENTS',
  MEDIA_NEEDS_CLOUD: 'WHATSAPP_MEDIA_NEEDS_CLOUD',
  OAUTH_NOT_CONFIGURED: 'WHATSAPP_OAUTH_NOT_CONFIGURED',
  OAUTH_EXPIRED: 'WHATSAPP_OAUTH_EXPIRED',
  OAUTH_NO_ACCOUNTS: 'WHATSAPP_OAUTH_NO_ACCOUNTS',
  OAUTH_FAILED: 'WHATSAPP_OAUTH_FAILED',
} as const;

export type WhatsAppErrorCodeValue = (typeof WhatsAppErrorCode)[keyof typeof WhatsAppErrorCode];

const MESSAGES: Record<WhatsAppErrorCodeValue, string> = {
  WHATSAPP_NOT_CONFIGURED: 'WhatsApp is not configured on this server: the encryption key is missing.',
  WHATSAPP_WEB_DISABLED: 'Linking WhatsApp by QR code is turned off on this server.',
  WHATSAPP_NOT_CONNECTED: 'WhatsApp is not connected. Connect it in Settings → WhatsApp.',
  WHATSAPP_CLOUD_AUTH_FAILED: 'Meta rejected these Cloud API credentials. Check the phone number ID and access token.',
  WHATSAPP_CLOUD_UNREACHABLE: 'Could not reach the WhatsApp Cloud API. Please try again.',
  WHATSAPP_OUTSIDE_WINDOW: 'More than 24 hours have passed since this donor last messaged you. Send an approved template instead.',
  WHATSAPP_TEMPLATE_NOT_FOUND: 'That message template does not exist or is not approved for this language.',
  WHATSAPP_TEMPLATE_UNSUPPORTED: 'This template needs a dynamic button, a header variable or named variables, which cannot be sent from here yet.',
  WHATSAPP_TEMPLATE_HEADER_MEDIA_REQUIRED: 'This template has an image, video or document header. Attach the file to send.',
  WHATSAPP_MISSING_DATA: 'A value this message needs is missing for this donor.',
  WHATSAPP_MEDIA_INVALID: 'That file cannot be used as this template\'s header. Check the file type and size.',
  WHATSAPP_SCHEDULE_INVALID: 'Choose a time at least a few minutes from now, within the next 30 days.',
  WHATSAPP_UPLOAD_INVALID: 'That spreadsheet could not be read. Use an .xlsx file with a column for phone numbers.',
  WHATSAPP_TEMPLATE_PARAMS_MISMATCH: 'Fill in a value for every variable of the template.',
  WHATSAPP_TEMPLATE_PAUSED: 'Meta has paused or disabled this template because of its quality. Choose another template.',
  // Carries Meta's own explanation (e.g. a name that already exists), so it has no fixed translation.
  WHATSAPP_TEMPLATE_INVALID: 'Meta did not accept this template.',
  WHATSAPP_RATE_LIMITED: 'WhatsApp is limiting how fast messages can be sent. Please try again shortly.',
  WHATSAPP_PAYMENT_ISSUE:
    'Meta will not send messages for this WhatsApp Business Account until billing is set up. In Meta Business Settings → WhatsApp accounts → Payment settings, set the currency and add a payment method.',
  WHATSAPP_ACCOUNT_RESTRICTED: 'This WhatsApp Business Account or number is restricted or locked by Meta. Check its status in Meta Business Manager.',
  WHATSAPP_ENGAGEMENT_LIMIT: 'Meta chose not to deliver this message to this person to keep conversations healthy. It may succeed later.',
  WHATSAPP_DISPLAY_NAME_PENDING: 'The WhatsApp display name for this number has not been approved yet.',
  WHATSAPP_MEDIA_FAILED: 'WhatsApp could not use the media (image, video or document) in this message.',
  WHATSAPP_RECIPIENT_NOT_ALLOWED: 'This number is not on your Cloud API test recipient list.',
  WHATSAPP_INVALID_NUMBER: 'This donor does not have a valid mobile number.',
  WHATSAPP_NOT_ON_WHATSAPP: 'That number does not have a WhatsApp account.',
  WHATSAPP_NOT_OPTED_IN: 'This donor has not agreed to receive WhatsApp messages.',
  WHATSAPP_DONOR_INACTIVE: 'This donor is inactive.',
  WHATSAPP_MONTHLY_LIMIT: "This month's WhatsApp sending limit has been reached.",
  WHATSAPP_NUMBER_IN_USE: 'This WhatsApp number is already linked to another organization.',
  WHATSAPP_SEND_FAILED: 'The message could not be sent. Please try again.',
  WHATSAPP_UNLINKED: 'Unlinked from the WhatsApp app on the phone.',
  WHATSAPP_QR_EXPIRED: 'The QR code expired before it was scanned. Try again for a new code.',
  WHATSAPP_CONNECTION_LOST: 'Lost the connection to WhatsApp and could not reconnect automatically.',
  WHATSAPP_LINK_FAILED: 'Could not complete the WhatsApp link. Start again and scan the new code.',
  WHATSAPP_TEMPLATE_NEEDS_CLOUD: 'Message templates can only be sent through the WhatsApp Cloud API.',
  WHATSAPP_EMPTY_MESSAGE: 'Write a message or choose a template.',
  WHATSAPP_NO_RECIPIENTS: 'None of the selected donors were found.',
  WHATSAPP_MEDIA_NEEDS_CLOUD: 'Photos and documents can only be sent through the WhatsApp Cloud API.',
  WHATSAPP_OAUTH_NOT_CONFIGURED: 'Connect with Facebook is not set up on this server: WHATSAPP_APP_ID and WHATSAPP_APP_SECRET are needed.',
  WHATSAPP_OAUTH_EXPIRED: 'The Facebook sign-in expired before a number was chosen. Please connect again.',
  WHATSAPP_OAUTH_NO_ACCOUNTS: 'No WhatsApp Business account with messaging permission was shared. Connect again and allow access to your WhatsApp account.',
  WHATSAPP_OAUTH_FAILED: 'Could not finish connecting to Facebook. Please try again.',
};

/** Problems with the request itself rather than the connection. */
const BAD_REQUEST_CODES = new Set<WhatsAppErrorCodeValue>([
  'WHATSAPP_TEMPLATE_NEEDS_CLOUD',
  'WHATSAPP_EMPTY_MESSAGE',
  'WHATSAPP_NO_RECIPIENTS',
  'WHATSAPP_MEDIA_NEEDS_CLOUD',
  'WHATSAPP_TEMPLATE_UNSUPPORTED',
  'WHATSAPP_TEMPLATE_PARAMS_MISMATCH',
  'WHATSAPP_TEMPLATE_HEADER_MEDIA_REQUIRED',
  'WHATSAPP_TEMPLATE_INVALID',
  'WHATSAPP_MEDIA_INVALID',
  'WHATSAPP_SCHEDULE_INVALID',
  'WHATSAPP_UPLOAD_INVALID',
]);

/**
 * What a Meta error code means to us. Used for the error a send call returns and
 * for the `errors` Meta attaches to a failed delivery receipt, so one failure reads
 * the same wherever it is noticed.
 */
export function codeForMetaError(code: number | undefined): WhatsAppErrorCodeValue {
  switch (code) {
    case 131047:
      return WhatsAppErrorCode.OUTSIDE_WINDOW;
    case 131026:
      return WhatsAppErrorCode.NOT_ON_WHATSAPP;
    case 131030:
      return WhatsAppErrorCode.RECIPIENT_NOT_ALLOWED;
    case 131042:
      return WhatsAppErrorCode.PAYMENT_ISSUE;
    case 131031:
      return WhatsAppErrorCode.ACCOUNT_RESTRICTED;
    case 131037:
      return WhatsAppErrorCode.DISPLAY_NAME_PENDING;
    case 131049:
      return WhatsAppErrorCode.ENGAGEMENT_LIMIT;
    case 131051:
    case 131052:
    case 131053:
      return WhatsAppErrorCode.MEDIA_FAILED;
    case 130429:
    case 131048:
    case 131056:
    case 80007:
      return WhatsAppErrorCode.RATE_LIMITED;
    case 132000:
    case 132012:
      return WhatsAppErrorCode.TEMPLATE_PARAMS_MISMATCH;
    case 132001:
      return WhatsAppErrorCode.TEMPLATE_NOT_FOUND;
    case 132015:
    case 132016:
      return WhatsAppErrorCode.TEMPLATE_PAUSED;
    default:
      return WhatsAppErrorCode.SEND_FAILED;
  }
}

/** "131042: Message failed because …" — Meta's code and its own words, short enough to store. */
export function metaErrorDetail(error: { code?: number; title?: string; message?: string; details?: string } | undefined): string | null {
  if (!error) return null;
  const words = error.details ?? error.message ?? error.title;
  const text = [error.code, words].filter((part) => part !== undefined && part !== '').join(': ');
  return text ? text.slice(0, 400) : null;
}

export class WhatsAppError extends AppError {
  constructor(
    public readonly whatsappCode: WhatsAppErrorCodeValue,
    message?: string,
    /** Meta's own explanation, when it gave one; stored with a failed message, never shown as the headline. */
    public readonly detail?: string | null,
  ) {
    const status =
      whatsappCode === WhatsAppErrorCode.NOT_CONFIGURED || whatsappCode === WhatsAppErrorCode.WEB_DISABLED
        ? 503
        : BAD_REQUEST_CODES.has(whatsappCode)
          ? 400
          : 409;
    super(status, whatsappCode, message ?? MESSAGES[whatsappCode]);
    this.name = 'WhatsAppError';
  }
}

/** What to store on a failed message: our code, plus Meta's detail if the error carried it. */
export function failureOf(error: unknown): { error: string; errorDetail: string | null } {
  return { error: sanitizeError(error), errorDetail: error instanceof WhatsAppError ? (error.detail ?? null) : null };
}

export function messageFor(code: WhatsAppErrorCodeValue): string {
  return MESSAGES[code];
}

/** Short and storable — Baileys errors sometimes hang large objects off `message`. */
export function sanitizeError(error: unknown): string {
  if (error instanceof WhatsAppError) return error.whatsappCode;
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}
