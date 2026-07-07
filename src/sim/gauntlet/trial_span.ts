// Trial 5 of The Gauntlet, The Brittle Span: paired floor panels bridge the pit,
// one of each pair brittle. There is no command for this trial; crossing IS the
// input. Position detection each tick resolves a step (stand on the safe panel
// to advance, the brittle panel or the gap between the pair to fall into the
// pit), and every step a crosser or a player takes is shared knowledge that
// reveals that pair's safe side to the whole field. Seeded NPC crossers go
// first and light up the early panels.
//
// Frozen contracts: GauntletSpanTuning (types.ts), GauntletSpanState (state.ts),
// the `span` view member (runs.ts gauntletRunWire), tuning GAUNTLET.span
// (content/gauntlet.ts). Determinism: run.rng is drawn only at startSpan (the
// crosser plans), in a fixed order; the per-tick logic is draw-free apart from
// the single fixed-order cullNpcsToward at resolution. No Math.random/Date.now.
//
// Panel geometry (instance-local yards; the venue renderer draws the panels at
// EXACTLY these rects, keep both in agreement). Crossing axis is +z. The field
// begins at spanZStart() = anchor.z - (steps * panelLength) / 2; step i occupies
// z in [zStart + i*panelLength, zStart + (i+1)*panelLength). Side 0 (left) has
// center x = anchor.x - (panelGap/2 + panelWidth/2), side 1 (right) mirrored
// positive; a contestant is ON side s of step i when their local x is within
// panelWidth/2 of that side's center and their local z is inside step i. Anchor
// is GAUNTLET_VENUE.span; every measurement comes from GAUNTLET.span.

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { placeContestantsAt } from './contestants';
import type { GauntletContestant, GauntletRun, GauntletSpanState } from './state';
import {
  aliveContestants,
  applyVitalityDamage,
  cullNpcsToward,
  trialDamageFromScore,
} from './vitality';

// Yards south of the first panel row a fallen player is dropped to try again.
const SPAN_RESPAWN_MARGIN = 2;
// Yards past the far edge that a crosser who clears the span stands and stops.
const SPAN_CROSSER_EXIT_MARGIN = 2;

export function startSpan(ctx: SimContext, run: GauntletRun): GauntletSpanState {
  const t = GAUNTLET.span;
  placeContestantsAt(
    ctx,
    run,
    GAUNTLET_VENUE.span.x,
    GAUNTLET_VENUE.span.z - GAUNTLET_VENUE.span.length / 2 - 6,
    8,
  );
  // A salted sub-stream so the layout is one fixed draw regardless of the
  // mid-trial draws around it.
  const layoutRng = new Rng((run.seed ^ 0x5eed5) >>> 0);
  const safeSide: number[] = [];
  for (let i = 0; i < t.steps; i++) safeSide.push(layoutRng.chance(0.5) ? 0 : 1);

  // Seed the NPC crossers: the most skilled surviving contestants go first. Cap
  // the count to the field's slack above this trial's survivor target, so their
  // falls never thin the NPC field below it (cullNpcsToward only ever removes
  // DOWN to the target, never replenishes, so a trial must not drop beneath it);
  // with no slack there are simply no crossers and the players probe the span
  // themselves.
  const target = GAUNTLET.targetSurvivorsPerTrial[run.trialIndex] ?? 0;
  const alive = aliveContestants(run);
  const alivePlayers = alive.filter((c) => c.player).length;
  const npcs = alive
    .filter((c) => !c.player)
    .sort((a, b) => b.skill - a.skill || a.entityId - b.entityId);
  const keep = Math.max(0, target - alivePlayers);
  const crosserCount = Math.min(t.npcAheadCount, Math.max(0, npcs.length - keep));

  // Precompute each crosser's fall step deterministically, in a fixed order,
  // each inheriting the reveals of those ahead of it (the field learns as it
  // crosses). The plan array is a scratch copy: trial.revealed starts blank and
  // is filled by the ACTUAL crossings (crossers and players) at runtime.
  const revealedPlan = safeSide.map(() => -1);
  const npcCrossers: GauntletSpanState['npcCrossers'] = [];
  for (let i = 0; i < crosserCount; i++) {
    npcCrossers.push({
      entityId: npcs[i].entityId,
      step: -1,
      fallStep: planCrosserFall(run.rng, safeSide, revealedPlan),
    });
  }

  return {
    kind: 'span',
    safeSide,
    revealed: safeSide.map(() => -1),
    npcCrossers,
    nextNpcStepAt: ctx.time + t.npcStepPeriodS,
    playerStep: new Map(),
    finished: new Set(),
  };
}

export function updateSpan(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  void dt;
  const trial = run.trial;
  if (!trial || trial.kind !== 'span') return true;

  advanceCrossers(ctx, run, trial);
  detectPlayers(ctx, run, trial);

  if (ctx.time >= run.phaseEndsAt || spanAllFinished(run)) {
    endSpan(ctx, run, trial);
    return true;
  }
  return false;
}

// Walk the span for one crosser: known-safe pairs are crossed for free (no
// draw), each still-unknown pair is a fair coin that reveals the safe side
// either way, and the first wrong guess is the fall. Returns the fall step, or
// null for a clean crossing. Mutates `revealed` so the next crosser inherits
// this one's reveals.
export function planCrosserFall(rng: Rng, safeSide: number[], revealed: number[]): number | null {
  for (let s = 0; s < safeSide.length; s++) {
    if (revealed[s] >= 0) continue;
    const pick = rng.chance(0.5) ? 0 : 1;
    revealed[s] = safeSide[s];
    if (pick !== safeSide[s]) return s;
  }
  return null;
}

// One NPC crosser step per cadence: the lead (first not-yet-done) crosser
// advances a single panel. A known pair is walked on its safe side; a still
// unknown pair is revealed by the step, and if it is this crosser's planned
// fall the brittle guess poofs them (their death teaches the field the safe
// side). Cosmetic position writes only; no rng.
function advanceCrossers(ctx: SimContext, run: GauntletRun, trial: GauntletSpanState): void {
  const t = GAUNTLET.span;
  if (ctx.time < trial.nextNpcStepAt) return;
  trial.nextNpcStepAt = ctx.time + t.npcStepPeriodS;
  for (const cr of trial.npcCrossers) {
    const c = run.contestants.find((k) => k.entityId === cr.entityId);
    if (!c || c.eliminatedAtTrial !== null || cr.step >= t.steps) continue; // done: skip
    cr.step++;
    const s = cr.step;
    const e = ctx.entities.get(cr.entityId);
    if (s >= t.steps) {
      if (e)
        placeCrosser(
          ctx,
          run,
          e,
          GAUNTLET_VENUE.span.x,
          spanFieldEndZ() + SPAN_CROSSER_EXIT_MARGIN,
        );
      return;
    }
    if (trial.revealed[s] >= 0) {
      if (e) placeCrosser(ctx, run, e, spanSideCenterX(trial.revealed[s]), spanStepCenterZ(s));
      return;
    }
    // First onto this pair: stepping on it reveals the safe side either way.
    trial.revealed[s] = trial.safeSide[s];
    if (s === cr.fallStep) {
      if (e) placeCrosser(ctx, run, e, spanSideCenterX(1 - trial.safeSide[s]), spanStepCenterZ(s));
      applyVitalityDamage(ctx, run, c, c.vitality, 'caught');
      return;
    }
    if (e) placeCrosser(ctx, run, e, spanSideCenterX(trial.safeSide[s]), spanStepCenterZ(s));
    return;
  }
}

// Authoritative per-tick position detection for every live player. Standing on a
// step's safe panel proves it and advances progress; the brittle panel or the
// gap is a fall (a vitality chunk and a respawn at the span start); crossing the
// far edge finishes the trial for that player.
function detectPlayers(ctx: SimContext, run: GauntletRun, trial: GauntletSpanState): void {
  const t = GAUNTLET.span;
  const zStart = spanZStart();
  const fieldEnd = spanFieldEndZ();
  for (const c of run.contestants) {
    if (!c.player || c.eliminatedAtTrial !== null) continue;
    const ps = run.playerStates.get(c.entityId);
    const e = ctx.entities.get(c.entityId);
    if (!ps || !e || ps.spectating || ps.finishedAt !== null) continue;
    const lx = e.pos.x - run.origin.x;
    const lz = e.pos.z - run.origin.z;
    if (lz >= fieldEnd) {
      // Past the far edge: a finish once inside the panel-width envelope.
      if (spanInEnvelope(lx)) {
        trial.finished.add(c.entityId);
        ps.finishedAt = ctx.time;
      }
      continue;
    }
    if (lz < zStart) continue; // still approaching from the south
    const step = clampStep(Math.floor((lz - zStart) / t.panelLength));
    const side = spanSideAt(lx);
    if (side < 0) {
      // The gap between the pair, or beyond either panel's width: into the pit.
      spanFall(ctx, run, c, e);
      continue;
    }
    if (side !== trial.safeSide[step]) {
      // The brittle panel shatters, revealing its safe side as it goes.
      trial.revealed[step] = trial.safeSide[step];
      spanFall(ctx, run, c, e);
      continue;
    }
    // Stood on the safe panel: proven safe, and progress recorded.
    trial.revealed[step] = trial.safeSide[step];
    const prev = trial.playerStep.get(c.entityId) ?? -1;
    if (step > prev) trial.playerStep.set(c.entityId, step);
  }
}

// A fall: a vitality chunk, then a respawn at the span start (unless the chunk
// eliminated them, in which case eliminateContestant already parked them as a
// spectator and must not be overridden).
function spanFall(ctx: SimContext, run: GauntletRun, c: GauntletContestant, e: Entity): void {
  const fell = applyVitalityDamage(ctx, run, c, GAUNTLET.span.fallDamage, 'caught');
  if (fell) return;
  const x = run.origin.x + GAUNTLET_VENUE.span.x;
  const z = run.origin.z + spanZStart() - SPAN_RESPAWN_MARGIN;
  e.pos = ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  e.facing = 0;
  ctx.rebucket(e);
}

// Resolved: every live non-spectating player has crossed (vacuously true once
// none remain, so a run whose players all fell out resolves at once rather than
// idling to the clock).
function spanAllFinished(run: GauntletRun): boolean {
  for (const c of run.contestants) {
    if (!c.player || c.eliminatedAtTrial !== null) continue;
    const ps = run.playerStates.get(c.entityId);
    if (!ps || ps.spectating) continue;
    if (ps.finishedAt === null) return false;
  }
  return true;
}

// End-of-trial resolution: timeout damage for anyone the clock caught short
// (scaled by how many panels they proved), then the one NPC attrition cull.
function endSpan(ctx: SimContext, run: GauntletRun, trial: GauntletSpanState): void {
  const t = GAUNTLET.span;
  for (const c of [...aliveContestants(run)]) {
    if (!c.player) continue;
    const ps = run.playerStates.get(c.entityId);
    if (!ps || ps.spectating || ps.finishedAt !== null) continue;
    const step = trial.playerStep.get(c.entityId) ?? -1;
    const score = (step + 1) / t.steps;
    applyVitalityDamage(ctx, run, c, trialDamageFromScore(score, t.damageMax), 'timeout');
  }
  cullNpcsToward(ctx, run);
}

// A cosmetic crosser position write onto an instance-local (x, z) panel point.
function placeCrosser(
  ctx: SimContext,
  run: GauntletRun,
  e: Entity,
  localX: number,
  localZ: number,
): void {
  e.prevPos = { ...e.pos };
  e.pos = ctx.groundPos(run.origin.x + localX, run.origin.z + localZ);
  e.facing = 0;
  ctx.rebucket(e);
}

// --- Panel geometry (instance-local yards; see the header). Exported so the
// venue renderer and the tests share ONE source of truth for the panel rects. --

export function spanZStart(): number {
  const t = GAUNTLET.span;
  return GAUNTLET_VENUE.span.z - (t.steps * t.panelLength) / 2;
}

export function spanFieldEndZ(): number {
  const t = GAUNTLET.span;
  return spanZStart() + t.steps * t.panelLength;
}

export function spanSideCenterX(side: number): number {
  const t = GAUNTLET.span;
  const off = t.panelGap / 2 + t.panelWidth / 2;
  return GAUNTLET_VENUE.span.x + (side === 0 ? -off : off);
}

export function spanStepCenterZ(step: number): number {
  const t = GAUNTLET.span;
  return spanZStart() + (step + 0.5) * t.panelLength;
}

// Which panel side (0 left, 1 right) an instance-local x sits on, or -1 for the
// gap between the pair or beyond either panel's width.
function spanSideAt(lx: number): number {
  const half = GAUNTLET.span.panelWidth / 2;
  if (Math.abs(lx - spanSideCenterX(0)) <= half) return 0;
  if (Math.abs(lx - spanSideCenterX(1)) <= half) return 1;
  return -1;
}

// Inside the outer envelope of the twin panels (used for the finish line past
// the far edge, where the individual panels have ended).
function spanInEnvelope(lx: number): boolean {
  const t = GAUNTLET.span;
  return Math.abs(lx - GAUNTLET_VENUE.span.x) <= t.panelGap / 2 + t.panelWidth;
}

function clampStep(i: number): number {
  const last = GAUNTLET.span.steps - 1;
  return i < 0 ? 0 : i > last ? last : i;
}
