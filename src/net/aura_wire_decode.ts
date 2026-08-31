import type { Aura } from '../sim/types';
import { type SnapshotTimerWireMode, stableDeadlineRemaining } from './snapshot_timer_wire';

// The aura half of the snapshot decode, extracted whole from
// ClientWorld.applySnapshot (src/net/online.ts, the monolith ratchet) as the
// directory's own "a new decode block is a new sibling" rule asks. It is the
// biggest single field family on the entity path and the one with real logic:
// a deadline-vs-remaining clock decision, an in-place update fast path, and a
// dozen presence-only markers whose absent-means-cleared handling is what keeps
// a mirrored aura from going stale.
//
// TWO PATHS, and the split is a per-frame allocation decision rather than a
// style one. Between snapshots the aura SET is usually unchanged (only the
// countdown moves), so when the incoming ids line up index for index with the
// records already held, the existing objects are updated IN PLACE: no array and
// no per-aura object per entity at 20 Hz, and the preserved object identity
// matches the offline Sim, where one live aura object persists across ticks.
// Any composition change (a gain, a fade, a reorder) falls back to the fresh
// build. Both paths must decode every field the same way, which is exactly the
// drift this module exists to make impossible: they now sit side by side.
//
// Every marker is PRESENCE-only and clears on absence. That is not cosmetic:
// `fl` decides which glyph a buff paints, `und` decides whether the client
// offers a right-click cancel the server would refuse, and a sticky mirror
// would keep answering for a state that ended.

/** One aura row as the wire carries it. Terse keys, matching the server
 *  encoder in server/snapshot_timer_wire.ts; every optional key is omitted
 *  rather than sent falsy, so an older server simply sends fewer. */
export interface ClientWireAura {
  id: string;
  name: string;
  kind: Aura['kind'];
  rem?: number;
  exp?: number;
  dur: number;
  perm?: 1;
  value?: number;
  value2?: number;
  value3?: number;
  tickInterval?: number;
  school?: Aura['school'];
  stacks?: number;
  charges?: number;
  emp?: Aura['empowerAbilities'];
  src?: number;
  ub?: 1;
  und?: 1;
  /** Flask-sourced buff marker (server/snapshot_timer_wire.ts). Presence-only:
   *  the client paints a distinct glyph for it, never a different outcome. */
  fl?: 1;
  bt?: 1;
}

/** The snapshot's timer-wire context: which clock the row's countdown is in.
 *  Structural on purpose, so ClientWorld hands its live `timerWire` straight in
 *  and a future mode joins the union in ONE place (snapshot_timer_wire.ts). */
export interface AuraTimerContext {
  mode: SnapshotTimerWireMode;
  time: number | null;
}

/**
 * Seconds left on one aura.
 *
 * A permanent aura has no countdown at all. Under the STABLE timer wire the
 * row carries an absolute deadline (`exp`) rather than a per-snapshot
 * remaining, so it ages between snapshots without the server resending it;
 * `rem` is the legacy arm and the fallback for a row that carried no usable
 * deadline.
 */
export function auraRemaining(aura: ClientWireAura, timer: AuraTimerContext): number {
  if (aura.perm === 1) return Number.POSITIVE_INFINITY;
  if (timer.mode !== 'stable' || timer.time === null) return Number(aura.rem);
  const deadlineRemaining = stableDeadlineRemaining(aura.exp, timer.time);
  if (deadlineRemaining !== null) return deadlineRemaining;
  return typeof aura.rem === 'number' && Number.isFinite(aura.rem) ? aura.rem : 0;
}

/**
 * Whether this snapshot carries an aura list to apply at all.
 *
 * Under the stable timer wire the list is delta-gated: an absent `auras` key
 * means UNCHANGED, and applying an empty list for it would silently strip every
 * aura the entity is wearing.
 */
export function snapshotCarriesAuras(
  timer: AuraTimerContext,
  wireAuras: unknown,
): wireAuras is unknown {
  if (timer.mode === 'legacy') return true;
  return timer.mode === 'stable' && timer.time !== null && wireAuras !== undefined;
}

/** True when the incoming ids line up index for index with the held records,
 *  which is what makes the in-place update legal. */
function sameShape(existing: readonly Aura[], incoming: readonly ClientWireAura[]): boolean {
  if (existing.length !== incoming.length) return false;
  for (let i = 0; i < incoming.length; i++) {
    if (existing[i].id !== incoming[i].id) return false;
  }
  return true;
}

/** Build one fresh aura record from its wire row. */
function decodeAura(a: ClientWireAura, timer: AuraTimerContext): Aura {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    remaining: auraRemaining(a, timer),
    duration: a.perm === 1 ? Number.POSITIVE_INFINITY : a.dur,
    permanent: a.perm === 1,
    value: a.value ?? 0,
    value2: a.value2,
    value3: a.value3,
    tickInterval: a.tickInterval,
    sourceId: a.src ?? 0,
    school: a.school ?? 'physical',
    stacks: a.stacks,
    charges: a.charges,
    empowerAbilities: a.emp,
    unbreakableControl: a.ub === 1 ? true : undefined,
    undispellable: a.und === 1 ? true : undefined,
    flask: a.fl === 1 ? true : undefined,
    breakThreshold: a.bt === 1 ? 1 : undefined,
  } as Aura;
}

/** Overwrite one held record from its wire row, preserving object identity. */
function updateAura(rec: Aura, a: ClientWireAura, timer: AuraTimerContext): void {
  rec.name = a.name;
  rec.kind = a.kind;
  rec.remaining = auraRemaining(a, timer);
  rec.duration = a.perm === 1 ? Number.POSITIVE_INFINITY : a.dur;
  rec.permanent = a.perm === 1;
  rec.value = a.value ?? 0;
  rec.value2 = a.value2;
  rec.value3 = a.value3;
  rec.tickInterval = a.tickInterval;
  rec.school = a.school ?? 'physical';
  rec.stacks = a.stacks;
  // The charge count for a charge-limited aura (Lightning Shield); sent only
  // when defined, so an ordinary aura or an older server decodes to undefined
  // and the badge falls back to the stacks path.
  rec.charges = a.charges;
  rec.empowerAbilities = a.emp;
  // The caster's entity id, for the target strip's own-aura prominence
  // (auras_view ownFirst). An older server omits it; 0 matches no player id.
  rec.sourceId = a.src ?? 0;
  rec.unbreakableControl = a.ub === 1 ? true : undefined;
  // Presence-only, so the client's isPlayerRemovableAura answers exactly as the
  // server's does.
  rec.undispellable = a.und === 1 ? true : undefined;
  // Presence-only, so the buff bar paints the same distinct flask glyph online
  // that it does offline; an older server omits it and the glyph falls back to
  // the shared aura_<kind> recipe.
  rec.flask = a.fl === 1 ? true : undefined;
  // Presence-only mirror of the break-threshold ARMED marker: the one client
  // reader is the Lingering Dread victim band, which gates on the field being
  // defined and never reads the value.
  rec.breakThreshold = a.bt === 1 ? 1 : undefined;
}

/**
 * Apply a snapshot's aura list to an entity's held records, in place where the
 * composition is unchanged and as a fresh list otherwise. Returns the list to
 * store (which is the SAME array on the in-place path).
 */
export function applyAuraWire(
  existing: Aura[],
  wireAuras: readonly ClientWireAura[],
  timer: AuraTimerContext,
): Aura[] {
  if (sameShape(existing, wireAuras)) {
    for (let i = 0; i < wireAuras.length; i++) updateAura(existing[i], wireAuras[i], timer);
    return existing;
  }
  return wireAuras.map((a) => decodeAura(a, timer));
}
