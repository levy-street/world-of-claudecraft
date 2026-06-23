// Skin-atlas validation + SSRF-safe remote fetch for the self-hosted mode.
//
// A creator-supplied PNG must conform to the body-UV atlas (1024² or 512², a
// real non-interlaced PNG within a decoded-byte ceiling). For self-hosted, the
// server fetches the creator's URL — an SSRF surface — so the fetch refuses
// non-http(s), literal private/reserved IPs, hostnames that RESOLVE to private
// IPs, and follows no redirects (a public host can't 302 to an internal one).
// The pure helpers (PNG validation, IP classification, URL shape) are unit-tested.
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { parsePngInfo } from './http_util';

export const ALLOWED_SKIN_DIMENSIONS = [
  { width: 1024, height: 1024 },
  { width: 512, height: 512 },
] as const;
export const MAX_SKIN_BYTES = 6 * 1024 * 1024;
// RGBA (4 bytes) + 1 filter byte per row, at the largest accepted dimension.
const MAX_SKIN_DECODED_BYTES = (1024 * 4 + 1) * 1024;
const FETCH_TIMEOUT_MS = 8000;

export type SkinValidation =
  | { ok: true; sha256: string; width: number; height: number }
  | { ok: false; reason: 'too_large' | 'invalid_png' };

/** Validate bytes as a conforming skin atlas; returns its content hash on success. */
export function validateSkinPng(buf: Buffer): SkinValidation {
  if (buf.length > MAX_SKIN_BYTES) return { ok: false, reason: 'too_large' };
  const info = parsePngInfo(buf, {
    allowedDimensions: ALLOWED_SKIN_DIMENSIONS.map((d) => ({ ...d })),
    maxDecodedBytes: MAX_SKIN_DECODED_BYTES,
  });
  if (!info) return { ok: false, reason: 'invalid_png' };
  return { ok: true, sha256: createHash('sha256').update(buf).digest('hex'), width: info.width, height: info.height };
}

// --- SSRF guard --------------------------------------------------------------

/** A reserved/private/loopback/link-local IPv4 that must never be fetched. */
export function isBlockedIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return true; // malformed -> block
  const [a, b] = o;
  return (
    a === 0 || a === 10 || a === 127 || // this-net, private, loopback
    (a === 169 && b === 254) || // link-local (incl. 169.254.169.254 metadata)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 192 && b === 0) || // 192.0.0/24 + 192.0.2/24 special-use
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved + 255.255.255.255
  );
}

/** A reserved/private/loopback/link-local IPv6 (incl. IPv4-mapped) to block. */
export function isBlockedIpv6(ip: string): boolean {
  const lc = ip.toLowerCase();
  if (lc === '::1' || lc === '::') return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lc);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const head = lc.split(':')[0] ?? '';
  if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) return true; // fe80::/10 link-local
  if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 ULA
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return ip.includes(':') ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

/** Parse a string as an http(s) URL, or null. */
export function asHttpUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

export type UrlSafetyReason = 'url_not_http' | 'url_unresolved' | 'url_private_host';

/** Resolve + vet a creator URL for fetching. Throws an Error whose message is a
 *  UrlSafetyReason on any failure. Returns the parsed URL when safe. */
export async function assertSafePublicUrl(raw: string): Promise<URL> {
  const url = asHttpUrl(raw);
  if (!url) throw new Error('url_not_http');
  // Block a literal private host before any DNS work.
  if (isBlockedIp(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('url_private_host');
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.length === 0) throw new Error('url_unresolved');
  for (const a of addrs) if (isBlockedIp(a.address)) throw new Error('url_private_host');
  return url;
}

/** SSRF-safe fetch of a remote image: vetted host, no redirects, size + time
 *  bounded. Returns the raw bytes (caller then validates the PNG). */
export async function fetchRemoteImage(raw: string): Promise<Buffer> {
  const url = await assertSafePublicUrl(raw);
  return fetchBounded(url, { redirect: 'error' });
}

// A plain bounded fetch for a TRUSTED, server-configured URL (our IPFS gateway) —
// no SSRF vetting needed because the host isn't creator-supplied.
async function fetchBounded(url: URL | string, opts: { redirect: RequestRedirect }): Promise<Buffer> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: opts.redirect, signal: ac.signal });
    if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
    if (Number(res.headers.get('content-length') ?? '0') > MAX_SKIN_BYTES) throw new Error('too_large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_SKIN_BYTES) throw new Error('too_large');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

// Bounded LRU of served atlas bytes so a hot skin isn't re-fetched from the
// origin / gateway every render (and survives a brief gateway blip once warm).
const MAX_CACHED_ATLASES = 64;
const atlasCache = new Map<string, Buffer>();
const atlasLru: string[] = [];
function cacheAtlas(key: string, bytes: Buffer): void {
  const i = atlasLru.indexOf(key);
  if (i >= 0) atlasLru.splice(i, 1);
  atlasLru.push(key);
  atlasCache.set(key, bytes);
  while (atlasLru.length > MAX_CACHED_ATLASES) {
    const evict = atlasLru.shift();
    if (evict !== undefined) atlasCache.delete(evict);
  }
}

/** Load the atlas bytes for a skin's source, cached by a stable key (sha256/cid).
 *  self_hosted goes through the SSRF-safe fetch; hosted (gatewayUrl) is a trusted
 *  bounded fetch. Returns null when neither source is set. */
export async function loadAtlasBytes(opts: { key: string; originUrl?: string | null; gatewayUrl?: string | null }): Promise<Buffer | null> {
  const hit = atlasCache.get(opts.key);
  if (hit) { cacheAtlas(opts.key, hit); return hit; }
  let bytes: Buffer | null = null;
  if (opts.gatewayUrl) bytes = await fetchBounded(opts.gatewayUrl, { redirect: 'follow' });
  else if (opts.originUrl) bytes = await fetchRemoteImage(opts.originUrl);
  if (bytes) cacheAtlas(opts.key, bytes);
  return bytes;
}
