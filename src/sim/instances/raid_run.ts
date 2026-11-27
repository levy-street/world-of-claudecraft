// The raid run as a player reads it: which raid they stand in, on what
// difficulty, and which of its boss bodies are down or fighting in THIS claim.
// It backs IWorld.raidRun (the Adventure Journal's landing page: the engaged
// boss, else the next one still standing) on every host: the offline Sim reads
// it directly, and the server ships it on the self record (`rdrun`) for the
// online mirror.
//
// Deliberately apart from dungeon_run.ts: that view is the five-player
// objectives tracker's, keyed on the Dungeon Finder's 'dungeon' activities,
// and a raid does not show that tracker. The rows here are the raid's own
// placed bosses in route order, one row per BODY (a council lists each of its
// members), so a consumer groups them the way its own pages need.
//
// Like the dungeon run, nothing is stored: dead instance mobs stay dead until
// the claim is freed, so the roster IS the progress. Draws NO rng and mutates
// no sim state; the WeakMap is a derived read cache keyed by the claim's slot
// record, so every caller in a tick, and every member of the raid, is handed
// the same frozen view until a row changes.

import type { RaidRunBossView, RaidRunView } from '../../world_api/dungeons';
import {
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../content/smith_heart';
import { COUNCIL_SEAM_SINGER } from '../encounters/smith_heart/council_ids';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import type { DungeonDifficulty } from '../types';
import { dungeonPlacedBossDead, dungeonPlacedBossFighting } from './dungeon_gates';
import { claimedInstanceAt } from './dungeons';

/** Each tracked raid's placed boss bodies, in route order (content ids). */
export const RAID_RUN_PLANS: Readonly<Record<string, readonly string[]>> = {
  [SMITH_HEART_DUNGEON]: [
    SMITH_HEART_GUARDIANS.hammer,
    COUNCIL_SEAM_SINGER,
    SMITH_HEART_GUARDIANS.breath,
    SMITH_HEART_GUARDIANS.quench,
    SMITH_HEART_GUARDIANS.heat,
    SMITH_HEART_FINAL_BOSS,
  ],
};

interface RaidRunMemo {
  claimId: number;
  difficulty: DungeonDifficulty;
  /** Bit i: row i defeated; bit i + 16: row i engaged. */
  state: number;
  view: RaidRunView;
}

const views = new WeakMap<InstanceSlot, RaidRunMemo>();

/** The run of one live raid claim, or null when its raid is not tracked. */
export function raidRunForClaim(ctx: SimContext, inst: InstanceSlot): RaidRunView | null {
  if (inst.partyKey === null || inst.exitId === null) return null;
  if (!Object.hasOwn(RAID_RUN_PLANS, inst.dungeonId)) return null;
  const plan = RAID_RUN_PLANS[inst.dungeonId];
  let state = 0;
  for (let i = 0; i < plan.length; i++) {
    if (dungeonPlacedBossDead(ctx, inst, plan[i])) state |= 1 << i;
    else if (dungeonPlacedBossFighting(ctx, inst, plan[i])) state |= 1 << (i + 16);
  }
  const memo = views.get(inst);
  if (
    memo &&
    memo.claimId === inst.exitId &&
    memo.difficulty === inst.difficulty &&
    memo.state === state
  ) {
    return memo.view;
  }
  const bosses: RaidRunBossView[] = plan.map((mobId, i) =>
    Object.freeze({
      mobId,
      defeated: (state & (1 << i)) !== 0,
      engaged: (state & (1 << (i + 16))) !== 0,
    }),
  );
  const view: RaidRunView = Object.freeze({
    dungeonId: inst.dungeonId,
    difficulty: inst.difficulty,
    bosses: Object.freeze(bosses),
  });
  views.set(inst, { claimId: inst.exitId, difficulty: inst.difficulty, state, view });
  return view;
}

/** The raid run `pid` is physically standing in, or null. */
export function raidRunForPlayer(ctx: SimContext, pid: number): RaidRunView | null {
  const player = ctx.entities.get(pid);
  if (!player) return null;
  const inst = claimedInstanceAt(ctx, player.pos);
  return inst ? raidRunForClaim(ctx, inst) : null;
}
