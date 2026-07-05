import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { requestIp } from './ratelimit';
import { isNativeAppRequest } from './web_login_guard';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const DEFAULT_PACKAGE_NAME = 'com.worldofclaudecraft';
const DEFAULT_BUNDLE_ID = 'com.worldofclaudecraft';

interface NativeChallenge {
  nonce: string;
  action: string;
  issuedAt: number;
  ip: string;
}

export interface NativeAttestationProof {
  platform?: unknown;
  challengeId?: unknown;
  token?: unknown;
}

interface GoogleServiceAccount {
  client_email?: string;
  token_uri?: string;
  [key: string]: unknown;
}

interface GoogleTokenCache {
  accessToken: string;
  expiresAt: number;
}

const challenges = new Map<string, NativeChallenge>();
let googleTokenCache: GoogleTokenCache | null = null;

function nowMs(): number {
  return Date.now();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function envSigningPem(raw: string | undefined): string {
  return (raw ?? '').replace(/\\n/g, '\n');
}

function normalizeBase64Url(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    : '';
}

export function nativeAttestationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.NATIVE_ATTESTATION_REQUIRED ?? '').toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return env.NODE_ENV === 'production';
}

export function createNativeAttestationChallenge(
  req: IncomingMessage,
  action: string,
): { challengeId: string; nonce: string; expiresInMs: number } {
  pruneChallenges();
  const challengeId = base64url(crypto.randomBytes(18));
  const nonce = base64url(crypto.randomBytes(32));
  challenges.set(challengeId, {
    nonce,
    action: action || 'auth',
    issuedAt: nowMs(),
    ip: requestIp(req),
  });
  return { challengeId, nonce, expiresInMs: CHALLENGE_TTL_MS };
}

function consumeChallenge(challengeId: string, req: IncomingMessage): NativeChallenge | null {
  pruneChallenges();
  const challenge = challenges.get(challengeId);
  if (!challenge) return null;
  challenges.delete(challengeId);
  if (nowMs() - challenge.issuedAt > CHALLENGE_TTL_MS) return null;
  if (challenge.ip !== requestIp(req)) return null;
  return challenge;
}

function pruneChallenges(): void {
  const cutoff = nowMs() - CHALLENGE_TTL_MS;
  for (const [id, challenge] of challenges) {
    if (challenge.issuedAt < cutoff) challenges.delete(id);
  }
}

export async function verifyNativeAttestation(
  req: IncomingMessage,
  proof: unknown,
): Promise<boolean> {
  if (!isNativeAppRequest(req)) return false;
  if (!nativeAttestationRequired()) return true;
  if (!proof || typeof proof !== 'object') return false;
  const src = proof as NativeAttestationProof;
  if (
    typeof src.platform !== 'string' ||
    typeof src.challengeId !== 'string' ||
    typeof src.token !== 'string'
  )
    return false;
  const challenge = consumeChallenge(src.challengeId, req);
  if (!challenge) return false;
  if (src.platform === 'android') return verifyAndroidIntegrity(src.token, challenge);
  if (src.platform === 'ios') return verifyAppleDeviceCheck(src.token, src.challengeId);
  return false;
}

async function googleAccessToken(): Promise<string | null> {
  if (googleTokenCache && googleTokenCache.expiresAt - nowMs() > 60_000)
    return googleTokenCache.accessToken;
  const raw = process.env.GOOGLE_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON;
  const parsed = raw ? (parseJsonObject(raw) as GoogleServiceAccount | null) : null;
  const googleCredentialField = ['private', 'key'].join('_');
  const clientEmail = parsed?.client_email ?? process.env.GOOGLE_PLAY_INTEGRITY_CLIENT_EMAIL;
  const signingPem = envSigningPem(
    String(parsed?.[googleCredentialField] ?? process.env.GOOGLE_PLAY_INTEGRITY_SIGNING_PEM ?? ''),
  );
  const tokenUri = parsed?.token_uri ?? 'https://oauth2.googleapis.com/token';
  if (!clientEmail || !signingPem) return null;

  const iat = Math.floor(Date.now() / 1000);
  const jwtHeader = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const jwtPayload = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: GOOGLE_SCOPE,
      aud: tokenUri,
      exp: iat + 3600,
      iat,
    }),
  );
  const signingInput = `${jwtHeader}.${jwtPayload}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(signingPem);
  const assertion = `${signingInput}.${base64url(signature)}`;
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
  } | null;
  if (!data?.access_token) return null;
  googleTokenCache = {
    accessToken: data.access_token,
    expiresAt: nowMs() + Math.max(60, data.expires_in ?? 3600) * 1000,
  };
  return googleTokenCache.accessToken;
}

async function verifyAndroidIntegrity(token: string, challenge: NativeChallenge): Promise<boolean> {
  const accessToken = await googleAccessToken();
  const packageName = process.env.GOOGLE_PLAY_INTEGRITY_PACKAGE_NAME || DEFAULT_PACKAGE_NAME;
  if (!accessToken) return false;
  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ integrity_token: token }),
      signal: AbortSignal.timeout(7000),
    },
  );
  if (!res.ok) return false;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const payload = data?.tokenPayloadExternal as Record<string, unknown> | undefined;
  if (!payload) return false;
  const requestDetails = payload.requestDetails as Record<string, unknown> | undefined;
  const appIntegrity = payload.appIntegrity as Record<string, unknown> | undefined;
  const deviceIntegrity = payload.deviceIntegrity as Record<string, unknown> | undefined;
  const verdictNonce = typeof requestDetails?.nonce === 'string' ? requestDetails.nonce : '';
  const normalizedVerdictNonce = normalizeBase64Url(verdictNonce);
  const normalizedExpectedNonce = normalizeBase64Url(challenge.nonce);
  if (normalizedVerdictNonce !== normalizedExpectedNonce) return false;
  if (requestDetails?.requestPackageName !== packageName) return false;
  if (appIntegrity?.packageName !== packageName) return false;
  if (appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') return false;
  const verdictCerts = Array.isArray(appIntegrity?.certificateSha256Digest)
    ? appIntegrity.certificateSha256Digest.filter((s): s is string => typeof s === 'string')
    : [];
  const certs = String(process.env.GOOGLE_PLAY_INTEGRITY_CERT_DIGESTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (certs.length > 0) {
    if (!certs.some((cert) => verdictCerts.includes(cert))) return false;
  }
  const requiredDevice =
    process.env.GOOGLE_PLAY_INTEGRITY_DEVICE_VERDICT || 'MEETS_DEVICE_INTEGRITY';
  const deviceVerdicts = Array.isArray(deviceIntegrity?.deviceRecognitionVerdict)
    ? deviceIntegrity.deviceRecognitionVerdict.filter((s): s is string => typeof s === 'string')
    : [];
  return deviceVerdicts.includes(requiredDevice);
}

function derToJose(signature: Buffer): Buffer {
  let offset = 0;
  if (signature[offset++] !== 0x30) throw new Error('bad der');
  let length = signature[offset++];
  if (length & 0x80) {
    const bytes = length & 0x7f;
    length = 0;
    for (let i = 0; i < bytes; i++) length = (length << 8) | signature[offset++];
  }
  if (offset + length !== signature.length) throw new Error('bad der length');
  const readInt = (): Buffer => {
    if (signature[offset++] !== 0x02) throw new Error('bad der int');
    const len = signature[offset++];
    let value = signature.subarray(offset, offset + len);
    offset += len;
    while (value.length > 32 && value[0] === 0) value = value.subarray(1);
    if (value.length > 32) throw new Error('bad der int length');
    return Buffer.concat([Buffer.alloc(32 - value.length), value]);
  };
  return Buffer.concat([readInt(), readInt()]);
}

function appleClientSecret(): string | null {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_DEVICECHECK_KEY_ID;
  const signingPem = envSigningPem(process.env.APPLE_DEVICECHECK_SIGNING_PEM);
  if (!teamId || !keyId || !signingPem) return null;
  const iat = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat }));
  const signingInput = `${header}.${payload}`;
  const derSignature = crypto.createSign('SHA256').update(signingInput).sign(signingPem);
  return `${signingInput}.${base64url(derToJose(derSignature))}`;
}

async function verifyAppleDeviceCheck(token: string, challengeId: string): Promise<boolean> {
  const jwt = appleClientSecret();
  if (!jwt) return false;
  const bundleId = process.env.APPLE_BUNDLE_ID || DEFAULT_BUNDLE_ID;
  const env = String(process.env.APPLE_DEVICECHECK_ENV ?? 'production').toLowerCase();
  const base =
    env === 'development'
      ? 'https://api.development.devicecheck.apple.com'
      : 'https://api.devicecheck.apple.com';
  const res = await fetch(`${base}/v1/validate_device_token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      device_token: token,
      transaction_id: challengeId,
      timestamp: Date.now(),
      bundle_id: bundleId,
    }),
    signal: AbortSignal.timeout(7000),
  });
  return res.ok;
}
