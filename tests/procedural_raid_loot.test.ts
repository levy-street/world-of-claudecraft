import { describe, expect, it } from 'vitest';
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
import {
  generateLiveProceduralDrop,
  type ProceduralSourceFacts,
  proceduralDropProfile,
} from '../src/sim/loot/procedural/live_drop';
import type { ProceduralRarity } from '../src/sim/procedural_item';
import type { PlayerClass } from '../src/sim/types';
import { resolveProceduralItemIcon } from '../src/ui/procedural_item_art';

const BOSS = MOBS[NYTHRAXIS_RAID_BOSS_ID];
const ACTIVE_RARITIES = ['rare', 'epic', 'legendary'] as const;

function raidFacts(difficulty: 'normal' | 'heroic'): ProceduralSourceFacts {
  return {
    inDungeon: true,
    inDelve: false,
    dungeonId: NYTHRAXIS_RAID_DUNGEON_ID,
    dungeonDifficulty: difficulty,
  };
}

function liveDrop(
  difficulty: 'normal' | 'heroic',
  sequence: number,
  lootRecipientClasses: readonly PlayerClass[] = ['mage', 'warrior', 'paladin', 'druid'],
) {
  return generateLiveProceduralDrop({
    worldSeed: 30_037,
    sourceEntityId: 90_001,
    sourceSpawnSequence: sequence,
    lootSlotIndex: 0,
    sourceItemLevel: BOSS.maxLevel,
    sourceTemplate: BOSS,
    sourceFacts: raidFacts(difficulty),
    uid: `pi1:raid-loot:${difficulty}:${sequence + 1}`,
    lootRecipientClasses,
  });
}

function quantizedMidpoint(range: { min: number; max: number; step?: number }): number {
  const step = range.step ?? 1;
  const digits = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
  return Number(
    (Math.round((range.min + (range.max - range.min) * 0.5) / step) * step).toFixed(digits),
  );
}

describe('Nythraxis procedural raid loot', () => {
  it('pins the authoritative Normal and Heroic rarity, item-level, magnitude and fragment profiles', () => {
    expect(PROCEDURAL_RARITY_TABLES.nythraxis_raid_normal.weights).toEqual({
      rare: 0.65,
      epic: 0.33,
      legendary: 0.02,
    });
    expect(PROCEDURAL_RARITY_TABLES.nythraxis_raid_heroic.weights).toEqual({
      rare: 0.4,
      epic: 0.55,
      legendary: 0.05,
    });
    expect(NYTHRAXIS_PROCEDURAL_RAID_PROFILES).toEqual({
      normal: {
        difficulty: 'normal',
        rarityTableId: 'nythraxis_raid_normal',
        itemLevels: { rare: 27, epic: 28, legendary: 32 },
        legendaryMagnitudeFloor: 0,
        fragmentsPerParticipant: 1,
      },
      heroic: {
        difficulty: 'heroic',
        rarityTableId: 'nythraxis_raid_heroic',
        itemLevels: { rare: 31, epic: 32, legendary: 36 },
        legendaryMagnitudeFloor: 0.5,
        fragmentsPerParticipant: 3,
      },
    });
    for (const tableId of ['nythraxis_raid_normal', 'nythraxis_raid_heroic']) {
      const weights = Object.values(PROCEDURAL_RARITY_TABLES[tableId].weights);
      expect(
        weights.reduce((sum, weight) => sum + (weight ?? 0), 0),
        tableId,
      ).toBe(1);
    }
  });

  it('routes Nythraxis to its raid profile before the generic dungeon-boss policy', () => {
    expect(proceduralDropProfile(BOSS, raidFacts('normal'))).toMatchObject({
      source: 'raid',
      chance: 1,
      basePoolId: 'nythraxis_raid',
      rarityTableId: 'nythraxis_raid_normal',
    });
    expect(proceduralDropProfile(BOSS, raidFacts('heroic'))).toMatchObject({
      source: 'raid',
      chance: 1,
      basePoolId: 'nythraxis_raid',
      rarityTableId: 'nythraxis_raid_heroic',
      raidForgedLegendary: true,
    });
    expect(
      proceduralDropProfile(BOSS, {
        ...raidFacts('heroic'),
        dungeonId: 'another_dungeon',
      }),
    ).toMatchObject({ source: 'dungeon', rarityTableId: 'initial_dungeon_boss' });
  });

  it.each(['normal', 'heroic'] as const)(
    'always appends exactly one %s shared procedural entry with provenance',
    (difficulty) => {
      for (let sequence = 0; sequence < 1_000; sequence++) {
        const drop = liveDrop(difficulty, sequence);
        expect(drop, String(sequence)).not.toBeNull();
        expect(drop?.instance.procedural.dropContext).toMatchObject({
          source: 'raid',
          sourceTemplateId: NYTHRAXIS_RAID_BOSS_ID,
        });
        expect(drop?.instance.procedural.dropContext?.sourceTags).toEqual(
          expect.arrayContaining(['raid', difficulty, 'boss']),
        );
      }
    },
  );

  it.each(['normal', 'heroic'] as const)(
    'pins all three %s item levels and excludes Common and Magic',
    (difficulty) => {
      const expected = NYTHRAXIS_PROCEDURAL_RAID_PROFILES[difficulty].itemLevels;
      const seen = new Set<ProceduralRarity>();
      for (let sequence = 0; sequence < 20_000 && seen.size < 3; sequence++) {
        const item = liveDrop(difficulty, sequence)?.instance.procedural;
        if (!item) throw new Error('Nythraxis raid entry unexpectedly missed');
        expect(ACTIVE_RARITIES).toContain(item.rarity);
        expect(item.itemLevel).toBe(expected[item.rarity as keyof typeof expected]);
        seen.add(item.rarity);
      }
      expect([...seen].sort()).toEqual([...ACTIVE_RARITIES].sort());
    },
  );

  it.each([
    ['normal', { rare: 0.65, epic: 0.33, legendary: 0.02 }],
    ['heroic', { rare: 0.4, epic: 0.55, legendary: 0.05 }],
  ] as const)(
    'holds the %s rarity distribution over 100,000 deterministic boss sources',
    (difficulty, expected) => {
      const counts = { rare: 0, epic: 0, legendary: 0 };
      const samples = 100_000;
      for (let sequence = 0; sequence < samples; sequence++) {
        const rarity = liveDrop(difficulty, sequence)?.instance.procedural.rarity;
        if (!rarity || rarity === 'common' || rarity === 'magic' || rarity === 'mythic')
          throw new Error(`unexpected raid rarity ${String(rarity)}`);
        counts[rarity]++;
      }
      for (const rarity of ACTIVE_RARITIES) {
        expect(counts[rarity] / samples, `${difficulty}:${rarity}`).toBeCloseTo(
          expected[rarity],
          2,
        );
      }
    },
    60_000,
  );

  it('remaps every Heroic Legendary power roll into the authored upper half', () => {
    let checked = 0;
    for (let sequence = 0; sequence < 20_000; sequence++) {
      const procedural = liveDrop('heroic', sequence)?.instance.procedural;
      if (!procedural || procedural.rarity !== 'legendary') continue;
      const power =
        PROCEDURAL_LEGENDARY_POWERS[procedural.legendaryPowerId as ProceduralLegendaryPowerId];
      for (const [key, range] of Object.entries(power.rolls)) {
        expect(procedural.legendaryRolls?.[key], `${power.id}:${key}`).toBeGreaterThanOrEqual(
          quantizedMidpoint(range),
        );
      }
      expect(procedural.raidForged).toBe(true);
      const art = resolveProceduralItemIcon(procedural.baseId, { procedural });
      expect(art?.state).toBe('legendary-raid-forged');
      expect(art?.url).toMatch(/\.r1\.ascendant\.webp$/);
      checked++;
    }
    expect(checked).toBeGreaterThan(850);
  });

  it('never selects a class-required Legendary power for an absent recipient class', () => {
    const roster: readonly PlayerClass[] = ['mage', 'warrior', 'rogue'];
    const allowed = new Set<PlayerClass>(roster);
    let checked = 0;
    for (let sequence = 0; sequence < 30_000; sequence++) {
      const procedural = liveDrop('normal', sequence, roster)?.instance.procedural;
      if (!procedural || procedural.rarity !== 'legendary') continue;
      const power =
        PROCEDURAL_LEGENDARY_POWERS[procedural.legendaryPowerId as ProceduralLegendaryPowerId];
      if ('requiredClass' in power) expect(allowed.has(power.requiredClass)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('does not mark non-Legendary Heroic drops or any Normal drop as Raid-forged', () => {
    for (let sequence = 0; sequence < 5_000; sequence++) {
      const normal = liveDrop('normal', sequence)?.instance.procedural;
      const heroic = liveDrop('heroic', sequence)?.instance.procedural;
      expect(normal?.raidForged).toBeUndefined();
      expect(heroic?.raidForged).toBe(heroic?.rarity === 'legendary' ? true : undefined);
    }
  });
});
