// What the Shardpike wielder should DO right now, derived from the live fight.
//
// The trial shipped communicating entirely through chat lines and a balance beam that only
// appears once you have already braced. That leaves the actual question unanswered: a player
// holding a quest pike in front of a thirty-foot boss has no idea that the pike is the
// mechanic, that his EYE is the target, that there is a range to be inside, or that a seal
// is what is stopping them right now. Every one of those facts already exists in sim state;
// this is the readout that puts them on screen.
//
// Sim-side rather than derived on the client from the entity stream, for two reasons. The
// truth is here (`eyeWardVulnerable` reads two timestamps the auras only mirror), and the
// TARGET SELECTION must be the same lookup the thrust itself uses, or the prompt promises a
// thrust the sim then refuses. Both halves call `nearestEyeWardTarget`.
//
// Draws no rng and reads no wall clock: a pure projection of state, safe to call per frame.

import type { LanceGuidanceView } from '../world_api/lance_trial';
import { MOBS } from './data';
import { eyeWardBlinded, eyeWardVulnerable } from './mob/eye_ward';
import { effigyInReach, effigyWindowRemaining } from './muster_effigy';
import type { SimContext } from './sim_context';
import { dist2d, type Entity } from './types';

/**
 * How far out the guidance still names a boss as the trial's subject.
 *
 * Deliberately much wider than `LANCE_THRUST_RANGE`: the prompt's whole job at distance is
 * "walk to him", which it cannot say if he stops existing to it at the same radius the
 * thrust does. Scoped to the boss's own nameplate band rather than the zone, so a pike
 * carried across the map is not permanently nagging about a fight nobody is at.
 */
export const LANCE_GUIDANCE_RANGE = 60;

/**
 * The warded mob this player's pike is about, or null.
 *
 * `range` is the caller's: the thrust passes its own reach so the prompt and the verb agree
 * about what is in range, and the guidance passes the wider band above.
 */
export function nearestEyeWardTarget(
  ctx: SimContext,
  p: Entity,
  range: number,
): { mob: Entity; distance: number } | null {
  let best: Entity | null = null;
  let bestD = range;
  for (const e of ctx.entities.values()) {
    // A sleeping Foreman is a landmark, not a target: the thrust never lands on one, so the
    // prompt must not promise it, and a second, awake copy (a /dev spawn beside the one in
    // his bed) must never lose the pike to the sleeper.
    if (e.kind !== 'mob' || e.dead || e.asleep || !MOBS[e.templateId]?.eyeWard) continue;
    const d = dist2d(e.pos, p.pos);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best ? { mob: best, distance: bestD } : null;
}

/** What a pike is pointed at: the Foreman himself, or the drill yard's Straw Foreman. */
export interface LanceTarget {
  kind: 'boss' | 'effigy';
  mob: Entity;
  distance: number;
}

/**
 * The thing a thrust from here would find inside `range`: a living warded boss first (the
 * real fight always wins), else the drill yard's effigy (muster_effigy.ts). The thrust
 * passes its own reach; the guidance asks at that reach first and then at its wider band,
 * so the prompt and the verb can never disagree about what is in reach.
 */
export function lanceTargetInReach(ctx: SimContext, p: Entity, range: number): LanceTarget | null {
  const boss = nearestEyeWardTarget(ctx, p, range);
  if (boss) return { kind: 'boss', ...boss };
  const effigy = effigyInReach(ctx, ctx.musterArmy, p, range);
  return effigy ? { kind: 'effigy', ...effigy } : null;
}

/** Seconds until a blinded ward re-forms, or 0. */
function blindRemaining(ctx: SimContext, mob: Entity): number {
  return Math.max(0, (mob.eyeWardDownUntil ?? 0) - ctx.time);
}

/** Seconds until the refractory seal lifts, or 0. */
function sealRemaining(ctx: SimContext, mob: Entity): number {
  return Math.max(0, (mob.eyeWardSealedUntil ?? 0) - ctx.time);
}

/**
 * The guidance for one player, or null when the pike is not in hand.
 *
 * Null, not an all-false view, so the HUD's visibility test is the same one the bar already
 * uses: no pike, no prompt, and a player who never takes the quest is never told about a
 * mechanic they cannot perform.
 */
export function lanceGuidanceFor(
  ctx: SimContext,
  pid: number,
  thrustRange: number,
): LanceGuidanceView | null {
  const meta = ctx.players.get(pid);
  const p = ctx.entities.get(pid);
  if (!meta || !p) return null;
  const found =
    lanceTargetInReach(ctx, p, thrustRange) ?? lanceTargetInReach(ctx, p, LANCE_GUIDANCE_RANGE);
  if (!found) {
    return {
      targetPresent: false,
      targetDistance: null,
      inRange: false,
      vulnerable: false,
      blinded: false,
      blindRemaining: 0,
      sealRemaining: 0,
      thrusts: meta.lanceThrusts ?? 0,
    };
  }
  const { mob, distance } = found;
  if (found.kind === 'effigy') {
    // The drill yard: the "ward" is this player's own lantern (muster_effigy.ts), never
    // sealed beyond the window itself, and never anyone else's.
    const open = effigyWindowRemaining(ctx, ctx.musterArmy, pid);
    return {
      targetPresent: true,
      targetDistance: distance,
      inRange: distance <= thrustRange,
      vulnerable: open <= 0,
      blinded: open > 0,
      blindRemaining: open,
      sealRemaining: 0,
      thrusts: meta.lanceThrusts ?? 0,
      effigy: true,
    };
  }
  return {
    targetPresent: true,
    targetDistance: distance,
    inRange: distance <= thrustRange,
    vulnerable: eyeWardVulnerable(ctx, mob),
    blinded: eyeWardBlinded(ctx, mob),
    blindRemaining: blindRemaining(ctx, mob),
    sealRemaining: sealRemaining(ctx, mob),
    thrusts: meta.lanceThrusts ?? 0,
  };
}
