import { NPCS } from '../data';
import { cancelProfessionSessionOnDisplacement } from '../professions/session_teardown';
import type { SimContext } from '../sim_context';
import {
  emptyWeeklyRewards,
  WEEKLY_KEEPER_ID,
  type WeeklyPoolId,
  weeklyLootPool,
} from '../weekly_rewards';

/** Explicit local/dev-only fixture. Never called by normal gameplay or reset. */
export function prepareWeeklyVaultPlaytest(ctx: SimContext, pid: number): void {
  if (!ctx.devCommands) return;
  const r = ctx.resolve(pid);
  const keeper = NPCS[WEEKLY_KEEPER_ID];
  if (!r || !keeper || r.e.dead) return;
  cancelProfessionSessionOnDisplacement(ctx, r.e);
  r.e.pos = ctx.groundPos(keeper.pos.x - 1, keeper.pos.z - 1);
  r.e.prevPos = { ...r.e.pos };
  ctx.rebucket(r.e);
  const state = emptyWeeklyRewards(ctx.weeklyRaidResetMs(ctx.lockoutNowMs()));
  state.raids = [2, 1, 2];
  state.dungeons = [2, 2, 2, 2, 1];
  state.pvp = 3;
  state.raidUnlocks = [2, 2, 2];
  state.vaults = [
    {
      resetAtMs: Math.max(1, state.resetAtMs - 604800000),
      choices: (['raid', 'raid_heroic', 'dungeon', 'dungeon_heroic', 'pvp'] as WeeklyPoolId[]).map(
        (pool) => ({ pool, itemId: ctx.rng.pick(weeklyLootPool(pool, r.meta.cls)) }),
      ),
    },
  ];
  // Never reuse an earlier claim token when re-seeding the dev fixture.
  state.claimSequence = (r.meta.weeklyRewards?.claimSequence ?? 0) + 1;
  r.meta.weeklyRewards = state;
  ctx.emit({ type: 'weekly_rewards', pid });
}
