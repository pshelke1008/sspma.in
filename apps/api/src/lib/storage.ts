import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';
import { badRequest } from './errors';

/** Extension + MIME pairs accepted for expense attachments. */
const ALLOWED: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

export interface StoredFile {
  key: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * Server-side upload validation. The browser check is a convenience only —
 * every file is re-validated here against MIME type, extension and size, and
 * the magic bytes are checked so a renamed executable cannot slip through.
 */
export function validateUpload(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ALLOWED[file.mimetype];

  if (!allowedExts) {
    throw badRequest(`Unsupported file type "${file.mimetype}". Allowed: PDF, JPG, JPEG, PNG, WEBP.`);
  }
  if (!allowedExts.includes(ext)) {
    throw badRequest(`File extension "${ext}" does not match its content type.`);
  }
  if (file.size > env.maxUploadBytes) {
    throw badRequest(`File is larger than the ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB limit.`);
  }
  if (file.size === 0) {
    throw badRequest('File is empty.');
  }
  if (!hasExpectedSignature(file.buffer, file.mimetype)) {
    throw badRequest('File contents do not match the declared file type.');
  }
}

function hasExpectedSignature(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 12) return false;
  switch (mimeType) {
    case 'application/pdf':
      return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return (
        buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buffer.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    default:
      return false;
  }
}

function safeName(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const base = path
    .basename(original, ext)
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .slice(0, 60)
    .trim()
    .replace(/\s+/g, '-');
  return `${base || 'file'}${ext}`;
}

interface StorageDriver {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const localDriver: StorageDriver = {
  async put(key, body) {
    const target = path.join(env.storage.localDir, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  },
  async get(key) {
    return fs.readFile(path.join(env.storage.localDir, key));
  },
  async remove(key) {
    await fs.rm(path.join(env.storage.localDir, key), { force: true });
  },
};

/** Lazily constructed so the AWS SDK is only loaded when S3 is configured. */
function s3Driver(): StorageDriver {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: env.storage.region,
    endpoint: env.storage.endpoint,
    forcePathStyle: env.storage.forcePathStyle,
    credentials:
      env.storage.accessKeyId && env.storage.secretAccessKey
        ? { accessKeyId: env.storage.accessKeyId, secretAccessKey: env.storage.secretAccessKey }
        : undefined,
  });
  return {
    async put(key, body, mimeType) {
      await client.send(
        new PutObjectCommand({ Bucket: env.storage.bucket, Key: key, Body: body, ContentType: mimeType }),
      );
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: env.storage.bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of result.Body as AsyncIterable<Buffer>) chunks.push(chunk);
      return Buffer.concat(chunks);
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.storage.bucket, Key: key }));
    },
  };
}

let driver: StorageDriver | null = null;
function getDriver(): StorageDriver {
  if (!driver) driver = env.storage.driver === 's3' ? s3Driver() : localDriver;
  return driver;
}

/**
 * Object keys are namespaced per organization and carry a random component, so
 * keys are neither guessable nor shared across tenants.
 */
export async function storeFile(
  organizationId: string,
  scope: string,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
): Promise<StoredFile> {
  validateUpload(file);
  const fileName = safeName(file.originalname);
  const key = `org/${organizationId}/${scope}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${fileName}`;
  await getDriver().put(key, file.buffer, file.mimetype);
  return { key, fileName, mimeType: file.mimetype, size: file.size };
}

export async function readFile(key: string): Promise<Buffer> {
  return getDriver().get(key);
}

export async function removeFile(key: string): Promise<void> {
  await getDriver().remove(key);
}

/**
 * Stores a file that did not come from a user upload — WhatsApp media fetched
 * from Meta, which may be audio, video or any document type. It skips the
 * upload allowlist, so it must only be served back as a download (never inline
 * as HTML) by the route that reads it.
 */
export async function storeRawFile(
  organizationId: string,
  scope: string,
  file: { fileName: string; mimeType: string; buffer: Buffer },
): Promise<StoredFile> {
  const fileName = safeName(file.fileName);
  const key = `org/${organizationId}/${scope}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${fileName}`;
  await getDriver().put(key, file.buffer, file.mimeType);
  return { key, fileName, mimeType: file.mimeType, size: file.buffer.length };
}
