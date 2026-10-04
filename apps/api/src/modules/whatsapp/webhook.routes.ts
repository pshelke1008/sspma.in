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
  const secret = env.whatsapp.appSecret;
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;

  if (typeof signature !== 'string' || !secret || !rawBody) return res.sendStatus(403);

  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const received = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  // Constant-time: a plain comparison leaks how much of the digest matched.
  if (received.length !== wanted.length || !crypto.timingSafeEqual(received, wanted)) {
    return res.sendStatus(403);
  }

  // Acknowledge at once — Meta retries slow responses — then process.
  res.sendStatus(200);
  processCloudWebhook(req.body).catch((error) =>
    console.error('[whatsapp] webhook processing failed', sanitizeError(error)),
  );
});
