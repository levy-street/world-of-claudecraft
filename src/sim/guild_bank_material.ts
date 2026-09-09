// The guild book's MATERIAL arm: the one place a guild bank op delta's exact
// per-source legs are read, applied to a book, inverted, and re-attributed on
// load. The guild book is an anonymous pipe between characters, so the units it
// holds carry provenance that a slot-count edit (`slot.count -= n`) would
// silently flatten; every move here goes through the shared source model
// instead, so a book can only ever gain or lose the exact buckets that moved.
//
// It owns NO algebra of its own. Descriptor validation, coalescing and ordering
// are material_sources.ts, slot reading is material_stack.ts, payload identity
// is material_payload_identity.ts, the removal choice is
// material_inventory_take.ts, and every grant lands through the one canonical
// bags.ts `addStacked` path (source-aware since the material arm). What lives
// here is only the guild-specific adaptation: how a delta names the units it
// moved, and how that reads back onto a book's inventory.
//
// The two delta shapes, both first class:
//   * EXACT: the delta carries `materialSources`, signed as the BOOK moved them
//     (positive = units the book gained), summing to the op's signed count.
//     Removals take exactly those descriptors and refuse a short bucket rather
//     than substituting another; a count-0 delta with nonzero legs is a pure
//     re-attribution and is a legal, replayable move.
//   * LEGACY: no `materialSources`. Its provenance is the lossless projection of
//     `count` plus the payload's legacy `signer` (never an invented gatherer).
//     A legacy GRANT lands exactly that projection. A legacy REMOVAL keeps the
//     SIGNATURE constraint the old delta really recorded: a signed one spends
//     only that signature's units and refuses rather than substituting another
//     premium identity, an unsigned one spends only NON-PREMIUM units in the
//     shared canonical order. See legacyRemovalEligibility for the full rule and
//     for the one migration limit it cannot close.
//
// The LOAD path is deliberately not here: every container runs the shared
// material_slot_load.ts pair (see the note where the guild-only arm used to be).
//
// Failures are codes; nothing here throws, clamps, or writes to a caller's data
// before the whole move is known to land. The ONE exception is documented at
// `grantLegs`: a grant that the packing core refuses is an invariant break, not
// a shortfall, and `addStacked` raises it rather than half-writing a book.
//
// `src/sim`-pure: no DOM/Three/render-ui-game-net imports, no Math.random or
// Date.now. Draws NO rng. Material membership is INJECTED, never imported, so a
// Vitest drives it with its own registry.

import { addStacked } from './bags';
import {
  applyMaterialInventoryTake,
  type MaterialTakeError,
  planMaterialInventoryTake,
} from './material_inventory_take';
import {
  cloneMaterialPayload,
  type MaterialPayloadIdentity,
  materialPayloadKey,
} from './material_payload_identity';
import {
  canonicalMaterialComposition,
  isPremiumMaterialSource,
  type MaterialComposition,
  type MaterialSource,
  type MaterialSourceCount,
  type MaterialSourceDelta,
  materialSourceKey,
} from './material_sources';
import {
  type MaterialStackError,
  type MaterialStackResult,
  type MaterialStackSlot,
  normalizeMaterialStack,
} from './material_stack';
import type { InvSlot, ItemInstancePayload } from './types';

const succeed = <T>(value: T): MaterialStackResult<T> => ({ ok: true, value });
const fail = (error: MaterialStackError): MaterialStackResult<never> => ({ ok: false, error });

/** Binary lexical order on the ASCII descriptor keys; never localeCompare, which
 *  would reorder a receipt's legs between machines. */
const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Exact inside the safe range, undefined outside it. The source-ledger core's
 *  rule, applied here for the same reason: a count that far out can never
 *  describe a legal holding, so it refuses rather than rounding. */
function toSafeCount(value: bigint): number | undefined {
  if (value > MAX_SAFE || value < -MAX_SAFE) return undefined;
  return Number(value);
}

/**
 * Canonical signed legs: every descriptor validated through the shared algebra,
 * identical descriptors coalesced, a net-zero descriptor dropped, and the result
 * ordered by descriptor key with every source freshly owned.
 *
 * This is what makes a receipt's bytes stable: two sessions that moved the same
 * units serialize the same legs whatever order they observed them in. The
 * descriptor RULES (shape, unknown fields, the legal empty-string legacy signer)
 * are never restated here: each leg's magnitude is read through
 * `canonicalMaterialComposition`, the same entry every other consumer uses.
 *
 * Accumulation is EXACT BigInt and the safe-range bound is applied ONCE, to the
 * finished per-descriptor net, exactly as the source-ledger core coalesces a
 * batch. Summing in `number` and bounding each running subtotal would make the
 * answer depend on ARRIVAL ORDER: legs that net to a perfectly legal holding
 * would be refused whenever an intermediate happened to cross the safe range
 * first, and the same legs in another order would pass. No BigInt escapes.
 */
export function canonicalMaterialSourceLegs(
  legs: readonly MaterialSourceDelta[] | null | undefined,
): MaterialStackResult<readonly MaterialSourceDelta[]> {
  if (legs === null || legs === undefined) return succeed([]);
  if (!Array.isArray(legs)) return fail('invalid-source');

  const buckets = new Map<string, { source: MaterialSource; count: bigint }>();
  // Read as UNTRUSTED data, whatever the declared type says: these legs arrive
  // from a durable receipt row as often as from a live delta.
  for (const raw of legs as readonly unknown[]) {
    if (typeof raw !== 'object' || raw === null) return fail('invalid-source');
    const leg = raw as { source?: unknown; count?: unknown };
    // The same closed field set readEntry enforces, checked here because a
    // SIGNED leg cannot be handed to it directly.
    for (const key of Object.keys(leg)) {
      if (key !== 'source' && key !== 'count') return fail('unknown-field');
    }
    const count = leg.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count === 0) {
      return fail('invalid-count');
    }
    const magnitude = Math.abs(count);
    const checked = canonicalMaterialComposition(
      [{ source: leg.source as MaterialSource, count: magnitude }],
      magnitude,
    );
    if (!checked.ok) return fail(checked.error);
    if (checked.value.length !== 1) return fail('invalid-source');

    const { source } = checked.value[0];
    const key = materialSourceKey(source);
    const held = buckets.get(key);
    buckets.set(key, {
      source: held?.source ?? source,
      count: (held?.count ?? 0n) + BigInt(count),
    });
  }

  const rows = [...buckets.entries()]
    .filter(([, bucket]) => bucket.count !== 0n)
    .sort((a, b) => compareKeys(a[0], b[0]));
  const out: MaterialSourceDelta[] = [];
  for (const [, bucket] of rows) {
    const count = toSafeCount(bucket.count);
    if (count === undefined) return fail('count-overflow');
    out.push({ source: bucket.source, count });
  }
  return succeed(out);
}

/**
 * The signed total of canonical legs, or undefined outside the safe range.
 * BigInt for the same order-independence reason as above: only the FINISHED
 * total has to describe a legal move.
 */
export function materialSourceLegsTotal(legs: readonly MaterialSourceDelta[]): number | undefined {
  let total = 0n;
  for (const leg of legs) total += BigInt(leg.count);
  return toSafeCount(total);
}

/** The delta fields this arm reads. `GuildBankOpDelta` satisfies it
 *  structurally, and so does the server's own pre-sidecar delta shape. */
export interface GuildMaterialDeltaInput {
  readonly op: string;
  readonly itemId: string | null;
  readonly count: number | null;
  readonly instance?: ItemInstancePayload | null;
  readonly craftedRecipeId?: string | null;
  readonly materialSources?: readonly MaterialSourceDelta[] | null;
}

interface GuildMaterialMoveBase {
  readonly itemId: string;
  /** The NORMALIZED payload identity the book groups this move under. */
  readonly identity: MaterialPayloadIdentity;
  /** `materialPayloadKey(identity)`: the stable key a caller nets on. */
  readonly key: string;
  /** After minus before, as the BOOK moved it. Zero only for a re-attribution. */
  readonly signedCount: number;
}

/** One delta read as a material move: exactly which buckets moved, or the
 *  lossless legacy projection when nobody recorded any. */
export type GuildMaterialMove =
  | (GuildMaterialMoveBase & {
      readonly kind: 'exact';
      /** Canonical signed legs summing to `signedCount`. */
      readonly legs: readonly MaterialSourceDelta[];
    })
  | (GuildMaterialMoveBase & {
      readonly kind: 'legacy';
      /** The projection of `|signedCount|` units: what a GRANT lands, and what
       *  an inverse puts back. */
      readonly composition: MaterialComposition;
      /** The payload's legacy `signer`, or undefined when it carried none. It
       *  is the ONE fact an old delta really records about which units moved,
       *  and it CONSTRAINS a removal (see legacyRemovalEligibility). */
      readonly legacySigner: string | undefined;
    });

const MOVE_OPS: ReadonlySet<string> = new Set(['deposit', 'withdraw', 'admin_purge']);

/** The delta's own item count as the guild replay has always read it: lenient,
 *  because a legacy log row may carry a coerced number. */
function magnitudeOf(count: number | null): number {
  return Math.max(0, Math.floor(Number(count)) || 0);
}

/** The identity fields only, payload deep-copied through the safe walk so an
 *  own `__proto__` key survives and nothing aliases the caller's slot. */
function identityOf(slot: MaterialStackSlot): MaterialPayloadIdentity {
  const out: { itemId: string; instance?: ItemInstancePayload; craftedRecipeId?: string } = {
    itemId: slot.itemId,
  };
  if (slot.instance !== undefined) out.instance = cloneMaterialPayload(slot.instance);
  if (slot.craftedRecipeId !== undefined) out.craftedRecipeId = slot.craftedRecipeId;
  return out;
}

/** The delta's identity fields as a stack the shared adapter can read. */
function deltaSlot(
  delta: GuildMaterialDeltaInput,
  itemId: string,
  count: number,
): MaterialStackSlot {
  const slot: MaterialStackSlot = { itemId, count };
  if (delta.instance != null) slot.instance = delta.instance;
  if (typeof delta.craftedRecipeId === 'string' && delta.craftedRecipeId !== '') {
    slot.craftedRecipeId = delta.craftedRecipeId;
  }
  return slot;
}

/**
 * Read one guild bank delta as a material move, or `null` when this arm does not
 * own it (a treasury or ladder op, a non-material item, or a legacy item delta
 * that moves no units at all, which the caller's own no-op arm already skips).
 *
 * A refusal means the delta itself cannot be read: a malformed descriptor, legs
 * that do not sum to the count they claim, or a legacy `signer` sitting beside
 * explicit legs (which of the two names the units?). It is never downgraded to
 * unrecorded stock, because that would erase attribution rather than refuse it.
 */
export function guildMaterialMoveFor(
  delta: GuildMaterialDeltaInput,
  materialIds: ReadonlySet<string>,
): MaterialStackResult<GuildMaterialMove | null> {
  const raw = delta as unknown;
  if (typeof raw !== 'object' || raw === null) return fail('invalid-source');
  if (!MOVE_OPS.has(delta.op)) return succeed(null);
  const itemId = delta.itemId;
  if (typeof itemId !== 'string' || itemId === '' || !materialIds.has(itemId)) {
    return succeed(null);
  }

  const magnitude = magnitudeOf(delta.count);
  const signedCount = delta.op === 'deposit' ? magnitude : -magnitude;

  if (delta.materialSources === undefined || delta.materialSources === null) {
    // Legacy: `count` units under the payload's legacy signer, or the empty
    // descriptor. No gatherer is invented, because nobody recorded one.
    if (magnitude === 0) return succeed(null);
    const normalized = normalizeMaterialStack(deltaSlot(delta, itemId, magnitude), materialIds);
    if (!normalized.ok) return normalized;
    const composition = normalized.value.materialSources ?? [];
    return succeed({
      kind: 'legacy',
      itemId,
      identity: identityOf(normalized.value),
      key: materialPayloadKey(normalized.value),
      composition,
      // legacyMaterialComposition always projects ONE bucket, so this reads the
      // signer the payload really carried (including the legal empty string,
      // which is its own descriptor and is not premium).
      legacySigner: composition[0]?.source.signer,
      signedCount,
    });
  }

  const canonical = canonicalMaterialSourceLegs(delta.materialSources);
  if (!canonical.ok) return canonical;
  const total = materialSourceLegsTotal(canonical.value);
  if (total === undefined) return fail('count-overflow');
  // The legs ARE the claim about what moved, so a claim that disagrees with the
  // op's own count is refused rather than silently preferring one of the two.
  if (total !== signedCount) return fail('sum-mismatch');

  // A one-unit unrecorded probe, only so the payload is canonicalized by the
  // SAME reader every slot goes through: it drops an empty payload, keeps
  // unknown persisted fields, and refuses a legacy signer beside explicit legs.
  const probe = deltaSlot(delta, itemId, 1);
  probe.materialSources = [{ source: {}, count: 1 }];
  const normalized = normalizeMaterialStack(probe, materialIds);
  if (!normalized.ok) return normalized;
  return succeed({
    kind: 'exact',
    itemId,
    identity: identityOf(normalized.value),
    key: materialPayloadKey(normalized.value),
    legs: canonical.value,
    signedCount,
  });
}

/** Split canonical signed legs into the two halves a book move applies. */
function splitLegs(legs: readonly MaterialSourceDelta[]): {
  removed: MaterialSourceCount[];
  granted: MaterialSourceCount[];
} {
  const removed: MaterialSourceCount[] = [];
  const granted: MaterialSourceCount[] = [];
  for (const leg of legs) {
    if (leg.count < 0) removed.push({ source: leg.source, count: -leg.count });
    else granted.push({ source: leg.source, count: leg.count });
  }
  return { removed, granted };
}

const compositionTotal = (composition: readonly MaterialSourceCount[]): number => {
  let total = 0;
  for (const entry of composition) total += entry.count;
  return total;
};

/** Only the book stacks holding THIS payload identity are eligible: a book keeps
 *  a crafted and a plain copy of one item as separate stock, and crossing that
 *  line would spend another officer's provenance. Slots are matched on the
 *  NORMALIZED identity, so a legacy signer-in-payload stack and the normalized
 *  stack it merges with are correctly one bucket. */
function identityEligible(
  materialIds: ReadonlySet<string>,
  key: string,
): (slot: MaterialStackSlot) => boolean {
  return (slot) => {
    const normalized = normalizeMaterialStack(slot, materialIds);
    return normalized.ok && materialPayloadKey(normalized.value) === key;
  };
}

/**
 * Which BUCKETS a LEGACY removal may spend. An old delta records no per-unit
 * provenance, but it is not silent either, and the two things it does say are
 * both constraints the normalized projection must keep:
 *
 *  - A SIGNED legacy payload names its signer. Those units, and only those,
 *    left. Spending another signature (or plain stock) to satisfy it would
 *    destroy a premium identity the delta never touched, so a book that is
 *    short of THAT signature refuses rather than substituting. The gatherer
 *    axis is deliberately not constrained: the old model never recorded one,
 *    so a `{gatherer, signer}` unit is still that signature's unit.
 *  - An UNSIGNED legacy payload says the units were NOT premium (that is
 *    exactly what carrying no signer meant). So the spend is narrowed to
 *    non-premium buckets and ordered by the shared canonical rule inside them.
 *    Nothing is invented: no gatherer is guessed at, and a premium bucket is
 *    never consumed by a delta that provably did not hold one.
 *
 * The reviewed migration limit, stated rather than hidden: within its allowed
 * pool an unsigned legacy removal still cannot know WHICH gatherer's units
 * left, so its inverse restores the recorded projection (unrecorded units), not
 * the buckets the forward take chose. That is the pre-existing cost of stock
 * nobody attributed, not a new erasure, and it can never move a signature.
 */
function legacyRemovalEligibility(
  legacySigner: string | undefined,
): (source: MaterialSource) => boolean {
  if (legacySigner !== undefined) return (source) => source.signer === legacySigner;
  return (source) => !isPremiumMaterialSource(source);
}

/** Every spendable bucket of one payload identity, summed per descriptor, under
 *  the SAME eligibility the take planner applies, so a shortfall figure can
 *  never describe units the take was never allowed to reach. */
function heldBuckets(
  inventory: readonly MaterialStackSlot[],
  materialIds: ReadonlySet<string>,
  key: string,
  includeLocked: boolean,
  eligibleSource: ((source: MaterialSource) => boolean) | undefined,
): Map<string, number> {
  const held = new Map<string, number>();
  for (const slot of inventory) {
    if (!includeLocked && slot.instance?.locked === true) continue;
    const normalized = normalizeMaterialStack(slot, materialIds);
    if (!normalized.ok || materialPayloadKey(normalized.value) !== key) continue;
    for (const bucket of normalized.value.materialSources ?? []) {
      if (eligibleSource !== undefined && !eligibleSource(bucket.source)) continue;
      const bucketKey = materialSourceKey(bucket.source);
      held.set(bucketKey, (held.get(bucketKey) ?? 0) + bucket.count);
    }
  }
  return held;
}

/**
 * How many units a refused removal could not find. An EXACT removal is short by
 * descriptor (a short bucket is never made up from another one), while an
 * UNSPECIFIED removal is short by total over the buckets it was allowed to
 * reach: the same "requested minus held" figure the pre-source replay reported,
 * so an operator reading a deficit row sees the same number for the same book.
 */
function shortfallFor(
  inventory: readonly MaterialStackSlot[],
  materialIds: ReadonlySet<string>,
  key: string,
  count: number,
  wanted: readonly MaterialSourceCount[] | undefined,
  includeLocked: boolean,
  eligibleSource: ((source: MaterialSource) => boolean) | undefined,
): number {
  const held = heldBuckets(inventory, materialIds, key, includeLocked, eligibleSource);
  if (wanted === undefined) {
    let total = 0;
    for (const units of held.values()) total += units;
    return Math.max(0, count - total);
  }
  let short = 0;
  for (const want of wanted) {
    const have = held.get(materialSourceKey(want.source)) ?? 0;
    if (want.count > have) short += want.count - have;
  }
  return short;
}

export type GuildMaterialApplyResult =
  | { readonly ok: true }
  /** Durable truth does not hold the units this move takes out. */
  | { readonly ok: false; readonly reason: 'missing'; readonly shortfall: number }
  /** The BOOK's own material stock cannot be read; nothing was written. */
  | { readonly ok: false; readonly reason: 'unreadable'; readonly error: MaterialTakeError };

/** One removal's narrowing, kept in ONE object so the plan and its shortfall
 *  figure can never be computed under different rules. */
interface RemovalScope {
  /** Exactly these descriptors in these counts, or undefined for a pooled take. */
  readonly selectedSources?: readonly MaterialSourceCount[];
  /** Which buckets a pooled take may reach. Absent means every bucket. */
  readonly eligibleSource?: (source: MaterialSource) => boolean;
  readonly allowPartial: boolean;
}

/**
 * Take units out of a book: by exact descriptor, or pooled in the canonical
 * spend order within whatever buckets the scope allows. The whole removal is
 * planned before anything is written, so a refusal leaves the book exactly as
 * it was.
 *
 * `includeLocked` is always TRUE here, and it is the guild book's established
 * policy rather than a convenience: the player item lock is not consulted by
 * the guild pipe (transfer_lock.ts scopes it to the $WOC rail), so a locked
 * copy really can be deposited and withdrawn. A replay that skipped those
 * stacks would refuse every such command forever and drift the durable book
 * from the live one. It changes no global spend permission: the shared default
 * stays false and only this replay opts in.
 */
function removeUnits(
  inventory: InvSlot[],
  itemId: string,
  key: string,
  count: number,
  materialIds: ReadonlySet<string>,
  scope: RemovalScope,
): GuildMaterialApplyResult {
  if (count <= 0) return { ok: true };
  const plan = planMaterialInventoryTake({
    inventory,
    itemId,
    count,
    materialIds,
    eligibleSlot: identityEligible(materialIds, key),
    ...(scope.selectedSources === undefined ? {} : { selectedSources: scope.selectedSources }),
    ...(scope.eligibleSource === undefined
      ? {}
      : { eligibleSource: (source: MaterialSource) => scope.eligibleSource?.(source) === true }),
    allowPartial: scope.allowPartial,
    includeLocked: true,
  });
  if (!plan.ok) {
    if (plan.error === 'insufficient') {
      const short = shortfallFor(
        inventory,
        materialIds,
        key,
        count,
        scope.selectedSources,
        true,
        scope.eligibleSource,
      );
      // Always positive: reaching this arm means SOMETHING could not be found,
      // so a computed zero would be a lie about why the write was refused.
      return { ok: false, reason: 'missing', shortfall: Math.max(1, short) };
    }
    return { ok: false, reason: 'unreadable', error: plan.error };
  }
  applyMaterialInventoryTake(inventory, plan.value);
  return { ok: true };
}

/** Put units into a book through the ONE canonical grant path. `addStacked`
 *  merges only into stacks whose payload and craft provenance match, respects
 *  the per-item stack cap, and carries the exact composition into whatever it
 *  lands in. It RAISES on a plan it cannot build: that is an invariant break
 *  (the book holds material stock this model cannot read), never a shortfall,
 *  and half-writing a book instead would strand units. */
function grantLegs(
  inventory: InvSlot[],
  move: GuildMaterialMove,
  composition: readonly MaterialSourceCount[],
): void {
  const total = compositionTotal(composition);
  if (total <= 0) return;
  addStacked(
    inventory,
    move.itemId,
    total,
    move.identity.instance,
    move.identity.craftedRecipeId,
    composition,
  );
}

/**
 * Apply one material move FORWARD onto a book's inventory: exactly the buckets
 * that left, then exactly the buckets that arrived. Removals run first, so a
 * balanced re-attribution never transiently inflates a stack past its cap and a
 * refused removal never leaves a half-applied grant behind.
 */
export function applyGuildMaterialMove(
  inventory: InvSlot[],
  move: GuildMaterialMove,
  materialIds: ReadonlySet<string>,
): GuildMaterialApplyResult {
  if (move.kind === 'legacy') {
    if (move.signedCount > 0) {
      grantLegs(inventory, move, move.composition);
      return { ok: true };
    }
    // The signature the old delta DID record constrains the pool; the canonical
    // spend order chooses within it. A signed delta that cannot be satisfied
    // from its own signature refuses, rather than eating a different premium
    // identity to balance the books.
    return removeUnits(inventory, move.itemId, move.key, -move.signedCount, materialIds, {
      eligibleSource: legacyRemovalEligibility(move.legacySigner),
      allowPartial: false,
    });
  }

  const { removed, granted } = splitLegs(move.legs);
  const took = removeUnits(
    inventory,
    move.itemId,
    move.key,
    compositionTotal(removed),
    materialIds,
    {
      selectedSources: removed,
      allowPartial: false,
    },
  );
  if (!took.ok) return took;
  grantLegs(inventory, move, granted);
  return { ok: true };
}

/**
 * Apply one material move BACKWARD onto a book: the exact inverse of
 * `applyGuildMaterialMove`. Inverses CLAMP rather than refuse (another session
 * may already have consumed the un-durable units on the LIVE book, and its own
 * save is refused for the same reason), so removals here allow a short take.
 */
export function revertGuildMaterialMove(
  inventory: InvSlot[],
  move: GuildMaterialMove,
  materialIds: ReadonlySet<string>,
): void {
  if (move.kind === 'legacy') {
    if (move.signedCount > 0) {
      // Undo the grant by taking back exactly the projection it landed.
      removeUnits(
        inventory,
        move.itemId,
        move.key,
        compositionTotal(move.composition),
        materialIds,
        { selectedSources: move.composition, allowPartial: true },
      );
      return;
    }
    // Restores the RECORDED projection, which is all an old delta ever knew (see
    // legacyRemovalEligibility's stated migration limit).
    grantLegs(inventory, move, move.composition);
    return;
  }

  const { removed, granted } = splitLegs(move.legs);
  // Mirror image of the forward order: take back what the move granted first,
  // then restore what it removed.
  removeUnits(inventory, move.itemId, move.key, compositionTotal(granted), materialIds, {
    selectedSources: granted,
    allowPartial: true,
  });
  grantLegs(inventory, move, removed);
}

// THE LOAD PATH IS NOT HERE, deliberately. An earlier cut of this module owned a
// guild-only `sanitizeGuildBankMaterialSlot` that DROPPED provenance the shared
// model refused. That was a divergence: `material_slot_load.ts` is the ONE
// pre-validate/normalize pair the carried bags, the personal bank and the vault
// all run, and it REFUSES a row it cannot read rather than quietly demoting it
// to unrecorded stock. Two policies for one corruption is exactly how a book
// ends up laundering attribution that a character save would have refused, so
// `sanitizeGuildBankState` calls the shared pair like every other container and
// nothing guild-specific survives here.
