// Trial 2, Sugarglass Sigils: trace a seeded etched outline without cracking it.
// The sim OWNS the scoring; the client only streams shape-local trace points (it
// never decides progress or a shatter). Each accepted batch advances the trace
// along the outline, but progress can only advance by speedCap * elapsed since
// the last batch, so teleport-jumps buy nothing; straying off the etched line or
// reaching past the cap accrues crack, and a full crack meter shatters the pane
// (a vitality chunk and a fresh shape). The outline geometry is the pure,
// shared sigil_shapes module; every numeric knob is GAUNTLET.sigils.

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

// Progress fraction that counts the etching finished: the final outline segment
// only closes the loop, so 0.98 forgives the last sliver instead of demanding a
// pixel-perfect close.
const SIGIL_DONE = 0.98;
// Float slack when deciding a point reached past the speed cap.
const EPS = 1e-9;

export function startSigils(ctx: SimContext, run: GauntletRun): GauntletSigilsState {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.sigils.x, GAUNTLET_VENUE.sigils.z + 14, 10);
  const players = new Map<number, GauntletSigilsPlayer>();
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    players.set(pid, {
      shapeSeed: run.rng.int(1, 0x7fffffff),
      shapeId: run.rng.int(0, 3),
      crack: 0,
      progress: 0,
      lastPointAt: ctx.time,
      shatters: 0,
      done: false,
    });
  }
  return { kind: 'sigils', players };
}

// Precomputed arc-fractions for an outline: af[k] is the arc-fraction at vertex
// k, with af[0] = 0 and af[n] = 1 (the closing vertex). Built once per batch.
interface SigilArc {
  af: number[];
  n: number;
}

function sigilArc(o: SigilOutline): SigilArc {
  const n = o.xs.length;
  const seg = new Array<number>(n);
  let total = 0;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    seg[k] = Math.hypot(o.xs[j] - o.xs[k], o.ys[j] - o.ys[k]);
    total += seg[k];
  }
  const af = new Array<number>(n + 1);
  af[0] = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += seg[k];
    af[k + 1] = total > 0 ? acc / total : (k + 1) / n;
  }
  return { af, n };
}

interface Nearest {
  dist: number;
  frac: number;
  thin: boolean;
}

// Closest point on the outline that lies AHEAD of the cursor (arc-fraction in
// [progress, 1]): the nearest such point's distance decides off-path, its
// arc-fraction is the reachable progress, and its segment's thin flag scales
// accrual. Searching only forward means a cursor that has fallen behind the
// cursor makes no progress, and a genuine jump ahead is found but then clamped
// by the speed cap in the caller.
function nearestForward(
  o: SigilOutline,
  arc: SigilArc,
  progress: number,
  px: number,
  py: number,
): Nearest {
  const n = arc.n;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestFrac = progress;
  let bestThin = false;
  for (let k = 0; k < n; k++) {
    const a0 = arc.af[k];
    const a1 = arc.af[k + 1];
    if (a1 <= progress) continue; // wholly behind the cursor
    const j = (k + 1) % n;
    const x0 = o.xs[k];
    const y0 = o.ys[k];
    const dx = o.xs[j] - x0;
    const dy = o.ys[j] - y0;
    const segArc = a1 - a0;
    const tLo = a0 < progress ? (progress - a0) / segArc : 0;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    if (t < tLo) t = tLo;
    if (t > 1) t = 1;
    const qx = x0 + t * dx;
    const qy = y0 + t * dy;
    const d = Math.hypot(px - qx, py - qy);
    if (d < bestDist) {
      bestDist = d;
      bestFrac = a0 + t * segArc;
      bestThin = o.thin[k] || o.thin[j];
    }
  }
  return { dist: bestDist, frac: bestFrac, thin: bestThin };
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
  let budget = t.speedCap * elapsed; // the whole batch may advance at most this far

  const outline = sigilOutline(sp.shapeSeed, sp.shapeId, t.outlinePoints);
  const arc = sigilArc(outline);

  for (let i = 0; i < nPoints; i++) {
    const px = pts[2 * i];
    const py = pts[2 * i + 1];
    const near = nearestForward(outline, arc, sp.progress, px, py);
    const mult = near.thin ? t.thinSectionMult : 1;
    if (near.dist > t.tolerance) {
      // Off the etched line: crack accrues, no progress.
      sp.crack += t.crackOffPath * dtPoint * mult;
    } else {
      const desired = near.frac - sp.progress; // >= 0 (nearestForward searches ahead)
      const stepAdv = desired < budget ? desired : budget;
      sp.progress += stepAdv;
      budget -= stepAdv;
      if (desired > stepAdv + EPS) {
        // On the line but reaching past the speed cap: teleport-jumps buy nothing.
        sp.crack += t.crackOverSpeed * dtPoint * mult;
      }
    }
    if (sp.crack >= t.crackMax) {
      shatter(ctx, run, c, sp);
      break;
    }
    if (sp.progress >= SIGIL_DONE) {
      sp.done = true;
      const ps = run.playerStates.get(pid);
      if (ps && ps.finishedAt === null) ps.finishedAt = ctx.time;
      break;
    }
  }
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
  sp.progress = 0;
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
// the outline they carved (final progress as the 0..1 score); a finisher takes
// nothing. Then thin the NPC field toward this trial's target exactly once.
function endSigils(ctx: SimContext, run: GauntletRun, trial: GauntletSigilsState): void {
  for (const c of [...aliveContestants(run)]) {
    if (!c.player) continue;
    const ps = run.playerStates.get(c.entityId);
    if (!ps || ps.spectating) continue;
    const sp = trial.players.get(c.entityId);
    if (sp && sp.done) continue;
    const score = sp ? sp.progress : 0;
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
