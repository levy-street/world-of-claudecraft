// Trial 1 of The Gauntlet, Sentinel's Crossing (red light / green light).
// Cross the field from the start line (instance-local z=0) to the finish line
// (z=fieldLength) while the Stone Warden's light allows it. Moving while the
// light is red (past a short grace window) is a catch: a vitality chunk, a
// short pin, and a set-back, then you keep playing until the clock ends or
// you fall. Detection is authoritative and per-tick: actual displacement is
// what convicts, never input intent. Momentum makes stopping something you
// must anticipate: released input keeps sliding for a few ticks and that
// slide counts as movement.
//
// The light machine draws its windows from run.rng only; the pure helpers
// (nextGreenWindowS, the score math in vitality.ts) are Node-tested directly.

import { GAUNTLET } from '../content/gauntlet';
import type { SimContext } from '../sim_context';
import type { GauntletSentinelTuning } from '../types';
import type { GauntletRun, GauntletSentinelState } from './state';
import { updateSentinelNpcs } from './contestants';
import {
  aliveContestants,
  applyVitalityDamage,
  clamp01,
  emitToRunPlayers,
  sentinelScore,
  trialDamageFromScore,
} from './vitality';

// The green window for a given cycle: the seeded draw shrinks by accelPerCycle
// each completed cycle and never dips below the floor. Pure; tested directly.
export function nextGreenWindowS(draw: number, cycle: number, t: GauntletSentinelTuning): number {
  return Math.max(t.greenFloorS, draw * t.accelPerCycle ** cycle);
}

export function startSentinel(ctx: SimContext, run: GauntletRun): GauntletSentinelState {
  const t = GAUNTLET.sentinel;
  const draw = run.rng.range(t.greenMinS, t.greenMaxS);
  const trial: GauntletSentinelState = {
    kind: 'sentinel',
    light: 'green',
    flipAt: ctx.time + nextGreenWindowS(draw, 0, t),
    graceUntil: 0,
    greenWindowS: nextGreenWindowS(draw, 0, t),
    flipCount: 0,
  };
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletLight',
    light: 'green',
    until: trial.flipAt,
    pid,
  }));
  return trial;
}

// One tick of the sentinel trial. Returns true once the trial has resolved
// (clock expired, or every contestant has finished or fallen) and end-of-trial
// damage has been dealt.
export function updateSentinel(ctx: SimContext, run: GauntletRun, dt: number): boolean {
  const t = GAUNTLET.sentinel;
  const trial = run.trial;
  if (!trial || trial.kind !== 'sentinel') return true;

  updateLightMachine(ctx, run, trial, t);
  updatePlayers(ctx, run, trial, t);
  updateSentinelNpcs(ctx, run, trial, dt);

  const expired = ctx.time >= run.phaseEndsAt;
  if (expired || allResolved(ctx, run, t)) {
    endSentinel(ctx, run, t);
    return true;
  }
  return false;
}

function updateLightMachine(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletSentinelState,
  t: GauntletSentinelTuning,
): void {
  const watcher = run.watcherId !== null ? ctx.entities.get(run.watcherId) : undefined;
  // The turn animation IS the telegraph: the watcher's facing flips toward the
  // field telegraphS before red starts, and the client lerps the turn.
  if (watcher && trial.light === 'green' && ctx.time >= trial.flipAt - t.telegraphS) {
    watcher.facing = Math.PI; // faces the field (contestants approach from -z)
  }
  if (ctx.time < trial.flipAt) return;
  if (trial.light === 'green') {
    trial.light = 'red';
    trial.flipCount++;
    trial.graceUntil = ctx.time + t.graceS;
    trial.flipAt = ctx.time + run.rng.range(t.redMinS, t.redMaxS);
    if (watcher) watcher.facing = Math.PI;
  } else {
    trial.light = 'green';
    const draw = run.rng.range(t.greenMinS, t.greenMaxS);
    trial.greenWindowS = nextGreenWindowS(draw, trial.flipCount, t);
    trial.flipAt = ctx.time + trial.greenWindowS;
    if (watcher) watcher.facing = 0; // turns its back to chant
  }
  emitToRunPlayers(ctx, run, (pid) => ({
    type: 'gauntletLight',
    light: trial.light,
    until: trial.flipAt,
    pid,
  }));
}

function updatePlayers(
  ctx: SimContext,
  run: GauntletRun,
  trial: GauntletSentinelState,
  t: GauntletSentinelTuning,
): void {
  for (const c of run.contestants) {
    if (!c.player || c.eliminatedAtTrial !== null) continue;
    const ps = run.playerStates.get(c.entityId);
    const e = ctx.entities.get(c.entityId);
    if (!ps || !e || ps.spectating) continue;

    // Pinned (catch stun): overwrite whatever movement the core applied this
    // tick. prevPos is left alone so the wire shows a stationary entity.
    if (ps.heldAt) {
      if (ctx.time < ps.heldUntil) {
        e.pos.x = ps.heldAt.x;
        e.pos.y = ps.heldAt.y;
        e.pos.z = ps.heldAt.z;
        continue;
      }
      ps.heldAt = null;
    }

    // Momentum: while the core moved the player this tick, remember the
    // velocity; on release, keep sliding it (decayed) until it fades. The
    // slide is real movement and is judged like any other.
    const dx = e.pos.x - e.prevPos.x;
    const dz = e.pos.z - e.prevPos.z;
    const moved = Math.hypot(dx, dz);
    if (moved > t.momentumStopEps) {
      ps.momentumX = dx;
      ps.momentumZ = dz;
    } else {
      ps.momentumX *= t.momentumDecay;
      ps.momentumZ *= t.momentumDecay;
      if (Math.hypot(ps.momentumX, ps.momentumZ) > t.momentumStopEps) {
        e.pos.x += ps.momentumX;
        e.pos.z += ps.momentumZ;
      } else {
        ps.momentumX = 0;
        ps.momentumZ = 0;
      }
    }

    // Keep contestants on the field: lateral bounds clamp, and the finish
    // line resolves the trial for them.
    const lx = e.pos.x - run.origin.x;
    const lz = e.pos.z - run.origin.z;
    if (lx > t.fieldHalfWidth) e.pos.x = run.origin.x + t.fieldHalfWidth;
    if (lx < -t.fieldHalfWidth) e.pos.x = run.origin.x - t.fieldHalfWidth;
    if (ps.finishedAt === null && lz > ps.bestZ) ps.bestZ = Math.min(lz, t.fieldLength);
    if (ps.finishedAt === null && lz >= t.fieldLength) {
      ps.finishedAt = ctx.time;
      ps.momentumX = 0;
      ps.momentumZ = 0;
      continue;
    }

    // The catch: on red, past grace, still on the field, any displacement
    // beyond the epsilon (input movement or momentum slide alike) convicts.
    if (
      trial.light === 'red' &&
      ctx.time >= trial.graceUntil &&
      ps.finishedAt === null &&
      lz > 0
    ) {
      const disp = Math.hypot(e.pos.x - e.prevPos.x, e.pos.z - e.prevPos.z);
      if (disp > t.redMoveEps) {
        const fell = applyVitalityDamage(ctx, run, c, t.hardFailDamage, 'caught');
        if (!fell) {
          e.pos.z = Math.max(run.origin.z + 0.5, e.pos.z - t.pushbackYards);
          e.pos.y = ctx.groundPos(e.pos.x, e.pos.z).y;
          ps.heldAt = { ...e.pos };
          ps.heldUntil = ctx.time + t.stunS;
          ps.momentumX = 0;
          ps.momentumZ = 0;
          ctx.rebucket(e);
        }
      }
    }
  }
}

// Resolved: every live player has finished or fallen, every scripted NPC
// fumble has fired, and every surviving NPC has crossed.
function allResolved(ctx: SimContext, run: GauntletRun, t: GauntletSentinelTuning): boolean {
  for (const c of aliveContestants(run)) {
    if (c.player) {
      const ps = run.playerStates.get(c.entityId);
      if (ps && !ps.spectating && ps.finishedAt === null) return false;
    } else {
      if (c.script.fumbleOnFlip !== null) return false; // fumble not yet fired
      const e = ctx.entities.get(c.entityId);
      if (e && e.pos.z - run.origin.z < t.fieldLength) return false;
    }
  }
  return true;
}

// End-of-trial resolution: performance damage for the players, the scripted
// trickle for surviving NPCs, and the fate of anyone the clock caught short.
function endSentinel(ctx: SimContext, run: GauntletRun, t: GauntletSentinelTuning): void {
  const clockLeftFrac = clamp01((run.phaseEndsAt - ctx.time) / t.durationS);
  for (const c of [...aliveContestants(run)]) {
    if (c.player) {
      const ps = run.playerStates.get(c.entityId);
      if (!ps || ps.spectating) continue;
      const score = sentinelScore(
        ps.bestZ,
        ps.finishedAt !== null,
        ps.finishedAt !== null ? clamp01((run.phaseEndsAt - ps.finishedAt) / t.durationS) : 0,
        t.fieldLength,
        t.finishBonusMax,
      );
      applyVitalityDamage(ctx, run, c, trialDamageFromScore(score, t.damageMax), 'timeout');
    } else {
      // A scripted survivor pays a small vitality tithe (the same attrition
      // rules, just invisible); a fumbler that never got its flip in before
      // the clock is caught where it stands.
      if (c.script.fumbleOnFlip !== null) {
        applyVitalityDamage(ctx, run, c, c.vitality, 'caught');
      } else {
        applyVitalityDamage(ctx, run, c, trialDamageFromScore(0.8, t.damageMax), 'trial');
      }
    }
  }
}
