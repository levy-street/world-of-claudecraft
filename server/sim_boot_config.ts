// The realm GameServer's Sim boot configuration, assembled here (Bank Storage
// phase 09) so server/game.ts stays a thin consumer under its monolith
// ceiling. Every field is boot-time construction input the coordinator never
// touches again. The one parameter is the perfLap hook, which must stay a
// game.ts closure because it reads the GameServer's live tick-profiler state.

import {
  PLAYER_INTEREST_DROP_RADIUS,
  type SimConfig,
  type VaultConsumptionAdmission,
} from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { nextRaidResetMs, nextWeeklyRaidResetMs } from './raid_reset';
import { REALM_RESET_TIME_ZONE } from './realm';
import { STORAGE_PRICES } from './storage_prices';

// The admission is REQUIRED, deliberately, even though SimConfig's own field
// is optional (offline Sim constructions omit it and run inert): this seam is
// where the live realm forgets its wiring, and an optional parameter here let
// a boot that dropped the journal admission compile and silently skip the
// durable audit reservation. A caller that MEANS to run inert passes the
// exported inertVaultConsumptionAdmission by name (src/sim/sim_context.ts).
export function buildRealmSimConfig(
  perfLap: SimConfig['perfLap'],
  vaultConsumptionAdmission: VaultConsumptionAdmission,
): SimConfig {
  return {
    seed: WORLD_SEED,
    playerClass: 'warrior',
    noPlayer: true,
    devCommands: process.env.ALLOW_DEV_COMMANDS === '1',
    // Thunzharr is up as soon as the realm boots; subsequent rises keep the
    // normal interval cadence (see src/sim/world_boss.ts).
    // Live realm: legacy fresh mainland rows get ferried through the Proving
    // Shore too. Landed on the release's inline literal and mirrored here,
    // because this module is where that literal now lives.
    compulsoryTutorial: true,
    worldBossAtBoot: true,
    // Ranked rift portals spawn on the live realm (dev/test worlds opt in).
    riftPortals: true,
    // Distance-cull idle-mob AI (issue #2703): shouldSkipIdleMobTick skips a
    // wild, unbuffed, out-of-combat mob's per-tick aggro scan and wander
    // movement while it sits farther than this from EVERY connected player,
    // and it plainly never fires when nobody is connected at all. The world
    // grew from 3 zones to 11 (vite.config.ts) with it, so a realm's total mob
    // count and its per-mob terrain-height cost both grew well past what this
    // knob was originally sized against, and this Sim never opted in: every
    // mob everywhere paid full AI cost on every 50 ms tick regardless of
    // player proximity, which is what turned "nobody online" into a
    // multiples-of-idle CPU baseline as the world grew.
    // PLAYER_INTEREST_DROP_RADIUS (re-exported by server/game.ts as
    // INTEREST_DROP_RADIUS) is the exact distance a mob remains rendered to a
    // viewer, so a culled mob can never be one a player can actually see sit
    // still, and it is well past MAX_AGGRO_RADIUS (20 yd,
    // mob/aggro_ranges.ts), so culling never skips a scan that could have
    // pulled someone.
    idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
    lockoutNowMs: () => Date.now(),
    // Raid lockouts end at the next 3 AM (the classic daily reset) in this realm's civil
    // time zone, so the whole realm shares one predictable reset (via REALM_RESET_TZ).
    raidResetMs: (nowMs) => nextRaidResetMs(nowMs, REALM_RESET_TIME_ZONE),
    // The Ignivar rooms run on a weekly lockout beside the daily one
    // (server/raid_reset.ts): realm-local Tuesday, ported here when the boot
    // config moved out of game.ts (the 3685 base sync).
    weeklyRaidResetMs: (nowMs) => nextWeeklyRaidResetMs(nowMs, REALM_RESET_TIME_ZONE),
    perfLap,
    vaultConsumptionAdmission,
    // Boot-time construction input: the optional STORAGE_PRICES env override
    // (server/storage_prices.ts), resolved once by the Sim ctor.
    storagePrices: STORAGE_PRICES,
  };
}
