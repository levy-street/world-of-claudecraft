import {
  PROCEDURAL_LEGENDARY_POWERS,
  type ProceduralLegendaryPowerId,
} from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_RARITY_TABLES } from '../src/sim/content/procedural_loot';
import {
  NYTHRAXIS_PROCEDURAL_RAID_PROFILES,
  NYTHRAXIS_RAID_BOSS_ID,
  NYTHRAXIS_RAID_DUNGEON_ID,
} from '../src/sim/content/procedural_raid_loot';
import { MOBS } from '../src/sim/data';
import { hash32Parts } from '../src/sim/loot/procedural/item_seed';
import { generateLiveProceduralDrop } from '../src/sim/loot/procedural/live_drop';
import type { PlayerClass } from '../src/sim/types';

export const RAID_BALANCE_SAMPLE_FLOOR = 100_000;
export const RAID_BALANCE_MAX_RARITY_ERROR = 0.0075;

const RARITIES = ['rare', 'epic', 'legendary'] as const;
const DIFFICULTIES = ['normal', 'heroic'] as const;
const ROSTER = ['mage', 'warrior', 'paladin', 'druid'] as const satisfies readonly PlayerClass[];
const BOSS = MOBS[NYTHRAXIS_RAID_BOSS_ID];

type Difficulty = (typeof DIFFICULTIES)[number];
type RaidRarity = (typeof RARITIES)[number];

export interface RaidPowerObservation {
  powerId: string;
  rollKey: string;
  authoredMin: number;
  authoredMax: number;
  requiredMinimum: number;
  observedMin: number;
  observedMax: number;
  samples: number;
}

export interface RaidDifficultyBalance {
  difficulty: Difficulty;
  samples: number;
  expectedRates: Record<RaidRarity, number>;
  counts: Record<RaidRarity, number>;
  observedRates: Record<RaidRarity, number>;
  itemLevels: Record<RaidRarity, number>;
  maximumAbsoluteRateError: number;
  uniqueUids: number;
  powerObservations: RaidPowerObservation[];
  violations: string[];
}

export interface ProceduralRaidBalanceReport {
  campaign: 'nythraxis-raid-loot-v1';
  seed: number;
  samplesPerDifficulty: number;
  totalGeneratedItems: number;
  rosterClasses: readonly PlayerClass[];
  naturalLegendaryChanceByKills: Record<Difficulty, Array<{ kills: number; chancePct: number }>>;

  difficulties: RaidDifficultyBalance[];
  sampleFloorMet: boolean;
  gateFailures: string[];
  verdict: 'READY' | 'NOT_READY';
  deterministicFingerprint: string;
}

function midpoint(range: { min: number; max: number; step?: number }): number {
  const step = range.step ?? 1;
  const digits = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
  return Number(
    (Math.round((range.min + (range.max - range.min) * 0.5) / step) * step).toFixed(digits),
  );
}

function legendaryChance(p: number, kills: number): number {
  return Number((100 * (1 - (1 - p) ** kills)).toFixed(3));
}

function expectedRates(difficulty: Difficulty): Record<RaidRarity, number> {
  const weights =
    PROCEDURAL_RARITY_TABLES[NYTHRAXIS_PROCEDURAL_RAID_PROFILES[difficulty].rarityTableId].weights;
  return Object.fromEntries(RARITIES.map((rarity) => [rarity, weights[rarity] ?? 0])) as Record<
    RaidRarity,
    number
  >;
}

function observeDifficulty(
  difficulty: Difficulty,
  samples: number,
  seed: number,
): RaidDifficultyBalance {
  const expected = expectedRates(difficulty);
  const counts = { rare: 0, epic: 0, legendary: 0 };
  const uids = new Set<string>();
  const violations: string[] = [];
  const power = new Map<string, RaidPowerObservation>();
  const allowedClasses = new Set<PlayerClass>(ROSTER);
  const profile = NYTHRAXIS_PROCEDURAL_RAID_PROFILES[difficulty];

  for (let sequence = 0; sequence < samples; sequence++) {
    const uid = `pi1:raid-balance:${difficulty}:${sequence + 1}`;
    const drop = generateLiveProceduralDrop({
      worldSeed: seed,
      sourceEntityId: 90_001,
      sourceSpawnSequence: sequence,
      lootSlotIndex: 0,
      sourceItemLevel: BOSS.maxLevel,
      sourceTemplate: BOSS,
      sourceFacts: {
        inDungeon: true,
        inDelve: false,
        dungeonId: NYTHRAXIS_RAID_DUNGEON_ID,
        dungeonDifficulty: difficulty,
      },
      uid,
      lootRecipientClasses: ROSTER,
    });
    if (!drop) {
      violations.push(`missing guaranteed drop at sequence ${sequence}`);
      continue;
    }
    const item = drop.instance.procedural;
    if (item.rarity === 'common' || item.rarity === 'magic' || item.rarity === 'mythic') {
      violations.push(`unexpected ${item.rarity} at sequence ${sequence}`);
      continue;
    }
    counts[item.rarity]++;
    uids.add(item.uid);
    if (item.uid !== uid) violations.push(`UID changed at sequence ${sequence}`);
    if (item.itemLevel !== profile.itemLevels[item.rarity])
      violations.push(`wrong ${item.rarity} item level at sequence ${sequence}`);
    const families = item.affixes.map((affix) => affix.family);
    if (new Set(families).size !== families.length)
      violations.push(`duplicate affix family at sequence ${sequence}`);
    const expectedRaidForged = difficulty === 'heroic' && item.rarity === 'legendary';
    if (item.raidForged !== (expectedRaidForged ? true : undefined))
      violations.push(`wrong Raid-forged state at sequence ${sequence}`);

    if (item.rarity !== 'legendary' || !item.legendaryPowerId || !item.legendaryRolls) continue;
    const definition =
      PROCEDURAL_LEGENDARY_POWERS[item.legendaryPowerId as ProceduralLegendaryPowerId];
    if (!definition) {
      violations.push(`unknown Legendary power at sequence ${sequence}`);
      continue;
    }
    if ('requiredClass' in definition && !allowedClasses.has(definition.requiredClass))
      violations.push(`absent-class power ${definition.id} at sequence ${sequence}`);
    for (const [rollKey, range] of Object.entries(definition.rolls)) {
      const value = item.legendaryRolls[rollKey];
      const requiredMinimum = difficulty === 'heroic' ? midpoint(range) : range.min;
      if (value === undefined || value < requiredMinimum || value > range.max)
        violations.push(`out-of-range ${definition.id}.${rollKey} at sequence ${sequence}`);
      const key = `${definition.id}:${rollKey}`;
      const current = power.get(key);
      if (current) {
        current.observedMin = Math.min(current.observedMin, value);
        current.observedMax = Math.max(current.observedMax, value);
        current.samples++;
      } else {
        power.set(key, {
          powerId: definition.id,
          rollKey,
          authoredMin: range.min,
          authoredMax: range.max,
          requiredMinimum,
          observedMin: value,
          observedMax: value,
          samples: 1,
        });
      }
    }
  }

  const observed = Object.fromEntries(
    RARITIES.map((rarity) => [rarity, counts[rarity] / samples]),
  ) as Record<RaidRarity, number>;
  const maximumAbsoluteRateError = Math.max(
    ...RARITIES.map((rarity) => Math.abs(observed[rarity] - expected[rarity])),
  );
  if (maximumAbsoluteRateError > RAID_BALANCE_MAX_RARITY_ERROR)
    violations.push(`rarity error ${maximumAbsoluteRateError} exceeds release tolerance`);
  if (uids.size !== samples) violations.push(`expected ${samples} unique UIDs, saw ${uids.size}`);

  return {
    difficulty,
    samples,
    expectedRates: expected,
    counts,
    observedRates: observed,
    itemLevels: profile.itemLevels,
    maximumAbsoluteRateError,
    uniqueUids: uids.size,
    powerObservations: [...power.values()].sort((a, b) =>
      `${a.powerId}:${a.rollKey}`.localeCompare(`${b.powerId}:${b.rollKey}`),
    ),
    violations: [...new Set(violations)],
  };
}

export function simulateProceduralRaidBalance(options: {
  samplesPerDifficulty: number;
  seed: number;
}): ProceduralRaidBalanceReport {
  const difficulties = DIFFICULTIES.map((difficulty) =>
    observeDifficulty(difficulty, options.samplesPerDifficulty, options.seed),
  );
  const sampleFloorMet = options.samplesPerDifficulty >= RAID_BALANCE_SAMPLE_FLOOR;
  const gateFailures = [
    ...(!sampleFloorMet ? [`sample floor is ${RAID_BALANCE_SAMPLE_FLOOR}`] : []),
    ...difficulties.flatMap((difficulty) =>
      difficulty.violations.map((violation) => `${difficulty.difficulty}: ${violation}`),
    ),
  ];
  const kills = [1, 5, 10, 20, 25, 45, 50, 59, 90, 100];

  const fingerprint = hash32Parts(
    'procedural-raid-balance-v1',
    options.seed,
    options.samplesPerDifficulty,
    JSON.stringify(difficulties),
  )
    .toString(16)
    .padStart(8, '0');
  return {
    campaign: 'nythraxis-raid-loot-v1',
    seed: options.seed,
    samplesPerDifficulty: options.samplesPerDifficulty,
    totalGeneratedItems: options.samplesPerDifficulty * DIFFICULTIES.length,
    rosterClasses: ROSTER,
    naturalLegendaryChanceByKills: {
      normal: kills.map((count) => ({ kills: count, chancePct: legendaryChance(0.02, count) })),
      heroic: kills.map((count) => ({ kills: count, chancePct: legendaryChance(0.05, count) })),
    },

    difficulties,
    sampleFloorMet,
    gateFailures,
    verdict: gateFailures.length === 0 ? 'READY' : 'NOT_READY',
    deterministicFingerprint: fingerprint,
  };
}

export function assertProceduralRaidBalanceRelease(report: ProceduralRaidBalanceReport): void {
  if (report.verdict !== 'READY')
    throw new Error(`procedural raid balance gate failed:\n${report.gateFailures.join('\n')}`);
}
