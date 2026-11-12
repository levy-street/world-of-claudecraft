// /dev heart final ...: the Masterless Strength's dev verbs (design doc
// sections 5.21 and 7.5). Dev-gated like every /dev heart branch (the
// ctx.devCommands seam); never reached in production.
//
//   final                       the fight's readout
//   final pull                  set you down on the Anvil beside the boss and pull it
//   final reset                 the boss whole, home and out of its fight
//   final normal|heroic|mythic  this run's tier for the fight (a live fight
//                               takes it at once)
//   final quarter <zone>        move the boss (never its home) into the middle
//                               of that quarter, or onto the ring's centre
//                               (phase 2K's preview; in a live fight the move
//                               is a quarter change: its root, its kit, its
//                               shock). `ring` out of a fight forces the final
//                               look (its final phase's share of health, and
//                               it pulls the boss onto you)
//   final fill [vein|all] [pct] set an Overload bar (95 by default)
//   final burst|shock|root|unroot   the rules now
//   final <mechanic>            one ability now: fist, whirl, embers, freeze,
//                               cold <n>, ice, wind [deg], bolt, drawn, orbs,
//                               tremor, anvil, shell
//   final inter70|inter40       part 2: an intermission now
//   final splinter <vein>       one Splinter rises out of that quarter now
//   final killadds | endcall    every Splinter dies / the call ends (they pour)
//   final last | enrage         the final phase (15 percent) / Masterless Fury
//   final coal|toll|ring|pounce|circles|shear   a Splinter's signature now
//                               (encounters/smith_heart/final_phase_dev.ts)
//   final death                 replay the death scene on the living boss (its
//                               essence escaping into the well; presentation
//                               only: a cue the renderer plays, no kill, no
//                               pull, no loot)

import { SMITH_HEART_DUNGEON, SMITH_HEART_FINAL_BOSS } from '../content/smith_heart';
import {
  HEART_FINAL_PHASE_SHARE,
  HEART_QUARTER_ZONES,
  type HeartQuarterZone,
  heartQuarterSpot,
} from '../content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin } from '../data';
import {
  finalDevMechanic,
  finalDifficulty,
  finalReadout,
  releaseRootForDev,
  resetFinalForDev,
  setFinalDevTier,
} from '../encounters/smith_heart';
import { FINAL_DEV_CUES } from '../encounters/smith_heart/final_ids';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { displacePlayerForDev } from './dev_displace';

/** The claim's living final boss, or null. */
export function smithHeartFinalBoss(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && e.templateId === SMITH_HEART_FINAL_BOSS) return e;
  }
  return null;
}

/** Move the boss to a zone's spot. Its HOME stays its authored one (the
 *  middle of the Anvil): an idle boss already stays where it is set down (it
 *  never wanders), and a reset or a wipe must bring it home, never to the
 *  last quarter a dev move named (Jose's playtest of 28 Oct 2026: moving its
 *  home here left it respawning in a quarter). */
function standIn(ctx: SimContext, inst: InstanceSlot, boss: Entity, zone: HeartQuarterZone): void {
  const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
  const spot = heartQuarterSpot(zone);
  const pos = ctx.groundPos(o.x + spot.x, o.z + spot.z);
  boss.pos = pos;
  boss.prevPos = { ...pos };
  ctx.rebucket(boss);
}

function quarterVerb(ctx: SimContext, inst: InstanceSlot, arg: string, pid: number): string | null {
  const zone = arg as HeartQuarterZone;
  if (!HEART_QUARTER_ZONES.includes(zone)) return null;
  const boss = smithHeartFinalBoss(ctx, inst);
  if (!boss) return 'The Masterless Strength has fallen in this run (/dev heart reset).';
  const live = boss.smithHeartFinal !== undefined;
  if (live) releaseRootForDev(ctx, inst);
  standIn(ctx, inst, boss, zone);
  if (zone === 'ring' && !live) {
    // The final phase forced: its share of health (never raised past it).
    boss.hp = Math.min(boss.hp, Math.max(1, Math.floor(boss.maxHp * HEART_FINAL_PHASE_SHARE)));
    const me = ctx.entities.get(pid);
    const pulled = !!me && !me.dead && ctx.aggroMob(boss, me, false);
    return pulled
      ? 'The Masterless Strength stands in the central ring at its final phase and turns on you: the final look.'
      : 'The Masterless Strength stands in the central ring at its final phase (it could not be pulled).';
  }
  if (zone === 'ring') return 'The Masterless Strength stands in the central ring.';
  return `The Masterless Strength stands in the ${zone} quarter.`;
}

/** Handles `final ...` (the words after `/dev heart`); returns the reply
 *  line, or null when the words name nothing (the caller prints the help). */
export function smithHeartFinalDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  arg: string,
  pid: number,
): string | null {
  const words = arg.trim();
  if (!words) return finalReadout(ctx, inst).replace(/^\[dev\] /, '');
  const [verb, rest = ''] = words.split(/\s+(.*)/s);
  if (verb === 'quarter') return quarterVerb(ctx, inst, rest.trim(), pid);
  if (verb === 'reset') return resetFinalForDev(ctx, inst);
  if (verb === 'normal' || verb === 'heroic' || verb === 'mythic') {
    setFinalDevTier(inst, verb);
    const live = smithHeartFinalBoss(ctx, inst)?.smithHeartFinal;
    if (live) live.difficulty = finalDifficulty(inst);
    return `The Masterless Strength fights on ${finalDifficulty(inst)} for this run.`;
  }
  const boss = smithHeartFinalBoss(ctx, inst);
  if (!boss) return 'The Masterless Strength has fallen in this run (/dev heart reset).';
  if (verb === 'death') {
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'arcane',
      fx: 'nova',
      ability: FINAL_DEV_CUES.deathReplay,
    });
    return 'The Masterless Strength plays its death (presentation only: it still stands).';
  }
  const me = ctx.entities.get(pid);
  if (verb === 'pull') {
    if (me) displacePlayerForDev(ctx, me, boss.pos.x + 6, boss.pos.z - 6);
    // Already on you (it woke as you came near): that is the pull too.
    const pulled = !!me && (ctx.aggroMob(boss, me, false) || boss.aggroTargetId === me.id);
    return pulled
      ? 'The Masterless Strength wakes on the Anvil and turns on you.'
      : 'The Masterless Strength cannot be pulled.';
  }
  // A mechanic forced on a boss nobody pulled pulls it first (an unpulled
  // boss resets its fight on the next tick).
  if (!boss.inCombat && me && !me.dead) ctx.aggroMob(boss, me, false);
  return finalDevMechanic(ctx, inst, words, pid);
}
