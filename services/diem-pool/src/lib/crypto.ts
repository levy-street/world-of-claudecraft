import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

// AES-256-GCM envelope for provider API keys at rest.
// Format: "v1:<iv b64>:<ciphertext b64>:<authTag b64>". The envelope version
// prefix leaves room for KMS-backed envelopes later without a data migration.

const VERSION = 'v1';
const IV_BYTES = 12;

function keyFromHex(keyHex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('encryption key must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = keyFromHex(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), ct.toString('base64'), tag.toString('base64')].join(':');
}

export function decryptSecret(envelope: string, keyHex: string): string {
  const key = keyFromHex(keyHex);
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('unrecognized secret envelope');
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  // GCM auth failure throws here - tampered ciphertext never decrypts silently.
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Display-safe fragment of a secret ("…a1b2"). Never store or show more. */
export function last4(secret: string): string {
  return secret.slice(-4);
}

/** Constant-time string comparison for shared-secret headers. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still burn a comparison so length isn't a useful oracle.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Scrub secrets and bearer tokens from text destined for logs or error
 * responses. Applied to upstream error bodies before they leave the service.
 */
export function redactSecrets(text: string, secrets: Array<string | undefined> = []): string {
  let out = text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]');
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join('[redacted]');
  }
  return out;
}
