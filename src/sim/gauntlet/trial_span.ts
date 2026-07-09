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
// Yards south of the first pair the players open on (one stride from the
// glass, squarely in front of a panel column, never off beside the deck).
const SPAN_START_MARGIN = 2;

// Stand the field at the crossing: the NPC crowd on the approach behind the
// start line, every live player squared up in front of a panel column (left/
// right alternating), one stride from the first pair. Positioning only (no
// state, no rng), so runs.ts can call it during the interlude to line everyone
// up at the span while the countdown runs, and startSpan reuses the seating.
export function seatSpanField(ctx: SimContext, run: GauntletRun): void {
  placeContestantsAt(ctx, run, GAUNTLET_VENUE.span.x, spanZStart() - SPAN_START_MARGIN - 3, 4);
  let lane = 0;
  for (const [pid, ps] of run.playerStates) {
    if (ps.spectating) continue;
    const c = run.contestants.find((q) => q.entityId === pid);
    if (!c || c.eliminatedAtTrial !== null) continue;
    const e = ctx.entities.get(pid);
    if (!e) continue;
    e.pos = ctx.groundPos(
      run.origin.x + spanSideCenterX(lane % 2),
      run.origin.z + spanZStart() - SPAN_START_MARGIN,
    );
    e.prevPos = { ...e.pos };
    e.facing = 0; // squared up on the crossing (+z)
    ctx.rebucket(e);
    lane++;
  }
}

export function startSpan(ctx: SimContext, run: GauntletRun): GauntletSpanState {
  const t = GAUNTLET.span;
  // The field is already lined up at the crossing (the interlude seated them);
  // reassert it so a mid-run start is safe.
  seatSpanField(ctx, run);
  // A salted sub-stream so the layout is one fixed draw regardless of the
  // mid-trial draws around it.
  const layoutRng = new Rng((run.seed ^ 0x5eed5) >>> 0);
  const safeSide: number[] = [];
  for (let i = 0; i < t.steps; i++) safeSide.push(layoutRng.chance(0.5) ? 0 : 1);

  // Seed the NPC crossers: the most skilled surviving contestants go first, up
  // to npcAheadCount of them. Only the field's SLACK above this trial's survivor
  // target may FALL (cullNpcsToward only ever removes DOWN to the target, never
  // replenishes, so a trial must not drop beneath it); a crosser beyond the
  // slack still scouts the glass but crosses clean. This used to cap the crosser
  // COUNT to the slack, so a late run thinned to its target (a survivor or two)
  // seated ZERO crossers and no bot ever stepped onto the panels, reading as a
  // dead trial. Now the remnant always scouts.
  const target = GAUNTLET.targetSurvivorsPerTrial[run.trialIndex] ?? 0;
  const alive = aliveContestants(run);
  const alivePlayers = alive.filter((c) => c.player).length;
  const npcs = alive
    .filter((c) => !c.player)
    .sort((a, b) => b.skill - a.skill || a.entityId - b.entityId);
  const keep = Math.max(0, target - alivePlayers);
  const slack = Math.max(0, npcs.length - keep);
  const crosserCount = Math.min(t.npcAheadCount, npcs.length);

  // Precompute each sacrificeable crosser's fatal fall step deterministically,
  // in a fixed order, each inheriting the reveals of those ahead of it (the
  // field learns as it crosses). Scouts beyond the slack cross clean UNLESS a
  // salted roll gives them ONE honest wrong guess (a stumble they respawn from
  // and finish), so the field is never thinned below target. Only the fallers
  // draw from run.rng, and slack <= npcs so the faller count is unchanged, so the
  // main draw order matches the old fall-capped seeding exactly; the stumble
  // rolls use a separate salted stream. The plan array is a scratch copy:
  // trial.revealed starts blank and is filled by the ACTUAL crossings at runtime.
  const revealedPlan = safeSide.map(() => -1);
  const stumbleRng = new Rng((run.seed ^ 0x57a3b1e) >>> 0);
  const npcCrossers: GauntletSpanState['npcCrossers'] = [];
  for (let i = 0; i < crosserCount; i++) {
    const scout = i >= slack;
    const fallStep = scout ? null : planCrosserFall(run.rng, safeSide, revealedPlan);
    const stumbleStep =
      scout && stumbleRng.chance(t.npcStumbleChance) ? stumbleRng.int(0, t.steps - 1) : -1;
    npcCrossers.push({
      entityId: npcs[i].entityId,
      step: -1,
      fallStep,
      stumbleStep,
      mode: 'idle',
      segT: 0,
      hopFromX: 0,
      hopFromZ: 0,
    });
  }

  return {
    kind: 'span',
    safeSide,
    revealed: safeSide.map(() => -1),
    npcCrossers,
    playerStep: new Map(),
    finished: new Set(),
  };
}

export function updateSpan(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  const trial = run.trial;
  if (!trial || trial.kind !== 'span') return true;

  updateCrossers(ctx, run, trial, dt);
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

// The side (0/1) a crosser hops onto for the still-unknown panel `toStep`: a
// known pair is walked on its proven safe side; an unknown pair is a guess, and
// it guesses WRONG on its one scripted panel (the expendable's fatal fallStep or
// a scout's honest stumbleStep) and right (revealing the safe side) everywhere
// else.
function crosserHopSide(trial: GauntletSpanState, cr: SpanCrosser, toStep: number): number {
  if (trial.revealed[toStep] >= 0) return trial.revealed[toStep];
  if (toStep === cr.fallStep || toStep === cr.stumbleStep) return 1 - trial.safeSide[toStep];
  return trial.safeSide[toStep];
}

type SpanCrosser = GauntletSpanState['npcCrossers'][number];

// Per-tick crosser locomotion: the lead (first not-yet-done, still-alive)
// crosser actually RUNS and HOPS the span one panel at a time, so only one is
// ever mid-air and the reveal order stays the seeded one. Each landing proves
// its pair (teaching the whole field the safe side); a wrong guess drops the
// crosser through the shattered panel into the pit, where an expendable crosser
// is knocked out and a scout climbs back at the start to try again. Draw-free.
function updateCrossers(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletSpanState,
  dt: number,
): void {
  const t = GAUNTLET.span;
  let lead: SpanCrosser | null = null;
  for (const cr of trial.npcCrossers) {
    if (cr.mode === 'done') continue;
    const c = run.contestants.find((k) => k.entityId === cr.entityId);
    if (!c || c.eliminatedAtTrial !== null || !ctx.entities.has(cr.entityId)) {
      cr.mode = 'done'; // fell to a cull, or the entity is gone: retire the slot
      continue;
    }
    lead = cr;
    break;
  }
  if (!lead) return;
  const e = ctx.entities.get(lead.entityId);
  if (!e) return;

  if (lead.mode === 'idle') {
    // Break from the crowd: the first hop starts from wherever they were waiting.
    lead.hopFromX = e.pos.x - run.origin.x;
    lead.hopFromZ = e.pos.z - run.origin.z;
    lead.segT = 0;
    lead.mode = 'hop';
  }

  if (lead.mode === 'hop') {
    const toStep = lead.step + 1;
    const exiting = toStep >= t.steps;
    const side = exiting ? 0 : crosserHopSide(trial, lead, toStep);
    const toX = exiting ? GAUNTLET_VENUE.span.x : spanSideCenterX(side);
    const toZ = exiting ? spanFieldEndZ() + SPAN_CROSSER_EXIT_MARGIN : spanStepCenterZ(toStep);
    lead.segT = Math.min(1, lead.segT + dt / t.npcHopS);
    placeArc(ctx, run, e, lead.hopFromX, lead.hopFromZ, toX, toZ, lead.segT, t.npcJumpHeight);
    if (lead.segT >= 1) {
      lead.step = toStep;
      if (exiting) {
        lead.mode = 'done'; // cleared the whole span
        return;
      }
      trial.revealed[toStep] = trial.safeSide[toStep]; // the landing proves the pair
      if (side !== trial.safeSide[toStep]) {
        lead.segT = 0;
        lead.mode = 'plunge'; // stepped on the brittle side: it shatters underfoot
      } else {
        lead.hopFromX = toX; // bound straight into the next hop
        lead.hopFromZ = toZ;
        lead.segT = 0;
      }
    }
    return;
  }

  // Plunge: drop straight through the shattered brittle side into the pit.
  lead.segT = Math.min(1, lead.segT + dt / t.npcPlungeS);
  placePlunge(
    ctx,
    run,
    e,
    spanSideCenterX(1 - trial.safeSide[lead.step]),
    spanStepCenterZ(lead.step),
    lead.segT,
    t.npcPlungeDrop,
  );
  if (lead.segT < 1) return;
  const c = run.contestants.find((k) => k.entityId === lead.entityId);
  if (lead.step === lead.fallStep) {
    // The expendable crosser's scripted knockout (the show's drama, and it
    // teaches the field the safe side on the way down).
    if (c) applyVitalityDamage(ctx, run, c, c.vitality, 'caught');
    lead.mode = 'done';
  } else {
    // A scout's honest mistake: climb back out at the start and try again. The
    // panel it fell on is revealed now, so it will not trip on it twice.
    placeCrosser(ctx, run, e, spanSideCenterX(0), spanZStart() - SPAN_RESPAWN_MARGIN);
    lead.step = -1;
    lead.segT = 0;
    lead.mode = 'idle';
  }
}

// A smooth run-and-hop from one instance-local point to another over segT in
// 0..1, with a parabolic jump arc: the crosser leaves the deck at takeoff,
// peaks mid-gap, and lands on the far panel, facing where it is leaping.
function placeArc(
  ctx: SimContext,
  run: GauntletRun,
  e: Entity,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  segT: number,
  jumpH: number,
): void {
  const fromY = ctx.groundPos(run.origin.x + fromX, run.origin.z + fromZ).y;
  const toY = ctx.groundPos(run.origin.x + toX, run.origin.z + toZ).y;
  e.prevPos = { ...e.pos };
  e.pos = {
    x: run.origin.x + fromX + (toX - fromX) * segT,
    y: fromY + (toY - fromY) * segT + jumpH * Math.sin(Math.PI * segT),
    z: run.origin.z + fromZ + (toZ - fromZ) * segT,
  };
  e.facing = Math.atan2(toX - fromX, toZ - fromZ);
  ctx.rebucket(e);
}

// The plunge: hold the shattered brittle side and sink from the deck into the
// pit over segT in 0..1.
function placePlunge(
  ctx: SimContext,
  run: GauntletRun,
  e: Entity,
  localX: number,
  localZ: number,
  segT: number,
  drop: number,
): void {
  const baseY = ctx.groundPos(run.origin.x + localX, run.origin.z + localZ).y;
  e.prevPos = { ...e.pos };
  e.pos = { x: run.origin.x + localX, y: baseY - drop * segT, z: run.origin.z + localZ };
  ctx.rebucket(e);
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
    // Foot-contact detection: resolve only the panel the player is STANDING on.
    // While airborne (a jump), no panel is chosen yet, so a diagonal hop clears
    // the gap and lands on the far panel instead of being "caught" in mid-air
    // over the gap. The step resolves on the landing tick (physics sets onGround
    // before this trial driver runs in the same tick).
    if (!e.onGround) continue;
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
