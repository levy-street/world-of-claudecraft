// Trial 2, Sugarglass Sigils: freedraw the seeded etched outline without
// cracking it. The sim OWNS the scoring; the client only streams shape-local
// trace points (it never decides progress or a shatter). Coverage is ORDER
// FREE: each on-band point carves the outline vertices near its arc position
// (drag forward, backward, or piecewise; your stroke carves whatever part of
// the outline it passes near), capped at coverageCapPerS new vertices per
// second so packet spam buys nothing. Straying outside the tolerance band is
// what costs you: crack accrues (faster the further out), and a full crack
// meter shatters the pane (a vitality chunk and a fresh shape). The outline
// geometry is the pure, shared sigil_shapes module; every numeric knob is
// GAUNTLET.sigils.

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import { placeContestantsAt } from './contestants';
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

// Covered fraction that counts the etching finished: freedraw forgives the
// last few vertices instead of demanding every sliver of the loop.
const SIGIL_DONE = 0.95;
// Crack accrues double once a point strays past this many tolerances out (a
// wild stroke fails faster than a graze).
const FAR_OFF_MULT_AT = 2;
// The wire's coverage mask width (one bit per 24th of the arc; the venue
// tints its outline segments from these bits).
export const SIGIL_MASK_BITS = 24;

export function startSigils(ctx: SimContext, run: GauntletRun): GauntletSigilsState {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.sigils.x, GAUNTLET_VENUE.sigils.z + 14, 10);
  const players = new Map<number, GauntletSigilsPlayer>();
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    players.set(pid, {
      shapeSeed: run.rng.int(1, 0x7fffffff),
      shapeId: run.rng.int(0, 3),
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

// Mark covered every vertex whose arc position lies within `tolerance` of the
// hit's arc fraction (wrapped around the closed loop), spending one unit of
// carve budget per NEW vertex. Returns the remaining budget.
function carveWindow(sp: GauntletSigilsPlayer, frac: number, budget: number): number {
  const n = sp.covered.length;
  const radius = GAUNTLET.sigils.tolerance * n;
  const center = frac * n;
  const lo = Math.ceil(center - radius);
  const hi = Math.floor(center + radius);
  for (let k = lo; k <= hi && budget >= 1; k++) {
    const idx = ((k % n) + n) % n;
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
      budget = carveWindow(sp, near.frac, budget);
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
