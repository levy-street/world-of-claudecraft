import { describe, expect, it } from 'vitest';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { CAMPS, GATHER_NODES, MOBS } from '../src/sim/data';
import { FISHING_CATCH_BAND_THRESHOLDS } from '../src/sim/professions/fishing_bands';
import {
  FISHING_ZONE_ROD_TIERS,
  rodTierRequiredForZone,
} from '../src/sim/professions/fishing_zones';
import { nodeMaterialFor } from '../src/sim/professions/gathering_materials';
import {
  type CorpseMaterialSource,
  type FarmMaterialSource,
  type FishingMaterialSource,
  fishingLocationProvenZoneIds,
  materialSourceInfo,
  type NodeMaterialSource,
} from '../src/sim/professions/gathering_source_locations';
import { corpseSupply } from '../src/sim/professions/gathering_supply';
import { fineGradeReachable, fineMaterialFor } from '../src/sim/professions/material_grades';

describe('gathering source locations: corpse-harvest materials', () => {
  it('reports real creature+zone examples for rough_hide, ranked common before rare', () => {
    const info = materialSourceInfo('rough_hide') as CorpseMaterialSource;
    expect(info.kind).toBe('corpse');
    const wolf = info.examples.find((e) => e.mobId === 'forest_wolf');
    expect(wolf).toBeDefined();
    expect(wolf?.zoneId).toBe('eastbrook_vale');
    expect(wolf?.rare).toBe(false);
    expect(wolf?.elite).toBe(false);
    expect(wolf?.questGated).toBe(false);
    // Two eastbrook_vale forest_wolf camps, counts 6 and 5, folded into one example.
    expect(wolf?.spawnCount).toBe(11);

    const rare = info.examples.find((e) => e.mobId === 'old_greyjaw');
    expect(rare).toBeDefined();
    expect(rare?.rare).toBe(true);
    expect(rare?.zoneId).toBe('eastbrook_vale');

    // Ordinary carriers are listed before the rare one.
    expect(info.examples.indexOf(wolf!)).toBeLessThan(info.examples.indexOf(rare!));
    expect(info.totalCarriers).toBeGreaterThanOrEqual(2);
    // hide maps to the pristine_hide specimen (same tag), named by real item
    // id so the UI can resolve its display name, never a boolean.
    expect(info.premiumSpecimenItemIds).toEqual(['pristine_hide']);
  });

  it('never lists a campless carrier as a source', () => {
    const gameMeat = materialSourceInfo(HARVEST_COMPONENT_ITEMS.meat) as CorpseMaterialSource;
    expect(gameMeat.kind).toBe('corpse');
    // mister_crabs carries 'meat' but has no CAMPS row (summon-only miniboss).
    expect(MOBS.mister_crabs.componentTags).toContain('meat');
    expect(CAMPS.some((camp) => camp.mobId === 'mister_crabs')).toBe(false);
    expect(gameMeat.examples.some((e) => e.mobId === 'mister_crabs')).toBe(false);
  });

  it('deduplicates horn and tusk onto the one curved_tusk material, with no specimen', () => {
    expect(HARVEST_COMPONENT_ITEMS.horn).toBe('curved_tusk');
    expect(HARVEST_COMPONENT_ITEMS.tusk).toBe('curved_tusk');
    const info = materialSourceInfo('curved_tusk') as CorpseMaterialSource;
    expect(info.kind).toBe('corpse');
    // Every mob id appears at most once per zone, whether it carries horn,
    // tusk, or (hypothetically) both.
    const seen = new Set<string>();
    for (const example of info.examples) {
      const key = `${example.mobId} ${example.zoneId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(info.examples.length).toBeGreaterThan(0);
    // Neither horn nor tusk maps to a HARVEST_COMPONENT_SPECIMENS row.
    expect(info.premiumSpecimenItemIds).toEqual([]);
  });

  it('admits a quest-gated camp but labels it, never as an ordinary repeatable source', () => {
    expect(MOBS.spider_egg.requiresQuestId).toBe('q_broodmother');
    expect(MOBS.spider_egg.componentTags).toContain('silk');
    const info = materialSourceInfo(HARVEST_COMPONENT_ITEMS.silk) as CorpseMaterialSource;
    const gated = info.examples.find((e) => e.mobId === 'spider_egg');
    expect(gated).toBeDefined();
    expect(gated?.questGated).toBe(true);
    // The gated example is ranked after every ordinary (ungated) carrier.
    const ordinaryIndexes = info.examples
      .filter((e) => !e.questGated)
      .map((e) => info.examples.indexOf(e));
    const gatedIndex = info.examples.indexOf(gated!);
    for (const idx of ordinaryIndexes) expect(idx).toBeLessThan(gatedIndex);
  });

  it('marks a rare carrier as rare rather than implying common density', () => {
    const info = materialSourceInfo('rough_hide') as CorpseMaterialSource;
    const rare = info.examples.find((e) => e.mobId === 'old_greyjaw');
    expect(rare?.rare).toBe(true);
    expect(rare?.spawnCount).toBe(1);
  });

  it('answers unknown for an id no shipped family produces', () => {
    expect(materialSourceInfo('not_a_real_item_id')).toEqual({
      kind: 'unknown',
      itemId: 'not_a_real_item_id',
    });
  });

  it('the cached result is frozen and stable across repeated calls', () => {
    const first = materialSourceInfo('rough_hide') as CorpseMaterialSource;
    const second = materialSourceInfo('rough_hide') as CorpseMaterialSource;
    expect(first).toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.examples)).toBe(true);
    expect(() => {
      (first as { itemId: string }).itemId = 'tampered';
    }).toThrow();
  });
});

describe('gathering source locations: perfect specimens', () => {
  it('indexes every specimen by its own component tag rather than falling through to unknown', () => {
    for (const [tag, specimenId] of Object.entries(HARVEST_COMPONENT_SPECIMENS)) {
      const baseItemId = HARVEST_COMPONENT_ITEMS[tag];
      const info = materialSourceInfo(specimenId) as CorpseMaterialSource;
      expect(info.kind, specimenId).toBe('corpse');
      expect(info.conditionalOnBaseItemId, specimenId).toBe(baseItemId);
      // A specimen never lists itself (or anything else) as its own further
      // premium jackpot.
      expect(info.premiumSpecimenItemIds, specimenId).toEqual([]);
    }
  });

  it('reuses the SAME real carriers as the base material, for pristine_hide/rough_hide', () => {
    const base = materialSourceInfo('rough_hide') as CorpseMaterialSource;
    const specimen = materialSourceInfo('pristine_hide') as CorpseMaterialSource;
    expect(specimen.kind).toBe('corpse');
    expect(specimen.conditionalOnBaseItemId).toBe('rough_hide');
    const baseKeys = new Set(base.examples.map((e) => `${e.mobId} ${e.zoneId}`));
    const specimenKeys = new Set(specimen.examples.map((e) => `${e.mobId} ${e.zoneId}`));
    expect(specimenKeys).toEqual(baseKeys);
    expect(specimen.totalCarriers).toBe(base.totalCarriers);
  });

  it('never merges another tag sharing the base item onto a specimen scan (claw stays claw, not curved_tusk)', () => {
    // sharp_claw has no sibling tag; pristine_claw's carriers must equal
    // exactly the mobs tagged 'claw', not a union pulled in from another
    // family that happens to share a base item elsewhere.
    const claw = materialSourceInfo('pristine_claw') as CorpseMaterialSource;
    expect(claw.kind).toBe('corpse');
    expect(claw.conditionalOnBaseItemId).toBe('sharp_claw');
    for (const example of claw.examples) {
      expect(MOBS[example.mobId].componentTags).toContain('claw');
    }
  });

  it('resolves every id corpseSupply() reports as non-unknown', () => {
    for (const itemId of corpseSupply()) {
      expect(materialSourceInfo(itemId).kind, itemId).not.toBe('unknown');
    }
  });
});

describe('gathering source locations: node materials (mining/logging/herbalism)', () => {
  it('derives copper_ore zones and PER-ZONE minimum node tier from real placements', () => {
    const info = materialSourceInfo('copper_ore') as NodeMaterialSource;
    expect(info.kind).toBe('node');
    expect(info.nodeType).toBe('ore');
    expect(info.isFineGrade).toBe(false);
    expect(info.zones.length).toBeGreaterThan(0);
    for (const zone of info.zones) {
      const nodesHere = GATHER_NODES.filter(
        (node) =>
          node.type === 'ore' &&
          node.zoneId === zone.zoneId &&
          nodeMaterialFor('ore', node.zoneId).itemId === 'copper_ore',
      );
      expect(nodesHere.length).toBeGreaterThan(0);
      const trueMin = Math.min(...nodesHere.map((n) => n.tier));
      expect(zone.minimumNodeTier, zone.zoneId).toBe(trueMin);
      expect(zone.zoneId).toBe('eastbrook_vale');
    }
  });

  it('gates the fine grade behind a strictly-above tool tier, over reachable nodes only', () => {
    const fineId = fineMaterialFor('copper_ore')!;
    const info = materialSourceInfo(fineId) as NodeMaterialSource;
    expect(info.kind).toBe('node');
    expect(info.isFineGrade).toBe(true);
    // fineGatherTier is the material's OWN gatherTier (1); the tool must sit
    // STRICTLY above it, so the minimum satisfying tool tier is 2, computed
    // at the view layer, never stored here as if it were the gatherTier.
    expect(info.fineGatherTier).toBe(1);
    for (const zone of info.zones) {
      const reachable = GATHER_NODES.some(
        (node) =>
          node.type === 'ore' &&
          node.zoneId === zone.zoneId &&
          node.tier === zone.minimumNodeTier &&
          nodeMaterialFor('ore', node.zoneId).itemId === 'copper_ore' &&
          fineGradeReachable('copper_ore', node.tier),
      );
      expect(reachable, zone.zoneId).toBe(true);
    }
  });

  it('reports a per-zone minimum tier that reflects an actual tier-2/3 placement, never a blanket tier-1 claim', () => {
    // thorium_ore is thornpeak_heights' ore yield; the zone carries BOTH
    // tier-1 (ore_thornpeak_1/2) and tier-3 (ore_thornpeak_t3/t3b) ore veins.
    // The reported minimum must be the cheapest real vein (1), derived, never
    // hand-asserted as if every placement in the zone were that tier.
    const info = materialSourceInfo('thorium_ore') as NodeMaterialSource;
    const thornpeak = info.zones.find((z) => z.zoneId === 'thornpeak_heights');
    expect(thornpeak).toBeDefined();
    const tiersInZone = new Set(
      GATHER_NODES.filter((n) => n.type === 'ore' && n.zoneId === 'thornpeak_heights').map(
        (n) => n.tier,
      ),
    );
    expect(tiersInZone.has(1)).toBe(true);
    expect(tiersInZone.has(3)).toBe(true);
    expect(thornpeak?.minimumNodeTier).toBe(1);
  });

  it('answers unknown for a material no real node resolves to', () => {
    expect(materialSourceInfo('not_a_gathered_material')).toEqual({
      kind: 'unknown',
      itemId: 'not_a_gathered_material',
    });
  });
});

describe('gathering source locations: farming materials', () => {
  it('reaches every real patch zone regardless of crop tier: plantCrop compares no patch tier', () => {
    // vale_wheat is tier 1; the Evergarden patch is tier 4. plantCrop's gates
    // are the crop's OWN farming-skill threshold and hoe tier, never the
    // patch's tier, so the tier-1 crop is reachable at the tier-4 patch too.
    const wheat = FARM_CROPS.vale_wheat;
    const info = materialSourceInfo(wheat.produceItemId) as FarmMaterialSource;
    expect(info.kind).toBe('farm');
    expect(info.cropId).toBe('vale_wheat');
    expect(info.isFineGrade).toBe(false);
    expect(info.growDurationMs).toBe(wheat.durationMs);
    const allPatchZones = [...new Set(FARM_PATCHES.map((p) => p.zoneId))].sort();
    expect(info.zoneIds).toEqual(allPatchZones);
    expect(info.zoneIds).toContain('evergarden');
    expect(info.minimumFarmingSkill).toBe(0);
    expect(info.requiredHoeTier).toBe(1);
  });

  it('reaches the tier-1 patch with a tier-4 crop the same way, the inverse admission case', () => {
    const pumpkin = FARM_CROPS.evergarden_pumpkin;
    expect(pumpkin.tier).toBe(4);
    const info = materialSourceInfo(pumpkin.produceItemId) as FarmMaterialSource;
    expect(info.kind).toBe('farm');
    const allPatchZones = [...new Set(FARM_PATCHES.map((p) => p.zoneId))].sort();
    expect(info.zoneIds).toEqual(allPatchZones);
    expect(info.zoneIds).toContain('eastbrook_vale');
    expect(info.minimumFarmingSkill).toBe(75);
    expect(info.requiredHoeTier).toBe(4);
  });

  it('mirrors the same patch zones for the fine twin, grown from seed not instant', () => {
    const wheat = FARM_CROPS.vale_wheat;
    const base = materialSourceInfo(wheat.produceItemId) as FarmMaterialSource;
    const fine = materialSourceInfo(wheat.fineProduceItemId) as FarmMaterialSource;
    expect(fine.kind).toBe('farm');
    expect(fine.isFineGrade).toBe(true);
    expect(fine.zoneIds).toEqual(base.zoneIds);
    expect(fine.growDurationMs).toBeGreaterThan(0);
  });
});

describe('gathering source locations: fishing materials', () => {
  it('resolves the SAME eastbrook_vale fallback table for a zone with no table of its own, matching completeFishing', () => {
    const info = materialSourceInfo('raw_mirror_trout') as FishingMaterialSource;
    expect(info.kind).toBe('fishing');
    // eastbrook_vale carries its own table; mirefen_marsh/thornpeak_heights
    // carry their OWN distinct tables (no raw_mirror_trout row), so only the
    // fallback zones plus eastbrook_vale itself should list it: 1 + 11.
    const zoneIds = info.zones.map((z) => z.zoneId).sort();
    expect(zoneIds).toContain('eastbrook_vale');
    expect(zoneIds).not.toContain('mirefen_marsh');
    expect(zoneIds).not.toContain('thornpeak_heights');
    expect(zoneIds.length).toBe(12);
    const eastbrook = info.zones.find((z) => z.zoneId === 'eastbrook_vale')!;
    expect(eastbrook.band).toBe(0);
    expect(eastbrook.minimumProficiency).toBe(FISHING_CATCH_BAND_THRESHOLDS[0]);
    expect(eastbrook.minimumRodTier).toBe(1);
    // A fallback zone reads the SAME band and facts as eastbrook_vale.
    const veiledHollow = info.zones.find((z) => z.zoneId === 'veiled_hollow')!;
    expect(veiledHollow.band).toBe(0);
    expect(veiledHollow.minimumProficiency).toBe(FISHING_CATCH_BAND_THRESHOLDS[0]);
  });

  it('pins the exact skill and rod facts for the three high-band catches', () => {
    // The reviewer's flagged fact: Stillmere Salmon is NOT "rod tier 1+ at
    // Eastbrook". It is band 5, which needs proficiency 200 and rod tier 6
    // (band + 1), the stricter of that and any zone's own access tier.
    const stillmere = materialSourceInfo('raw_stillmere_salmon') as FishingMaterialSource;
    expect(stillmere.kind).toBe('fishing');
    expect(stillmere.zones.length).toBe(14);
    for (const zone of stillmere.zones) {
      expect(zone.band, zone.zoneId).toBe(5);
      expect(zone.minimumProficiency, zone.zoneId).toBe(200);
      expect(zone.minimumProficiency, zone.zoneId).toBe(FISHING_CATCH_BAND_THRESHOLDS[5]);
      expect(zone.minimumRodTier, zone.zoneId).toBe(6);
    }

    const deepbarb = materialSourceInfo('raw_deepbarb_catfish') as FishingMaterialSource;
    expect(deepbarb.zones.length).toBe(14);
    for (const zone of deepbarb.zones) {
      expect(zone.band, zone.zoneId).toBe(3);
      expect(zone.minimumProficiency, zone.zoneId).toBe(200);
      expect(zone.minimumRodTier, zone.zoneId).toBe(4);
    }

    const hollowgill = materialSourceInfo('raw_hollowgill_sturgeon') as FishingMaterialSource;
    expect(hollowgill.zones.length).toBe(14);
    for (const zone of hollowgill.zones) {
      expect(zone.band, zone.zoneId).toBe(4);
      expect(zone.minimumProficiency, zone.zoneId).toBe(200);
      expect(zone.minimumRodTier, zone.zoneId).toBe(5);
    }
  });

  it('the minimum rod tier is the STRICTER of the zone access gate and the band requirement', () => {
    // thornpeak_heights asks rod tier 3 to cast at all; band 0 there would
    // only need tier 1 by the band formula alone, so the zone's own gate
    // must win for any item appearing at band 0 in thornpeak's own table.
    expect(rodTierRequiredForZone('thornpeak_heights')).toBe(3);
    const info = materialSourceInfo('raw_frostgill_trout') as FishingMaterialSource;
    const thornpeak = info.zones.find((z) => z.zoneId === 'thornpeak_heights')!;
    expect(thornpeak.band).toBe(0);
    expect(thornpeak.minimumRodTier).toBe(3);
  });

  it('every fishing-eligible zone has a real, cast-accepting declared location', () => {
    // Mirrors the live-cast proof in tests/fishing_zones.test.ts without a
    // hand-authored per-item registry: computed once via a cheap geometry
    // probe over declared lakes, never a Sim.
    const proven = fishingLocationProvenZoneIds();
    expect(proven.size).toBe(14);
    expect([...proven].sort()).toEqual(Object.keys(FISHING_ZONE_ROD_TIERS).sort());
  });

  it('reflects provenLocation from the real probe, not a bare lake count', () => {
    const info = materialSourceInfo('raw_mirror_trout') as FishingMaterialSource;
    const proven = fishingLocationProvenZoneIds();
    for (const zone of info.zones) {
      expect(zone.provenLocation, zone.zoneId).toBe(proven.has(zone.zoneId));
    }
    expect(info.zones.every((z) => z.provenLocation)).toBe(true);
  });

  it('excludes poor-quality junk catches from being reported as a material source', () => {
    // tangled_weed is the shipped junk row in the eastbrook band-0 table.
    expect(materialSourceInfo('tangled_weed')).toEqual({ kind: 'unknown', itemId: 'tangled_weed' });
  });
});
