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
]);

export class WhatsAppError extends AppError {
  constructor(public readonly whatsappCode: WhatsAppErrorCodeValue, message?: string) {
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

export function messageFor(code: WhatsAppErrorCodeValue): string {
  return MESSAGES[code];
}

/** Short and storable — Baileys errors sometimes hang large objects off `message`. */
export function sanitizeError(error: unknown): string {
  if (error instanceof WhatsAppError) return error.whatsappCode;
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}
