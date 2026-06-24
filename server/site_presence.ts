import { createHash } from 'node:crypto';
import type * as http from 'node:http';
import { recordSitePresence } from './admin_db';
import { json, readBody } from './http_util';
import { requestIp } from './ratelimit';

const VISITOR_ID_RE = /^[a-zA-Z0-9_-]{16,80}$/;
const PAGE_RE = /^[a-z0-9][a-z0-9/_-]{0,63}$/;

export function cleanSiteVisitorId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return VISITOR_ID_RE.test(trimmed) ? trimmed : null;
}

export function cleanSitePresencePage(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9/_-]/g, '-');
  return PAGE_RE.test(normalized) ? normalized.slice(0, 64) : 'unknown';
}

export function hashPresenceText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export async function handleSitePresenceHeartbeat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
  const body = await readBody(req, 1024);
  const visitorId = cleanSiteVisitorId(body.visitorId);
  if (!visitorId) return json(res, 400, { ok: false, error: 'invalid visitor id' });
  await recordSitePresence({
    visitorId,
    page: cleanSitePresencePage(body.page),
    ipHash: hashPresenceText(requestIp(req)),
    userAgentHash: hashPresenceText(String(req.headers['user-agent'] ?? '')),
  });
  return json(res, 200, { ok: true });
}
