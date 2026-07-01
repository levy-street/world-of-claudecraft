import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import type { MobComponentType, MobFamily } from '../src/sim/types';

const HARVESTABLE_FAMILIES = new Set<MobFamily>([
  'beast',
  'spider',
  'murloc',
  'kobold',
  'undead',
  'troll',
  'ogre',
  'elemental',
  'dragonkin',
]);

const EXPECTED_COMPONENTS_BY_FAMILY: Record<MobFamily, readonly MobComponentType[] | null> = {
  beast: ['hide', 'fang', 'meat'],
  spider: ['venom_sac', 'silk', 'chitin'],
  murloc: ['gills', 'scale', 'fin'],
  kobold: ['hide', 'claw', 'candlewax'],
  undead: ['bone', 'ectoplasm'],
  troll: ['tusk', 'hide'],
  ogre: ['tusk', 'hide', 'bone'],
  elemental: ['elemental_core', 'crystal'],
  dragonkin: ['scale', 'fang', 'claw'],
  humanoid: null,
  demon: null,
};

describe('mob component type tags', () => {
  it('tags every harvestable mob family with at least one component type', () => {
    const missing = Object.values(MOBS)
      .filter((mob) => HARVESTABLE_FAMILIES.has(mob.family))
      .filter((mob) => !mob.componentTypes?.length)
      .map((mob) => `${mob.id}:${mob.family}`);

    expect(missing).toEqual([]);
  });

  it('keeps non-harvestable humanoids and demon pets untagged for this content slice', () => {
    const unexpected = Object.values(MOBS)
      .filter((mob) => !HARVESTABLE_FAMILIES.has(mob.family))
      .filter((mob) => mob.componentTypes?.length)
      .map((mob) => `${mob.id}:${mob.family}`);

    expect(unexpected).toEqual([]);
  });

  it('uses the expected family component bundles for representative mobs across zones', () => {
    expect(MOBS.forest_wolf.componentTypes).toEqual(EXPECTED_COMPONENTS_BY_FAMILY.beast);
    expect(MOBS.webwood_spider.componentTypes).toEqual(EXPECTED_COMPONENTS_BY_FAMILY.spider);
    expect(MOBS.deepfen_murloc.componentTypes).toEqual(EXPECTED_COMPONENTS_BY_FAMILY.murloc);
    expect(MOBS.fen_troll.componentTypes).toEqual(EXPECTED_COMPONENTS_BY_FAMILY.troll);
    expect(MOBS.stormcrag_elemental.componentTypes).toEqual(
      EXPECTED_COMPONENTS_BY_FAMILY.elemental,
    );
    expect(MOBS.korzul_the_gravewyrm.componentTypes).toEqual(
      EXPECTED_COMPONENTS_BY_FAMILY.dragonkin,
    );
  });
});
