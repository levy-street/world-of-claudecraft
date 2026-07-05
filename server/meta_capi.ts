import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const DEFAULT_PIXEL_ID = '1692101265042180';
const DEFAULT_API_VERSION = 'v21.0';
const SEND_TIMEOUT_MS = 3000;

const PIXEL_ID = process.env.META_CAPI_PIXEL_ID ?? DEFAULT_PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN ?? '';
const TEST_CODE = process.env.META_CAPI_TEST_EVENT_CODE ?? '';
const API_VERSION = process.env.META_CAPI_API_VERSION ?? DEFAULT_API_VERSION;
const ENABLED = ACCESS_TOKEN.length > 0;

if (!ENABLED) {
  console.log('[capi] META_CAPI_ACCESS_TOKEN unset; Conversions API disabled.');
}

export interface CapiUserData {
  email?: string | null;
  externalId?: string | null;
  clientIp?: string | null;
  clientUserAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

export interface CapiEvent {
  eventName: string;
  eventId: string;
  eventTime?: number;
  eventSourceUrl?: string;
  actionSource?: 'website' | 'app' | 'other';
  userData: CapiUserData;
  customData?: Record<string, unknown>;
}

export interface RequestMetaForCapi {
  ip?: string;
  userAgent?: string;
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function hashedMetaValue(value?: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? sha256(normalized) : undefined;
}

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function metaCookieData(
  cookieHeader: string | string[] | undefined,
): Pick<CapiUserData, 'fbp' | 'fbc'> {
  const cookie = firstHeader(cookieHeader);
  if (!cookie) return {};
  const out: Pick<CapiUserData, 'fbp' | 'fbc'> = {};
  for (const part of cookie.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim();
    if (!key || (key !== '_fbp' && key !== '_fbc')) continue;
    const value = safeDecode(rest.join('=').trim());
    if (!value) continue;
    if (key === '_fbp') out.fbp = value;
    if (key === '_fbc') out.fbc = value;
  }
  return out;
}

export function metaEventSourceUrl(req: IncomingMessage): string | undefined {
  const referer = firstHeader(req.headers.referer);
  if (/^https?:\/\//i.test(referer)) return referer.slice(0, 2048);
  const origin = firstHeader(req.headers.origin);
  if (/^https?:\/\//i.test(origin)) return origin.slice(0, 2048);
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  if (!host) return undefined;
  const protoHeader = firstHeader(req.headers['x-forwarded-proto']);
  const proto =
    protoHeader.split(',')[0]?.trim() || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host.split(',')[0]?.trim()}/`.slice(0, 2048);
}

export function metaRequestUserData(req: IncomingMessage, meta: RequestMetaForCapi): CapiUserData {
  return {
    clientIp: meta.ip,
    clientUserAgent: meta.userAgent,
    ...metaCookieData(req.headers.cookie),
  };
}

export function buildCapiPayload(ev: CapiEvent): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  const em = hashedMetaValue(ev.userData.email);
  const externalId = hashedMetaValue(ev.userData.externalId);
  if (em) userData.em = [em];
  if (externalId) userData.external_id = [externalId];
  if (ev.userData.clientIp) userData.client_ip_address = ev.userData.clientIp;
  if (ev.userData.clientUserAgent) userData.client_user_agent = ev.userData.clientUserAgent;
  if (ev.userData.fbp) userData.fbp = ev.userData.fbp;
  if (ev.userData.fbc) userData.fbc = ev.userData.fbc;

  const event: Record<string, unknown> = {
    event_name: ev.eventName,
    event_time: ev.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: ev.eventId,
    action_source: ev.actionSource ?? 'website',
    user_data: userData,
  };
  if (ev.eventSourceUrl) event.event_source_url = ev.eventSourceUrl;
  if (ev.customData) event.custom_data = ev.customData;

  return {
    data: [event],
    ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}),
  };
}

export async function sendCapiEvent(ev: CapiEvent): Promise<void> {
  if (!ENABLED) return;
  const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(
    ACCESS_TOKEN,
  )}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildCapiPayload(ev)),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[capi] ${ev.eventName} rejected ${res.status}: ${text.slice(0, 500)}`);
    }
  } catch (err) {
    console.warn(`[capi] ${ev.eventName} send failed:`, (err as Error)?.message ?? err);
  } finally {
    clearTimeout(timeout);
  }
}

export function trackAccountCreated(
  accountId: number | string,
  userData: CapiUserData,
  sourceUrl?: string,
): Promise<void> {
  const id = String(accountId);
  return sendCapiEvent({
    eventName: 'AccountCreated',
    eventId: `acct_${id}`,
    eventSourceUrl: sourceUrl,
    userData: { externalId: id, ...userData },
  });
}

export function trackReachedLevel5(
  characterId: number | string,
  userData: CapiUserData,
  sourceUrl?: string,
): Promise<void> {
  const id = String(characterId);
  return sendCapiEvent({
    eventName: 'ReachedLevel5',
    eventId: `lvl5_${id}`,
    eventSourceUrl: sourceUrl,
    userData: { externalId: id, ...userData },
    customData: { milestone: 'level_5' },
  });
}
