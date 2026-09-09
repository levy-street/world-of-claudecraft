import { describe, expect, it } from 'vitest';
import type {
  CorpseMaterialSource,
  CorpseSourceExample,
  FarmMaterialSource,
  FishingMaterialSource,
  NodeMaterialSource,
} from '../src/sim/professions/gathering_source_locations';
import { buildGatheringSourceView } from '../src/ui/hud/professions/gathering_source_view';

function corpseExample(overrides: Partial<CorpseSourceExample> = {}): CorpseSourceExample {
  return {
    mobId: 'x',
    zoneId: 'eastbrook_vale',
    rare: false,
    elite: false,
    questGated: false,
    spawnCount: 1,
    ...overrides,
  };
}

describe('gathering source view: corpse materials', () => {
  it('passes every example through unchanged when under the cap', () => {
    const info: CorpseMaterialSource = {
      kind: 'corpse',
      itemId: 'rough_hide',
      examples: [
        corpseExample({ mobId: 'forest_wolf' }),
        corpseExample({ mobId: 'old_greyjaw', rare: true }),
      ],
      totalCarriers: 2,
      premiumSpecimenItemIds: ['pristine_hide'],
    };
    const view = buildGatheringSourceView(info);
    expect(view.kind).toBe('corpse');
    if (view.kind !== 'corpse') throw new Error('unreachable');
    expect(view.examples).toHaveLength(2);
    expect(view.remainingCount).toBe(0);
    expect(view.premiumSpecimenItemIds).toEqual(['pristine_hide']);
  });

  it('caps the visible example list and reports an honest remaining count', () => {
    const examples = Array.from({ length: 7 }, (_, i) => corpseExample({ mobId: `mob_${i}` }));
    const info: CorpseMaterialSource = {
      kind: 'corpse',
      itemId: 'rough_hide',
      examples,
      totalCarriers: 7,
      premiumSpecimenItemIds: [],
    };
    const view = buildGatheringSourceView(info);
    if (view.kind !== 'corpse') throw new Error('unreachable');
    expect(view.examples).toHaveLength(3);
    expect(view.remainingCount).toBe(4);
    // The cap never reorders: the first three of the sim's own ranked list.
    expect(view.examples.map((e) => e.mobId)).toEqual(['mob_0', 'mob_1', 'mob_2']);
  });

  it('carries rare/elite/questGated flags and specimen ids through untouched', () => {
    const info: CorpseMaterialSource = {
      kind: 'corpse',
      itemId: 'spider_silk',
      examples: [corpseExample({ mobId: 'spider_egg', questGated: true })],
      totalCarriers: 1,
      premiumSpecimenItemIds: ['pristine_silk'],
    };
    const view = buildGatheringSourceView(info);
    if (view.kind !== 'corpse') throw new Error('unreachable');
    expect(view.examples[0].questGated).toBe(true);
    expect(view.premiumSpecimenItemIds).toEqual(['pristine_silk']);
    expect(view.conditionalOnBaseItemId).toBeNull();
  });

  it('reports the base material a specimen entry conditions on, with no self-referencing premium list', () => {
    const info: CorpseMaterialSource = {
      kind: 'corpse',
      itemId: 'pristine_silk',
      examples: [corpseExample({ mobId: 'spider_egg', questGated: true })],
      totalCarriers: 1,
      premiumSpecimenItemIds: [],
      conditionalOnBaseItemId: 'spider_silk',
    };
    const view = buildGatheringSourceView(info);
    if (view.kind !== 'corpse') throw new Error('unreachable');
    expect(view.conditionalOnBaseItemId).toBe('spider_silk');
    expect(view.premiumSpecimenItemIds).toEqual([]);
  });
});

describe('gathering source view: node materials', () => {
  it("caps zones (preserving each zone's own minimum tier) and derives the fine-grade tool tier", () => {
    const info: NodeMaterialSource = {
      kind: 'node',
      itemId: 'fine_copper_ore',
      nodeType: 'ore',
      zones: [
        { zoneId: 'a', minimumNodeTier: 2 },
        { zoneId: 'b', minimumNodeTier: 3 },
        { zoneId: 'c', minimumNodeTier: 2 },
        { zoneId: 'd', minimumNodeTier: 4 },
      ],
      isFineGrade: true,
      fineGatherTier: 1,
    };
    const view = buildGatheringSourceView(info);
    expect(view.kind).toBe('node');
    if (view.kind !== 'node') throw new Error('unreachable');
    expect(view.zones).toEqual([
      { zoneId: 'a', minimumNodeTier: 2 },
      { zoneId: 'b', minimumNodeTier: 3 },
      { zoneId: 'c', minimumNodeTier: 2 },
    ]);
    expect(view.remainingZoneCount).toBe(1);
    expect(view.isFineGrade).toBe(true);
    // The tool must sit STRICTLY above fineGatherTier (1), so the minimum
    // satisfying tool tier is 2, never the raw gatherTier itself.
    expect(view.minimumFineToolTier).toBe(2);
  });

  it("reports a null fine tool tier for the plain grade, and each zone's own minimum tier", () => {
    const info: NodeMaterialSource = {
      kind: 'node',
      itemId: 'thorium_ore',
      nodeType: 'ore',
      zones: [{ zoneId: 'thornpeak_heights', minimumNodeTier: 1 }],
      isFineGrade: false,
    };
    const view = buildGatheringSourceView(info);
    if (view.kind !== 'node') throw new Error('unreachable');
    expect(view.minimumFineToolTier).toBeNull();
    expect(view.remainingZoneCount).toBe(0);
    expect(view.zones).toEqual([{ zoneId: 'thornpeak_heights', minimumNodeTier: 1 }]);
  });
});

describe('gathering source view: farm materials', () => {
  it('carries the grow duration, skill and hoe requirements, and caps zones the same way', () => {
    const info: FarmMaterialSource = {
      kind: 'farm',
      itemId: 'evergarden_pumpkin',
      cropId: 'evergarden_pumpkin',
      zoneIds: ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights', 'evergarden'],
      isFineGrade: false,
      growDurationMs: 38_700_000,
      minimumFarmingSkill: 75,
      requiredHoeTier: 4,
    };
    const view = buildGatheringSourceView(info);
    expect(view.kind).toBe('farm');
    if (view.kind !== 'farm') throw new Error('unreachable');
    expect(view.growDurationMs).toBe(38_700_000);
    expect(view.zoneIds).toEqual(['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights']);
    expect(view.remainingZoneCount).toBe(1);
    expect(view.minimumFarmingSkill).toBe(75);
    expect(view.requiredHoeTier).toBe(4);
  });
});

describe('gathering source view: fishing materials', () => {
  it('caps zones and preserves the skill/rod/proven facts per zone', () => {
    const info: FishingMaterialSource = {
      kind: 'fishing',
      itemId: 'raw_stillmere_salmon',
      zones: [
        {
          zoneId: 'eastbrook_vale',
          band: 5,
          minimumProficiency: 200,
          minimumRodTier: 6,
          provenLocation: true,
        },
        {
          zoneId: 'mirefen_marsh',
          band: 5,
          minimumProficiency: 200,
          minimumRodTier: 6,
          provenLocation: false,
        },
        {
          zoneId: 'thornpeak_heights',
          band: 5,
          minimumProficiency: 200,
          minimumRodTier: 6,
          provenLocation: true,
        },
        {
          zoneId: 'veiled_hollow',
          band: 5,
          minimumProficiency: 200,
          minimumRodTier: 6,
          provenLocation: false,
        },
      ],
    };
    const view = buildGatheringSourceView(info);
    expect(view.kind).toBe('fishing');
    if (view.kind !== 'fishing') throw new Error('unreachable');
    expect(view.zones).toHaveLength(3);
    expect(view.remainingZoneCount).toBe(1);
    expect(view.zones[0]).toEqual({
      zoneId: 'eastbrook_vale',
      minimumProficiency: 200,
      minimumRodTier: 6,
      provenLocation: true,
    });
    expect(view.zones[1].provenLocation).toBe(false);
  });
});

describe('gathering source view: unknown materials', () => {
  it('never invents a source for an id no family produces', () => {
    const view = buildGatheringSourceView({ kind: 'unknown', itemId: 'nonsense' });
    expect(view).toEqual({ kind: 'unknown' });
  });
});
