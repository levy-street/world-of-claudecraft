import type * as http from 'node:http';
import { DEFAULT_RAID_RESET_TIME_ZONE, isSupportedTimeZone } from './raid_reset';

// The realm (world/shard) this server process serves. In the process-per-realm
// model each instance hosts exactly one realm — set REALM_NAME per deployment
// (e.g. a Caddy vhost or compose service per realm), all pointing at the same
// database. Characters, friends, guilds, and presence are all scoped to this
// value, so two processes with different REALM_NAME share a DB yet form fully
// isolated worlds. Defaults to a single realm for local dev / single-shard prod.

export const DEFAULT_REALM_NAME = 'Claudemoon';

export function resolveRealm(rawName: string | undefined): string {
  const raw = (rawName ?? '').trim();
  // realm names are short, human display strings (letters, digits, spaces, a
  // couple of punctuation marks à la "Area 52" / "Mal'Ganis"); fall back rather
  // than boot a process with a nonsense realm
  if (raw && raw.length <= 24 && /^[A-Za-z0-9][A-Za-z0-9 '_-]*$/.test(raw)) return raw;
  return DEFAULT_REALM_NAME;
}

export const REALM = resolveRealm(process.env.REALM_NAME);

// Classic-MMO realm types. Normal == PvE.
export type RealmType = 'Normal' | 'PvP' | 'RP' | 'RP-PvP';
const REALM_TYPES: readonly RealmType[] = ['Normal', 'PvP', 'RP', 'RP-PvP'];

function resolveRealmType(raw: string | undefined): RealmType {
  const t = (raw ?? '').trim();
  return (REALM_TYPES as readonly string[]).includes(t) ? (t as RealmType) : 'Normal';
}

// This process's own realm type (used for the single-realm default directory).
export const REALM_TYPE: RealmType = resolveRealmType(process.env.REALM_TYPE);

// The civil time zone whose 3 AM daily reset ends this realm's raid lockouts (a fixed
// reset, classic-style). Each realm process sets REALM_RESET_TZ to its own IANA zone
// (e.g. "Europe/Paris" for an EU realm), so a realm resets on its local server time
// rather than a single global boundary; defaults to US Eastern (the launch region).
// Requires a full-ICU Node: an unresolvable configured zone falls back to the default,
// and if the runtime cannot resolve even the default we fail fast at boot rather than
// crash on the first boss kill.
export function resolveRaidResetTimeZone(raw: string | undefined): string {
  const zone = (raw ?? '').trim();
  if (zone) {
    if (isSupportedTimeZone(zone)) return zone;
    console.warn(
      `REALM_RESET_TZ "${zone}" is not a resolvable IANA time zone; falling back to ${DEFAULT_RAID_RESET_TIME_ZONE}.`,
    );
  }
  if (!isSupportedTimeZone(DEFAULT_RAID_RESET_TIME_ZONE)) {
    throw new Error(
      `Raid reset time zone ${DEFAULT_RAID_RESET_TIME_ZONE} is unavailable: run a full-ICU Node build.`,
    );
  }
  return DEFAULT_RAID_RESET_TIME_ZONE;
}

export const REALM_RESET_TIME_ZONE: string = resolveRaidResetTimeZone(process.env.REALM_RESET_TZ);

export function resolvePublicOrigin(rawOrigin: string | undefined): string {
  const trimmed = (rawOrigin ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export interface RealmEntry {
  name: string;
  // origin a client should connect to for this realm (e.g.
  // "https://ironforge.example.com"); '' means "same origin as this page",
  // used for the single-realm default
  url: string;
  type: RealmType;
}

// The realm directory drives the client's classic-MMO-style realm-list screen.
// Configure it with REALMS as a comma-separated list of `Name=https://host=Type`
// entries (Type optional, defaults Normal), e.g.
//   REALMS="Claudemoon=https://claudemoon.example.com=Normal,Ironforge=https://ironforge.example.com=PvP"
// Every realm process shares the same DATABASE_URL and serves the same
// directory, so a client on any of them can discover and switch to the others.
// Unset → a single same-origin realm (this process), i.e. no cross-realm UI.
function parseRealms(raw: string | undefined): RealmEntry[] {
  const out: RealmEntry[] = [];
  for (const part of (raw ?? '').split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const fields = seg.split('=').map((s) => s.trim());
    if (fields.length < 2) continue;
    const name = resolveRealm(fields[0]);
    const rawUrl = fields[1];
    const url = resolvePublicOrigin(rawUrl);
    if (rawUrl && !url) continue; // must be a bare origin
    if (out.some((e) => e.name === name)) continue;
    out.push({ name, url, type: resolveRealmType(fields[2]) });
  }
  return out;
}

export const REALM_DIRECTORY: RealmEntry[] = (() => {
  const parsed = parseRealms(process.env.REALMS);
  return parsed.length > 0 ? parsed : [{ name: REALM, url: '', type: REALM_TYPE }];
})();

// Cross-origin requests from these realm origins are allowed (CORS), so a
// client served by one realm can call another realm's API after switching.
export const REALM_ORIGINS: ReadonlySet<string> = new Set(
  REALM_DIRECTORY.map((r) => r.url).filter(Boolean),
);

// Public, unauthenticated read surfaces that any browser origin may call (CORS
// `*`): the public character sheet and the deterministic avatar art. These carry
// no credentials and expose only the public subset, so reflecting any origin is
// safe and lets companion web apps / extensions / IDE webviews read them
// client-side. Mutating and owner-scoped routes are NOT here — they keep the
// narrow realm/native allowlist (cookieless bearer auth) in main.ts's maybeCors.
const PUBLIC_CORS_PREFIXES = ['/api/public/', '/avatar/'];

export function isPublicCorsPath(path: string): boolean {
  return PUBLIC_CORS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function publicOriginForRealm(realm: string, directory: readonly RealmEntry[]): string {
  return directory.find((entry) => entry.name === realm && entry.url)?.url ?? '';
}

export const CONFIGURED_PUBLIC_ORIGIN = resolvePublicOrigin(process.env.PUBLIC_ORIGIN);
export const REALM_PUBLIC_ORIGIN =
  CONFIGURED_PUBLIC_ORIGIN || publicOriginForRealm(REALM, REALM_DIRECTORY);

const DEFAULT_PRODUCTION_PUBLIC_ORIGIN = 'https://worldofclaudecraft.com';
const TRUSTED_PUBLIC_HOST_ORIGINS = new Map([
  ['worldofclaudecraft.com', DEFAULT_PRODUCTION_PUBLIC_ORIGIN],
  ['www.worldofclaudecraft.com', DEFAULT_PRODUCTION_PUBLIC_ORIGIN],
  ['dev.worldofclaudecraft.com', 'https://dev.worldofclaudecraft.com'],
]);

function firstHeaderValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).split(',')[0].trim();
}

function trustedPublicOriginFromHost(req: http.IncomingMessage): string {
  const raw = firstHeaderValue(req.headers.host).toLowerCase();
  const host = raw.includes(':') ? raw.split(':')[0] : raw;
  return TRUSTED_PUBLIC_HOST_ORIGINS.get(host) ?? '';
}

export function publicOriginFromRequest(req: http.IncomingMessage): string {
  if (REALM_PUBLIC_ORIGIN) return REALM_PUBLIC_ORIGIN;
  if (process.env.NODE_ENV === 'production') {
    return trustedPublicOriginFromHost(req) || DEFAULT_PRODUCTION_PUBLIC_ORIGIN;
  }
  const fwd = firstHeaderValue(req.headers['x-forwarded-proto']).toLowerCase();
  const proto =
    fwd === 'http' || fwd === 'https'
      ? fwd
      : (req.socket as { encrypted?: boolean } | undefined)?.encrypted
        ? 'https'
        : 'http';
  const host = firstHeaderValue(req.headers.host) || 'localhost';
  return `${proto}://${host}`;
}
