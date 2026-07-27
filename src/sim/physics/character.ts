// The character physics solver: the horizontal half of a real character
// controller, in the Unreal/Quake lineage, adapted exactly to this world's
// extruded-2D collision geometry and this sim's determinism rules.
//
// Per call it runs, in order:
//   1. DEPENETRATION  push the body out of anything it starts inside (a
//      teleport, a geometry swap, or float drift can leave it embedded).
//   2. SLIDE ITERATIONS  sweep the body along the remaining motion, advance to
//      the time of impact (minus a skin), then project what is left along the
//      contact plane and sweep again. Four passes resolve corners and creases
//      without the wall-sticking a single push-out pass produces.
//   3. STEP UP  when a blocking obstacle's top is within `stepHeight` of the
//      feet and is standable, lift the body onto it and keep the SAME
//      horizontal motion going. This is what makes small stones, kerbs, roots,
//      and low rubble something you stride over instead of bump into, with no
//      jump input and no vertical velocity: the defining feature of a modern
//      character controller.
//   4. TERRAIN GATE  the heightfield is not a collider, so the walkable-slope
//      rule is applied separately: an unwalkable rise is a wall, and step-up
//      deliberately does NOT apply to it (see the NOTE at the gate). A
//      rejected uphill retries along the contour so a body slides across a
//      steep face instead of sticking to it.
//
// Determinism: pure functions of (world content, seed, pose, delta). No rng,
// no wall clock, no allocation in the steady state (module scratch is reused).
// The same code runs on the server Sim, the offline browser Sim, the headless
// RL env, and the client's display-only self extrapolator.
//
// Scope: the OPEN WORLD. Instanced interiors (dungeons, delves, arena, the
// Yumi maze) are flat-floored rooms of full-height walls where step-up has
// nothing to act on, so they stay on the long-standing `resolveMove` path and
// keep their behavior (and their tests) byte-identical.

import {
  type Collider,
  colliderTopAt,
  MANTLE_REACH,
  queryOpenWorldColliders,
  SUPPORT_OVERLAP,
  supportHeightAt,
} from '../colliders';
import { groundHeight, terrainDownhill, terrainSteepnessAt } from '../world';
import { overlapCollider, SKIN_WIDTH, sweepCollider } from './sweep';

/**
 * How high a walking body climbs without jumping (yards). At the player's 2 yd
 * body height this is 45 percent of stature: generous, in the classic-MMO
 * tradition rather than the simulation one, and chosen against MEASURED world
 * geometry rather than taste. The rock field's own height model
 * (`decoration_dims.ts`) runs about 0.7 to 1.7 yd, and the climb the solver
 * actually tests is from the BODY'S FEET, so rolling terrain adds a few
 * centimetres either way: a tighter value left stones that read as obviously
 * strideable failing by under a centimetre, which is precisely the "why did I
 * stop?" moment this engine exists to remove. Everything above it stays a jump
 * (crates at 1.35, the taller boulders), reachable via the mantle assist.
 * Pinned against the rock size model by tests/physics_character.test.ts.
 */
export const MAX_STEP_HEIGHT = 0.9;
/** Slide passes per move. Four resolves a corner (two planes) plus slack. */
const MAX_SLIDE_ITERATIONS = 4;
/** Depenetration passes when the body starts embedded. */
const MAX_DEPENETRATION_ITERATIONS = 4;
/** Height comparisons against a collider top. */
const TOP_EPS = 1e-3;
/** Motions below this are treated as zero. */
const MIN_MOTION = 1e-7;
/** How far a step-up may carry the body forward to land ON the surface. */
const STEP_COMMIT_DISTANCE = 0.35;
/** Commit samples tried, from 0 (already over the top) to the full distance. */
const STEP_COMMIT_TRIES = 4;

export interface CharacterMoveParams {
  seed: number;
  /** Body radius (yards). */
  radius: number;
  /** How high the body climbs unaided (yards). */
  stepHeight: number;
  /** Walkable slope limit (rise over run), the terrain wall gate. */
  maxSlope: number;
  /** Step-up requires footing: an airborne body only passes over tops. */
  grounded: boolean;
  /** A treading body is never terrain-gated (a lake bank is not a wall). */
  swimming: boolean;
  /** Jump arcs clear low fence rails (the long-standing fence rule). */
  ignoreFences: boolean;
}

export interface CharacterMoveResult {
  x: number;
  /** Feet height: raised when the body stepped up onto something. */
  y: number;
  z: number;
  /** True when a surface stopped or deflected the motion. */
  blocked: boolean;
  /** Total height gained by stepping up this move (0 when none). */
  stepped: number;
}

/**
 * Work counters for the efficiency pin. Wall-clock budgets rot across machines
 * and CI runners; the WORK a solve performs does not, so
 * tests/physics_character.test.ts asserts against these instead. Plain integer
 * adds, free on the hot path.
 */
export const physicsStats = {
  solves: 0,
  /** Colliders surviving the broadphase prune, summed over solves. */
  candidates: 0,
  /** Swept collider tests performed (the dominant inner-loop cost). */
  sweeps: 0,
  /** Overlap tests (depenetration plus step-up headroom). */
  overlaps: 0,
};

export function resetPhysicsStats(): void {
  physicsStats.solves = 0;
  physicsStats.candidates = 0;
  physicsStats.sweeps = 0;
  physicsStats.overlaps = 0;
}

// Module scratch: this runs per body per tick and must not allocate.
const candidates: Collider[] = [];
const hit = { t: 0, nx: 0, nz: 0 };
const push = { nx: 0, nz: 0, depth: 0 };

// Rotate a world offset into an OBB's local frame, into scratch (no object).
const localPt = { x: 0, z: 0 };
function toLocal(lx: number, lz: number, rot: number): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  localPt.x = lx * c + lz * s;
  localPt.z = -lx * s + lz * c;
}

// Drop every candidate that cannot touch the swept body, once, before the
// slide iterations. A grid cell is 16 yd across and a tick's step is under
// one, so the broadphase hands back far more than the solver can ever hit;
// pruning here shrinks the inner loops (sweep, depenetrate, isClear, support)
// from "everything nearby" to "the two or three things actually in reach".
function pruneCandidates(x: number, z: number, dx: number, dz: number, reach: number): void {
  const minX = Math.min(x, x + dx) - reach;
  const maxX = Math.max(x, x + dx) + reach;
  const minZ = Math.min(z, z + dz) - reach;
  const maxZ = Math.max(z, z + dz) + reach;
  let kept = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const ext = c.type === 'circle' ? c.r : Math.hypot(c.hw, c.hd);
    if (c.x + ext < minX || c.x - ext > maxX || c.z + ext < minZ || c.z - ext > maxZ) continue;
    candidates[kept++] = c;
  }
  candidates.length = kept;
}

/**
 * Highest standable top under (x, z) among the PRUNED candidates, at or below
 * `maxY`. Identical predicate to `colliders.ts` `supportHeightAt` (pinned by
 * tests/physics_character.test.ts), computed against the list the solver
 * already holds so a step-up does not re-enter the broadphase per attempt.
 */
function supportFromCandidates(x: number, z: number, r: number, maxY: number): number {
  let best = -Infinity;
  const reachR = r * SUPPORT_OVERLAP;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c.standable || c.moveTopY === undefined) continue;
    if (c.type === 'circle') {
      const dx = x - c.x;
      const dz = z - c.z;
      const reach = c.r + reachR;
      if (dx * dx + dz * dz >= reach * reach) continue;
    } else {
      toLocal(x - c.x, z - c.z, -c.rot);
      if (Math.abs(localPt.x) >= c.hw + reachR || Math.abs(localPt.z) >= c.hd + reachR) continue;
    }
    // Sampled surface: a pitched roof supports at its local height.
    const top = colliderTopAt(c, x, z);
    if (top > maxY + TOP_EPS || top <= best) continue;
    best = top;
  }
  return best;
}

/**
 * Does this collider block a body at (x, z) whose feet are at `feetY`?
 *
 * An AIRBORNE body gets the mantle assist over standable tops (the same
 * `MANTLE_REACH` allowance `colliders.ts` grants the legacy sweep): a jump
 * that falls just short of a crate rim still carries over it, and the vertical
 * pass then seats the body on top. Grounded bodies get no lift; they climb
 * only through step-up, which has its own, stricter gate.
 *
 * Sloped tops are sampled at the body's own position: a body standing on a
 * canopy's fabric is ON the surface there, and must not be treated as inside
 * an obstacle just because the ridge line rises higher elsewhere (that
 * ridge-max reading would depenetrate a roof-walker off the roof).
 */
function blocksAt(
  c: Collider,
  x: number,
  z: number,
  feetY: number,
  params: CharacterMoveParams,
): boolean {
  if (params.ignoreFences && c.type === 'obb' && c.isFence) return false;
  if (c.moveTopY === undefined) return true; // full height: buildings, trees, walls
  const lift = !params.grounded && c.standable === true ? MANTLE_REACH : 0;
  return colliderTopAt(c, x, z) > feetY + lift + TOP_EPS;
}

/** Can a grounded body climb onto this obstacle without jumping? */
function steppableAt(c: Collider, feetY: number, params: CharacterMoveParams): boolean {
  return (
    params.grounded &&
    c.standable === true &&
    c.moveTopY !== undefined &&
    c.moveTopY > feetY &&
    c.moveTopY - feetY <= params.stepHeight
  );
}

/** Is the body clear at (x, z) with its feet at `feetY`? Gates every step-up:
 *  climbing must never push the body into a wall or under an overhang. */
function isClear(x: number, z: number, feetY: number, params: CharacterMoveParams): boolean {
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!blocksAt(c, x, z, feetY, params)) continue;
    physicsStats.overlaps++;
    if (overlapCollider(c, x, z, params.radius, push)) return false;
  }
  return true;
}

// Push the body out of everything it starts inside. Sequential minimum
// translations, capped: a body wedged in a crevice settles instead of jittering.
function depenetrate(
  x: number,
  z: number,
  feetY: number,
  params: CharacterMoveParams,
  out: { x: number; z: number },
): void {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < MAX_DEPENETRATION_ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!blocksAt(c, px, pz, feetY, params)) continue;
      physicsStats.overlaps++;
      if (!overlapCollider(c, px, pz, params.radius, push)) continue;
      px += push.nx * (push.depth + SKIN_WIDTH);
      pz += push.nz * (push.depth + SKIN_WIDTH);
      moved = true;
    }
    if (!moved) break;
  }
  out.x = px;
  out.z = pz;
}

const depen = { x: 0, z: 0 };

/**
 * Move a character body by (dx, dz), resolving collision with sliding and
 * step-up. Writes the resolved pose into `out`; never allocates.
 */
export function moveCharacter(
  params: CharacterMoveParams,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  out: CharacterMoveResult,
): void {
  out.x = x;
  out.y = y;
  out.z = z;
  out.blocked = false;
  out.stepped = 0;

  // Broadphase over the whole swept extent, padded by the body and the step
  // reach so a step-up's headroom test sees the same candidate set.
  const pad = params.radius + params.stepHeight + 1;
  candidates.length = 0;
  queryOpenWorldColliders(
    params.seed,
    Math.min(x, x + dx) - pad,
    Math.min(z, z + dz) - pad,
    Math.max(x, x + dx) + pad,
    Math.max(z, z + dz) + pad,
    candidates,
  );
  pruneCandidates(x, z, dx, dz, params.radius + STEP_COMMIT_DISTANCE + SKIN_WIDTH);
  physicsStats.solves++;
  physicsStats.candidates += candidates.length;

  let feetY = y;
  depenetrate(x, z, feetY, params, depen);
  let px = depen.x;
  let pz = depen.z;
  let remX = dx;
  let remZ = dz;
  let blocked = false;
  let stepped = 0;
  // Entry state for the terrain-gate rollback below: rolling the position
  // back to the depenetrated origin must also roll back any step-up the
  // discarded motion committed, or `stepped`/`feetY` lie for this tick.
  const entryFeetY = feetY;

  for (let iter = 0; iter < MAX_SLIDE_ITERATIONS; iter++) {
    const len = Math.hypot(remX, remZ);
    if (len < MIN_MOTION) break;

    let bestT = Infinity;
    let bestIndex = -1;
    let bestNx = 0;
    let bestNz = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      // Sampled at the sweep's start: a body on a roof slope re-evaluates
      // each tick as it moves, while a body outside the footprint sees the
      // eave-clamped face as the wall it is.
      if (!blocksAt(c, px, pz, feetY, params)) continue;
      physicsStats.sweeps++;
      if (!sweepCollider(c, px, pz, remX, remZ, params.radius, hit)) continue;
      if (hit.t < bestT) {
        bestT = hit.t;
        bestIndex = i;
        bestNx = hit.nx;
        bestNz = hit.nz;
      }
    }
    if (bestIndex < 0) {
      px += remX;
      pz += remZ;
      break;
    }

    // Advance to just short of contact, keeping the skin gap.
    const skinT = Math.min(bestT, SKIN_WIDTH / len);
    const advance = Math.max(0, bestT - skinT);
    px += remX * advance;
    pz += remZ * advance;
    remX *= 1 - advance;
    remZ *= 1 - advance;

    // Step up rather than stop, when the obstacle is a low standable ledge and
    // the body fits at the raised height. The horizontal motion continues
    // unchanged: no vertical velocity, no input, no pause.
    //
    // The step must COMMIT the body onto the surface, not just raise it at the
    // contact point. Contact sits at `collider.r + bodyRadius` from the prop's
    // centre, while the kernel's support query only holds a body up well
    // inside that (a rim graze must not levitate anyone), so a raise alone
    // leaves the feet unsupported: the vertical pass drops them back the same
    // tick and depenetration shoves the body out again the next one. That is a
    // movement LOCK for anyone crossing slower than about three quarters of run
    // speed (backpedalling, snared, walking a diagonal). So the step advances
    // the body along its motion until the floor query actually reports the top
    // underfoot; if no clear, supported spot exists, the step is abandoned and
    // the body slides around the obstacle exactly as it would off a wall.
    const blocker = candidates[bestIndex];
    if (steppableAt(blocker, feetY, params)) {
      const lifted = (blocker.moveTopY as number) + TOP_EPS;
      const dirLen = Math.hypot(remX, remZ);
      const ux = dirLen > MIN_MOTION ? remX / dirLen : 0;
      const uz = dirLen > MIN_MOTION ? remZ / dirLen : 0;
      let committed = false;
      for (let s = 0; s < STEP_COMMIT_TRIES && !committed; s++) {
        const adv = (s * STEP_COMMIT_DISTANCE) / (STEP_COMMIT_TRIES - 1);
        const cx = px + ux * adv;
        const cz = pz + uz * adv;
        if (!isClear(cx, cz, lifted, params)) continue;
        const floor = supportFromCandidates(cx, cz, params.radius, lifted + TOP_EPS);
        if (floor < lifted - TOP_EPS) continue; // nothing underfoot there
        px = cx;
        pz = cz;
        const consumed = Math.min(adv, dirLen);
        remX -= ux * consumed;
        remZ -= uz * consumed;
        stepped += lifted - feetY;
        feetY = lifted;
        committed = true;
      }
      if (committed) continue;
    }

    blocked = true;
    // Slide: strip the into-surface component from what is left.
    const into = remX * bestNx + remZ * bestNz;
    if (into < 0) {
      remX -= into * bestNx;
      remZ -= into * bestNz;
    } else {
      break; // already moving away; nothing left to resolve
    }
  }

  // Terrain gate. The heightfield is not in the collider set, so the walkable
  // slope rule is applied to the net move.
  //
  // Three conditions reproduce the pre-engine rule exactly, and all three
  // matter: a SWIMMER is never terrain-gated (treading water over a steep
  // lake bank must not be walled); an AIRBORNE body is gated only by ground
  // that rises above its feet (otherwise a jump is stopped dead in mid-air by
  // a slope far below, killing every leap onto a bank); and the slope ratio is
  // measured against the REQUESTED step, not the collision-shortened one (a
  // 0.05 yd slide along a crate beside a hill is not a 2:1 climb).
  const groundStart = groundHeight(x, z, params.seed);
  let groundEnd = groundHeight(px, pz, params.seed);
  const run = Math.hypot(dx, dz);
  const airborneClears = !params.grounded && groundEnd <= feetY;
  if (!params.swimming && !airborneClears && groundEnd > groundStart && run > 1e-5) {
    const rise = groundEnd - groundStart;
    const unwalkable =
      rise / run > params.maxSlope || terrainSteepnessAt(px, pz, params.seed) > params.maxSlope;
    // NOTE: step-up deliberately does NOT apply to the heightfield. A per-tick
    // step allowance on terrain is a cliff-climbing ladder: at 20 Hz a body
    // covers about 0.35 yd per tick, so allowing a step-height rise each tick
    // would raise the effective climb limit to stepHeight/0.35 (over 2.2) and
    // let players walk up faces the slope gate exists to forbid. Terrain keeps
    // the original wall rule exactly; step-up is for placed geometry (stones,
    // kerbs, low props), which is what the player actually gets stuck on.
    if (unwalkable) {
      // A wall. Rather than stick, slide along the contour: project the
      // attempted motion perpendicular to the downhill gradient and retry it
      // once. A body brushing a steep face keeps moving across it.
      blocked = true;
      const slope = terrainDownhill(x, z, params.seed);
      const gx = slope?.x ?? 0;
      const gz = slope?.z ?? 0;
      const glen = Math.hypot(gx, gz);
      // Back to the DEPENETRATED origin, never the raw input: a body that
      // started embedded must keep the push-out that freed it. The rollback
      // covers the WHOLE horizontal move, so any step-up committed inside the
      // discarded motion unwinds with it: the reported feet and `stepped`
      // stay honest, and the step smoother never sees a phantom up-then-down.
      px = depen.x;
      pz = depen.z;
      feetY = entryFeetY;
      stepped = 0;
      if (glen > 1e-6) {
        const ux = gx / glen;
        const uz = gz / glen;
        const along = dx * ux + dz * uz;
        const contourX = dx - along * ux;
        const contourZ = dz - along * uz;
        if (Math.hypot(contourX, contourZ) > MIN_MOTION) {
          const cx = x + contourX;
          const cz = z + contourZ;
          const contourGround = groundHeight(cx, cz, params.seed);
          const contourRise = contourGround - groundStart;
          const contourRun = Math.hypot(contourX, contourZ);
          // Both halves of the original wall rule: the step's own slope AND
          // the gradient of the ground it lands on.
          const contourOk =
            (contourRise <= 0 || contourRise / contourRun <= params.maxSlope) &&
            terrainSteepnessAt(cx, cz, params.seed) <= params.maxSlope;
          if (contourOk && isClear(cx, cz, feetY, params)) {
            px = cx;
            pz = cz;
          }
        }
      }
      groundEnd = groundHeight(px, pz, params.seed);
    }
  }

  out.x = px;
  out.z = pz;
  out.y = feetY;
  out.blocked = blocked;
  out.stepped = stepped;
}

/**
 * The surface the body rests on at (x, z): the terrain, or the highest
 * standable prop top no higher than `maxY`. This is the floor query the
 * vertical pass lands and snaps against.
 */
export function floorHeightAt(
  seed: number,
  x: number,
  z: number,
  radius: number,
  maxY: number,
): number {
  return Math.max(groundHeight(x, z, seed), supportHeightAt(seed, x, z, radius, maxY));
}
