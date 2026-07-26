import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_LEGENDARY_POWERS,
  proceduralLegendaryPower,
  proceduralLegendaryPowerCompatibleWithBase,
} from '../src/sim/content/procedural_legendary_powers';
import {
  baseEligibleForAffix,
  PROCEDURAL_AFFIXES,
  PROCEDURAL_ITEM_BASES,
  PROCEDURAL_RARITIES,
} from '../src/sim/content/procedural_loot';
import { PROCEDURAL_BASE_ITEMS } from '../src/sim/content/procedural_loot/item_defs';
import { canEquipItem } from '../src/sim/equipment_rules';
import {
  calculateProceduralBudget,
  deriveProceduralItemSeed,
  formatProceduralItemUid,
  generateProceduralItem,
} from '../src/sim/loot/procedural';
import type { ItemDropContext } from '../src/sim/procedural_item';
import { sanitizeItemInstancePayload } from '../src/sim/procedural_item_validation';
import { Rng } from '../src/sim/rng';
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
const LEGENDARY_BASE_BY_CLASS: Record<PlayerClass, string> = {
  warrior: 'iron_broadsword',
  paladin: 'gravecaller_ring',
  hunter: 'mirefen_hunting_bow',
  rogue: 'mirefen_dirk',
  priest: 'ashwood_staff',
  shaman: 'gravecaller_focus',
  mage: 'gravecaller_cloth_hood',
  warlock: 'gravecaller_ring',
  druid: 'gravecaller_pendant',
};

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
  it('checks every deterministic base, rarity, and seed scenario', () => {
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
    expect(scenarios).toBe(BASE_IDS.length * RARITIES.length * 64);
  }, 30_000);

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
          forcedBaseId: LEGENDARY_BASE_BY_CLASS[cls],
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

  it('rejects impossible forced item levels and preserves feasible forced draws', () => {
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
    expect(() => generateProceduralItem({ ...base, forcedItemLevel: -20 })).toThrow(/unattainable/);
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

  it('weights shared bases across every eligible recipient without excluding off-class drops', () => {
    const mageOnlyCounts = {
      warriorOnly: 0,
      warriorAndMage: 0,
    };
    let mixedPartyOffClass = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      const dropContext = context(seed, 9);
      for (const [key, lootRecipientClasses] of [
        ['warriorOnly', ['warrior']],
        ['warriorAndMage', ['warrior', 'mage']],
      ] as const) {
        const drop = generateProceduralItem({
          seed: deriveProceduralItemSeed(seed, dropContext),
          uid: formatProceduralItemUid('shared', seed * 10 + (key === 'warriorOnly' ? 1 : 2)),
          context: dropContext,
          basePoolId: 'initial_all',
          rarityTableId: 'initial_world',
          sourceItemLevel: 20,
          forcedRarity: 'magic',
          lootRecipientClasses,
        });
        const definition = PROCEDURAL_BASE_ITEMS[drop.itemId];
        if (canEquipItem('mage', definition) && !canEquipItem('warrior', definition)) {
          mageOnlyCounts[key]++;
        }
        if (
          key === 'warriorAndMage' &&
          !lootRecipientClasses.some((cls) => canEquipItem(cls, definition))
        ) {
          mixedPartyOffClass++;
        }
      }
    }

    expect(mageOnlyCounts.warriorAndMage).toBeGreaterThan(mageOnlyCounts.warriorOnly * 1.5);
    expect(mixedPartyOffClass).toBeGreaterThan(100);
  });

  it('selects only power-compatible Legendary bases for every live source family', () => {
    const sources = [
      {
        source: 'world' as const,
        basePoolId: 'initial_world',
        rarityTableId: 'initial_world',
        sourceTemplateId: 'unmapped_world_source',
      },
      {
        source: 'rare' as const,
        basePoolId: 'initial_rare',
        rarityTableId: 'initial_rare',
        sourceTemplateId: 'unmapped_rare_source',
      },
      {
        source: 'dungeon' as const,
        basePoolId: 'initial_dungeon_boss',
        rarityTableId: 'initial_dungeon_boss',
        sourceTemplateId: 'korzul_the_gravewyrm',
      },
    ] as const;
    let scenarios = 0;
    for (const source of sources) {
      for (let seed = 1; seed <= 2_000; seed++) {
        const dropContext: ItemDropContext = {
          source: source.source,
          sourceEntityId: 8_000 + seed,
          sourceSpawnSequence: seed,
          lootSlotIndex: seed % 8,
          sourceTemplateId: source.sourceTemplateId,
          sourceTags: ['test', source.source],
        };
        const item = generateProceduralItem({
          seed: deriveProceduralItemSeed(seed, dropContext),
          uid: formatProceduralItemUid(`legendary_${source.source}`, seed),
          context: dropContext,
          basePoolId: source.basePoolId,
          rarityTableId: source.rarityTableId,
          sourceItemLevel: 20,
          forcedRarity: 'legendary',
        }).instance.procedural;
        const base = PROCEDURAL_ITEM_BASES[item.baseId];
        const power = proceduralLegendaryPower(item.legendaryPowerId ?? '');
        expect(power, `${source.source}:${seed}:power`).toBeDefined();
        expect(
          power && proceduralLegendaryPowerCompatibleWithBase(power, base),
          `${source.source}:${seed}:${item.baseId}:${power?.id}`,
        ).toBe(true);
        scenarios++;
      }
    }
    expect(scenarios).toBe(6_000);
  });

  it('rejects a forced Legendary base that cannot carry any authored power', () => {
    const dropContext = context(7_701);
    expect(() =>
      generateProceduralItem({
        seed: deriveProceduralItemSeed(7_701, dropContext),
        uid: 'pi1:unsupported_legendary:1',
        context: dropContext,
        basePoolId: 'initial_all',
        rarityTableId: 'initial_dungeon_boss',
        sourceItemLevel: 20,
        forcedBaseId: 'gravecaller_cloth_handwraps',
        forcedRarity: 'legendary',
      }),
    ).toThrow('forced base gravecaller_cloth_handwraps has no compatible legendary power');
  });

  it('consumes canonical budget across every v0.30-reachable non-common item matrix', () => {
    const rarityBonus = { magic: 0, rare: 0, epic: 1, legendary: 2 } as const;
    let serial = 1;
    let scenarios = 0;
    for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
      for (const rarity of Object.keys(rarityBonus) as (keyof typeof rarityBonus)[]) {
        if (
          rarity === 'legendary' &&
          !Object.values(PROCEDURAL_LEGENDARY_POWERS).some((power) =>
            proceduralLegendaryPowerCompatibleWithBase(power, base),
          )
        )
          continue;
        const minItemLevel = Math.max(1, base.sourceLevel - 1 + rarityBonus[rarity]);
        const maxItemLevel = 21 + rarityBonus[rarity];
        for (let itemLevel = minItemLevel; itemLevel <= maxItemLevel; itemLevel++) {
          for (let sample = 1; sample <= 4; sample++) {
            const item = generateProceduralItem({
              seed: (itemLevel * 100_003 + sample * 997 + serial) >>> 0 || 1,
              uid: formatProceduralItemUid('budget_matrix', serial++),
              context: context(sample + itemLevel * 32),
              basePoolId: 'initial_all',
              rarityTableId: 'initial_dungeon_boss',
              sourceItemLevel: Math.max(base.sourceLevel, itemLevel - rarityBonus[rarity]),
              forcedBaseId: base.id,
              forcedRarity: rarity,
              forcedItemLevel: itemLevel,
            }).instance.procedural;
            const canonical = calculateProceduralBudget(base, item.itemLevel, rarity);
            const realized = item.affixes.reduce((sum, affix) => sum + affix.budget, 0);
            const tolerance = Math.max(1, canonical * 0.15);
            expect(
              Math.abs(realized - canonical),
              `${base.id}:${rarity}:${itemLevel}:${sample}`,
            ).toBeLessThanOrEqual(tolerance + 1e-8);
            for (const affix of item.affixes) {
              for (const [stat, value] of Object.entries(affix.values)) {
                const range = affix.ranges[stat];
                const floor =
                  range.min + (range.max - range.min) * PROCEDURAL_RARITIES[rarity].rollFloor;
                expect(
                  value + 1e-8,
                  `${base.id}:${rarity}:${affix.affixId}:${stat}`,
                ).toBeGreaterThanOrEqual(floor);
              }
            }
            scenarios++;
          }
        }
      }
    }
    expect(scenarios).toBeGreaterThan(5_000);
  }, 60_000);

  it('keeps the fixed generator draw categories at eight plus three per affix', () => {
    const original = Rng.prototype.next;
    let draws = 0;
    Rng.prototype.next = function nextWithCount(this: Rng): number {
      draws++;
      return original.call(this);
    };
    try {
      const item = generateProceduralItem({
        seed: 91_771,
        uid: 'pi1:draw_count:1',
        context: context(91_771),
        basePoolId: 'initial_all',
        rarityTableId: 'initial_dungeon_boss',
        sourceItemLevel: 20,
        forcedBaseId: 'gravecaller_ring',
        forcedRarity: 'legendary',
        forcedItemLevel: 20,
      }).instance.procedural;
      expect(draws).toBe(8 + item.affixes.length * 3);
    } finally {
      Rng.prototype.next = original;
    }
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

  it('rejects invalid seeds and persists both positive uint32 boundaries', () => {
    const input = {
      uid: 'pi1:seed-contract:1',
      context: context(1),
      basePoolId: 'initial_all',
      rarityTableId: 'initial_world',
      sourceItemLevel: 20,
      forcedBaseId: 'gravecaller_ring',
      forcedRarity: 'rare' as const,
    };

    for (const seed of [0, -1, 1.5, 0x1_0000_0000]) {
      expect(() => generateProceduralItem({ ...input, seed }), String(seed)).toThrow(
        'procedural item seed must be an integer from 1 to 4294967295',
      );
    }

    for (const seed of [1, 0xffffffff]) {
      const drop = generateProceduralItem({
        ...input,
        seed,
        uid: `pi1:seed-contract:${seed}`,
        context: context(seed),
      });
      expect(drop.instance.procedural.seed).toBe(seed);
      expect(sanitizeItemInstancePayload(drop.instance, 'gravecaller_ring'), String(seed)).toEqual({
        ok: true,
        value: drop.instance,
      });
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
