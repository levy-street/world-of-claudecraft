import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_LEGENDARY_POWER_IDS,
  PROCEDURAL_LEGENDARY_POWERS,
  proceduralLegendaryPowerCompatibleWithBase,
} from '../src/sim/content/procedural_legendary_powers';
import {
  PROCEDURAL_BOSS_LEGENDARY_SIGNATURES,
  PROCEDURAL_LEGENDARY_SIGNATURE_SHARE,
  proceduralBossLegendarySignatures,
} from '../src/sim/content/procedural_legendary_sources';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import { MOBS } from '../src/sim/data';
import { generateProceduralItem } from '../src/sim/loot/procedural/generate';
import type { ItemDropContext } from '../src/sim/procedural_item';

const EXPECTED_SIGNATURES = {
  deacon_varric: ['bell_of_the_ninth_peal'],
  morthen: ['greyjaws_edge'],
  vael_the_mistcaller: ['hushwood_longbow', 'boots_of_the_unbroken_road'],
  sister_nhalia_drowned_canticle: ['nightglass_fang', 'mantle_of_borrowed_time'],
  ysolei: ['ysoleis_vigil', 'stormwake_idol'],
  korzul_the_gravewyrm: ['crown_last_pyre', 'ashbinders_seal'],
  nythraxis_scourge_of_thornpeak: ['dawnward_signet', 'feral_moonclasp'],
} as const;

function context(sourceTemplateId: string, sequence: number): ItemDropContext {
  return {
    source:
      sourceTemplateId.includes('deacon') || sourceTemplateId.includes('sister')
        ? 'delve'
        : 'dungeon',
    sourceEntityId: 90_000 + sequence,
    sourceSpawnSequence: sequence,
    lootSlotIndex: 0,
    sourceTemplateId,
    sourceTags: ['boss'],
  };
}

describe('procedural boss legendary signatures', () => {
  it('pins the complete seven-boss target-farming map', () => {
    expect(PROCEDURAL_BOSS_LEGENDARY_SIGNATURES).toEqual(EXPECTED_SIGNATURES);
    expect(PROCEDURAL_LEGENDARY_SIGNATURE_SHARE).toBe(0.8);
  });

  it('maps every legendary power exactly once and only to a real repeatable boss', () => {
    const mapped = Object.values(PROCEDURAL_BOSS_LEGENDARY_SIGNATURES).flat();
    expect([...mapped].sort()).toEqual([...PROCEDURAL_LEGENDARY_POWER_IDS].sort());
    expect(new Set(mapped).size).toBe(mapped.length);

    for (const [bossId, powerIds] of Object.entries(PROCEDURAL_BOSS_LEGENDARY_SIGNATURES)) {
      const boss = MOBS[bossId];
      expect(boss, bossId).toBeDefined();
      expect(boss.boss, bossId).toBe(true);
      expect(boss.worldBoss, bossId).not.toBe(true);

      for (const powerId of powerIds) {
        const power = PROCEDURAL_LEGENDARY_POWERS[powerId];
        expect(power, `${bossId}:${powerId}`).toBeDefined();
        expect(
          Object.values(PROCEDURAL_ITEM_BASES).some(
            (base) =>
              base.sourceLevel <= boss.maxLevel &&
              proceduralLegendaryPowerCompatibleWithBase(power, base),
          ),
          `${bossId}:${powerId} must have a compatible base by level ${boss.maxLevel}`,
        ).toBe(true);
      }
    }
  });

  it('returns immutable signature IDs for known bosses and none for unknown sources', () => {
    expect(proceduralBossLegendarySignatures('morthen')).toEqual(['greyjaws_edge']);
    expect(proceduralBossLegendarySignatures('ordinary_wolf')).toEqual([]);
    expect(proceduralBossLegendarySignatures(undefined)).toEqual([]);
  });

  it.each(Object.entries(EXPECTED_SIGNATURES))(
    'makes $0 a strong but non-exclusive source for its signature powers',
    (bossId, signatureIds) => {
      const boss = MOBS[bossId];
      const signatureSet = new Set<string>(signatureIds);
      let signatureDrops = 0;
      const samples = 8_000;

      for (let sequence = 0; sequence < samples; sequence++) {
        const dropContext = context(bossId, sequence);
        const item = generateProceduralItem({
          seed: sequence + 1,
          uid: `pi1:signature:${bossId}:${sequence + 1}`,
          context: dropContext,
          basePoolId: 'initial_dungeon_boss',
          rarityTableId: 'initial_dungeon_boss',
          sourceItemLevel: boss.maxLevel,
          forcedRarity: 'legendary',
        }).instance.procedural;
        if (signatureSet.has(item.legendaryPowerId ?? '')) signatureDrops++;
      }

      const share = signatureDrops / samples;
      expect(share, bossId).toBeGreaterThanOrEqual(0.65);
      expect(share, bossId).toBeLessThan(0.98);
    },
    30_000,
  );

  it('leaves unknown source IDs on the original deterministic selection path', () => {
    const dropContext = context('generator_matrix_boss', 77);
    const input = {
      seed: 77,
      uid: 'pi1:signature:unknown:77',
      context: dropContext,
      basePoolId: 'initial_dungeon_boss',
      rarityTableId: 'initial_dungeon_boss',
      sourceItemLevel: 20,
      forcedRarity: 'legendary' as const,
    };
    expect(generateProceduralItem(input)).toEqual(generateProceduralItem(input));
    expect(proceduralBossLegendarySignatures(dropContext.sourceTemplateId)).toEqual([]);
  });
});
