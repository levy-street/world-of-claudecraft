// First-reveal policy for the foliage bucket culls (foliage.ts, the per-frame
// `b.mesh.visible` loop). The foliage twin of prop_cull_core: a species bucket
// first met mid-travel used to flip visible on the very frame that linked its
// programs, because the boot sweep only ever saw what was inside the fog at
// spawn and the material prewarm compiles one twin per program, not per bucket.
// The bucket now consults a reveal gate on that first flip and stays hidden
// while the gate is cold, which for scenery arriving at the fog plane is
// invisible.
//
// The two escapes are the props ones, for the props reasons:
//   - a bucket already inside half the fog range on its FIRST consult reveals
//     at once (a hearth or teleport arrival lands the camera among buckets that
//     must exist immediately, and its loading cover already links what it
//     draws). It never applies to a bucket the gate has held: after an arrival
//     the fog opens over seconds, so a held bucket would otherwise cross the
//     near line mid-compile and link cold anyway;
//   - a reach floor under the hold. Trees and boulders ARE solid: every
//     decoration gets a sim collider (src/sim/colliders.ts decorationCollider),
//     so a driver whose link takes seconds must never leave one invisible at
//     arm's length. Decor may arrive late; the player must never walk into
//     nothing.
// Once revealed, the gate is never consulted again: a later fog re-entry is a
// plain cull flip, so the gate can never hide an object it has already shown
// (numPointLights is in three's program cache key, and a hide between frames
// moves the counted light set).
// A bucket key is ONE root (foliage.ts revealRoots hands back the single
// representative mesh per program key), so there is nothing here for the
// towns' piecewise per-root reveal to split.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/foliage_bucket_reveal_core.test.ts.

export interface FoliageBucketRevealState {
  /** Reveal-gate key: the bucket mesh's program key (foliage_prewarm_twins_core). */
  key: string;
  /** Latched once the first reveal was allowed; the gate is consulted only
   *  until the bucket's programs are known linked. */
  revealed: boolean;
  /** Latched once the gate held the bucket: from then on only the settle
   *  reveals it, never the near escape. */
  held: boolean;
}

/** Structural subset of reveal_gate_core's RevealGateCore, so this core stays
 *  decoupled from the gate module. */
export interface FoliageBucketRevealGate {
  allow(key: string): boolean;
}

/** Buckets whose nearest edge is inside this fraction of the fog far plane
 *  reveal immediately on their FIRST consult. Same value and same reasoning as
 *  PROP_CULL_REVEAL_NEAR_FRACTION. */
export const FOLIAGE_BUCKET_REVEAL_NEAR_FRACTION = 0.5;

/** The absolute floor of the hold, in yards from the bucket's nearest edge: a
 *  bucket this close reveals on every consult, held or not. Same distance as
 *  the props floor (PROP_CULL_REVEAL_REACH), and for the same collider-fairness
 *  reason; it also floors the near escape when a residency clamp has pulled the
 *  fog in tight. */
export const FOLIAGE_BUCKET_REVEAL_REACH = 40;

/**
 * 'hidden': the bucket's own cull hides it this frame. 'held': first reveal
 * deferred by the gate, the bucket stays hidden; the caller latches `held`.
 * 'revealed': the bucket draws; the caller latches `revealed`.
 */
export type FoliageBucketReveal = 'hidden' | 'held' | 'revealed';

export function foliageBucketReveal(
  culledVisible: boolean,
  edgeDist: number,
  fogFar: number,
  state: FoliageBucketRevealState,
  gate: FoliageBucketRevealGate | null | undefined,
): FoliageBucketReveal {
  if (!culledVisible) return 'hidden';
  if (state.revealed) return 'revealed';
  if (!gate) return 'revealed';
  if (edgeDist <= FOLIAGE_BUCKET_REVEAL_REACH) return 'revealed';
  if (!state.held && edgeDist <= fogFar * FOLIAGE_BUCKET_REVEAL_NEAR_FRACTION) return 'revealed';
  return gate.allow(state.key) ? 'revealed' : 'held';
}

/**
 * Per-frame entry: decide, latch and answer in one pass with no allocation on
 * the frame path. `culledVisible` is what the bucket's own cull already
 * decided; the return value is what the caller writes to `mesh.visible`. No
 * gate keeps the historical immediate reveal.
 */
export function foliageBucketVisible(
  culledVisible: boolean,
  edgeDist: number,
  fogFar: number,
  state: FoliageBucketRevealState,
  gate: FoliageBucketRevealGate | null | undefined,
): boolean {
  const reveal = foliageBucketReveal(culledVisible, edgeDist, fogFar, state, gate);
  if (reveal === 'revealed') {
    if (!state.revealed) state.revealed = true;
  } else if (reveal === 'held') state.held = true;
  return reveal === 'revealed';
}
