// The account ledger: the ACCOUNT-scoped record behind the Book of Deeds and
// the Reliquary. Both books are shared across every character on an account,
// and every entry remembers WHICH characters earned it (a deed) or found it
// (a relic), in the order they did.
//
// Scope model, stated once:
// - The GRANT lane stays per character. The deeds evaluator (deeds.ts) and the
//   Reliquary fill paths (reliquary.ts) still decide from the acting
//   character's own state, so a character is listed as an earner only when it
//   accomplished the thing itself. Nothing here can grant, deny, or mutate a
//   deed or a relic fill.
// - The DISPLAY and ownership lane is account-wide. The two books, the
//   cosmetic pickers (titles, borders), completion meters and Curator rank all
//   read the UNION of the character's own state and this ledger.
//
// The ledger is INPUT to the sim, never sim-derived truth: the server loads it
// from the character_deeds and account_relic_finds tables at join
// (server/account_ledger_db.ts) and hands it to Sim.addPlayer; the sim appends
// the acting character's own grants as they happen so both hosts read the
// same union within the same tick. It is never serialized into CharacterState
// (it is account state, not character state), and it never carries text a
// player sees beyond character names.
//
// Determinism: pure data plus deterministic appends; no clock (the day stamp
// is the host utcDay every grant already uses) and no randomness.

import type { PlayerClass } from './types';

/** One character's entry against a deed or relic: who, and on which utcDay
 *  ('YYYY-MM-DD', '' when the host set no calendar). `characterId` is the
 *  authoritative row id online and 0 for the offline sandbox's one player. */
export interface AccountEarner {
  characterId: number;
  name: string;
  cls: PlayerClass;
  day: string;
}

/** The relic kinds the ledger records. Weapon skins are already account
 *  cosmetics and titles are deeds, so neither needs a relic row. */
export type AccountRelicKind = 'item' | 'mark' | 'mount';

export interface AccountLedger {
  /** deed id -> earners, first earner first. */
  deeds: Map<string, AccountEarner[]>;
  /** relic key (accountRelicKey) -> finders, first finder first. */
  relics: Map<string, AccountEarner[]>;
}

export function freshAccountLedger(): AccountLedger {
  return { deeds: new Map(), relics: new Map() };
}

/** The one key shape for relic rows: `<kind>:<id>`. The kind prefix keeps an
 *  item id and a mount key that happen to share a string apart, and lets the
 *  union lookups below filter one kind without a second map. */
export function accountRelicKey(kind: AccountRelicKind, id: string): string {
  return `${kind}:${id}`;
}

/** The earner record for the acting character. Offline the sandbox character
 *  has no authoritative id and lands as 0. */
export function selfEarner(
  meta: Readonly<{ characterId?: number; name: string; cls: PlayerClass }>,
  day: string,
): AccountEarner {
  return { characterId: meta.characterId ?? 0, name: meta.name, cls: meta.cls, day };
}

// Wire memo, keyed by ledger identity: every append bumps the rev; the heavy
// self gate re-runs on a staggered refresh even when nothing moved, and the
// JSON is rebuilt only when the rev moved (the reliquaryWireJson doctrine).
const ledgerRev = new WeakMap<AccountLedger, number>();
const ledgerWireCache = new WeakMap<AccountLedger, { rev: number; json: string }>();

function bumpRev(ledger: AccountLedger): void {
  ledgerRev.set(ledger, (ledgerRev.get(ledger) ?? 0) + 1);
}

/** Monotonic change counter for a ledger (0 for a fresh one). Mirrors and
 *  repaint signatures fold it in so a change on another character of the
 *  account repaints an open book without walking the maps. */
export function accountLedgerRev(ledger: AccountLedger): number {
  return ledgerRev.get(ledger) ?? 0;
}

function appendEarner(
  map: Map<string, AccountEarner[]>,
  key: string,
  earner: AccountEarner,
): boolean {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [earner]);
    return true;
  }
  for (const existing of list) {
    if (existing.characterId === earner.characterId) return false;
  }
  list.push(earner);
  return true;
}

/** Record a deed earner. Idempotent per (deed, character): a repeat is a
 *  no-op that keeps the first-recorded day. @returns true when a new entry
 *  landed. */
export function recordAccountDeed(
  ledger: AccountLedger,
  deedId: string,
  earner: AccountEarner,
): boolean {
  if (!appendEarner(ledger.deeds, deedId, earner)) return false;
  bumpRev(ledger);
  return true;
}

/** Record a relic finder under an accountRelicKey. Same idempotence contract
 *  as recordAccountDeed. */
export function recordAccountRelic(
  ledger: AccountLedger,
  relicKey: string,
  earner: AccountEarner,
): boolean {
  if (!appendEarner(ledger.relics, relicKey, earner)) return false;
  bumpRev(ledger);
  return true;
}

/** Fold every entry of `from` into `into` (dedupe per character, order kept:
 *  existing earners stay ahead of merged ones). Used at join to fold the
 *  retro pass's own-character appends over the rows the server loaded. */
export function mergeAccountLedger(into: AccountLedger, from: AccountLedger): void {
  let changed = false;
  for (const [id, earners] of from.deeds) {
    for (const earner of earners) if (appendEarner(into.deeds, id, earner)) changed = true;
  }
  for (const [key, earners] of from.relics) {
    for (const earner of earners) if (appendEarner(into.relics, key, earner)) changed = true;
  }
  if (changed) bumpRev(into);
}

// ---------------------------------------------------------------------------
// Wire shape: the `acct` heavy self key. Tuples keep a veteran account's
// ledger compact (hundreds of deeds times a few characters).
// ---------------------------------------------------------------------------

/** [characterId, name, cls, day] */
export type AccountEarnerWire = [number, string, string, string];

export interface AccountLedgerWire {
  d: Record<string, AccountEarnerWire[]>;
  r: Record<string, AccountEarnerWire[]>;
}

function earnersWire(list: readonly AccountEarner[]): AccountEarnerWire[] {
  return list.map((e) => [e.characterId, e.name, e.cls, e.day]);
}

export function serializeAccountLedger(ledger: AccountLedger): AccountLedgerWire {
  const d: Record<string, AccountEarnerWire[]> = {};
  const r: Record<string, AccountEarnerWire[]> = {};
  for (const [id, earners] of ledger.deeds) d[id] = earnersWire(earners);
  for (const [key, earners] of ledger.relics) r[key] = earnersWire(earners);
  return { d, r };
}

/** The `acct` blob as JSON, built once per change (see the memo note above).
 *  Byte-identical to JSON.stringify(serializeAccountLedger(ledger)). */
export function accountLedgerWireJson(ledger: AccountLedger): string {
  const rev = accountLedgerRev(ledger);
  const cached = ledgerWireCache.get(ledger);
  if (cached !== undefined && cached.rev === rev) return cached.json;
  const json = JSON.stringify(serializeAccountLedger(ledger));
  ledgerWireCache.set(ledger, { rev, json });
  return json;
}

function restoreEarners(raw: unknown): AccountEarner[] {
  const out: AccountEarner[] = [];
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    const [cid, name, cls, day] = entry as unknown[];
    if (typeof cid !== 'number' || !Number.isFinite(cid)) continue;
    if (typeof name !== 'string' || typeof cls !== 'string' || typeof day !== 'string') continue;
    if (out.some((e) => e.characterId === cid)) continue;
    out.push({ characterId: cid, name, cls: cls as PlayerClass, day });
  }
  return out;
}

function restoreMap(raw: unknown): Map<string, AccountEarner[]> {
  const map = new Map<string, AccountEarner[]>();
  if (raw === null || typeof raw !== 'object') return map;
  // Own keys only: the wire is untrusted at the client edge, and a prototype
  // key must never become a ledger id.
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    const earners = restoreEarners((raw as Record<string, unknown>)[key]);
    if (earners.length > 0) map.set(key, earners);
  }
  return map;
}

/** Rebuild a ledger from the wire blob. Malformed input degrades to an empty
 *  ledger, never a throw (the mirror keeps working with what it has). */
export function restoreAccountLedger(raw: unknown): AccountLedger {
  if (raw === null || typeof raw !== 'object') return freshAccountLedger();
  const wire = raw as Partial<AccountLedgerWire>;
  return { deeds: restoreMap(wire.d), relics: restoreMap(wire.r) };
}

// ---------------------------------------------------------------------------
// Pure union reads: the account-wide ownership the display lane consumes.
// ---------------------------------------------------------------------------

/** Any set-like container (a Set, a Map, an itemsDiscovered ledger). */
export interface HasLookup {
  has(id: string): boolean;
}

/** An ownership lookup that answers true when the character's own surface
 *  holds the id OR the ledger records a find of that kind by any character
 *  on the account. A live view: both inputs are read on every call, so an
 *  append on either side is visible without rebuilding. */
export function accountRelicLookup(
  own: HasLookup,
  ledger: Readonly<{ relics: HasLookup }>,
  kind: AccountRelicKind,
): HasLookup {
  return {
    has: (id: string) => own.has(id) || ledger.relics.has(accountRelicKey(kind, id)),
  };
}

/** The deed twin of accountRelicLookup: earned by this character or by any
 *  character on the account. */
export function accountDeedLookup(
  own: HasLookup,
  ledger: Readonly<{ deeds: HasLookup }>,
): HasLookup {
  return { has: (id: string) => own.has(id) || ledger.deeds.has(id) };
}

/** Every deed id the account has earned, with the day it was FIRST earned on
 *  the account: the character's own day where it has one, else the first
 *  ledger earner's day. Insertion order: the character's own earns first (the
 *  grant order the offline recent strip relies on), then account-only earns
 *  in ledger order. */
export function accountEarnedDays(
  own: ReadonlyMap<string, string>,
  ledger: Readonly<{ deeds: ReadonlyMap<string, readonly AccountEarner[]> }>,
): Map<string, string> {
  const out = new Map(own);
  for (const [id, earners] of ledger.deeds) {
    if (out.has(id)) continue;
    out.set(id, earners[0]?.day ?? '');
  }
  return out;
}

/** True when `earners` lists the given character. */
export function earnedByCharacter(
  earners: readonly AccountEarner[] | undefined,
  characterId: number,
): boolean {
  return earners !== undefined && earners.some((e) => e.characterId === characterId);
}
