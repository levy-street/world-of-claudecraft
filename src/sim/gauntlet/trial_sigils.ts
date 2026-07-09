// Trial 2, Sugarglass Sigils: trace the seeded etched outline in one continuous
// pass without cracking it. The sim OWNS the scoring; the client only streams
// shape-local trace points (it never decides progress or a shatter). Coverage is
// CONTINUOUS: the covered set is a single contiguous arc that grows only from the
// stroke's live frontier (start anywhere, drag either direction), so you must
// walk the whole loop connected: a point that lands far from the covered arc is a
// jump across the shape and carves nothing. Straying outside the tolerance band
// is what costs you: crack accrues (faster the further out), and a full crack
// meter shatters the pane (a vitality chunk and a fresh shape). The outline
// geometry is the pure, shared sigil_shapes module; every numeric knob is
// GAUNTLET.sigils.

import { GAUNTLET, GAUNTLET_VENUE, sigilRingAngle } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { seatLivePlayersAt } from './contestants';
import { type SigilOutline, sigilOutline } from './sigil_shapes';
import type {
  GauntletContestant,
  GauntletRun,
  GauntletSigilsPlayer,
  GauntletSigilsState,
} from './state';
import {
  aliveContestants,
  applyVitalityDamage,
  cullNpcsToward,
  trialDamageFromScore,
} from './vitality';

// Covered fraction that counts the etching finished: near-total, forgiving only
// the last sliver where the two frontier ends close the loop.
const SIGIL_DONE = 0.98;
// Crack accrues double once a point strays past this many tolerances out (a
// wild stroke fails faster than a graze).
const FAR_OFF_MULT_AT = 2;
// The wire's coverage mask width (one bit per 24th of the arc; the venue
// tints its outline segments from these bits).
export const SIGIL_MASK_BITS = 24;

// Where the i-th live player stands for the etching. There is ONE interactive
// lectern: the first player takes the etcher's mark dead ahead of the slab
// face (facing -x, the slab tilts toward +x); any extra players (online runs)
// park in a small arc around it and share the slab view (the v1 answer to the
// one-lectern design gap).
function lecternSpot(i: number): { x: number; z: number; facing: number } {
  const { x, z } = GAUNTLET_VENUE.sigils;
  const ang = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * 0.55 * Math.ceil(i / 2);
  const px = x + 1.8 * Math.cos(ang);
  const pz = z + 1.8 * Math.sin(ang);
  return { x: px, z: pz, facing: Math.atan2(x - px, z - pz) };
}

// The NPC field mans the cosmetic lectern ring: one etcher per station facing
// its own slab (and the pavilion center), extras ranked up behind, so the
// pavilion reads as a working hall rather than a waiting crowd. Direct pos
// writes, no rng draws.
function seatNpcsAtRingLecterns(ctx: SimContext, run: GauntletRun): void {
  const { x, z, ring } = GAUNTLET_VENUE.sigils;
  const npcs = aliveContestants(run).filter((c) => !c.player);
  for (let i = 0; i < npcs.length; i++) {
    const e = ctx.entities.get(npcs[i].entityId);
    if (!e) continue;
    const a = sigilRingAngle(i % ring.count, ring.count);
    const r = ring.radius + 1.6 + Math.floor(i / ring.count) * 1.6;
    const px = run.origin.x + x + Math.sin(a) * r;
    const pz = run.origin.z + z + Math.cos(a) * r;
    e.pos = ctx.groundPos(px, pz);
    e.prevPos = { ...e.pos };
    e.facing = Math.atan2(run.origin.x + x - px, run.origin.z + z - pz);
    ctx.rebucket(e);
  }
}

// Seat the whole field at the etching pavilion: players AT the interactive
// lecterns, the NPC field at the cosmetic ring lecterns. Positioning only (no
// state, no rng), so runs.ts can call it during the interlude to stand everyone
// at their stations while the countdown runs, and startSigils reuses it.
export function seatSigilsField(ctx: SimContext, run: GauntletRun): void {
  seatLivePlayersAt(ctx, run, (i) => lecternSpot(i));
  seatNpcsAtRingLecterns(ctx, run);
}

export function startSigils(ctx: SimContext, run: GauntletRun): GauntletSigilsState {
  // Everyone is at a station for this one (runs.ts pins the players there for
  // the trial); the same seating already ran when the interlude opened.
  seatSigilsField(ctx, run);
  const players = new Map<number, GauntletSigilsPlayer>();
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    players.set(pid, {
      shapeSeed: run.rng.int(1, 0x7fffffff),
      // Any of the five shapes (0 triangle, 1 circle, 2 star, 3 rectangle,
      // 4 hexagon). One rng draw, so the per-run stream's draw order is unchanged.
      shapeId: run.rng.int(0, 4),
      crack: 0,
      covered: new Array<boolean>(GAUNTLET.sigils.outlinePoints).fill(false),
      coveredCount: 0,
      carveBank: 0,
      lastPointAt: ctx.time,
      shatters: 0,
      done: false,
    });
  }
  return { kind: 'sigils', players };
}

/** Covered fraction of the outline (the trial's 0..1 progress/score). */
export function sigilCoverage(sp: GauntletSigilsPlayer): number {
  const n = sp.covered.length;
  return n > 0 ? sp.coveredCount / n : 0;
}

/** The wire's 24-bit coverage mask: bit k = any vertex in the k-th 24th of
 * the arc covered. Vertices are evenly spaced by arc length, so index order
 * IS arc order. */
export function sigilCoveredMask(sp: GauntletSigilsPlayer): number {
  const n = sp.covered.length;
  let mask = 0;
  for (let i = 0; i < n; i++) {
    if (!sp.covered[i]) continue;
    mask |= 1 << Math.min(SIGIL_MASK_BITS - 1, Math.floor((i * SIGIL_MASK_BITS) / n));
  }
  return mask >>> 0;
}

interface Nearest {
  dist: number;
  frac: number;
  thin: boolean;
}

// Closest point on ANY outline segment: its distance decides on/off band, its
// arc-fraction centers the coverage window, and its segment's thin flag scales
// crack accrual. Order-free by design (freedraw).
function nearestAny(o: SigilOutline, px: number, py: number): Nearest {
  const n = o.xs.length;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestFrac = 0;
  let bestThin = false;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const x0 = o.xs[k];
    const y0 = o.ys[k];
    const dx = o.xs[j] - x0;
    const dy = o.ys[j] - y0;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const qx = x0 + t * dx;
    const qy = y0 + t * dy;
    const d = Math.hypot(px - qx, py - qy);
    if (d < bestDist) {
      bestDist = d;
      // Vertices are evenly spaced by arc length, so (k + t) / n IS the hit's
      // arc fraction.
      bestFrac = (k + t) / n;
      bestThin = o.thin[k] || o.thin[j];
    }
  }
  return { dist: bestDist, frac: bestFrac, thin: bestThin };
}

// Extend the covered arc contiguously from the stroke's live frontier. The first
// on-band point seeds coverage anywhere on the loop; after that a point only
// carves if its arc position lands within `contiguityArcFrac` of an
// already-covered vertex (either direction), filling the small gap up to it so a
// fast drag leaves no holes. A point that lands further out (a jump across the
// shape) carves NOTHING: you must trace the loop in one connected pass, not dab
// disconnected pieces. Spends one unit of carve budget per NEW vertex; returns
// the remaining budget. Wraps around the closed loop.
function carveContiguous(sp: GauntletSigilsPlayer, frac: number, budget: number): number {
  const n = sp.covered.length;
  const wrap = (k: number): number => ((k % n) + n) % n;
  const hit = wrap(Math.round(frac * n));
  // Seed anywhere while the arc is empty.
  if (sp.coveredCount === 0) {
    if (budget >= 1 && !sp.covered[hit]) {
      sp.covered[hit] = true;
      sp.coveredCount++;
      budget -= 1;
    }
    return budget;
  }
  if (sp.covered[hit]) return budget; // already on the covered arc: nothing new
  // Find the nearest covered vertex within reach, either direction.
  const reach = Math.max(1, Math.round(GAUNTLET.sigils.contiguityArcFrac * n));
  let gap = 0;
  let dir = 0;
  for (let d = 1; d <= reach; d++) {
    if (sp.covered[wrap(hit + d)]) {
      gap = d;
      dir = 1;
      break;
    }
    if (sp.covered[wrap(hit - d)]) {
      gap = d;
      dir = -1;
      break;
    }
  }
  if (dir === 0) return budget; // a jump, not a continuation: carve nothing
  // Fill from the hit up to (but not including) the covered neighbour, extending
  // the contiguous arc toward the stroke.
  for (let d = 0; d < gap && budget >= 1; d++) {
    const idx = wrap(hit + dir * d);
    if (!sp.covered[idx]) {
      sp.covered[idx] = true;
      sp.coveredCount++;
      budget -= 1;
    }
  }
  return budget;
}

export function gauntletTraceSigils(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletSigilsState,
  pid: number,
  pts: number[],
): void {
  const sp = trial.players.get(pid);
  if (!sp || sp.done) return;
  const nPoints = pts.length >> 1;
  if (nPoints === 0) return;
  const c = run.contestants.find((k) => k.entityId === pid);
  if (!c || c.eliminatedAtTrial !== null) {
    sp.lastPointAt = ctx.time;
    return;
  }

  const t = GAUNTLET.sigils;
  const elapsed = Math.max(0, ctx.time - sp.lastPointAt);
  const dtPoint = elapsed / nPoints; // crack accrual is per second, sliced over the batch
  // The batch may carve at most this many NEW vertices: the budget accrues at
  // coverageCapPerS and banks at most one second's worth, so a clean drag is
  // never capped at any batch cadence while packet spam and teleport-taps buy
  // nothing past the rate (the anti-teleport rule).
  let budget = Math.min(t.coverageCapPerS, sp.carveBank + t.coverageCapPerS * elapsed);

  const outline = sigilOutline(sp.shapeSeed, sp.shapeId, t.outlinePoints);

  for (let i = 0; i < nPoints; i++) {
    const px = pts[2 * i];
    const py = pts[2 * i + 1];
    const near = nearestAny(outline, px, py);
    if (near.dist > t.tolerance) {
      // Off the etched line: crack accrues, no coverage. A point far outside
      // the band (a wild stroke, not a graze) accrues double.
      const far = near.dist > FAR_OFF_MULT_AT * t.tolerance ? 2 : 1;
      sp.crack += t.crackOffPath * dtPoint * (near.thin ? t.thinSectionMult : 1) * far;
    } else {
      budget = carveContiguous(sp, near.frac, budget);
    }
    if (sp.crack >= t.crackMax) {
      shatter(ctx, run, c, sp);
      break;
    }
    if (sigilCoverage(sp) >= SIGIL_DONE) {
      sp.done = true;
      const ps = run.playerStates.get(pid);
      if (ps && ps.finishedAt === null) ps.finishedAt = ctx.time;
      break;
    }
  }
  sp.carveBank = budget; // the fractional remainder carries to the next batch
  sp.lastPointAt = ctx.time;
}

function shatter(
  ctx: SimContext,
  run: GauntletRun,
  c: GauntletContestant,
  sp: GauntletSigilsPlayer,
): void {
  applyVitalityDamage(ctx, run, c, GAUNTLET.sigils.shatterDamage, 'caught');
  sp.crack = 0;
  sp.covered.fill(false);
  sp.coveredCount = 0;
  sp.shapeSeed = run.rng.int(1, 0x7fffffff); // a fresh etching to trace from the top
  sp.shatters++;
}

export function updateSigils(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt; // NPCs kneel in place; the trial resolves on completion or the clock
  const trial = run.trial;
  if (!trial || trial.kind !== 'sigils') return true;
  const expired = ctx.time >= run.phaseEndsAt;
  if (!expired && !allSigilsDone(run, trial)) return false;
  endSigils(ctx, run, trial);
  return true;
}

// Resolved when every live, non-spectating player has finished (vacuously true
// when none are live, so an all-knocked-out field still advances the run).
function allSigilsDone(run: GauntletRun, trial: GauntletSigilsState): boolean {
  for (const c of aliveContestants(run)) {
    if (!c.player) continue;
    const ps = run.playerStates.get(c.entityId);
    if (!ps || ps.spectating) continue;
    const sp = trial.players.get(c.entityId);
    if (!sp || !sp.done) return false;
  }
  return true;
}

// End-of-trial damage: an unfinished player takes damage scaled by how little of
// the outline they carved (final coverage as the 0..1 score); a finisher takes
// nothing. Then thin the NPC field toward this trial's target exactly once.
function endSigils(ctx: SimContext, run: GauntletRun, trial: GauntletSigilsState): void {
  for (const c of [...aliveContestants(run)]) {
    if (!c.player) continue;
    const ps = run.playerStates.get(c.entityId);
    if (!ps || ps.spectating) continue;
    const sp = trial.players.get(c.entityId);
    if (sp && sp.done) continue;
    const score = sp ? sigilCoverage(sp) : 0;
    applyVitalityDamage(
      ctx,
      run,
      c,
      trialDamageFromScore(score, GAUNTLET.sigils.damageMax),
      'trial',
    );
  }
  cullNpcsToward(ctx, run);
}
