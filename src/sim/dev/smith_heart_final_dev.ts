// /dev heart final quarter <breath|hammer|quench|heat|ring>: preview the
// Anvil of the World's quarters (phase 2K, design doc section 5.21). Moves the
// Masterless Strength (and its home, so it stays put) into the middle of that
// quarter, or onto the central ring's centre; the renderer wakes the quarter
// it stands in (presentation only, smith_heart_quarters.ts). `ring` forces
// the final phase: it sets the boss to the final phase's share of its health
// (HEART_FINAL_PHASE_SHARE) and pulls it onto the player, so the final look
// (all four quarters awake, the ring blazing) shows; a boss in the ring above
// that share wakes no quarter (phase 2L). Dev-gated like every /dev heart
// branch (the ctx.devCommands seam); never reached in production.

import { SMITH_HEART_DUNGEON, SMITH_HEART_FINAL_BOSS } from '../content/smith_heart';
import {
  HEART_FINAL_PHASE_SHARE,
  HEART_QUARTER_ZONES,
  type HeartQuarterZone,
  heartQuarterSpot,
} from '../content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin } from '../data';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** The claim's living final boss, or null. */
export function smithHeartFinalBoss(ctx: SimContext, inst: InstanceSlot): Entity | null {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (e && !e.dead && e.templateId === SMITH_HEART_FINAL_BOSS) return e;
  }
  return null;
}

/** Handles `final ...` (the words after `/dev heart`); returns the reply
 *  line, or null when the words name nothing (the caller prints the help). */
export function smithHeartFinalDevTrigger(
  ctx: SimContext,
  inst: InstanceSlot,
  arg: string,
  pid: number,
): string | null {
  const m = /^quarter\s+(\S+)$/.exec(arg);
  if (!m) return null;
  const zone = m[1] as HeartQuarterZone;
  if (!HEART_QUARTER_ZONES.includes(zone)) return null;
  const boss = smithHeartFinalBoss(ctx, inst);
  if (!boss) return 'The Masterless Strength has fallen in this run (/dev heart reset).';
  const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
  const spot = heartQuarterSpot(zone);
  const pos = ctx.groundPos(o.x + spot.x, o.z + spot.z);
  boss.pos = pos;
  boss.prevPos = { ...pos };
  // Its home moves with it: an idle boss stays where it was set down, a
  // leash measures from here.
  boss.spawnPos = { ...pos };
  if (boss.leashAnchor) boss.leashAnchor = { ...pos };
  ctx.rebucket(boss);
  if (zone === 'ring') {
    // The final phase forced: its share of health (never raised past it).
    boss.hp = Math.min(boss.hp, Math.max(1, Math.floor(boss.maxHp * HEART_FINAL_PHASE_SHARE)));
    const me = ctx.entities.get(pid);
    const pulled = !!me && !me.dead && ctx.aggroMob(boss, me, false);
    return pulled
      ? 'The Masterless Strength stands in the central ring at its final phase and turns on you: the final look.'
      : 'The Masterless Strength stands in the central ring at its final phase (it could not be pulled).';
  }
  return `The Masterless Strength stands in the ${zone} quarter.`;
}
