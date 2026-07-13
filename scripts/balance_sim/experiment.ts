// The Monte Carlo experiment runner: a PvP round robin plus PvE kill benchmarks
// over every selected spec, swept across deterministic seed streams, aggregated
// into standings, matchup matrices, and outlier rankings. Optionally a talent
// knockout pass: re-run a spec with one talent node removed and measure the
// winrate delta, which attributes brokenness to individual talents.

import { talentPointsAtLevel } from '../../src/sim/content/talents';
import { MAX_LEVEL } from '../../src/sim/types';
import { type DuelResult, type PveTarget, runDuelBout, runPveBout } from './bout';
import { knockoutBuilds, specBuild } from './builds';
import { type BalanceSpec, SPEC_CATALOG, specByKey } from './spec_catalog';
import {
  aggregatePvp,
  type BrokenRanking,
  matchupMatrix,
  mean,
  type PvpOutcome,
  type PvpStanding,
  rankBrokenness,
  zScores,
} from './stats';

export interface ExperimentConfig {
  specKeys: string[];
  trials: number;
  baseSeed: number;
  level: number;
  pvp: boolean;
  pve: boolean;
  pveTargets: PveTarget[];
  maxSeconds: number;
  knockout: boolean;
  knockoutTrials: number;
}

export const DEFAULT_PVE_TARGETS: PveTarget[] = [
  { key: 'standard', templateId: 'forest_wolf' },
  { key: 'elite', templateId: 'ogre_crusher' },
];

export function defaultConfig(): ExperimentConfig {
  return {
    specKeys: SPEC_CATALOG.map((s) => s.key),
    trials: 20,
    baseSeed: 1337,
    level: MAX_LEVEL,
    pvp: true,
    pve: true,
    pveTargets: DEFAULT_PVE_TARGETS,
    maxSeconds: 180,
    knockout: false,
    knockoutTrials: 6,
  };
}

// Deterministic seed stream: a fixed integer mix of the experiment base seed
// and the trial coordinates. No wall clock, no Math.random, so the same config
// always reproduces the same report byte for byte.
export function mixSeed(base: number, a: number, b: number, c: number): number {
  let h = base >>> 0;
  h = (h ^ Math.imul(a + 1, 2654435761)) >>> 0;
  h = (h ^ Math.imul(b + 1, 40503)) >>> 0;
  h = (h ^ Math.imul(c + 1, 69427)) >>> 0;
  // Final avalanche so consecutive trials do not share low bits.
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return h;
}

export interface DuelRecord {
  aKey: string;
  bKey: string;
  seed: number;
  winner: 'a' | 'b' | 'draw';
  endReason: DuelResult['endReason'];
  seconds: number;
  realDeath: boolean;
}

export interface SpecPvpDetail {
  key: string;
  avgDuelSeconds: number;
  avgControlTicksInflicted: number;
  avgDamagePerDuel: number;
  avgHealingPerDuel: number;
  topDamageAbilities: { ability: string; share: number }[];
}

export interface SpecPveRow {
  key: string;
  targetKey: string;
  trials: number;
  killRate: number;
  deathRate: number;
  avgKillSeconds: number | null;
  avgDps: number;
}

export interface KnockoutRow {
  key: string;
  nodeId: string;
  games: number;
  fullWinRate: number;
  knockoutWinRate: number;
  // fullWinRate minus knockoutWinRate: how much winrate this single talent buys.
  winRateDelta: number;
}

export interface ExperimentResult {
  config: ExperimentConfig;
  standings: PvpStanding[];
  matchups: Record<string, Record<string, number>>;
  pvpDetails: SpecPvpDetail[];
  duels: DuelRecord[];
  pve: SpecPveRow[];
  ranking: BrokenRanking[];
  knockouts: KnockoutRow[];
  // Duels where a fighter actually died despite the 1 hp duel guard: the
  // non-lethality hole this simulator surfaced (in-flight shots landing on the
  // same tick the duel ends).
  realDeathCount: number;
}

export type ProgressFn = (done: number, total: number, label: string) => void;

interface PvpAccumulator {
  duels: number;
  seconds: number;
  control: number;
  damage: number;
  healing: number;
  byAbility: Record<string, number>;
}

export function runExperiment(cfg: ExperimentConfig, onProgress?: ProgressFn): ExperimentResult {
  const specs = cfg.specKeys.map((key) => {
    const spec = specByKey(key);
    if (!spec) throw new Error(`unknown spec key "${key}"`);
    return spec;
  });
  const outcomes: PvpOutcome[] = [];
  const duels: DuelRecord[] = [];
  const acc = new Map<string, PvpAccumulator>();
  const accFor = (key: string): PvpAccumulator => {
    let a = acc.get(key);
    if (!a) {
      a = { duels: 0, seconds: 0, control: 0, damage: 0, healing: 0, byAbility: {} };
      acc.set(key, a);
    }
    return a;
  };

  const pairs: [BalanceSpec, BalanceSpec][] = [];
  for (let i = 0; i < specs.length; i++) {
    for (let j = i + 1; j < specs.length; j++) pairs.push([specs[i], specs[j]]);
  }
  const pveJobs = cfg.pve ? specs.length * cfg.pveTargets.length : 0;
  const total = (cfg.pvp ? pairs.length : 0) + pveJobs;
  let done = 0;
  let realDeathCount = 0;

  if (cfg.pvp) {
    for (let p = 0; p < pairs.length; p++) {
      const [sa, sb] = pairs[p];
      for (let t = 0; t < cfg.trials; t++) {
        const seed = mixSeed(cfg.baseSeed, p, 1, t);
        const r = runDuelBout(
          { spec: sa, level: cfg.level },
          { spec: sb, level: cfg.level },
          seed,
          cfg.maxSeconds,
        );
        outcomes.push({ aKey: sa.key, bKey: sb.key, winner: r.winner });
        const realDeath = r.a.diedForReal || r.b.diedForReal;
        if (realDeath) realDeathCount++;
        duels.push({
          aKey: sa.key,
          bKey: sb.key,
          seed,
          winner: r.winner,
          endReason: r.endReason,
          seconds: r.seconds,
          realDeath,
        });
        for (const [spec, m] of [
          [sa, r.a],
          [sb, r.b],
        ] as const) {
          const a = accFor(spec.key);
          a.duels++;
          a.seconds += r.seconds;
          a.control += m.controlTicksInflicted;
          a.damage += m.damageDone;
          a.healing += m.healingDone;
          for (const [ability, amount] of Object.entries(m.damageByAbility)) {
            a.byAbility[ability] = (a.byAbility[ability] ?? 0) + amount;
          }
        }
      }
      done++;
      onProgress?.(done, total, `pvp ${sa.key} vs ${sb.key}`);
    }
  }

  const pve: SpecPveRow[] = [];
  if (cfg.pve) {
    for (let s = 0; s < specs.length; s++) {
      for (let g = 0; g < cfg.pveTargets.length; g++) {
        const target = cfg.pveTargets[g];
        let kills = 0;
        let deaths = 0;
        const killSeconds: number[] = [];
        const dpsSamples: number[] = [];
        for (let t = 0; t < cfg.trials; t++) {
          const seed = mixSeed(cfg.baseSeed, 100000 + s, 2 + g, t);
          const r = runPveBout({ spec: specs[s], level: cfg.level }, target, seed, cfg.maxSeconds);
          if (r.killed) {
            kills++;
            killSeconds.push(r.seconds);
          }
          if (r.playerDied) deaths++;
          dpsSamples.push(r.dps);
        }
        pve.push({
          key: specs[s].key,
          targetKey: target.key,
          trials: cfg.trials,
          killRate: cfg.trials > 0 ? kills / cfg.trials : 0,
          deathRate: cfg.trials > 0 ? deaths / cfg.trials : 0,
          avgKillSeconds: killSeconds.length > 0 ? mean(killSeconds) : null,
          avgDps: mean(dpsSamples),
        });
        done++;
        onProgress?.(done, total, `pve ${specs[s].key} vs ${target.key}`);
      }
    }
  }

  const standings = aggregatePvp(outcomes);
  const pvpDetails: SpecPvpDetail[] = [...acc.entries()]
    .map(([key, a]) => {
      const totalDamage = Object.values(a.byAbility).reduce((x, y) => x + y, 0);
      const topDamageAbilities = Object.entries(a.byAbility)
        .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
        .slice(0, 3)
        .map(([ability, amount]) => ({
          ability,
          share: totalDamage > 0 ? amount / totalDamage : 0,
        }));
      return {
        key,
        avgDuelSeconds: a.duels > 0 ? a.seconds / a.duels : 0,
        avgControlTicksInflicted: a.duels > 0 ? a.control / a.duels : 0,
        avgDamagePerDuel: a.duels > 0 ? a.damage / a.duels : 0,
        avgHealingPerDuel: a.duels > 0 ? a.healing / a.duels : 0,
        topDamageAbilities,
      };
    })
    .sort((x, y) => x.key.localeCompare(y.key));

  // PvE speed z-scores come from the standard target so elites (which some
  // specs cannot solo) do not dominate the composite.
  const standard = pve.filter((r) => r.targetKey === cfg.pveTargets[0]?.key);
  const timed = standard.filter((r) => r.avgKillSeconds !== null);
  const zs = zScores(timed.map((r) => r.avgKillSeconds ?? 0));
  const pveZ = timed.map((r, i) => ({ key: r.key, zScore: zs[i] }));
  const ranking = rankBrokenness(
    cfg.pvp ? standings.map((s) => ({ key: s.key, zScore: s.zScore })) : [],
    cfg.pve ? pveZ : [],
  );

  const knockouts = cfg.knockout ? runKnockouts(cfg, specs, onProgress) : [];

  return {
    config: cfg,
    standings,
    matchups: matchupMatrix(outcomes),
    pvpDetails,
    duels,
    pve,
    ranking,
    knockouts,
    realDeathCount,
  };
}

// Knockout pass: for each spec, duel a small fixed opponent pool with the full
// build and once more per removed talent node, same seeds, and report the
// winrate each single talent is worth. Quadratic in nothing but still costly
// (nodes x pool x trials duels per spec): opt in via config.
function runKnockouts(
  cfg: ExperimentConfig,
  specs: BalanceSpec[],
  onProgress?: ProgressFn,
): KnockoutRow[] {
  const points = talentPointsAtLevel(cfg.level);
  const poolStride = Math.max(1, Math.ceil(specs.length / 4));
  const pool = specs.filter((_, i) => i % poolStride === 0).slice(0, 4);
  const rows: KnockoutRow[] = [];
  for (let s = 0; s < specs.length; s++) {
    const spec = specs[s];
    const full = specBuild(spec.cls, spec.specId, points);
    const cuts = knockoutBuilds(spec.cls, full, points);
    const winRateVs = (talents: typeof full, cutIndex: number): number => {
      let wins = 0;
      let games = 0;
      for (let o = 0; o < pool.length; o++) {
        if (pool[o].key === spec.key) continue;
        for (let t = 0; t < cfg.knockoutTrials; t++) {
          // Same seed for full and knockout runs: the delta isolates the talent.
          const seed = mixSeed(cfg.baseSeed, 200000 + s, o, t);
          const r = runDuelBout(
            { spec, level: cfg.level, talents },
            { spec: pool[o], level: cfg.level },
            seed,
            cfg.maxSeconds,
          );
          games++;
          wins += r.winner === 'a' ? 1 : r.winner === 'draw' ? 0.5 : 0;
        }
      }
      onProgress?.(cutIndex + 1, cuts.length + 1, `knockout ${spec.key}`);
      return games > 0 ? wins / games : 0;
    };
    const fullWinRate = winRateVs(full, -1);
    const games = (pool.filter((p) => p.key !== spec.key).length || 0) * cfg.knockoutTrials;
    for (let c = 0; c < cuts.length; c++) {
      const knockoutWinRate = winRateVs(cuts[c].alloc, c);
      rows.push({
        key: spec.key,
        nodeId: cuts[c].nodeId,
        games,
        fullWinRate,
        knockoutWinRate,
        winRateDelta: fullWinRate - knockoutWinRate,
      });
    }
  }
  return rows.sort((a, b) => b.winRateDelta - a.winRateDelta || a.nodeId.localeCompare(b.nodeId));
}
