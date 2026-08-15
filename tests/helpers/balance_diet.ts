// PR-tier diet vs the nightly full sweep for the owned-class balance family
// (docs/qa-gate.md, "The balance-harness diet"). These suites are regression
// tripwires, not measurements (the authoritative balance instrument is the
// offline Monte Carlo sweep), so the PR long-sims lane runs a reduced
// configuration and WOC_FULL_BALANCE_SWEEP=1 (set only by the nightly
// workflow) restores the full one. Every band in the consuming suites is
// pinned to a measurement at ITS OWN configuration via band(full, diet); when
// a balance change moves a band, re-pin BOTH values from their own printed
// actuals, and never carry one configuration's value under the other.
//
// Each consuming suite reads the flag ITSELF with the exact literal
// `process.env` dot `WOC_FULL_BALANCE_SWEEP === '1'` and passes it in here:
// the diet-flag registry pin (tests/ci_shard_plan.test.ts) source-scrapes
// test files for that literal to weld every flag reader to long-sims lane
// membership, and a flag read hidden inside this helper would blind it. That
// is also why this helper never touches process.env.
import {
  OWNED_CLASS_LEVEL_20_BOSS_SCENARIO,
  OWNED_CLASS_RAID_SCENARIOS,
  type OwnedClassBalanceScenario,
} from '../../scripts/owned_class_balance_probe';

// Seed VALUES are fixed and never change here; only the count does.
export const balanceSeeds = (fullSweep: boolean): readonly number[] =>
  fullSweep ? [29_930, 29_931, 29_932, 29_933, 29_934] : [29_930, 29_931];

export const bandAt =
  (fullSweep: boolean) =>
  (full: number, diet: number): number =>
    fullSweep ? full : diet;

// The 120 s level-20 boss window trips the same coefficient regressions in
// its first 60 s; the diet halves it. (The raid family keeps its own 120 s
// windows: its mana-sustain and cadence assertions are long-fight guards.)
export const bossScenarioAt = (fullSweep: boolean): OwnedClassBalanceScenario =>
  fullSweep
    ? OWNED_CLASS_LEVEL_20_BOSS_SCENARIO
    : { ...OWNED_CLASS_LEVEL_20_BOSS_SCENARIO, seconds: 60 };

// Raid diet: only the level-24 boss (the tightest FLOOR of the three raid
// profiles; the warspirit/vespers CEILING is tightest at level 22, so that
// arm's PR-time margin is looser than the sweep's tightest and its
// full-depth copy is nightly-only). The full sweep restores all three levels.
export const raidScenariosUnderTest = (fullSweep: boolean): readonly OwnedClassBalanceScenario[] =>
  fullSweep ? OWNED_CLASS_RAID_SCENARIOS : [OWNED_CLASS_RAID_SCENARIOS[2]];
