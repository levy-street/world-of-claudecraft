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
    if (e.kind !== 'mob' || e.dead || !MOBS[e.templateId]?.eyeWard) continue;
    const d = dist2d(e.pos, p.pos);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best ? { mob: best, distance: bestD } : null;
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
  const found = nearestEyeWardTarget(ctx, p, LANCE_GUIDANCE_RANGE);
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
