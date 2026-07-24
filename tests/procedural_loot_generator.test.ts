import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_LEGENDARY_POWERS,
  proceduralLegendaryPower,
} from '../src/sim/content/procedural_legendary_powers';
import {
  baseEligibleForAffix,
  PROCEDURAL_AFFIXES,
  PROCEDURAL_ITEM_BASES,
  PROCEDURAL_RARITIES,
} from '../src/sim/content/procedural_loot';
import {
  deriveProceduralItemSeed,
  formatProceduralItemUid,
  generateProceduralItem,
} from '../src/sim/loot/procedural';
import type { ItemDropContext } from '../src/sim/procedural_item';
import type { PlayerClass } from '../src/sim/types';

const BASE_IDS = Object.keys(PROCEDURAL_ITEM_BASES);
const RARITIES = ['common', 'magic', 'rare'] as const;
const CLASSES: PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

function context(seed: number, recipientId?: number): ItemDropContext {
  return {
    source: 'dungeon',
    sourceEntityId: 700,
    sourceSpawnSequence: Math.floor(seed / 8),
    lootSlotIndex: seed % 8,
    recipientId,
    sourceTemplateId: 'generator_matrix_boss',
    sourceTags: ['test', 'boss'],
  };
}

function generate(
  baseId: string,
  rarity: (typeof RARITIES)[number],
  seed: number,
  personalLootClass?: PlayerClass,
) {
  const dropContext = context(
    seed,
    personalLootClass ? CLASSES.indexOf(personalLootClass) + 1 : undefined,
  );
  return generateProceduralItem({
    seed: deriveProceduralItemSeed(seed, dropContext),
    uid: formatProceduralItemUid(
      'test',
      `${seed}${BASE_IDS.indexOf(baseId)}${RARITIES.indexOf(rarity)}`,
    ),
    context: dropContext,
    basePoolId: 'initial_all',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: 20,
    forcedBaseId: baseId,
    forcedRarity: rarity,
    personalLootClass,
  });
}

describe('procedural item generator', () => {
  it('checks 1,152 deterministic base, rarity, and seed scenarios', () => {
    let scenarios = 0;
    for (const baseId of BASE_IDS) {
      for (const rarity of RARITIES) {
        for (let seed = 1; seed <= 64; seed++) {
          const first = generate(baseId, rarity, seed);
          const second = generate(baseId, rarity, seed);
          expect(second, `${baseId}:${rarity}:${seed}`).toEqual(first);

          const item = first.instance.procedural;
          const base = PROCEDURAL_ITEM_BASES[baseId];
          expect(first.itemId).toBe(baseId);
          expect(item.baseId).toBe(baseId);
          expect(item.version).toBe(1);
          expect(item.rarity).toBe(rarity);
          expect(item.itemLevel).toBeGreaterThanOrEqual(19);
          expect(item.itemLevel).toBeLessThanOrEqual(21);
          expect(item.seed).toBeGreaterThan(0);
          expect(item.generatedName.baseId).toBe(baseId);
          expect(item.dropContext).toEqual(context(seed));

          const allowedCounts = PROCEDURAL_RARITIES[rarity].affixCounts.map((entry) => entry.count);
          expect(allowedCounts, `${baseId}:${rarity}:${seed}:count`).toContain(item.affixes.length);
          expect(new Set(item.affixes.map((affix) => affix.family)).size).toBe(item.affixes.length);

          for (const affix of item.affixes) {
            const definition = PROCEDURAL_AFFIXES[affix.affixId];
            expect(definition, affix.affixId).toBeDefined();
            expect(baseEligibleForAffix(base, definition)).toBe(true);
            expect(affix.family).toBe(definition.family);
            expect(affix.revision).toBe(1);
            expect(affix.budget).toBeGreaterThan(0);
            for (const [stat, value] of Object.entries(affix.values)) {
              const range = affix.ranges[stat];
              expect(Number.isFinite(value), `${affix.affixId}:${stat}`).toBe(true);
              expect(value).toBeGreaterThanOrEqual(range.min);
              expect(value).toBeLessThanOrEqual(range.max);
            }
          }
          scenarios++;
        }
      }
    }
    expect(scenarios).toBe(1152);
  });

  it('produces useful variation over different seeds', () => {
    const fingerprints = new Set<string>();
    for (let seed = 1; seed <= 256; seed++) {
      const drop = generate('gravecaller_ring', 'rare', seed);
      fingerprints.add(JSON.stringify(drop.instance.procedural));
    }
    expect(fingerprints.size).toBeGreaterThan(240);
  });

  it('persists a compatible, revisioned, quantized power for 288 forced legendary drops', () => {
    let scenarios = 0;
    for (const cls of CLASSES) {
      for (let seed = 1; seed <= 32; seed++) {
        const dropContext = context(seed, CLASSES.indexOf(cls) + 1);
        const item = generateProceduralItem({
          seed: deriveProceduralItemSeed(seed, dropContext),
          uid: formatProceduralItemUid('legendary', scenarios + 1),
          context: dropContext,
          basePoolId: 'initial_all',
          rarityTableId: 'initial_dungeon_boss',
          sourceItemLevel: 20,
          forcedBaseId: 'gravecaller_ring',
          forcedRarity: 'legendary',
          personalLootClass: cls,
        }).instance.procedural;
        const power = proceduralLegendaryPower(item.legendaryPowerId ?? '');
        expect(power).toBeDefined();
        if (!power) throw new Error('generated legendary power was not catalogued');
        expect(item.powerRevision).toBe(1);
        expect(item.generatedName.legendaryNameId).toBe(power?.id);
        expect(power?.requiredClass === undefined || power.requiredClass === cls).toBe(true);
        expect(Object.keys(item.legendaryRolls ?? {}).sort()).toEqual(
          Object.keys(power?.rolls ?? {}).sort(),
        );
        for (const [key, value] of Object.entries(item.legendaryRolls ?? {})) {
          const range = power.rolls[key];
          expect(value).toBeGreaterThanOrEqual(range.min);
          expect(value).toBeLessThanOrEqual(range.max);
          expect(
            Math.abs(
              (value - range.min) / range.step - Math.round((value - range.min) / range.step),
            ),
          ).toBeLessThan(1e-8);
        }
        scenarios++;
      }
    }
    expect(scenarios).toBe(288);
    expect(Object.keys(PROCEDURAL_LEGENDARY_POWERS)).toHaveLength(12);
  });

  it('honors exact and clamped forced item levels without shifting later draws', () => {
    const base = {
      seed: 501,
      uid: 'pi1:forced-level:1',
      context: context(501),
      basePoolId: 'initial_all',
      rarityTableId: 'initial_dungeon_boss',
      sourceItemLevel: 18,
      forcedBaseId: 'gravecaller_ring',
      forcedRarity: 'legendary' as const,
    };
    expect(
      generateProceduralItem({ ...base, forcedItemLevel: -20 }).instance.procedural.itemLevel,
    ).toBe(1);
    expect(
      generateProceduralItem({ ...base, forcedItemLevel: 17.9 }).instance.procedural.itemLevel,
    ).toBe(17);
    expect(
      generateProceduralItem({ ...base, forcedItemLevel: 999 }).instance.procedural.itemLevel,
    ).toBe(40);
    expect(() => generateProceduralItem({ ...base, forcedItemLevel: Number.NaN })).toThrow(
      /forced item level must be finite/,
    );

    let matchingSeed = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const candidate = generateProceduralItem({ ...base, seed, uid: `pi1:forced-level:${seed}` });
      if (candidate.instance.procedural.itemLevel === 20) {
        matchingSeed = seed;
        break;
      }
    }
    expect(matchingSeed).toBeGreaterThan(0);
    const uid = `pi1:forced-level:${matchingSeed}`;
    const rolled = generateProceduralItem({ ...base, seed: matchingSeed, uid });
    const forced = generateProceduralItem({
      ...base,
      seed: matchingSeed,
      uid,
      forcedItemLevel: 20,
    });
    expect(forced).toEqual(rolled);
  });

  it('keeps reserved legendary fields absent on non-legendary output', () => {
    for (const rarity of ['common', 'magic', 'rare', 'epic'] as const) {
      const item = generateProceduralItem({
        seed: 900 + RARITIES.indexOf(rarity as (typeof RARITIES)[number]),
        uid: `pi1:nonlegendary:${rarity.length}`,
        context: context(900),
        basePoolId: 'initial_all',
        rarityTableId: 'initial_dungeon_boss',
        sourceItemLevel: 20,
        forcedBaseId: 'gravecaller_ring',
        forcedRarity: rarity,
      }).instance.procedural;
      expect(item.legendaryPowerId).toBeUndefined();
      expect(item.powerRevision).toBeUndefined();
      expect(item.legendaryRolls).toBeUndefined();
      expect(item.generatedName.legendaryNameId).toBeUndefined();
    }
  });

  it('uses magic prefix or suffix identity from the dominant affix', () => {
    for (let seed = 1; seed <= 128; seed++) {
      const item = generate('gravecaller_ring', 'magic', seed).instance.procedural;
      expect(Boolean(item.generatedName.prefixId) || Boolean(item.generatedName.suffixId)).toBe(
        true,
      );
      expect(item.generatedName.rareWordIds).toBeUndefined();
    }
  });

  it('uses deterministic two-token names for rare items', () => {
    for (let seed = 1; seed <= 128; seed++) {
      const item = generate('gravecaller_ring', 'rare', seed).instance.procedural;
      expect(item.generatedName.rareWordIds).toHaveLength(2);
      expect(item.generatedName.prefixId).toBeUndefined();
      expect(item.generatedName.suffixId).toBeUndefined();
    }
  });

  it('biases personal drops without making every item class-specific', () => {
    let mageUsable = 0;
    let offClass = 0;
    for (let seed = 1; seed <= 1200; seed++) {
      const dropContext = context(seed, 9);
      const drop = generateProceduralItem({
        seed: deriveProceduralItemSeed(seed, dropContext),
        uid: formatProceduralItemUid('smart', seed),
        context: dropContext,
        basePoolId: 'initial_all',
        rarityTableId: 'initial_world',
        sourceItemLevel: 18,
        forcedRarity: 'magic',
        personalLootClass: 'mage',
      });
      const base = PROCEDURAL_ITEM_BASES[drop.itemId];
      if (!base.requiredClass || base.requiredClass.includes('mage')) mageUsable++;
      else offClass++;
    }
    expect(mageUsable / 1200).toBeGreaterThan(0.68);
    expect(offClass).toBeGreaterThan(150);
  });

  it('never reuses the same UID when a monotonic serial changes', () => {
    const ids = new Set<string>();
    for (let serial = 0; serial < 10000; serial++)
      ids.add(formatProceduralItemUid('matrix', serial));
    expect(ids.size).toBe(10000);
  });

  it.each(RARITIES)('keeps every %s roll JSON-safe', (rarity) => {
    for (let seed = 1; seed <= 128; seed++) {
      const item = generate('iron_broadsword', rarity, seed).instance.procedural;
      expect(JSON.parse(JSON.stringify(item))).toEqual(item);
    }
  });

  it('rejects unknown pools, tables, and forced bases', () => {
    const baseInput = {
      seed: 1,
      uid: 'pi1:test:1',
      context: context(1),
      basePoolId: 'initial_all',
      rarityTableId: 'initial_world',
      sourceItemLevel: 20,
    };
    expect(() => generateProceduralItem({ ...baseInput, basePoolId: 'missing' })).toThrow(
      /unknown procedural base pool/,
    );
    expect(() => generateProceduralItem({ ...baseInput, rarityTableId: 'missing' })).toThrow(
      /unknown rarity table/,
    );
    expect(() => generateProceduralItem({ ...baseInput, forcedBaseId: 'missing' })).toThrow(
      /forced base/,
    );
  });
});
