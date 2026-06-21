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

export function resolveRealmType(raw: string | undefined): RealmType {
  const t = (raw ?? '').trim();
  return (REALM_TYPES as readonly string[]).includes(t) ? (t as RealmType) : 'Normal';
}

export const REALM_TYPE_LIST: readonly RealmType[] = REALM_TYPES;

// This process's own realm type (used for the single-realm default directory).
export const REALM_TYPE: RealmType = resolveRealmType(process.env.REALM_TYPE);

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
export const REALM_ORIGINS: ReadonlySet<string> = new Set(REALM_DIRECTORY.map((r) => r.url).filter(Boolean));

export function publicOriginForRealm(realm: string, directory: readonly RealmEntry[]): string {
  return directory.find((entry) => entry.name === realm && entry.url)?.url ?? '';
}

export const CONFIGURED_PUBLIC_ORIGIN = resolvePublicOrigin(process.env.PUBLIC_ORIGIN);
export const REALM_PUBLIC_ORIGIN = CONFIGURED_PUBLIC_ORIGIN || publicOriginForRealm(REALM, REALM_DIRECTORY);

// ---------------------------------------------------------------------------
// Realm registry — realms as first-class, ownable entities (#475).
//
// The env directory above is operator-pinned infrastructure. A realm can also
// be a player-provisioned, owned entity backed by a `realms` row (see
// server/realm_db.ts) with a lifecycle, an owner, a tier, delegated roles, and
// a stable per-realm world seed. The two are merged for the realm-list screen
// by `mergeRealmDirectory` below. The types + pure helpers live here (no SQL);
// the persistence lives in realm_db.ts.
// ---------------------------------------------------------------------------

// Realm lifecycle. A registry realm is born `provisioning` (stake quote issued,
// lock not yet confirmed), goes `active` on a confirmed stake, `decommissioning`
// while its unstake timelock runs, `lapsed` if frozen for a ToS violation
// (gameplay frozen, funds untouched), and `closed` once decommissioned.
export type RealmStatus = 'provisioning' | 'active' | 'decommissioning' | 'lapsed' | 'closed';
export const REALM_STATUSES: readonly RealmStatus[] = [
  'provisioning',
  'active',
  'decommissioning',
  'lapsed',
  'closed',
];

export function isRealmStatus(raw: string): raw is RealmStatus {
  return (REALM_STATUSES as readonly string[]).includes(raw);
}

// Delegated operator roles. `owner` is the stake wallet's account; `moderator`
// and `builder` are invited so a guild can collectively run a realm (moderate
// chat, spend customization budget) without ever sharing the stake wallet.
export type RealmRole = 'owner' | 'moderator' | 'builder';
export const REALM_ROLES: readonly RealmRole[] = ['owner', 'moderator', 'builder'];

export function isRealmRole(raw: string): raw is RealmRole {
  return (REALM_ROLES as readonly string[]).includes(raw);
}

// The canonical world seed of the single-shard default realm. Historically this
// was hard-coded in server/game.ts and src/main.ts (World of ClaudeCraft is a
// persistent place). It stays the seed of the default realm so its world is
// byte-identical; provisioned realms derive a distinct, stable seed below.
export const BASE_WORLD_SEED = 20061;

// Deterministically derive a realm's world seed from its name. The default
// realm keeps BASE_WORLD_SEED so its world never changes; any other realm gets
// a stable, name-derived seed (FNV-1a folded with the base) clamped to a
// positive 31-bit integer, so it slots into the Sim's numeric seed exactly like
// the hand-picked default and reproduces the same procedural world on every
// boot. Pure + deterministic: the persisted `realms.world_seed` and any process
// booting that realm compute the identical value without a DB round-trip.
export function worldSeedForRealm(name: string): number {
  const resolved = resolveRealm(name);
  if (resolved === DEFAULT_REALM_NAME) return BASE_WORLD_SEED;
  let h = 0x811c9dc5; // FNV-1a offset basis
  const s = resolved.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x0100_0193); // FNV prime
  }
  h ^= BASE_WORLD_SEED;
  const seed = (h >>> 0) % 0x7fff_ffff;
  return seed === 0 ? 1 : seed;
}

// A registry realm reduced to the fields the realm-list screen needs.
export interface DbRealmSummary {
  realmId: number;
  name: string;
  type: RealmType;
  originUrl: string;
  status: RealmStatus;
  ownerAccountId: number | null;
  tier: number;
}

// A realm-list entry enriched with its registry identity. Existing clients read
// `name`/`url`/`type` (the RealmEntry shape); the extra fields are additive so a
// newer client can show ownership, tier, and provisioning state.
export interface DirectoryEntry extends RealmEntry {
  realmId: number | null; // null for an env-only realm with no registry row
  status: RealmStatus; // env-only realms are implicitly active
  owned: boolean; // player-provisioned (has an owner account)
  tier: number; // 0 for env / system realms
}

// Merge the operator-pinned env directory with player-provisioned registry
// realms for the realm-list screen. Env entries are canonical and come first
// (their pinned origin URL wins, but a matching registry row enriches them with
// id/owner/tier/status); player-provisioned realms not pinned in env follow,
// but only while `active`. De-duped case-insensitively by name.
export function mergeRealmDirectory(
  env: readonly RealmEntry[],
  db: readonly DbRealmSummary[],
): DirectoryEntry[] {
  const byName = new Map<string, DbRealmSummary>();
  for (const r of db) byName.set(r.name.toLowerCase(), r);

  const out: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const e of env) {
    const key = e.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const row = byName.get(key);
    out.push({
      name: e.name,
      url: e.url,
      type: e.type,
      realmId: row?.realmId ?? null,
      status: row?.status ?? 'active',
      owned: row != null && row.ownerAccountId != null,
      tier: row?.tier ?? 0,
    });
  }
  for (const r of db) {
    const key = r.name.toLowerCase();
    if (seen.has(key) || r.status !== 'active') continue;
    seen.add(key);
    out.push({
      name: r.name,
      url: r.originUrl,
      type: r.type,
      realmId: r.realmId,
      status: r.status,
      owned: r.ownerAccountId != null,
      tier: r.tier,
    });
  }
  return out;
}
