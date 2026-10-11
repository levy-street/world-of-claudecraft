import { NPCS } from '../data';
import { cancelProfessionSessionOnDisplacement } from '../professions/session_teardown';
import type { SimContext } from '../sim_context';
import { WEEKLY_BOSS_TABLES } from '../weekly_reward_tables';
import { emptyWeeklyRewards, WEEKLY_KEEPER_ID, type WeeklyPoolId } from '../weekly_rewards';

/** Explicit local/dev-only fixture. Never called by normal gameplay or reset. */
export function prepareWeeklyVaultPlaytest(ctx: SimContext, pid: number, rollover = false): void {
  if (!ctx.devCommands) return;
  const r = ctx.resolve(pid);
  const keeper = NPCS[WEEKLY_KEEPER_ID];
  if (!r || !keeper || r.e.dead) return;
  cancelProfessionSessionOnDisplacement(ctx, r.e);
  r.e.pos = ctx.groundPos(keeper.pos.x - 1, keeper.pos.z - 1);
  r.e.prevPos = { ...r.e.pos };
  ctx.rebucket(r.e);
  const state = emptyWeeklyRewards(
    rollover ? Math.max(1, ctx.lockoutNowMs() - 1000) : ctx.weeklyRaidResetMs(ctx.lockoutNowMs()),
  );
  state.raids = [2, 1, 2];
  state.dungeons = [2, 2, 2, 2, 1];
  state.pvp = 3;
  state.world = 4;
  state.raidUnlocks = [2, 2, 2];
  state.bossUnlocks = Object.fromEntries(WEEKLY_BOSS_TABLES.map(({ bossId }) => [bossId, 2]));
  // The rollover fixture leaves earning progress for the real reset path to roll
  // on the next read. It must not open the window before the tester interacts.
  state.vaults = rollover
    ? []
    : [
        {
          resetAtMs: Math.max(1, state.resetAtMs - 604800000),
          raidUnlocks: [2, 2, 2],
          bossUnlocks: { ...state.bossUnlocks },
          choices: (
            ['raid', 'raid_heroic', 'dungeon', 'dungeon_heroic', 'world', 'pvp'] as WeeklyPoolId[]
          ).map((pool) => ({ pool })),
        },
      ];
  // Never reuse an earlier claim token when re-seeding the dev fixture.
  state.claimSequence = (r.meta.weeklyRewards?.claimSequence ?? 0) + 1;
  r.meta.weeklyRewards = state;
  if (!rollover) ctx.emit({ type: 'weekly_rewards', pid });
}
