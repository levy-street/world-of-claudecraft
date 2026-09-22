// The Shardpike trial: brace, hold the beam, put the Foreman's eye out.
//
// The level-spread mechanic for the Mirefen world boss, and the reason a level 6 belongs at
// a level 20 pull. Wielding Skerrit's Shardpike (a quest tool with laughable weapon stats)
// gives a player one job gear cannot do for them: BRACE the pike (a movement-owning mode,
// same family as the ledge climb and the charge), hold an inverted-pendulum balance beam
// against drift and the boss's own shockwaves using the strafe axis as the balance stick,
// and, once the pike is SET, land the Loomshard Thrust: fixed damage no level scales, plus
// the blind that drops Barrowhide for everyone else (mob/eye_ward.ts).
//
// Session state lives on PlayerMeta (session-only, never serialized: a relog is a dropped
// pike). The per-tick step runs INSIDE the movement ladder (`advanceLanceBrace`, called
// from Sim.updatePlayerMovement), which is what makes the strafe keys the balance stick
// with no new wire traffic: movement intent already streams at 20Hz. The beam math itself
// is the pure leaf lance_balance_core.ts; the seed is the brace tick, so the beam draws
// NOTHING from the shared rng stream and replays identically on every host.

import type { LanceTrialView } from '../world_api/lance_trial';
import { MOBS } from './data';
import {
  freshLanceBalance,
  LANCE_FIXED_DAMAGE,
  LANCE_REST_SECONDS,
  LANCE_SET_SECONDS,
  LANCE_THRUST_RANGE,
  LANCE_WINDOW_SECONDS,
  type LanceBalance,
  lanceFumbled,
  shockLanceBalance,
  stepLanceBalance,
} from './lance_balance_core';
import { blindEyeWard } from './mob/eye_ward';
import { onQuestEventForQuests } from './quests/quest_credit';
import type { SimContext } from './sim_context';
import { DT, dist2d, type Entity, type MoveInput } from './types';

/** The one item whose wield unlocks the trial. */
export const LANCE_ITEM_ID = 'skerrits_shardpike';
/** Stable ability id for presentation (the thrust clip and its FCT line). */
export const LANCE_THRUST_ABILITY = 'lance_thrust';
/** How hard a slam shockwave kicks the beam at its centre (velocity impulse). */
export const LANCE_SHOCK_KICK = 1.1;
/** Shockwaves reach this multiple of the slam's own blast radius. */
export const LANCE_SHOCK_REACH = 2.5;

export { LANCE_FIXED_DAMAGE, LANCE_THRUST_RANGE };

export type LancePhase = 'bracing' | 'steadied';

export interface LanceSession {
  phase: LancePhase;
  beam: LanceBalance;
  /** Seconds inside the steadied window (phase timer; beam.t keeps running too). */
  windowT: number;
  /** noise seed: the brace tick, unchoosable and reproducible. */
  seed: number;
  /** Where the brace was planted; drifting off it (a shove) breaks the stance. */
  anchorX: number;
  anchorZ: number;
}

/** The live session, or null. */
export function lanceSessionOf(ctx: SimContext, pid: number): LanceSession | null {
  return ctx.players.get(pid)?.lance ?? null;
}

/** The IWorld view of a player's live trial: what the HUD meter paints, nothing more. */
export function lanceTrialViewFor(ctx: SimContext, pid: number): LanceTrialView | null {
  const session = ctx.players.get(pid)?.lance;
  if (!session) return null;
  return {
    phase: session.phase,
    balance: Math.max(-1, Math.min(1, session.beam.balance)),
    setProgress: Math.min(1, session.beam.t / LANCE_SET_SECONDS),
    windowRemaining:
      session.phase === 'steadied' ? Math.max(0, LANCE_WINDOW_SECONDS - session.windowT) : 0,
  };
}

/** Seconds until the pike can be braced again; 0 when it is ready. */
export function lanceRestRemainingFor(ctx: SimContext, pid: number): number {
  return Math.max(0, (ctx.players.get(pid)?.lanceRestUntil ?? 0) - ctx.time);
}

/** Begin the brace. Emits the player-readable refusal on every closed gate. */
export function lanceBrace(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  const p = ctx.entities.get(pid);
  if (!meta || !p) return;
  if (meta.lance) return;
  if (p.dead || p.ghost) {
    ctx.error(pid, "You can't do that while dead.");
    return;
  }
  if (meta.equipment.mainhand !== LANCE_ITEM_ID) {
    ctx.error(pid, "You need Skerrit's Shardpike in hand.");
    return;
  }
  if ((meta.lanceRestUntil ?? 0) > ctx.time) {
    ctx.error(pid, 'The pike needs a moment to be re-set.');
    return;
  }
  if (!p.onGround) {
    ctx.error(pid, 'You need solid ground under you.');
    return;
  }
  if (p.mountKey) {
    ctx.error(pid, 'Not from the saddle.');
    return;
  }
  p.sitting = false;
  meta.lance = {
    phase: 'bracing',
    beam: freshLanceBalance(ctx.tickCount),
    windowT: 0,
    seed: ctx.tickCount,
    anchorX: p.pos.x,
    anchorZ: p.pos.z,
  };
  p.bracing = true;
  ctx.notice(pid, 'You couch the Shardpike. Hold it true.');
}

/** Put the pike up deliberately. No penalty: bailing out is a decision, not a fumble. */
export function lanceRelease(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  const p = ctx.entities.get(pid);
  if (!meta?.lance) return;
  endSession(meta, p);
}

/**
 * The Loomshard Thrust. Only a SET pike can deliver it; the payoff is the fixed hit plus,
 * when the ward is vulnerable, the blind that opens everyone else's window.
 */
export function lanceThrust(ctx: SimContext, pid: number): void {
  const meta = ctx.players.get(pid);
  const p = ctx.entities.get(pid);
  if (!meta || !p) return;
  const session = meta.lance;
  if (session?.phase !== 'steadied') {
    ctx.error(pid, 'The pike is not set.');
    return;
  }
  const target = nearestEyeWardMob(ctx, p);
  if (!target) {
    ctx.error(pid, 'Nothing worth the point in reach.');
    return;
  }
  // Blind BEFORE the damage lands, so the poke that opens the window is never itself
  // dampened by the ward it just removed: the point went into the eye, not the hide.
  const blinded = blindEyeWard(ctx, target);
  ctx.dealDamage(
    p,
    target,
    LANCE_FIXED_DAMAGE,
    false,
    'physical',
    'Loomshard Thrust',
    'hit',
    true,
    undefined,
    true,
    true,
    // alreadyFinal: no source-side output mods either. Fixed means fixed.
    true,
    LANCE_THRUST_ABILITY,
  );
  if (blinded) {
    ctx.notice(pid, 'Your thrust finds the Loomshard. The Barrowhide sloughs away!');
    noteLanceBlind(ctx, pid, target);
  }
  endSession(meta, p);
  meta.lanceRestUntil = ctx.time + LANCE_REST_SECONDS;
}

/**
 * The movement-owning per-tick step. Returns true while a session owns this player's
 * movement (the caller skips ordinary locomotion); false lets the tick fall through, which
 * is also how a broken brace hands a shove's velocities straight to the motion kernel.
 */
export function advanceLanceBrace(ctx: SimContext, p: Entity, mv: MoveInput): boolean {
  const meta = ctx.players.get(p.id);
  const session = meta?.lance;
  if (!meta || !session) return false;
  if (p.dead || p.ghost || meta.equipment.mainhand !== LANCE_ITEM_ID) {
    endSession(meta, p);
    return false;
  }
  // A shove is not a fumble, it is worse: the stance is simply gone. Airborne (a launch
  // punted them), external velocity (a knockback in progress), or dragged off the anchor
  // all end the session THIS tick and fall through, so the shove integrates normally.
  const shoved =
    !p.onGround ||
    Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz) > 0.01 ||
    dist2d(p.pos, { x: session.anchorX, y: p.pos.y, z: session.anchorZ }) > 0.75;
  if (shoved) {
    endSession(meta, p);
    meta.lanceRestUntil = ctx.time + LANCE_REST_SECONDS;
    ctx.error(p.id, 'The stance is broken!');
    return false;
  }
  // Jumping out is the deliberate bail: clean release, no rest penalty.
  if (mv.jump) {
    endSession(meta, p);
    return false;
  }
  const lean: -1 | 0 | 1 = mv.strafeRight ? 1 : mv.strafeLeft ? -1 : 0;
  session.beam = stepLanceBalance(session.beam, lean, session.seed);
  if (lanceFumbled(session.beam)) {
    endSession(meta, p);
    meta.lanceRestUntil = ctx.time + LANCE_REST_SECONDS;
    ctx.error(p.id, 'You fumble the Shardpike!');
    return true;
  }
  if (session.phase === 'bracing' && session.beam.t >= LANCE_SET_SECONDS) {
    session.phase = 'steadied';
    ctx.notice(p.id, 'The pike is set. STRIKE!');
  }
  if (session.phase === 'steadied') {
    session.windowT += DT;
    if (session.windowT >= LANCE_WINDOW_SECONDS) {
      endSession(meta, p);
      meta.lanceRestUntil = ctx.time + LANCE_REST_SECONDS;
      ctx.error(p.id, 'The moment passes.');
    }
  }
  return true;
}

/**
 * A slam landed: kick every braced beam in reach, away from the blast.
 *
 * Called from the shared launch in mob/boss_slams.ts, which is the one door every
 * telegraphed detonation already walks through. The kick's SIGN is which side of the
 * player's facing the blast came from, because the beam is the player's own left-right
 * axis: a blast on your left shoves you right. Draws no rng.
 */
export function shockLanceBraces(ctx: SimContext, x: number, z: number, radius: number): void {
  const reach = radius * LANCE_SHOCK_REACH;
  for (const meta of ctx.players.values()) {
    const session = meta.lance;
    if (!session) continue;
    const p = ctx.entities.get(meta.entityId);
    if (!p || p.dead) continue;
    const dx = x - p.pos.x;
    const dz = z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || d < 0.001) continue;
    const bearing = Math.atan2(dx, dz) - p.facing;
    // sin(bearing) > 0: the blast is to the player's LEFT; the shove goes right (+).
    const side = Math.sin(bearing) >= 0 ? 1 : -1;
    const falloff = 1 - d / reach;
    session.beam = shockLanceBalance(session.beam, side * LANCE_SHOCK_KICK * falloff);
  }
}

function endSession(meta: { lance?: LanceSession }, p: Entity | undefined | null): void {
  meta.lance = undefined;
  if (p) p.bracing = false;
}

function nearestEyeWardMob(ctx: SimContext, p: Entity): Entity | null {
  let best: Entity | null = null;
  let bestD = LANCE_THRUST_RANGE;
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !MOBS[e.templateId]?.eyeWard) continue;
    const d = dist2d(e.pos, p.pos);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** Stable quest-event id for a landed blind (objective type 'event' matches on it). */
export const LANCE_BLIND_EVENT_ID = 'balgath_blinded';

/**
 * The blind's bookkeeping beyond the fight itself: quest credit now, the deed counter when
 * the deed lands. One seam so content wiring has a single hook to grow from.
 */
function noteLanceBlind(ctx: SimContext, pid: number, _target: Entity): void {
  const meta = ctx.players.get(pid);
  if (!meta) return;
  // The tally the HUD floats as `+N`. Booked here rather than at the thrust site because
  // only a thrust that actually BROKE the ward counts: poking a sealed boss is not a
  // contribution, and a counter that rewarded it would teach exactly the wrong habit.
  meta.lanceThrusts = (meta.lanceThrusts ?? 0) + 1;
  ctx.emit({ type: 'lanceBlind', pid, count: meta.lanceThrusts, targetId: _target.id });
  onQuestEventForQuests(ctx, meta, LANCE_BLIND_EVENT_ID);
}
