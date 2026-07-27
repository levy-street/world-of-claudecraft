import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import {
  generateLiveProceduralDrop,
  proceduralDropChanceRoll,
  proceduralDropProfile,
} from '../src/sim/loot/procedural/live_drop';

function input(
  mobId: keyof typeof MOBS,
  sourceFacts = { inDungeon: false, inDelve: false },
  sequence = 0,
) {
  const template = MOBS[mobId];
  return {
    worldSeed: 20_061,
    sourceEntityId: 812,
    sourceSpawnSequence: sequence,
    lootSlotIndex: 0,
    sourceItemLevel: template.maxLevel,
    sourceTemplate: template,
    sourceFacts,
    uid: `pi1:test_live:${sequence + 1}`,
    personalLootClass: 'mage' as const,
  };
}

describe('live procedural drop policy', () => {
  it('gives normal world mobs a five percent equipment entry', () => {
    const profile = proceduralDropProfile(MOBS.forest_wolf, {
      inDungeon: false,
      inDelve: false,
    });
    expect(profile).toEqual({
      source: 'world',
      chance: 0.05,
      basePoolId: 'initial_world',
      rarityTableId: 'initial_world',
    });
  });

  it('guarantees a rare-spawn procedural entry', () => {
    const rare = Object.values(MOBS).find(
      (template) => template.maxLevel >= 5 && template.rare && !template.worldBoss,
    );
    if (!rare) throw new Error('expected a rare mob fixture');
    expect(proceduralDropProfile(rare, { inDungeon: false, inDelve: false })).toMatchObject({
      source: 'rare',
      chance: 1,
      basePoolId: 'initial_rare',
      rarityTableId: 'initial_rare',
    });
  });

  it('adds procedural loot to dungeon bosses but not dungeon trash', () => {
    const boss = Object.values(MOBS).find((template) => template.boss && !template.worldBoss);
    const trash = Object.values(MOBS).find((template) => template.elite && !template.boss);
    if (!boss || !trash) throw new Error('expected dungeon fixtures');
    expect(proceduralDropProfile(boss, { inDungeon: true, inDelve: false })).toMatchObject({
      source: 'dungeon',
      chance: 1,
    });
    expect(proceduralDropProfile(trash, { inDungeon: true, inDelve: false })).toBeNull();
  });

  it('guarantees delve bosses and gives delve elites a lower repeatable chance', () => {
    const boss = Object.values(MOBS).find((template) => template.boss && !template.worldBoss);
    const elite = Object.values(MOBS).find((template) => template.elite && !template.boss);
    if (!boss || !elite) throw new Error('expected delve fixtures');
    expect(proceduralDropProfile(boss, { inDungeon: false, inDelve: true })).toMatchObject({
      source: 'delve',
      chance: 1,
      rarityTableId: 'initial_dungeon_boss',
    });
    expect(proceduralDropProfile(elite, { inDungeon: false, inDelve: true })).toMatchObject({
      source: 'delve',
      chance: 0.2,
      rarityTableId: 'initial_rare',
    });
  });

  it('excludes world bosses and training dummies', () => {
    const worldBoss = Object.values(MOBS).find((template) => template.worldBoss);
    const dummy = Object.values(MOBS).find((template) => template.dummy);
    if (!worldBoss || !dummy) throw new Error('expected exclusion fixtures');
    expect(proceduralDropProfile(worldBoss, { inDungeon: false, inDelve: false })).toBeNull();
    expect(proceduralDropProfile(dummy, { inDungeon: false, inDelve: false })).toBeNull();
  });

  it('uses a deterministic child hash for the entry chance', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const roll = proceduralDropChanceRoll(seed);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThan(1);
      expect(proceduralDropChanceRoll(seed)).toBe(roll);
    }
  });

  it('does not allocate a UID when the deterministic chance misses', () => {
    const normal = Object.values(MOBS).find(
      (template) =>
        template.maxLevel >= 5 &&
        !template.elite &&
        !template.rare &&
        !template.boss &&
        !template.worldBoss &&
        !template.dummy,
    );
    if (!normal) throw new Error('expected level 5+ normal world fixture');
    let sequence = 0;
    while (
      generateLiveProceduralDrop({
        ...input('forest_wolf', undefined, sequence),
        sourceTemplate: normal,
        sourceItemLevel: normal.maxLevel,
      })
    )
      sequence++;
    let allocations = 0;
    const result = generateLiveProceduralDrop({
      ...input('forest_wolf', undefined, sequence),
      sourceTemplate: normal,
      sourceItemLevel: normal.maxLevel,
      uid: () => {
        allocations++;
        return 'pi1:test_live:lazy';
      },
    });
    expect(result).toBeNull();
    expect(allocations).toBe(0);
  });

  it('generates byte-identical stats for the same world source sequence', () => {
    const first = generateLiveProceduralDrop(input('forest_wolf', undefined, 90));
    const second = generateLiveProceduralDrop(input('forest_wolf', undefined, 90));
    expect(second).toEqual(first);
  });

  it('changes the item seed and rolled copy when a respawn sequence changes', () => {
    const rare = Object.values(MOBS).find(
      (template) => template.maxLevel >= 5 && template.rare && !template.worldBoss,
    );
    if (!rare) throw new Error('expected rare fixture');
    const firstInput = {
      ...input('forest_wolf', undefined, 10),
      sourceTemplate: rare,
      sourceItemLevel: rare.maxLevel,
      uid: 'pi1:test_live:101',
    };
    const secondInput = {
      ...firstInput,
      sourceSpawnSequence: 11,
      uid: 'pi1:test_live:102',
    };
    const first = generateLiveProceduralDrop(firstInput);
    const second = generateLiveProceduralDrop(secondInput);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first?.instance.procedural.seed).not.toBe(second?.instance.procedural.seed);
    expect(first?.instance.procedural).not.toEqual(second?.instance.procedural);
  });

  it('records source identity and smart-loot input without consuming a shared Rng', () => {
    const rare = Object.values(MOBS).find(
      (template) => template.maxLevel >= 5 && template.rare && !template.worldBoss,
    );
    if (!rare) throw new Error('expected rare fixture');
    const result = generateLiveProceduralDrop({
      ...input('forest_wolf', undefined, 12),
      sourceTemplate: rare,
      sourceItemLevel: rare.maxLevel,
      uid: 'pi1:test_live:103',
    });
    expect(result).not.toBeNull();
    expect(result?.instance.procedural.dropContext).toMatchObject({
      source: 'rare',
      sourceEntityId: 812,
      sourceSpawnSequence: 12,
      lootSlotIndex: 0,
      sourceTemplateId: rare.id,
    });
    expect(result?.instance.procedural.dropContext?.sourceTags).toContain(rare.family);
  });

  it('lands normal-world entry frequency near five percent over many deterministic sources', () => {
    const normal = Object.values(MOBS).find(
      (template) =>
        template.maxLevel >= 5 &&
        !template.elite &&
        !template.rare &&
        !template.boss &&
        !template.worldBoss &&
        !template.dummy,
    );
    if (!normal) throw new Error('expected level 5+ normal world fixture');
    let drops = 0;
    const count = 20_000;
    for (let sequence = 0; sequence < count; sequence++) {
      const candidate = {
        ...input('forest_wolf', undefined, sequence),
        sourceItemLevel: normal.maxLevel,
        sourceTemplate: normal,
      };
      if (generateLiveProceduralDrop(candidate)) drops++;
    }
    const rate = drops / count;
    expect(rate).toBeGreaterThan(0.043);
    expect(rate).toBeLessThan(0.057);
  });
});
