/**
 * WhatsApp media: files donors send us are downloaded from Meta into our own
 * storage (Meta's URLs expire within minutes), and served back to staff only
 * through an authenticated, organization-scoped route.
 */
import { prisma } from '../../db';
import { notFound } from '../../lib/errors';
import { readFile, storeRawFile } from '../../lib/storage';
import * as cloud from './cloudApi';
import { credentialsFor } from './numbers.service';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

export async function fetchInboundMedia(
  messageId: string,
  organizationId: string,
  numberId: string,
  media: { kind: string; mediaId: string; fileName?: string | null; mimeType?: string | null },
) {
  const credentials = await credentialsFor(organizationId, numberId);
  const file = await cloud.downloadMedia(media.mediaId, credentials.token);
  const mimeType = media.mimeType ?? file.mimeType;
  const fileName = media.fileName ?? `${media.kind}-${messageId}.${EXTENSIONS[mimeType.split(';')[0]] ?? 'bin'}`;
  const stored = await storeRawFile(organizationId, 'whatsapp', { fileName, mimeType, buffer: file.buffer });
  await prisma.whatsAppMessage.update({
    where: { id: messageId },
    data: { mediaStorageKey: stored.key, mediaMimeType: mimeType, mediaFileName: stored.fileName },
  });
}

/** The stored file of a message, only for the organization that owns it. */
export async function readMessageMedia(organizationId: string, messageId: string) {
  const message = await prisma.whatsAppMessage.findFirst({
    where: { id: messageId, organizationId },
    select: { mediaStorageKey: true, mediaMimeType: true, mediaFileName: true, mediaType: true },
  });
  if (!message?.mediaStorageKey) throw notFound('This file is not available');
  return {
    buffer: await readFile(message.mediaStorageKey),
    mimeType: message.mediaMimeType ?? 'application/octet-stream',
    fileName: message.mediaFileName ?? 'file',
    kind: message.mediaType,
  };
}
