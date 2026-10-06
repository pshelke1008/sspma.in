/**
 * WhatsApp Cloud API webhook — public, but authenticated by Meta's signature.
 *
 * One endpoint serves every organization: Meta configures webhooks per app, and
 * each callback names the business phone number it concerns, which routes it
 * to the right tenant. The request fails closed: no configured secret, no
 * signature, or a signature that does not match the raw bytes — all 403.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../../env';
import { processCloudWebhook } from './messaging.service';
import { sanitizeError } from './errors';

/**
 * Whether `signature` (Meta's `X-Hub-Signature-256`) is the HMAC-SHA256 of the raw
 * body under any of the app secrets. Constant-time: a plain comparison leaks how
 * much of the digest matched.
 */
export function isValidSignature(rawBody: Buffer, signature: string, secrets: string[]): boolean {
  const received = Buffer.from(signature);
  return secrets.some((secret) => {
    const wanted = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`);
    return received.length === wanted.length && crypto.timingSafeEqual(received, wanted);
  });
}

export const whatsappWebhookRouter = Router();

whatsappWebhookRouter.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && env.whatsapp.webhookVerifyToken && token === env.whatsapp.webhookVerifyToken) {
    return res.status(200).send(String(challenge ?? ''));
  }
  res.sendStatus(403);
});

whatsappWebhookRouter.post('/', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const secrets = env.whatsapp.appSecrets;
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

  if (typeof signature !== 'string' || secrets.length === 0 || !rawBody) return res.sendStatus(403);
  if (!isValidSignature(rawBody, signature, secrets)) return res.sendStatus(403);

  // Acknowledge at once — Meta retries slow responses — then process.
  res.sendStatus(200);
  processCloudWebhook(req.body).catch((error) =>
    console.error('[whatsapp] webhook processing failed', sanitizeError(error)),
  );
});
