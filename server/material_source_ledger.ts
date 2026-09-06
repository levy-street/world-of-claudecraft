// The source-ledger core: PROJECT a container's material slots into canonical
// per-payload entries, DIFF two containers into movement rows, REPLAY a batch of
// rows onto a projection. Preparatory: pure data in, explicit result out, no
// storage and no runtime caller yet.
//
// Identity is the payload (material_payload_identity.ts); provenance is the exact
// composition, summed and diffed only through the shared source algebra
// (material_sources.ts). So adding one unit journals one unit, a re-attribution
// that moves no quantity still journals (count 0, one negative leg and one
// positive leg), and a pure regrouping journals nothing at all.
//
// Every refusal is total: a malformed slot or descriptor, a row whose legs do not
// sum to its own count, an overdraw, or a resulting holding outside the safe
// integer range refuses the WHOLE call and leaves the caller's data untouched.
// Nothing clamps, clips or half-applies.
//
// Replay is BATCH level: rows for one payload coalesce into ONE source update, so
// a deposit and a withdraw that cancel can never read as an intermediate
// overdraw, in any arrival order. Counts and legs accumulate as exact BigInt
// internally and convert back only once the coalesced net is inside the safe
// range (a net outside it cannot describe a legal holding), while the final held
// total stays the source algebra's judgement. No BigInt reaches a return value.
//
// Ordering ACROSS batches (epochs, revisions, the durable sequence a writer
// replays in) is deliberately not modelled here.

import {
  cloneMaterialPayload,
  type MaterialPayloadIdentity,
  materialPayloadKey,
} from '../src/sim/material_payload_identity';
import {
  applyMaterialSourceDeltas,
  canonicalMaterialComposition,
  diffMaterialCompositions,
  type MaterialComposition,
  type MaterialSource,
  type MaterialSourceDelta,
  materialSourceKey,
  mergeMaterialCompositions,
  totalMaterialCount,
} from '../src/sim/material_sources';
import {
  type MaterialStackError,
  type MaterialStackSlot,
  normalizeMaterialStack,
} from '../src/sim/material_stack';
import type { ItemInstancePayload } from '../src/sim/types';

/** One payload's whole holding in a container: the summed count and the exact
 *  summed composition behind it. Satisfies `MaterialPayloadIdentity`, so
 *  `materialPayloadKey(entry)` is its stable ledger key. */
export interface MaterialLedgerEntry extends MaterialPayloadIdentity {
  readonly count: number;
  readonly sources: MaterialComposition;
}

/** A container's material holdings, one entry per payload, in stable key order.
 *  Non-material slots are not represented at all. */
export interface MaterialContainerProjection {
  readonly entries: readonly MaterialLedgerEntry[];
}

/** One payload's movement between two projections. `count` is after minus
 *  before and MAY be 0: a row with no quantity change but changed descriptors is
 *  how a re-attribution is journalled. Its legs must sum to its own count. */
export interface MaterialMovementRow extends MaterialPayloadIdentity {
  readonly count: number;
  readonly sourceDeltas: readonly MaterialSourceDelta[];
}

export type MaterialLedgerError =
  /** Two entries of one opening projection claim the same payload. */
  | 'duplicate-entry'
  /** A row's legs do not sum to its count, or a batch's net disagrees with the
   *  total change it makes. */
  | 'count-mismatch'
  | MaterialStackError;

export type MaterialLedgerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MaterialLedgerError };

const succeed = <T>(value: T): MaterialLedgerResult<T> => ({ ok: true, value });
const fail = (error: MaterialLedgerError): MaterialLedgerResult<never> => ({ ok: false, error });

/** Binary lexical order on the ASCII keys; never localeCompare. */
const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Exact inside the safe range, undefined outside it: a count that far out can
 *  never describe a legal holding, so it refuses rather than rounding. */
function toSafeCount(value: bigint): number | undefined {
  if (value > MAX_SAFE || value < -MAX_SAFE) return undefined;
  return Number(value);
}

/** The identity fields only, payload deep-copied, absent fields left absent. */
function identityOf(source: MaterialPayloadIdentity): MaterialPayloadIdentity {
  const out: { itemId: string; instance?: ItemInstancePayload; craftedRecipeId?: string } = {
    itemId: source.itemId,
  };
  if (source.instance !== undefined) out.instance = cloneMaterialPayload(source.instance);
  if (source.craftedRecipeId !== undefined) out.craftedRecipeId = source.craftedRecipeId;
  return out;
}

/** One payload's holding while it is being built up. */
interface Group {
  readonly identity: MaterialPayloadIdentity;
  readonly sources: MaterialComposition;
  readonly count: number;
}

/** Canonical order, one fresh entry per payload, every composition re-read
 *  through the algebra so the result shares no object with any input and its
 *  count can never drift from its sources. */
function buildProjection(
  groups: ReadonlyMap<string, Group>,
): MaterialLedgerResult<MaterialContainerProjection> {
  const ordered = [...groups.entries()].sort((a, b) => compareKeys(a[0], b[0]));
  const entries: MaterialLedgerEntry[] = [];
  for (const [, group] of ordered) {
    if (group.count === 0) continue;
    const canonical = canonicalMaterialComposition(group.sources, group.count);
    if (!canonical.ok) return fail(canonical.error);
    entries.push({ ...group.identity, count: group.count, sources: canonical.value });
  }
  return succeed({ entries });
}

/**
 * Every material slot the container holds, normalized and grouped by payload
 * identity. Non-material slots are SKIPPED (this model does not own them); a
 * material slot the model cannot read refuses the whole container, because a
 * projection missing one stack is a wrong ledger, not a partial one. Manual
 * separation is ignored: it is container grouping, never accounting.
 */
export function projectMaterialContainer(
  slots: readonly MaterialStackSlot[],
  materialIds: ReadonlySet<string>,
): MaterialLedgerResult<MaterialContainerProjection> {
  const groups = new Map<string, Group>();
  for (const slot of slots) {
    if (!materialIds.has(slot.itemId)) continue;
    const normalized = normalizeMaterialStack(slot, materialIds);
    if (!normalized.ok) return fail(normalized.error);

    const stack = normalized.value;
    const sources = stack.materialSources ?? [];
    const key = materialPayloadKey(stack);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { identity: identityOf(stack), sources, count: stack.count });
      continue;
    }
    const merged = mergeMaterialCompositions(existing.sources, sources);
    if (!merged.ok) return fail(merged.error);
    groups.set(key, {
      identity: existing.identity,
      sources: merged.value,
      count: totalMaterialCount(merged.value),
    });
  }
  return buildProjection(groups);
}

function indexEntries(projection: MaterialContainerProjection): Map<string, MaterialLedgerEntry> {
  const index = new Map<string, MaterialLedgerEntry>();
  for (const entry of projection.entries) index.set(materialPayloadKey(entry), entry);
  return index;
}

/**
 * The movement rows that turn one container into the other, in stable key order.
 * A row is emitted when the count moved OR the descriptors moved, so a balanced
 * re-attribution survives as a count-0 row while splitting, combining,
 * separating or re-celling a stack emits nothing.
 */
export function planMaterialContainerTransition(
  beforeSlots: readonly MaterialStackSlot[],
  afterSlots: readonly MaterialStackSlot[],
  materialIds: ReadonlySet<string>,
): MaterialLedgerResult<{
  readonly opening: MaterialContainerProjection;
  readonly movements: readonly MaterialMovementRow[];
}> {
  const before = projectMaterialContainer(beforeSlots, materialIds);
  if (!before.ok) return before;
  const after = projectMaterialContainer(afterSlots, materialIds);
  if (!after.ok) return after;

  const from = indexEntries(before.value);
  const to = indexEntries(after.value);
  const keys = [...new Set([...from.keys(), ...to.keys()])].sort(compareKeys);

  const rows: MaterialMovementRow[] = [];
  for (const key of keys) {
    const held = from.get(key);
    const next = to.get(key);
    const identity = next ?? held;
    if (identity === undefined) continue;

    const deltas = diffMaterialCompositions(held?.sources ?? [], next?.sources ?? []);
    if (!deltas.ok) return fail(deltas.error);
    const count = (next?.count ?? 0) - (held?.count ?? 0);
    if (count === 0 && deltas.value.length === 0) continue;
    rows.push({ ...identityOf(identity), count, sourceDeltas: deltas.value });
  }
  return succeed({ opening: before.value, movements: rows });
}

/** Public delta-only view of the same validated transition. */
export function diffMaterialContainers(
  beforeSlots: readonly MaterialStackSlot[],
  afterSlots: readonly MaterialStackSlot[],
  materialIds: ReadonlySet<string>,
): MaterialLedgerResult<readonly MaterialMovementRow[]> {
  const transition = planMaterialContainerTransition(beforeSlots, afterSlots, materialIds);
  return transition.ok ? succeed(transition.value.movements) : transition;
}

/** A validated opening projection, keyed by payload. */
function readOpening(
  opening: MaterialContainerProjection,
): MaterialLedgerResult<Map<string, Group>> {
  const groups = new Map<string, Group>();
  for (const entry of opening.entries) {
    if (!Number.isSafeInteger(entry.count) || entry.count <= 0) return fail('invalid-count');
    const canonical = canonicalMaterialComposition(entry.sources, entry.count);
    if (!canonical.ok) return fail(canonical.error);
    const key = materialPayloadKey(entry);
    if (groups.has(key)) return fail('duplicate-entry');
    groups.set(key, { identity: identityOf(entry), sources: canonical.value, count: entry.count });
  }
  return succeed(groups);
}

/** One validated leg: the shared descriptor identity plus its exact count. */
interface ReadLeg {
  readonly key: string;
  readonly source: MaterialSource;
  readonly count: bigint;
}

/** One validated row: internally consistent before it can join a batch. */
interface ReadRow {
  readonly key: string;
  readonly identity: MaterialPayloadIdentity;
  readonly legs: readonly ReadLeg[];
  readonly count: bigint;
}

/** One payload's coalesced batch: the net legs to apply and the net count they
 *  are claimed to move. */
interface Batch {
  readonly identity: MaterialPayloadIdentity;
  readonly legs: readonly MaterialSourceDelta[];
  readonly net: number;
}

/** Reads one signed leg through the shared algebra: descriptor shape, unknown
 *  fields and the nonzero-safe-integer count rule, validated even when the batch
 *  will later cancel this leg away. */
function readLeg(leg: MaterialSourceDelta): MaterialLedgerResult<ReadLeg> {
  if (!Number.isSafeInteger(leg.count) || leg.count === 0) return fail('invalid-count');
  const magnitude = Math.abs(leg.count);
  const checked = canonicalMaterialComposition([{ ...leg, count: magnitude }], magnitude);
  if (!checked.ok) return fail(checked.error);
  if (checked.value.length !== 1) return fail('invalid-source');
  const { source } = checked.value[0];
  return succeed({ key: materialSourceKey(source), source, count: BigInt(leg.count) });
}

/** Every descriptor is validated FIRST, then the row's own legs must sum exactly
 *  to its count: a row is consistent on its own, so two malformed rows can never
 *  cancel each other's discrepancy inside a batch. */
function readRow(row: MaterialMovementRow): MaterialLedgerResult<ReadRow> {
  if (!Number.isSafeInteger(row.count)) return fail('invalid-count');
  const legs: ReadLeg[] = [];
  let sum = 0n;
  for (const leg of row.sourceDeltas) {
    const read = readLeg(leg);
    if (!read.ok) return read;
    legs.push(read.value);
    sum += read.value.count;
  }
  if (sum !== BigInt(row.count)) return fail('count-mismatch');
  return succeed({ key: materialPayloadKey(row), identity: identityOf(row), legs, count: sum });
}

/** Private accumulators; exact and order independent, so nothing depends on the
 *  order a batch's deposit and withdraw legs arrive in. */
interface BatchAccumulator {
  readonly identity: MaterialPayloadIdentity;
  count: bigint;
  readonly legs: Map<string, { readonly source: MaterialSource; count: bigint }>;
}

/** Rows for one payload become ONE net update. */
function coalesceRows(
  rows: readonly MaterialMovementRow[],
): MaterialLedgerResult<Map<string, Batch>> {
  const accumulated = new Map<string, BatchAccumulator>();
  for (const row of rows) {
    const read = readRow(row);
    if (!read.ok) return read;

    let batch = accumulated.get(read.value.key);
    if (batch === undefined) {
      batch = { identity: read.value.identity, count: 0n, legs: new Map() };
      accumulated.set(read.value.key, batch);
    }
    batch.count += read.value.count;
    for (const leg of read.value.legs) {
      const held = batch.legs.get(leg.key);
      if (held === undefined) batch.legs.set(leg.key, { source: leg.source, count: leg.count });
      else held.count += leg.count;
    }
  }

  const batches = new Map<string, Batch>();
  for (const [key, batch] of accumulated) {
    const net = toSafeCount(batch.count);
    if (net === undefined) return fail('count-overflow');
    const legs: MaterialSourceDelta[] = [];
    for (const [, leg] of [...batch.legs.entries()].sort((a, b) => compareKeys(a[0], b[0]))) {
      if (leg.count === 0n) continue;
      const count = toSafeCount(leg.count);
      if (count === undefined) return fail('count-overflow');
      legs.push({ source: leg.source, count });
    }
    batches.set(key, { identity: batch.identity, legs, net });
  }
  return succeed(batches);
}

/**
 * Replays a whole batch of movement rows onto an opening projection and returns
 * a FRESH projection, or refuses the batch entirely: the opening is only read,
 * and the first refusal returns before anything is built.
 *
 * Each payload's rows are coalesced, then applied as one source update. An
 * overdraw, a malformed descriptor, an inconsistent row and a resulting holding
 * outside the safe integer range all refuse the whole batch; a count-0 row that
 * only moves descriptors is accepted.
 */
export function applyMaterialContainerDeltas(
  opening: MaterialContainerProjection,
  rows: readonly MaterialMovementRow[],
): MaterialLedgerResult<MaterialContainerProjection> {
  const held = readOpening(opening);
  if (!held.ok) return held;
  const batches = coalesceRows(rows);
  if (!batches.ok) return batches;

  const next = new Map(held.value);
  for (const [key, batch] of batches.value) {
    const current = next.get(key);
    const applied = applyMaterialSourceDeltas(current?.sources ?? [], batch.legs);
    if (!applied.ok) return fail(applied.error);

    const beforeCount = current?.count ?? 0;
    const afterCount = totalMaterialCount(applied.value);
    // Redundant by construction (every row was checked against its own legs);
    // kept as the seam invariant between the count side and the source side.
    if (afterCount - beforeCount !== batch.net) return fail('count-mismatch');

    if (afterCount === 0) {
      next.delete(key);
      continue;
    }
    next.set(key, {
      identity: current?.identity ?? batch.identity,
      sources: applied.value,
      count: afterCount,
    });
  }
  return buildProjection(next);
}
