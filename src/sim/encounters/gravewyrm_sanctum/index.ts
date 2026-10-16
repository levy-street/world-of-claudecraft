// The Gravewyrm Sanctum encounters (docs/design/dungeon-rework/
// gravewyrm_sanctum.md): the Sledge Tusker's kit and the Calving Face's story
// (phase A); the three bosses' cores land here as their own modules in phase B
// (korgath.ts, velkhar.ts, korzul.ts). One pass per tick over every live
// Sanctum claim, after the mob AI (called from instances/dungeons.ts
// updateInstances, beside the trash kit), so a pull or a planted cast owns its
// tick.

import { sweepOrphanBurstRings } from '../../mob/trash_kit/death_burst';
import { sweepOrphanTossRings } from '../../mob/trash_kit/sanctum_kit';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { bossEngaged, claimBoss, sanctumClaims } from './claim';
import { KORGATH_ID, KORZUL_ID, SLEDGE_TUSKER_ID, VELKHAR_ID } from './ids';
import { tickKorgath } from './korgath';
import { tickKorgathBarks } from './korgath_barks';
import { tickKorzul } from './korzul';
import { tickRuneWallLore } from './rune_wall';
import { tickTusker, tickTuskerPaused } from './sledge_tusker';
import { tickStory } from './story';
import { tickVelkhar } from './velkhar';

export * from './ids';
export { korgathDevTrigger } from './korgath';
export {
  KORGATH_BARK_RANGE,
  KORGATH_BARKS,
  tickKorgathBarks,
  wingPacksDown,
} from './korgath_barks';
export { korzulDevTrigger } from './korzul';
export { inRuneWallReadZone, RUNE_WALL_LORE_LOG } from './rune_wall';
export {
  enrageTusker,
  spillBraziers,
  startTrample,
  startTuskSweep,
  stickInOutcrop,
  trampleReach,
  tuskerBaitDevTrigger,
  tuskerState,
} from './sledge_tusker';
export { earnedStoryStep, raiseStory, storyMarkers, storyStep } from './story';
export {
  outcropObjects,
  outcropsStanding,
  restoreOutcrops,
  standingOutcrops,
} from './tusker_outcrops';
export {
  inTrail,
  onSledgeRoad,
  planTrampleLane,
  TUSKER_BODY,
  trampleAimLocked,
  trampleAimYaw,
} from './tusker_road';
export { TRAIL_DAMAGE_NAME } from './tusker_trail';
export { velkharDevTrigger } from './velkhar';

/** A live fight whose mob lost its target for a moment (the tank falling)
 *  while still in combat and not evading: the fight holds, so a blip never
 *  replays its thresholds (a second spill). Only an evade, a reset or a death
 *  ends it (each tick's `engaged` false). */
function paused(mob: Entity): boolean {
  return (
    mob.sanctumFight !== undefined &&
    !mob.dead &&
    mob.inCombat &&
    mob.aggroTargetId === null &&
    (mob.aiState === 'chase' || mob.aiState === 'attack')
  );
}

/** One tick of every Gravewyrm Sanctum encounter. */
export function tickSanctumEncounters(ctx: SimContext): void {
  for (const inst of sanctumClaims(ctx)) {
    const tusker = claimBoss(ctx, inst, SLEDGE_TUSKER_ID);
    if (tusker && !paused(tusker)) tickTusker(ctx, inst, tusker, bossEngaged(tusker));
    else if (tusker?.sanctumFight?.kind === 'tusker')
      // A blip with no target holds the fight, but its fires still burn out
      // and a stuck beast still wrenches free.
      tickTuskerPaused(ctx, inst, tusker, tusker.sanctumFight);
    // The three bosses (phase B), in route order. A paused fight holds.
    const korgath = claimBoss(ctx, inst, KORGATH_ID);
    if (korgath && !paused(korgath)) tickKorgath(ctx, inst, korgath, bossEngaged(korgath));
    tickKorgathBarks(ctx, inst, korgath);
    const velkhar = claimBoss(ctx, inst, VELKHAR_ID);
    if (velkhar && !paused(velkhar)) tickVelkhar(ctx, inst, velkhar, bossEngaged(velkhar));
    const korzul = claimBoss(ctx, inst, KORZUL_ID);
    if (korzul && !paused(korzul)) tickKorzul(ctx, inst, korzul, bossEngaged(korzul));
    tickStory(ctx, inst);
    tickRuneWallLore(ctx, inst);
    sweepOrphanBurstRings(ctx, inst);
    sweepOrphanTossRings(ctx, inst);
  }
}
