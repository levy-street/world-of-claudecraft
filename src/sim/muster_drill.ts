// The drill yard's mallet: the Muster Drillmaster drives a stake beside the Straw Foreman,
// and every blow of his mallet shakes the ground under a couched pike.
//
// The real fight's hardest part is not the thrust, it is holding the beam while Balgath's
// slams kick it (lance_trial.ts shockLanceBraces, called from every telegraphed detonation
// in mob/boss_slams.ts). A training effigy that never shakes would teach the easy half. So
// the drillmaster pounds on a steady beat while someone is TRAINING, which means a player
// in the drill yard with a Shardpike couched (a live brace, lance_trial.ts): carrying the
// pike is not enough, and the moment the last trainee's brace ends (the thrust lands, the
// pike is lifted, the player walks off) he is back at ease, leaning on his mallet and
// watching the lane. Each blow goes through THE SAME shockwave the slams use (the same
// kick, the same falloff with distance, the same "a blow on your left shoves you right"
// rule), but only for trainees: a braced player anywhere else never feels the yard.
// Nobody is hurt, nobody is launched; only the beam feels it.
//
// Presentation rides the channels the fight already has: the windup is a `spellfx` windup
// on the drillmaster (his Drill_Pound clip, scripts/build_drillmaster_anims.mjs, which
// brings the mallet head down on the ground in front of him on the strike frame below),
// and the landing is a `spellfxAt` nova where the head lands (the renderer's Balgath
// ground layer kicks up a dust puff and a ground ring there, src/render/balgath_fx.ts, and
// the HUD plays the thud). Between blows the rig's idle is Drill_Rest, the lean.
//
// State: the beat (next-due time, and whether a set is under way) lives on
// MusterArmyState (Sim-owned, live view). Draws no rng: the beat is a fixed cadence on the
// sim clock, the stake a fixed point.

import { MUSTER_DRILL_POST, MUSTER_EFFIGY_POST } from './content/mirefen_muster';
import { isShardpikeItem } from './lance_balance_core';
import { shockLanceBraces } from './lance_trial';
import type { MusterArmyState } from './mirefen_muster';
import { MUSTER_MALLET_POUND_ABILITY } from './muster_effigy_core';
import type { SimContext } from './sim_context';
import { CAST_COMPLETE_EPS } from './types';

export { MUSTER_MALLET_POUND_ABILITY };
/** Seconds between blows while someone trains: at least one lands inside every set. */
export const MUSTER_DRILL_POUND_EVERY = 4;
/** Seconds from a trainee couching the pike to the first blow: time to find the balance. */
export const MUSTER_DRILL_FIRST_BLOW = 1.5;
/** Seconds from the windup to the mallet meeting the ground (Drill_Pound's strike frame). */
export const MUSTER_DRILL_POUND_IMPACT = 0.55;
/**
 * Where the mallet head lands, from his feet: this far ahead and this far to his right
 * (measured off Drill_Pound's strike frame at the rig's in-game scale), so the dust rises
 * where the head actually meets the ground.
 */
export const MUSTER_DRILL_POUND_REACH = 1.2;
export const MUSTER_DRILL_POUND_SIDE = 0.8;
/**
 * The blow's shock radius as the slam path reads it: shockLanceBraces reaches
 * LANCE_SHOCK_REACH times this, so a trainee anywhere on the lane takes a real kick,
 * weaker the further they stand from the stake.
 */
export const MUSTER_DRILL_SHOCK_RADIUS = 6;
/** The dust ring's size at the stake (presentation only). */
export const MUSTER_DRILL_DUST_RADIUS = 1.6;
/** A braced player within this of the effigy is training: the drill yard and its lane. */
export const MUSTER_DRILL_WATCH_RANGE = 12;
/** How often he looks round for a trainee while he is at ease. */
const IDLE_LOOK_SECONDS = 0.25;
/** The thud (an existing heavy-landing SFX, the war hammer's). */
const POUND_SFX = 'impact_warrior_hammer_land';

/** Where the mallet lands: ahead of his post and a little to his right. */
export function musterDrillStake(): { x: number; z: number } {
  const f = MUSTER_DRILL_POST.facing;
  // forward is (sin f, cos f); his right is (-cos f, sin f), the side rule lance_trial.ts
  // kicks the beam by
  return {
    x:
      MUSTER_DRILL_POST.x +
      Math.sin(f) * MUSTER_DRILL_POUND_REACH -
      Math.cos(f) * MUSTER_DRILL_POUND_SIDE,
    z:
      MUSTER_DRILL_POST.z +
      Math.cos(f) * MUSTER_DRILL_POUND_REACH +
      Math.sin(f) * MUSTER_DRILL_POUND_SIDE,
  };
}

/** Is this player training: alive, in the drill yard, with a Shardpike couched? */
export function isMusterDrillTrainee(ctx: SimContext, pid: number): boolean {
  const meta = ctx.players.get(pid);
  if (!meta?.lance || !isShardpikeItem(meta.equipment.mainhand)) return false;
  const p = ctx.entities.get(meta.entityId);
  if (!p || p.dead || p.ghost) return false;
  const dx = p.pos.x - MUSTER_EFFIGY_POST.x;
  const dz = p.pos.z - MUSTER_EFFIGY_POST.z;
  return dx * dx + dz * dz <= MUSTER_DRILL_WATCH_RANGE * MUSTER_DRILL_WATCH_RANGE;
}

/** Is anyone training right now? */
export function musterDrillHasTrainee(ctx: SimContext): boolean {
  for (const meta of ctx.players.values()) {
    if (isMusterDrillTrainee(ctx, meta.entityId)) return true;
  }
  return false;
}

/**
 * One pass, from the muster army. At ease until someone couches a pike in the yard, then a
 * blow on the beat (the first after MUSTER_DRILL_FIRST_BLOW) until the last trainee's
 * brace ends, when he settles back and faces the lane.
 */
export function tickMusterDrill(ctx: SimContext, army: MusterArmyState): void {
  if (army.drillmasterId === null || ctx.time < army.drillNextPoundAt) return;
  const drillmaster = ctx.entities.get(army.drillmasterId);
  const training = !!drillmaster && !drillmaster.dead && musterDrillHasTrainee(ctx);
  if (!training) {
    if (army.drillTraining && drillmaster && !drillmaster.dead) {
      drillmaster.facing = MUSTER_DRILL_POST.facing;
    }
    army.drillTraining = false;
    army.drillNextPoundAt = ctx.time + IDLE_LOOK_SECONDS;
    return;
  }
  if (!army.drillTraining) {
    // a set begins: let the trainee find the balance before the first blow
    army.drillTraining = true;
    army.drillNextPoundAt = ctx.time + MUSTER_DRILL_FIRST_BLOW;
    return;
  }
  army.drillNextPoundAt = ctx.time + MUSTER_DRILL_POUND_EVERY;
  poundMusterDrill(ctx, army);
}

/**
 * Swing the mallet now: the windup at once, the landing (shockwave, dust, thud) at the
 * strike frame. Also the dev command's entry point. The shockwave only reaches trainees.
 */
export function poundMusterDrill(ctx: SimContext, army: MusterArmyState): void {
  if (army.drillmasterId === null) return;
  const drillmaster = ctx.entities.get(army.drillmasterId);
  if (!drillmaster || drillmaster.dead) return;
  const sourceId = drillmaster.id;
  // He squares up to the lane for the blow, whatever he was watching.
  drillmaster.facing = MUSTER_DRILL_POST.facing;
  ctx.emit({
    type: 'spellfx',
    sourceId,
    targetId: sourceId,
    school: 'physical',
    fx: 'windup',
    ability: MUSTER_MALLET_POUND_ABILITY,
  });
  const stake = musterDrillStake();
  ctx.delayedEvents.push({
    at: ctx.time + MUSTER_DRILL_POUND_IMPACT - CAST_COMPLETE_EPS,
    resolve: () => {
      const live = ctx.entities.get(sourceId);
      if (!live || live.dead) return;
      shockLanceBraces(ctx, stake.x, stake.z, MUSTER_DRILL_SHOCK_RADIUS, (pid) =>
        isMusterDrillTrainee(ctx, pid),
      );
      ctx.emit({
        type: 'spellfxAt',
        x: stake.x,
        z: stake.z,
        school: 'physical',
        fx: 'nova',
        ability: MUSTER_MALLET_POUND_ABILITY,
        radius: MUSTER_DRILL_DUST_RADIUS,
        sourceId,
        sfxKey: POUND_SFX,
      });
    },
  });
}
