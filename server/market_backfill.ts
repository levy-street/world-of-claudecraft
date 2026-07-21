// Partitioned World Market backfill.
//
// Before realm scoping, every realm process on one DATABASE_URL persisted the
// market to the single world_state row 'market' (last writer wins). The keys
// are realm-scoped now (market:<realm>); this module migrates a surviving
// pre-scoping global row by PARTITIONING it per seller realm, once, inside
// ensureSchema's pg_advisory_xact_lock transaction, and records completion in
// a marker row so every later boot is a no-op. The legacy row is RETAINED
// (never deleted) as the rollback artifact; see
// docs/api-pipeline/phase-20-rollback-runbook.md.
//
// This is a *_db-style module: SQL runs against an INJECTED client (type-only
// usage of pg shapes), and it never imports db.ts, mirroring ratelimit_db.ts,
// so db.ts can import the constants and the runner without a cycle.
import type { MarketSave } from '../src/sim/sim';

// FROZEN CONTRACT: every exported name and signature in this file is shared
// between db.ts, the backfill tests, and the isolation tests. Keep the names
// and shapes exactly as written.

export const MARKET_KEY_PREFIX = 'market:';
export const LEGACY_MARKET_KEY = 'market';
export const MARKET_BACKFILL_MARKER_KEY = 'market_backfill_done';

export function marketStateKey(realm: string): string {
  return `${MARKET_KEY_PREFIX}${realm}`;
}

// Minimal query surface of a pg PoolClient inside the ensureSchema
// transaction; tests fake this with a plain object.
export interface MarketBackfillClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface MarketTotals {
  listingCount: number;
  collectionCount: number;
  escrowCopper: number;
  escrowItemCount: number;
}

export interface MarketPartitionPlan {
  byRealm: Record<string, MarketSave>;
  // Seller keys that could not be resolved to a realm (unknown character id,
  // unknown or realm-ambiguous character name, or the '' house key). They are
  // ROUTED TO THE FALLBACK REALM, never dropped, and logged as a count.
  unresolvedSellerKeys: string[];
  globalTotals: MarketTotals;
  perRealmTotals: Record<string, MarketTotals>;
}

export interface MarketBackfillResult {
  // true when this call performed (or, under dryRun, computed) the partition
  // work; false when the marker row already existed and the call was a no-op.
  ran: boolean;
  dryRun: boolean;
  legacyRowFound: boolean;
  plan: MarketPartitionPlan | null;
}

// The exact saveWorldState upsert (server/db.ts). Kept as a literal here so the
// backfill never imports db.ts; the pinning test asserts the shared fragments.
const WORLD_STATE_UPSERT_SQL = `INSERT INTO world_state (key, data, updated_at) VALUES ($1, $2, now())
ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;

// A collection row as it rides in MarketSave (key + copper + InvSlot items).
type MarketCollectionSave = MarketSave['collections'][number];

// Coerce a persisted numeric field to a finite number, defaulting to 0. A raw
// JSONB blob can carry a surprising value; treating it the same everywhere
// keeps computeMarketTotals additive (and therefore conservation exact).
function numberOr0(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function computeMarketTotals(save: MarketSave): MarketTotals {
  const listings = save.listings ?? [];
  const collections = save.collections ?? [];
  let escrowCopper = 0;
  let escrowItemCount = 0;
  for (const l of listings) escrowItemCount += numberOr0(l.count);
  for (const c of collections) {
    escrowCopper += numberOr0(c.copper);
    for (const s of c.items ?? []) {
      if (!s) continue; // skip null/empty slots defensively
      escrowItemCount += numberOr0(s.count);
    }
  }
  return {
    listingCount: listings.length,
    collectionCount: collections.length,
    escrowCopper,
    escrowItemCount,
  };
}

// Distinct seller keys needing realm resolution: listings[].sellerKey plus
// collections[].key.
export function collectSellerKeys(save: MarketSave): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  const add = (k: string): void => {
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  for (const l of save.listings ?? []) add(l.sellerKey);
  for (const c of save.collections ?? []) add(c.key);
  return keys;
}

// Split the global blob per seller realm. Every partition inherits the global
// nextListingId. Keys absent from realmBySellerKey go to fallbackRealm and
// are recorded in unresolvedSellerKeys.
export function partitionMarketSave(
  save: MarketSave,
  realmBySellerKey: ReadonlyMap<string, string>,
  fallbackRealm: string,
): MarketPartitionPlan {
  const byRealm: Record<string, MarketSave> = {};
  const seenUnresolved = new Set<string>();
  const unresolvedSellerKeys: string[] = [];
  const nextListingId = save.nextListingId; // global, inherited unchanged

  const partitionFor = (realm: string): MarketSave => {
    let p = byRealm[realm];
    if (!p) {
      p = { listings: [], collections: [], nextListingId };
      byRealm[realm] = p;
    }
    return p;
  };

  const realmFor = (key: string): string => {
    const resolved = realmBySellerKey.get(key);
    if (resolved !== undefined) return resolved;
    if (!seenUnresolved.has(key)) {
      seenUnresolved.add(key);
      unresolvedSellerKeys.push(key);
    }
    return fallbackRealm;
  };

  for (const l of save.listings ?? []) partitionFor(realmFor(l.sellerKey)).listings.push(l);
  for (const c of save.collections ?? []) partitionFor(realmFor(c.key)).collections.push(c);

  const perRealmTotals: Record<string, MarketTotals> = {};
  for (const [realm, part] of Object.entries(byRealm)) {
    perRealmTotals[realm] = computeMarketTotals(part);
  }

  return {
    byRealm,
    unresolvedSellerKeys,
    globalTotals: computeMarketTotals(save),
    perRealmTotals,
  };
}

// Merge a partition into an ALREADY EXISTING realm row (reachable only from a
// mixed-version fleet that recreated the legacy row after a realm key was
// written). Base is `existing`; incoming listing ids are remapped
// sequentially from existing.nextListingId; collections merge by key (copper
// summed, items concatenated). Must conserve totals (existing + incoming).
export function mergeMarketSaves(existing: MarketSave, incoming: MarketSave): MarketSave {
  const existingNext = existing.nextListingId;
  const existingListings = existing.listings ?? [];
  const incomingListings = incoming.listings ?? [];

  // Existing listings keep their ids; incoming ids are remapped sequentially
  // from existing.nextListingId so there is no collision. A healthy blob keeps
  // nextListingId > every listing id (the sim recomputes it on serialize), but
  // a corrupt or hand-edited row could violate that, so clamp the remap start
  // above the max existing id. Clone every object so the inputs are never
  // mutated.
  const listings = existingListings.map((l) => ({ ...l }));
  let nextId = existingNext;
  for (const l of existingListings) {
    if (numberOr0(l.id) >= nextId) nextId = numberOr0(l.id) + 1;
  }
  for (const l of incomingListings) {
    listings.push({ ...l, id: nextId });
    nextId++;
  }

  // Collections merge by key: existing rows keep their order (copper summed and
  // items concatenated when the incoming partition shares a key), net-new
  // incoming keys append at the end.
  const cloneCollection = (c: MarketCollectionSave): MarketCollectionSave => ({
    key: c.key,
    copper: c.copper,
    items: (c.items ?? []).map((s) => ({ ...s })),
  });
  const collections: MarketCollectionSave[] = [];
  const byKey = new Map<string, MarketCollectionSave>();
  for (const c of existing.collections ?? []) {
    const clone = cloneCollection(c);
    collections.push(clone);
    byKey.set(clone.key, clone);
  }
  for (const c of incoming.collections ?? []) {
    const found = byKey.get(c.key);
    if (found) {
      found.copper += numberOr0(c.copper);
      for (const s of c.items ?? []) found.items.push({ ...s });
    } else {
      const clone = cloneCollection(c);
      collections.push(clone);
      byKey.set(clone.key, clone);
    }
  }

  return {
    listings,
    collections,
    nextListingId: nextId,
  };
}

// Conservation check consumed by the dry-run log, the runner (which throws on
// a mismatch BEFORE writing), and the regression tests. `actual` is the sum
// over all partitions.
export function verifyPartitionConservation(
  global: MarketSave,
  byRealm: Record<string, MarketSave>,
): { ok: boolean; expected: MarketTotals; actual: MarketTotals } {
  const expected = computeMarketTotals(global);
  const actual: MarketTotals = {
    listingCount: 0,
    collectionCount: 0,
    escrowCopper: 0,
    escrowItemCount: 0,
  };
  for (const part of Object.values(byRealm)) {
    const t = computeMarketTotals(part);
    actual.listingCount += t.listingCount;
    actual.collectionCount += t.collectionCount;
    actual.escrowCopper += t.escrowCopper;
    actual.escrowItemCount += t.escrowItemCount;
  }
  const ok =
    actual.listingCount === expected.listingCount &&
    actual.collectionCount === expected.collectionCount &&
    actual.escrowCopper === expected.escrowCopper &&
    actual.escrowItemCount === expected.escrowItemCount;
  return { ok, expected, actual };
}

// Resolve every seller key to a realm via the characters table. Numeric keys
// are character ids (characters.id is a SERIAL/int column); name-form keys are
// legacy character names. Both queries are intentionally realm-UNFILTERED (the
// per-realm helpers in db.ts filter by the process realm; the backfill must see
// every realm's characters). A name present on more than one realm is
// ambiguous and left UNRESOLVED (never guessed); the '' house key resolves to
// nothing by construction and routes to the fallback realm.
async function resolveSellerRealms(
  client: MarketBackfillClient,
  sellerKeys: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // A numeric key must also fit int4 (characters.id is SERIAL): a corrupted
  // blob carrying an out-of-range digit string would otherwise make Postgres
  // reject the ANY($1::int[]) cast and crash-loop boot; keeping it out of both
  // queries degrades it to the unresolved -> fallback-realm rule instead.
  const isResolvableId = (k: string): boolean =>
    /^[0-9]+$/.test(k) && Number.isSafeInteger(Number(k)) && Number(k) <= 2147483647;
  const numericKeys = sellerKeys.filter(isResolvableId);
  const nameKeys = sellerKeys.filter((k) => k.length > 0 && !/^[0-9]+$/.test(k));

  if (numericKeys.length > 0) {
    const res = await client.query('SELECT id, realm FROM characters WHERE id = ANY($1::int[])', [
      numericKeys.map((k) => Number(k)),
    ]);
    for (const row of res.rows) {
      // pg returns int4 as a number and BIGINT as a string; normalize to the
      // String form the seller key uses so the map lookup matches either way.
      map.set(String(row.id), String(row.realm));
    }
  }

  if (nameKeys.length > 0) {
    const res = await client.query('SELECT name, realm FROM characters WHERE name = ANY($1)', [
      nameKeys,
    ]);
    const realmsByName = new Map<string, Set<string>>();
    for (const row of res.rows) {
      const name = String(row.name);
      let realms = realmsByName.get(name);
      if (!realms) {
        realms = new Set<string>();
        realmsByName.set(name, realms);
      }
      realms.add(String(row.realm));
    }
    for (const [name, realms] of realmsByName) {
      // Exactly one realm resolves; more than one is ambiguous and stays out of
      // the map (routed to the fallback realm, recorded as unresolved).
      if (realms.size === 1) map.set(name, [...realms][0]);
    }
  }

  return map;
}

async function upsertWorldState(
  client: MarketBackfillClient,
  key: string,
  data: unknown,
): Promise<void> {
  await client.query(WORLD_STATE_UPSERT_SQL, [key, JSON.stringify(data)]);
}

// Run once inside ensureSchema's advisory-lock transaction:
// 1. If the marker row exists: return { ran: false } issuing no other SQL.
// 2. SELECT the legacy row FOR UPDATE (serializes against a not-yet-upgraded
//    process's lazy claim transaction).
// 3. Resolve each seller key to a realm via the characters table (numeric
//    keys by id, others by name; a name matching characters on more than one
//    realm is UNRESOLVED), partition, verify conservation (throw on
//    mismatch), and under dryRun log the per-realm plan and STOP (no writes,
//    no marker).
// 4. Write each partition to marketStateKey(realm) (merging via
//    mergeMarketSaves when the realm row already exists), then INSERT the
//    marker row with { backfilledBy, legacyRowFound, perRealmTotals,
//    unresolvedCount }. The legacy row is NEVER deleted or modified.
export async function runMarketBackfill(opts: {
  client: MarketBackfillClient;
  realm: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}): Promise<MarketBackfillResult> {
  const { client, realm } = opts;
  const dryRun = !!opts.dryRun;
  const log = opts.log ?? ((line: string) => console.log(line));

  // 1. Marker already present: this migration ran on an earlier boot. No-op,
  // issuing no other SQL.
  const markerRes = await client.query('SELECT data FROM world_state WHERE key = $1', [
    MARKET_BACKFILL_MARKER_KEY,
  ]);
  if (markerRes.rows.length > 0) {
    return { ran: false, dryRun, legacyRowFound: false, plan: null };
  }

  // 2. Claim the pre-scoping legacy row FOR UPDATE. The row lock serializes
  // against a not-yet-upgraded realm's lazy claim transaction so only one
  // process ever partitions it.
  const legacyRes = await client.query('SELECT data FROM world_state WHERE key = $1 FOR UPDATE', [
    LEGACY_MARKET_KEY,
  ]);
  const legacyRow = legacyRes.rows[0];
  if (!legacyRow) {
    // Nothing to partition. Under dryRun, report and stop without writing.
    if (dryRun) {
      log('market backfill (dry run): no legacy market row to partition');
      return { ran: true, dryRun: true, legacyRowFound: false, plan: null };
    }
    // Record the marker so a later legacy row (from a rolled-back process) can
    // never be re-adopted after this migration has been declared complete.
    await upsertWorldState(client, MARKET_BACKFILL_MARKER_KEY, {
      backfilledBy: realm,
      legacyRowFound: false,
      perRealmTotals: {},
      unresolvedCount: 0,
    });
    return { ran: true, dryRun: false, legacyRowFound: false, plan: null };
  }

  const legacy = legacyRow.data as MarketSave;

  // 3. Resolve realms, partition, and verify conservation before any write.
  const realmBySellerKey = await resolveSellerRealms(client, collectSellerKeys(legacy));
  const plan = partitionMarketSave(legacy, realmBySellerKey, realm);
  const conservation = verifyPartitionConservation(legacy, plan.byRealm);
  if (!conservation.ok) {
    throw new Error(
      `market backfill conservation check failed: expected ${JSON.stringify(
        conservation.expected,
      )} got ${JSON.stringify(conservation.actual)}`,
    );
  }

  const realms = Object.keys(plan.byRealm).sort();

  // Under dryRun, log the plan and STOP: no partition writes, no marker.
  if (dryRun) {
    for (const r of realms) {
      const t = plan.perRealmTotals[r];
      log(
        `market backfill (dry run): realm ${r} listings ${t.listingCount} escrow ${t.escrowCopper} copper`,
      );
    }
    log(
      `market backfill (dry run): ${plan.unresolvedSellerKeys.length} unresolved seller keys routed to ${realm}`,
    );
    return { ran: true, dryRun: true, legacyRowFound: true, plan };
  }

  // 4. Write each partition (merging into an existing realm row if present),
  // then record the completion marker. The legacy row is left untouched.
  for (const r of realms) {
    const partition = plan.byRealm[r];
    const key = marketStateKey(r);
    const existingRes = await client.query('SELECT data FROM world_state WHERE key = $1', [key]);
    const existing = existingRes.rows[0]?.data as MarketSave | undefined;
    const data = existing ? mergeMarketSaves(existing, partition) : partition;
    await upsertWorldState(client, key, data);
  }
  await upsertWorldState(client, MARKET_BACKFILL_MARKER_KEY, {
    backfilledBy: realm,
    legacyRowFound: true,
    perRealmTotals: plan.perRealmTotals,
    unresolvedCount: plan.unresolvedSellerKeys.length,
  });
  log(
    `market backfill: partitioned into ${realms.length} realm(s), ${plan.unresolvedSellerKeys.length} unresolved seller keys routed to ${realm}`,
  );
  return { ran: true, dryRun: false, legacyRowFound: true, plan };
}
