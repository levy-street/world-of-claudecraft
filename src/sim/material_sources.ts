// The canonical source-count algebra for a material stack: the ONE definition
// of how gathered units are attributed, coalesced, spent, diffed and replayed.
// Grants, bags, custody journals, save/load and presentation all read the same
// answer from here, so no two callers can invent their own bucket format.
//
// A composition is a canonically ordered list of {source, count} buckets whose
// counts are positive safe integers summing to the stack quantity. Identity is
// the WHOLE descriptor: the gatherer namespace, its stable id, the historic
// display-name SNAPSHOT taken at gather time, and the legacy premium signer.
// Two snapshots of one person never collapse (an older name is shown, never
// erased), and premium and plain material from the same gatherer stay apart
// because only one of them carries a signature's benefits. The stable id is
// kept for a future grouped display, which is why it is a field of its own
// rather than something derived from the name.
//
// `signer` is the OLD premium-signature field and stays exactly what it was:
// plainly gathered material carries a gatherer and NO signer, legacy signed
// stock projects {signer} with no fabricated gatherer, and legacy unsigned
// stock projects the empty descriptor {}. An empty-string signer is a legal
// legacy value: it keeps its own descriptor (never silently merged into the
// unrecorded bucket) and stays non-premium, matching the old truthiness test.
//
// Everything here is total and side-effect free: no host lookup, no clock, no
// rng, no DOM, no player-facing text. Every failure is an explicit result code
// (never a throw, never a clamp, never a relabel) and every failure leaves the
// caller's data exactly as it was. Returned values are freshly built and share
// no object with any input, so caller and callee can never alias a bucket.

import { isLegalCrafterName } from './professions/tools';

/**
 * Who gathered a unit. `character` is the live DB character id, the stable
 * identity a rename cannot move. `offline` and `headless` ids are identities
 * their host PERSISTS; a transient entity id is never durable identity and is
 * never minted here.
 */
export type MaterialGatherer =
  | { readonly kind: 'character'; readonly id: number; readonly name: string }
  | { readonly kind: 'offline' | 'headless'; readonly id: string; readonly name: string };

/** One bucket's provenance. Both fields absent means legacy unrecorded stock. */
export interface MaterialSource {
  readonly gatherer?: MaterialGatherer;
  readonly signer?: string;
}

/** A held bucket: `count` is a positive safe integer. */
export interface MaterialSourceCount {
  readonly source: MaterialSource;
  readonly count: number;
}

/** A journal leg: `count` is a nonzero safe integer, signed. */
export interface MaterialSourceDelta {
  readonly source: MaterialSource;
  readonly count: number;
}

/** Coalesced buckets in canonical key order; empty only for a zero stack. */
export type MaterialComposition = readonly MaterialSourceCount[];

/** The two halves of a take. Their buckets share no object. */
export interface MaterialTake {
  readonly taken: MaterialComposition;
  readonly remaining: MaterialComposition;
}

export type MaterialSourceError =
  | 'invalid-source'
  | 'unknown-field'
  | 'invalid-count'
  | 'count-overflow'
  | 'sum-mismatch'
  | 'negative-result'
  | 'insufficient';

export type MaterialSourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MaterialSourceError };

/** Host-supplied offline/headless ids: printable ASCII, nonempty, bounded. */
export const MAX_GATHERER_ID_LENGTH = 64;

const TIER_UNRECORDED = 0;
const TIER_RECORDED = 1;
const TIER_PREMIUM = 2;

const succeed = <T>(value: T): MaterialSourceResult<T> => ({ ok: true, value });
const fail = (error: MaterialSourceError): MaterialSourceResult<never> => ({ ok: false, error });

/**
 * An ORDINARY data record: an object literal, a JSON.parse result, or a
 * null-prototype bag. A Date, a Map, an array or a class instance is refused
 * outright rather than read as an empty descriptor, which is what a bare
 * `typeof === 'object'` test would silently do (a Date has no own keys, so it
 * would have passed every field check and coalesced with unrecorded stock).
 */
const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isPrintableAscii = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
};

/**
 * True for material a premium signature covers. Deliberately the OLD
 * truthiness rule: an empty-string signer is a legal legacy value that
 * conveys nothing, so it is not premium even though it keeps its descriptor.
 */
export function isPremiumMaterialSource(source: MaterialSource): boolean {
  return typeof source.signer === 'string' && source.signer.length > 0;
}

// Length-prefixed so no field boundary is ambiguous: an id of 'a' with name
// 'bc' can never encode the same as an id of 'ab' with name 'c'. Built from
// named fields, so property order in the input cannot change the key.
const part = (text: string): string => `${text.length}:${text}`;

/**
 * The canonical identity of a descriptor: deterministic, unambiguous, and
 * property-order independent. Keys are ASCII, so ordering them with `<`
 * is raw binary lexical order on every host. NEVER localeCompare: a locale
 * collation would reorder journals between machines.
 */
export function materialSourceKey(source: MaterialSource): string {
  const g = source.gatherer;
  const gatherer = g === undefined ? '' : `${part(g.kind)}${part(String(g.id))}${part(g.name)}`;
  const signer = source.signer === undefined ? '-' : part(source.signer);
  return `${part(gatherer)}${signer}`;
}

const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const cloneGatherer = (g: MaterialGatherer): MaterialGatherer =>
  g.kind === 'character'
    ? { kind: 'character', id: g.id, name: g.name }
    : { kind: g.kind, id: g.id, name: g.name };

const cloneSource = (source: MaterialSource): MaterialSource => {
  const out: { gatherer?: MaterialGatherer; signer?: string } = {};
  if (source.gatherer !== undefined) out.gatherer = cloneGatherer(source.gatherer);
  if (source.signer !== undefined) out.signer = source.signer;
  return out;
};

/** Sum of a validated composition's buckets. */
export function totalMaterialCount(composition: MaterialComposition): number {
  let total = 0;
  for (const entry of composition) total += entry.count;
  return total;
}

// ---------------------------------------------------------------------------
// Reading untrusted input into coalesced buckets
// ---------------------------------------------------------------------------

interface Bucket {
  readonly key: string;
  readonly source: MaterialSource;
  readonly count: number;
}

type BucketMap = Map<string, Bucket>;

function readGatherer(value: unknown): MaterialSourceResult<MaterialGatherer> {
  if (!isPlainRecord(value)) return fail('invalid-source');
  for (const key of Object.keys(value)) {
    if (key !== 'kind' && key !== 'id' && key !== 'name') return fail('unknown-field');
  }
  const { kind, id, name } = value;
  // The name is a SNAPSHOT of a real character name, so it answers to the
  // same shape the mint validates; a fresh record always carries one.
  if (typeof name !== 'string' || name.length === 0 || !isLegalCrafterName(name)) {
    return fail('invalid-source');
  }
  if (typeof kind !== 'string') return fail('invalid-source');
  if (kind === 'character') {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
      return fail('invalid-source');
    }
    return succeed({ kind: 'character', id, name });
  }
  if (kind === 'offline' || kind === 'headless') {
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      id.length > MAX_GATHERER_ID_LENGTH ||
      !isPrintableAscii(id)
    ) {
      return fail('invalid-source');
    }
    return succeed({ kind, id, name });
  }
  return fail('invalid-source');
}

function readSource(value: unknown): MaterialSourceResult<MaterialSource> {
  if (!isPlainRecord(value)) return fail('invalid-source');
  for (const key of Object.keys(value)) {
    if (key !== 'gatherer' && key !== 'signer') return fail('unknown-field');
  }
  const out: { gatherer?: MaterialGatherer; signer?: string } = {};
  if (value.signer !== undefined) {
    // isLegalCrafterName accepts the empty string, and that is deliberate:
    // it is a shape an old signed row really holds.
    if (!isLegalCrafterName(value.signer)) return fail('invalid-source');
    out.signer = value.signer;
  }
  if (value.gatherer !== undefined) {
    const gatherer = readGatherer(value.gatherer);
    if (!gatherer.ok) return gatherer;
    out.gatherer = gatherer.value;
  }
  return succeed(out);
}

/** One parsed {source, count} row; the count's SIGN rule is the caller's. */
interface ParsedEntry {
  readonly source: MaterialSource;
  readonly count: number;
}

function readEntry(value: unknown): MaterialSourceResult<ParsedEntry> {
  if (!isPlainRecord(value)) return fail('invalid-source');
  for (const key of Object.keys(value)) {
    if (key !== 'source' && key !== 'count') return fail('unknown-field');
  }
  const source = readSource(value.source);
  if (!source.ok) return source;
  if (typeof value.count !== 'number') return fail('invalid-count');
  return succeed({ source: source.value, count: value.count });
}

/** Adds into a bucket map, refusing a sum that leaves the safe integer range. */
function addBucket(buckets: BucketMap, source: MaterialSource, count: number): boolean {
  const key = materialSourceKey(source);
  const held = buckets.get(key);
  if (held === undefined) {
    buckets.set(key, { key, source, count });
    return true;
  }
  const next = held.count + count;
  if (!Number.isSafeInteger(next)) return false;
  buckets.set(key, { key, source: held.source, count: next });
  return true;
}

interface HeldBuckets {
  readonly buckets: BucketMap;
  readonly total: number;
}

/** Validates held buckets (positive safe integer counts) and coalesces them. */
function readHeld(value: unknown): MaterialSourceResult<HeldBuckets> {
  if (!Array.isArray(value)) return fail('invalid-source');
  const buckets: BucketMap = new Map();
  let total = 0;
  for (const raw of value) {
    const entry = readEntry(raw);
    if (!entry.ok) return entry;
    if (!Number.isSafeInteger(entry.value.count) || entry.value.count <= 0) {
      return fail('invalid-count');
    }
    total += entry.value.count;
    if (!Number.isSafeInteger(total)) return fail('count-overflow');
    if (!addBucket(buckets, entry.value.source, entry.value.count)) return fail('count-overflow');
  }
  return succeed({ buckets, total });
}

/** Validates signed legs (nonzero safe integer counts) and coalesces them. */
function readDeltas(value: unknown): MaterialSourceResult<BucketMap> {
  if (!Array.isArray(value)) return fail('invalid-source');
  const buckets: BucketMap = new Map();
  for (const raw of value) {
    const entry = readEntry(raw);
    if (!entry.ok) return entry;
    if (!Number.isSafeInteger(entry.value.count) || entry.value.count === 0) {
      return fail('invalid-count');
    }
    if (!addBucket(buckets, entry.value.source, entry.value.count)) return fail('count-overflow');
  }
  return succeed(buckets);
}

/** Canonical order, positive counts only, every value freshly owned. */
function finalize(buckets: BucketMap): MaterialComposition {
  const rows = [...buckets.values()].filter((bucket) => bucket.count > 0);
  rows.sort((a, b) => compareKeys(a.key, b.key));
  return rows.map((bucket) => ({ source: cloneSource(bucket.source), count: bucket.count }));
}

const copyBuckets = (buckets: BucketMap): BucketMap => new Map(buckets);

/**
 * The stack quantity a finished bucket map describes, or undefined when that
 * total leaves the safe integer range. Per-bucket arithmetic cannot see this:
 * two buckets can each be safe while their sum is not.
 *
 * Only the surviving POSITIVE counts are summed, and a positive-only sum is
 * monotone, so the answer never depends on the order the buckets are visited
 * and a balanced move (one bucket down, another up) is never rejected for an
 * intermediate the finished stack never holds.
 */
function safeBucketTotal(buckets: BucketMap): number | undefined {
  let total = 0;
  for (const bucket of buckets.values()) {
    if (bucket.count <= 0) continue;
    total += bucket.count;
    if (!Number.isSafeInteger(total)) return undefined;
  }
  return total;
}

// ---------------------------------------------------------------------------
// The operations
// ---------------------------------------------------------------------------

/**
 * The lossless legacy projection: `count` units carrying the stack's old
 * homogeneous `signer`, or the empty descriptor when it had none. No gatherer
 * is invented for legacy stock, because nobody recorded one.
 */
export function legacyMaterialComposition(
  count: number,
  signer?: string,
): MaterialSourceResult<MaterialComposition> {
  if (!Number.isSafeInteger(count) || count < 0) return fail('invalid-count');
  if (signer !== undefined && !isLegalCrafterName(signer)) return fail('invalid-source');
  if (count === 0) return succeed([]);
  const source: MaterialSource = signer === undefined ? {} : { signer };
  return succeed([{ source: cloneSource(source), count }]);
}

/**
 * Validates an unknown bucket list against the stack quantity it claims to
 * describe and returns it canonically ordered and coalesced. The empty
 * composition is valid only for a total of zero.
 */
export function canonicalMaterialComposition(
  value: unknown,
  expectedTotal: number,
): MaterialSourceResult<MaterialComposition> {
  const held = readHeld(value);
  if (!held.ok) return held;
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0) return fail('invalid-count');
  if (held.value.total !== expectedTotal) return fail('sum-mismatch');
  return succeed(finalize(held.value.buckets));
}

/** Combines two compositions, coalescing identical descriptors. */
export function mergeMaterialCompositions(
  left: MaterialComposition,
  right: MaterialComposition,
): MaterialSourceResult<MaterialComposition> {
  const a = readHeld(left);
  if (!a.ok) return a;
  const b = readHeld(right);
  if (!b.ok) return b;
  const merged = copyBuckets(a.value.buckets);
  for (const bucket of b.value.buckets.values()) {
    if (!addBucket(merged, bucket.source, bucket.count)) return fail('count-overflow');
  }
  if (safeBucketTotal(merged) === undefined) return fail('count-overflow');
  return succeed(finalize(merged));
}

/**
 * Spend order for an unspecified take: unrecorded material first, then other
 * plain material, then premium. Premium units are the ones a player would
 * miss, so nothing else is allowed to consume them first.
 */
function takeTier(source: MaterialSource): number {
  if (isPremiumMaterialSource(source)) return TIER_PREMIUM;
  if (source.gatherer === undefined && source.signer === undefined) return TIER_UNRECORDED;
  return TIER_RECORDED;
}

/**
 * That same spend order as a comparator, for a caller choosing units ACROSS
 * stacks (material_inventory_take.ts) rather than within one composition:
 * unrecorded material first, then other plain material, then premium, with the
 * canonical key breaking ties. Both readings run through the one `takeTier`
 * above, so the rule still has a single definition here.
 */
export function compareMaterialSpendOrder(a: MaterialSource, b: MaterialSource): number {
  return takeTier(a) - takeTier(b) || compareKeys(materialSourceKey(a), materialSourceKey(b));
}

/** The default take: exactly `count` units, in the deterministic spend order. */
export function takeMaterialCount(
  composition: MaterialComposition,
  count: number,
): MaterialSourceResult<MaterialTake> {
  const held = readHeld(composition);
  if (!held.ok) return held;
  if (!Number.isSafeInteger(count) || count < 0) return fail('invalid-count');
  if (count > held.value.total) return fail('insufficient');

  const ordered = [...held.value.buckets.values()].sort(
    (a, b) => takeTier(a.source) - takeTier(b.source) || compareKeys(a.key, b.key),
  );
  const taken: BucketMap = new Map();
  const remaining: BucketMap = new Map();
  let owed = count;
  for (const bucket of ordered) {
    const spend = Math.min(owed, bucket.count);
    if (spend > 0) taken.set(bucket.key, { ...bucket, count: spend });
    const rest = bucket.count - spend;
    if (rest > 0) remaining.set(bucket.key, { ...bucket, count: rest });
    owed -= spend;
  }
  return succeed({ taken: finalize(taken), remaining: finalize(remaining) });
}

/**
 * An explicitly chosen take: exactly the selected quantity of exactly the
 * selected descriptors. A short bucket fails the whole take rather than
 * substituting another source, because the caller asked for those units.
 */
export function takeSelectedMaterialSources(
  composition: MaterialComposition,
  selections: readonly MaterialSourceCount[],
): MaterialSourceResult<MaterialTake> {
  const held = readHeld(composition);
  if (!held.ok) return held;
  const wanted = readHeld(selections);
  if (!wanted.ok) return wanted;

  const remaining = copyBuckets(held.value.buckets);
  for (const want of wanted.value.buckets.values()) {
    const bucket = remaining.get(want.key);
    if (bucket === undefined || bucket.count < want.count) return fail('insufficient');
    const rest = bucket.count - want.count;
    if (rest === 0) remaining.delete(want.key);
    else remaining.set(want.key, { ...bucket, count: rest });
  }
  return succeed({ taken: finalize(wanted.value.buckets), remaining: finalize(remaining) });
}

/**
 * The signed legs that turn `before` into `after`: one nonzero entry per
 * changed descriptor, so a one-unit top-up journals as one unit rather than
 * as a whole-stack rewrite.
 */
export function diffMaterialCompositions(
  before: MaterialComposition,
  after: MaterialComposition,
): MaterialSourceResult<readonly MaterialSourceDelta[]> {
  const from = readHeld(before);
  if (!from.ok) return from;
  const to = readHeld(after);
  if (!to.ok) return to;

  const rows: { key: string; source: MaterialSource; count: number }[] = [];
  const keys = new Set([...from.value.buckets.keys(), ...to.value.buckets.keys()]);
  for (const key of keys) {
    const oldBucket = from.value.buckets.get(key);
    const newBucket = to.value.buckets.get(key);
    const delta = (newBucket?.count ?? 0) - (oldBucket?.count ?? 0);
    if (delta === 0) continue;
    if (!Number.isSafeInteger(delta)) return fail('count-overflow');
    const source = (newBucket ?? oldBucket)?.source;
    if (source === undefined) continue;
    rows.push({ key, source, count: delta });
  }
  rows.sort((a, b) => compareKeys(a.key, b.key));
  return succeed(rows.map((row) => ({ source: cloneSource(row.source), count: row.count })));
}

/**
 * Applies signed legs atomically: any leg that overflows or drives a bucket
 * negative fails the whole application, and the input is never touched.
 */
export function applyMaterialSourceDeltas(
  composition: MaterialComposition,
  deltas: readonly MaterialSourceDelta[],
): MaterialSourceResult<MaterialComposition> {
  const held = readHeld(composition);
  if (!held.ok) return held;
  const legs = readDeltas(deltas);
  if (!legs.ok) return legs;

  const next = copyBuckets(held.value.buckets);
  for (const leg of legs.value.values()) {
    const bucket = next.get(leg.key);
    const result = (bucket?.count ?? 0) + leg.count;
    if (!Number.isSafeInteger(result)) return fail('count-overflow');
    if (result < 0) return fail('negative-result');
    if (result === 0) next.delete(leg.key);
    else next.set(leg.key, { key: leg.key, source: bucket?.source ?? leg.source, count: result });
  }
  // Judged on the FINISHED buckets, never on a running signed subtotal: the
  // legs of a balanced move arrive in no guaranteed order.
  if (safeBucketTotal(next) === undefined) return fail('count-overflow');
  return succeed(finalize(next));
}
