// The session reward counters: the shape, and its zero value.
//
// ONE MODULE OWNS THE SHAPE, the same rule src/sim/bank.ts already applies to the
// bank blob (emptyBankState / savedBankState). A counter added to the interface
// below without a matching zero here is a partially-initialised session, and the
// RL env reads these every step as its reward channel, so a missing field reads
// as NaN rather than as an error.
//
// Session-scoped on purpose: nothing here is persisted, `freshCounters` runs once
// per boot, and the PERSISTED lifetime totals live elsewhere (src/sim/types.ts
// says which). DOM-free and dependency-free, like everything else under src/sim.

/** Per-session tallies. Reset each boot; never persisted. */
export interface RewardCounters {
  damageDealt: number;
  damageTaken: number;
  kills: number;
  deaths: number;
  xpGained: number;
  questsCompleted: number;
  questProgress: number;
  lootCopper: number;
  levelUps: number;
}

/** A fresh set of counters, every field at zero. */
export function freshCounters(): RewardCounters {
  return {
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    deaths: 0,
    xpGained: 0,
    questsCompleted: 0,
    questProgress: 0,
    lootCopper: 0,
    levelUps: 0,
  };
}
