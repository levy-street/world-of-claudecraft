// Town static-cull first-reveal policy (hitch-hunt P3a), shared by the
// Eastbrook and Fenbridge views. The static batches' FIRST fog-cull reveal
// waits for a reveal gate so a walking approach never links the town's
// programs inside a live frame. A camera already among the buildings (login,
// hearth, teleport) is held too: that arrival used to reveal at once on the
// premise that the cover's zone prepare had compiled the scene, and on a host
// whose boot manifest drops the town that premise is false, so the whole town
// kit linked inside the live frames right after the jump. Its consult is
// IMMINENT instead: the hold stands, and the gate submits the town's compiles
// at the imminent priority, its roots ordered nearest to the camera first
// (orderTownRootsNearestFirst), so what the player is standing in links first.
// Nothing here reveals on a clock. Once revealed, the gate is never consulted
// again.
//
// A town key is the widest one in the game: every static batch plus every
// building group, dozens of independent subtrees behind one hold. Waiting for
// the slowest of them and then flipping all of them visible in one frame is
// the very first-draw burst the gate exists to prevent, so the hold is
// PIECEWISE: while the key is held, each root reveals as its own compile
// lands (reveal_gate_core rootReady), nearest to the camera first, and at
// most TOWN_PIECEWISE_REVEALS_PER_FRAME per frame so a burst of links cannot
// concatenate back into one frame. A root once shown is never hidden again by
// this policy: numPointLights is in three's program cache key, so a hide and
// re-show between frames links fresh programs, which is the cost being
// avoided. The key-level answer is unchanged, and it still wins: warm reveals
// everything, fog-hidden hides everything.
//
// TOWN_REVEAL_REACH_YD is the town's fairness floor, it applies only to
// FOOTPRINT-anchored roots (a building), and it is DELIBERATELY small where
// the props bands get 40 yards. A town kit's programs are SHARED
// across its buildings, so revealing one still-unlinked building links the
// whole kit cold, inside that live frame: exactly the cost this policy exists
// to avoid. The reach is therefore the smallest radius at which a collider is
// genuinely at arm's length, not a comfort radius for "the town looks empty".
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/town_reveal_core.test.ts.

export interface TownRevealGate {
  allow(key: string, imminent?: boolean): boolean;
  /** Per-root readiness (reveal_gate_core). A gate without it keeps the
   *  historical all-or-nothing hold, minus the reach floor. */
  rootReady?(key: string, root: object): boolean;
  /** Telemetry hook: this root revealed because its own compile landed. */
  noteRootRevealed?(key: string): void;
  /** Telemetry hook: this root revealed on the reach floor, linked or not. */
  noteRootRevealedAtReach?(key: string): void;
}

/**
 * 'hidden': the fog cull hides the batches this frame (the caller's revealed
 * latch is untouched either way). 'held': first reveal deferred by the gate,
 * batches stay hidden. 'revealed': batches visible; the caller latches so
 * the gate is never consulted again.
 */
export type TownStaticReveal = 'hidden' | 'held' | 'revealed';

export function townStaticReveal(
  fogVisible: boolean,
  alreadyRevealed: boolean,
  camDistSqToCenter: number,
  cullRadius: number,
  gate: TownRevealGate | null,
  key: string,
): TownStaticReveal {
  if (!fogVisible) return 'hidden';
  if (alreadyRevealed) return 'revealed';
  if (gate === null) return 'revealed';
  // A camera inside the cull radius is the IMMINENT consult: the player is
  // standing in this town, so its compiles go to the front of the reveal lane.
  const insideTown = camDistSqToCenter <= cullRadius * cullRadius;
  return gate.allow(key, insideTown) ? 'revealed' : 'held';
}

/**
 * How many held roots may flip visible in one frame. Small on purpose: the
 * compiles land one at a time in the shared queue, so the cap only bites when
 * several settle together, which is exactly the burst worth spreading.
 */
export const TOWN_PIECEWISE_REVEALS_PER_FRAME = 2;

/**
 * The town's reach floor, in yards from the camera to a root's anchor: a
 * building this close shows on the first held frame, linked or not, because
 * its colliders are at arm's length and the player would otherwise walk into
 * nothing. Small (see the header): a town kit's programs are shared across
 * buildings, so every reach reveal risks linking the whole kit cold in a live
 * frame. It is the fairness floor, not a comfort radius, so it covers only
 * what the player can physically touch; everything farther waits for its own
 * compile, however long that takes.
 */
export const TOWN_REVEAL_REACH_YD = 12;

/** The town's per-root reveal state, built once beside its roots list. */
export interface TownPiecewiseReveal {
  key: string;
  roots: readonly object[];
  /** World XZ anchor per root, for the nearest-first order. */
  x: Float32Array;
  z: Float32Array;
  /** 1 once the root at that slot has been shown; never cleared. */
  revealed: Uint8Array;
  /** 1 where the anchor is the root's OWN footprint, so a camera distance to
   *  it is a real arm's-length reading and the reach floor may take it. 0 for
   *  a town-spanning static batch, whose anchor is the town centre. */
  footprint: Uint8Array;
}

/** Roots past the end of `x`/`z` anchor at the town centre, which is the
 *  honest answer for a batch that spans the whole town.
 *
 *  `footprintAnchored` says which of those anchors is a footprint (defaulting
 *  to yes, per slot). It is a separate flag rather than a sentinel anchor
 *  because the centre IS the right anchor for the nearest-first ORDER of a
 *  town-spanning batch; what it is not is a distance the reach floor may read
 *  as arm's length. */
export function newTownPiecewiseReveal(
  key: string,
  roots: readonly object[],
  x: readonly number[],
  z: readonly number[],
  footprintAnchored?: readonly boolean[],
): TownPiecewiseReveal {
  const state: TownPiecewiseReveal = {
    key,
    roots,
    x: new Float32Array(roots.length),
    z: new Float32Array(roots.length),
    revealed: new Uint8Array(roots.length),
    footprint: new Uint8Array(roots.length),
  };
  for (let index = 0; index < roots.length; index++) {
    state.x[index] = x[index] ?? 0;
    state.z[index] = z[index] ?? 0;
    state.footprint[index] = (footprintAnchored?.[index] ?? true) ? 1 : 0;
  }
  return state;
}

/**
 * The roots of a town key, nearest to the camera first, refilled into a
 * caller-owned array. The town view hands this to the gate at REQUEST time so
 * an imminent arrival submits its compiles in the order the player will see
 * them; it runs once per key, not per frame, so the index sort it needs costs
 * nothing on the frame path. Equal distances keep their declaration order
 * (the sort is stable), so the result is deterministic.
 */
export function orderTownRootsNearestFirst<T>(
  roots: readonly T[],
  x: Float32Array,
  z: Float32Array,
  camX: number,
  camZ: number,
  out: T[],
): readonly T[] {
  const distSq = (index: number): number => {
    const dx = (x[index] ?? 0) - camX;
    const dz = (z[index] ?? 0) - camZ;
    return dx * dx + dz * dz;
  };
  const order: number[] = [];
  for (let index = 0; index < roots.length; index++) order.push(index);
  order.sort((a, b) => distSq(a) - distSq(b));
  out.length = 0;
  for (let n = 0; n < order.length; n++) out.push(roots[order[n]]);
  return out;
}

/**
 * Flip the held key's roots that may come in this frame, and return how many
 * flipped. Two passes, in this order:
 * - the REACH floor: every unrevealed FOOTPRINT-anchored root within
 *   TOWN_REVEAL_REACH_YD shows at once, readiness and per-frame budget both
 *   irrelevant, because a collider at arm's length may not be invisible. A
 *   town-spanning static batch is excluded: reach is a collider argument and
 *   a batch has no arm's-length position, so a camera standing on the town
 *   centre would otherwise flip every micro and wall batch in one unlinked
 *   frame, which is the burst this whole policy exists to prevent;
 * - the READY roots, nearest first, at most TOWN_PIECEWISE_REVEALS_PER_FRAME.
 * Allocation-free: the ready selection is a bounded k-smallest scan over the
 * caller-owned arrays, never a sort of a fresh list.
 */
export function townPiecewiseRevealInto(
  state: TownPiecewiseReveal,
  reveal: TownStaticReveal,
  camX: number,
  camZ: number,
  gate: TownRevealGate | null | undefined,
): number {
  if (reveal !== 'held') return 0;
  const { key, roots, revealed } = state;
  let flipped = 0;
  const reachSq = TOWN_REVEAL_REACH_YD * TOWN_REVEAL_REACH_YD;
  for (let index = 0; index < roots.length; index++) {
    if (revealed[index] === 1) continue;
    if (state.footprint[index] === 0) continue;
    const dx = state.x[index] - camX;
    const dz = state.z[index] - camZ;
    if (dx * dx + dz * dz > reachSq) continue;
    revealed[index] = 1;
    flipped++;
    gate?.noteRootRevealedAtReach?.(key);
  }
  if (!gate || typeof gate.rootReady !== 'function') return flipped;
  let ready = 0;
  while (ready < TOWN_PIECEWISE_REVEALS_PER_FRAME) {
    let best = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let index = 0; index < roots.length; index++) {
      if (revealed[index] === 1) continue;
      const dx = state.x[index] - camX;
      const dz = state.z[index] - camZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= bestDistSq) continue;
      if (!gate.rootReady(key, roots[index])) continue;
      best = index;
      bestDistSq = distSq;
    }
    if (best < 0) break;
    revealed[best] = 1;
    ready++;
    flipped++;
    gate.noteRootRevealed?.(key);
  }
  return flipped;
}

/** What the caller writes to the root's own visibility, on top of whatever
 *  cull or fade that root already answers for. */
export function townRootVisible(
  reveal: TownStaticReveal,
  state: TownPiecewiseReveal,
  index: number,
): boolean {
  if (reveal === 'hidden') return false;
  if (reveal === 'revealed') return true;
  return state.revealed[index] === 1;
}
