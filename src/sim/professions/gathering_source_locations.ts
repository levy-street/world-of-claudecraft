// Intentional Gathering PR5: WHERE a material actually comes from, derived
// from the shipped content tables the way gathering_supply.ts derives WHICH
// family supplies it. No hand-authored material-to-place table: every fact
// below is read live off MOBS/CAMPS/ZONES/GATHER_NODES/FARM_PATCHES/
// FISHING_TABLES_BY_BAND, cached once per process in private module-level
// Maps (never a plain object, so an unknown id can never resolve through
// Object.prototype).
//
// Reachability mirrors the masterwrought R22 predicate in
// tests/harvest_geography.test.ts (isOverworldCamp): strict zoneContaining,
// never the clamping zoneAt, and the far-east instance/delve/rift plane is
// excluded outright. A camp that fails that check contributes NOTHING here,
// the same way it contributes nothing to that suite's floor. Quest-gated
// camps are NOT excluded (R22 does not exclude them either): they are kept
// and visibly labelled `questGated`, never presented as an unlabeled ordinary
// source. Rare and elite carriers are kept and labelled, never implied to be
// as common as an ordinary camp.
//
// Pure in the sense that matters here: no SimContext, no rng, no clock, no
// player state, no runtime/SQL reads. UI localizes at its own seam
// (itemDisplayName/zone display/mob display); this module hands back ids.

import { FARM_CROPS, farmCropSkillThreshold } from '../content/farm_crops';
import { FARM_PATCHES } from '../content/farm_patches';
import { FISHING_TABLES_BY_BAND, type FishingEntry } from '../content/items';
import { HARVEST_COMPONENT_ITEMS, HARVEST_COMPONENT_SPECIMENS } from '../content/professions';
import {
  CAMPS,
  DUNGEON_X_THRESHOLD,
  dungeonAt,
  GATHER_NODES,
  ITEMS,
  isDelvePos,
  isRiftPos,
  MOBS,
  ZONES,
  zoneContaining,
} from '../data';
import { PLAYER_SWIM_DEPTH } from '../pathfind';
import type { GatherNodeType } from '../types';
import { groundHeight, isInWaterBody, waterLevel } from '../world';
import { WORLD_SEED } from '../world_seed';
import { FISHING_CATCH_BAND_THRESHOLDS } from './fishing_bands';
import { FISHING_ZONE_ROD_TIERS, rodTierRequiredForZone } from './fishing_zones';
import { nodeMaterialFor } from './gathering_materials';
import {
  baseMaterialFor,
  fineGradeReachable,
  fineMaterialFor,
  gatherMaterialTier,
} from './material_grades';

/** One creature+zone example a corpse-harvest material is actually farmed from. */
export interface CorpseSourceExample {
  readonly mobId: string;
  readonly zoneId: string;
  readonly rare: boolean;
  readonly elite: boolean;
  /** This carrier is only damageable while a named quest is active/ready
   *  (e.g. spider_egg / q_broodmother): a real but hollow, one-window source,
   *  never presented as an ordinary repeatable camp. */
  readonly questGated: boolean;
  /** Sum of CampDef.count across this mob's overworld camps in this zone. */
  readonly spawnCount: number;
}

export interface CorpseMaterialSource {
  readonly kind: 'corpse';
  readonly itemId: string;
  /** Ordinary (common, ungated) examples before rare/elite/gated ones;
   *  ties broken by mob id. The full reachable set, never pre-truncated: a
   *  caller that wants a short list slices this itself. */
  readonly examples: readonly CorpseSourceExample[];
  /** Distinct reachable carrier count (== examples.length by mob, i.e. before
   *  any per-zone split); recorded so a caller can say "N sources" honestly
   *  even after slicing `examples` for display. */
  readonly totalCarriers: number;
  /** SAME-TAG premium specimen item ids (HARVEST_COMPONENT_SPECIMENS), deduped:
   *  a rare-or-better roll of a component family mapping to this item ALSO
   *  yields the family's specimen, bag room permitting, at that same roll.
   *  Never an extra roll and never a claim about any one unrolled corpse.
   *  Usually zero or one entry; a list because a material can be reached by
   *  more than one component family (never more than one specimen per family).
   *  Always empty on a specimen's OWN entry (see `conditionalOnBaseItemId`):
   *  a specimen never lists itself as a premium jackpot of itself. */
  readonly premiumSpecimenItemIds: readonly string[];
  /** Present only when `itemId` IS a HARVEST_COMPONENT_SPECIMENS value: the
   *  base HARVEST_COMPONENT_ITEMS material id this specimen is a rare-or-
   *  better bonus roll of. The `examples`/`totalCarriers` above are the SAME
   *  real carriers that base material comes from (the same tag), never a
   *  separate guaranteed drop and never a different body: a specimen has no
   *  carrier of its own, only a chance on the base material's harvest. */
  readonly conditionalOnBaseItemId?: string;
}

/** Per-zone facts for one node-gathered material: the cheapest real node
 *  (lowest GatherNodeDef.tier) in that zone that actually yields this item,
 *  which is exactly the tool tier `canGatherTier` checks against
 *  (gathering.ts's node harvest gate reads the NODE's own tier, never a
 *  zone-wide value). */
export interface NodeZoneSource {
  readonly zoneId: string;
  readonly minimumNodeTier: number;
}

export interface NodeMaterialSource {
  readonly kind: 'node';
  readonly itemId: string;
  readonly nodeType: GatherNodeType;
  /** Zones carrying at least one real GATHER_NODES entry that actually
   *  resolves to this item id (derived from nodeMaterialFor, never assumed
   *  from NODE_MATERIAL_TABLE membership alone), each with its own minimum
   *  required tool tier. */
  readonly zones: readonly NodeZoneSource[];
  readonly isFineGrade: boolean;
  /** Present only when isFineGrade: the gatherTier a tool must sit strictly
   *  above (material_grades.ts yieldsFineGrade) to upgrade this harvest; the
   *  minimum satisfying tool tier is this value plus one. */
  readonly fineGatherTier?: number;
}

export interface FarmMaterialSource {
  readonly kind: 'farm';
  readonly itemId: string;
  readonly cropId: string;
  /** Every FARM_PATCHES zone: plantCrop compares farming skill and hoe tier
   *  against the crop's OWN requirements, never the patch's tier, so any
   *  crop may be planted at any real patch once those are met. */
  readonly zoneIds: readonly string[];
  readonly isFineGrade: boolean;
  /** Wall-clock growth time: this is grown from a planted seed, never an
   *  instant collection. */
  readonly growDurationMs: number;
  /** The farming proficiency plantCrop's skill gate requires
   *  (farmCropSkillThreshold(crop.tier)). */
  readonly minimumFarmingSkill: number;
  /** The wieldable farming hoe tier plantCrop's tool gate requires
   *  (canGatherTier(hoeTier, crop.tier)): crop.tier itself. */
  readonly requiredHoeTier: number;
}

export interface FishingZoneSource {
  readonly zoneId: string;
  /** Lowest band index (FISHING_TABLES_BY_BAND) this catch appears at in
   *  this zone, resolved through the SAME fallback completeFishing uses
   *  (a zone with no table of its own reads the eastbrook_vale row). */
  readonly band: number;
  /** The fishing proficiency effectiveFishingBand needs to reach this band
   *  (FISHING_CATCH_BAND_THRESHOLDS[band]): the skill half of the two-axis
   *  effective-band rule (min(skill band, rod band)). */
  readonly minimumProficiency: number;
  /** The rod tier a cast actually needs here: the zone's own access gate
   *  (rodTierRequiredForZone) OR the tier this band's catch table demands
   *  (band + 1), whichever is stricter. */
  readonly minimumRodTier: number;
  /** True only when this zone's declared water includes at least one spot a
   *  real cast accepts (the same groundHeight/waterLevel/isInWaterBody depth
   *  rule startFishing itself casts against, sampled cheaply at content-load
   *  time, never per lookup): a provable fishable location. False means the
   *  band/tool facts above are real but no specific spot can be shown
   *  honestly (a lake count alone is not proof of a casting spot). */
  readonly provenLocation: boolean;
}

export interface FishingMaterialSource {
  readonly kind: 'fishing';
  readonly itemId: string;
  readonly zones: readonly FishingZoneSource[];
}

export interface UnknownMaterialSource {
  readonly kind: 'unknown';
  readonly itemId: string;
}

export type MaterialSourceInfo =
  | CorpseMaterialSource
  | NodeMaterialSource
  | FarmMaterialSource
  | FishingMaterialSource
  | UnknownMaterialSource;

/** The far-east instance/delve/rift plane: no overworld source ever sits
 *  here (mirrors tests/harvest_geography.test.ts isInstancePlanePosition). */
function isInstancePlanePosition(x: number): boolean {
  return x > DUNGEON_X_THRESHOLD || dungeonAt(x) !== null || isDelvePos(x) || isRiftPos(x);
}

/** The zone a camp actually sits in, or null when it is on the instance
 *  plane or outside every authored zone rect. Strict containment
 *  (zoneContaining), never the clamping zoneAt. */
function overworldZoneOfCamp(x: number, z: number): string | null {
  if (isInstancePlanePosition(x)) return null;
  return zoneContaining(x, z)?.id ?? null;
}

interface TagCarriers {
  readonly examplesByKey: ReadonlyMap<string, CorpseSourceExample>;
  readonly totalCarriers: number;
}

/** Scans every mob for a component-tag match against `matchesTags`, folding
 *  its reachable overworld camps into one example per (mob, zone). Shared by
 *  a base material (matches ANY of its tags, e.g. horn/tusk both feeding
 *  curved_tusk) and a specimen (matches its OWN single tag only, since a
 *  specimen has no carrier the base material didn't already name). */
function scanCorpseCarriers(matchesTags: (mobTags: readonly string[]) => boolean): TagCarriers {
  const examplesByKey = new Map<string, CorpseSourceExample>();
  let totalCarriers = 0;

  for (const mob of Object.values(MOBS)) {
    const mobTags = mob.componentTags;
    if (!mobTags || !matchesTags(mobTags)) continue;
    let reachable = false;
    for (const camp of CAMPS) {
      if (camp.mobId !== mob.id) continue;
      const zoneId = overworldZoneOfCamp(camp.center.x, camp.center.z);
      if (zoneId === null) continue;
      reachable = true;
      const key = `${mob.id} ${zoneId}`;
      const existing = examplesByKey.get(key);
      if (existing) {
        examplesByKey.set(key, { ...existing, spawnCount: existing.spawnCount + camp.count });
      } else {
        examplesByKey.set(key, {
          mobId: mob.id,
          zoneId,
          rare: !!mob.rare,
          elite: !!mob.elite,
          questGated: mob.requiresQuestId !== undefined,
          spawnCount: camp.count,
        });
      }
    }
    if (reachable) totalCarriers++;
  }

  return { examplesByKey, totalCarriers };
}

function sortedCorpseExamples(
  examplesByKey: ReadonlyMap<string, CorpseSourceExample>,
): readonly CorpseSourceExample[] {
  const rank = (e: CorpseSourceExample): number => (e.questGated ? 2 : e.rare || e.elite ? 1 : 0);
  return Object.freeze(
    [...examplesByKey.values()].sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      if (a.mobId !== b.mobId) return a.mobId.localeCompare(b.mobId);
      return a.zoneId.localeCompare(b.zoneId);
    }),
  );
}

function buildCorpseSources(): ReadonlyMap<string, CorpseMaterialSource> {
  const tagsByItem = new Map<string, string[]>();
  for (const [tag, itemId] of Object.entries(HARVEST_COMPONENT_ITEMS)) {
    if (!itemId) continue;
    const row = tagsByItem.get(itemId);
    if (row) row.push(tag);
    else tagsByItem.set(itemId, [tag]);
  }

  const out = new Map<string, CorpseMaterialSource>();
  for (const [itemId, tags] of tagsByItem) {
    const tagSet = new Set(tags);
    const { examplesByKey, totalCarriers } = scanCorpseCarriers((mobTags) =>
      mobTags.some((tag) => tagSet.has(tag)),
    );

    const premiumSpecimenItemIds = Object.freeze([
      ...new Set(
        tags
          .map((tag) => HARVEST_COMPONENT_SPECIMENS[tag])
          .filter((specimenId): specimenId is string => !!specimenId),
      ),
    ]);
    out.set(
      itemId,
      Object.freeze({
        kind: 'corpse' as const,
        itemId,
        examples: sortedCorpseExamples(examplesByKey),
        totalCarriers,
        premiumSpecimenItemIds,
      }),
    );
  }

  // Perfect specimens (HARVEST_COMPONENT_SPECIMENS): indexed by their OWN
  // component tag, never left to fall through to 'unknown'. A specimen is
  // reached from the EXACT SAME real carriers as its base material (the tag
  // never changes what mob/camp actually drops it), so it reuses the same
  // scan restricted to its own tag; it carries no premiumSpecimenItemIds of
  // its own (never self-referenced as a premium jackpot of itself) and
  // instead names the base material it conditions on via
  // conditionalOnBaseItemId, so the UI can explain the roll honestly rather
  // than implying a specimen harvest generates itself or promising a
  // specific body.
  for (const [tag, specimenId] of Object.entries(HARVEST_COMPONENT_SPECIMENS)) {
    const baseItemId = HARVEST_COMPONENT_ITEMS[tag];
    if (!baseItemId) continue;
    const { examplesByKey, totalCarriers } = scanCorpseCarriers((mobTags) => mobTags.includes(tag));
    out.set(
      specimenId,
      Object.freeze({
        kind: 'corpse' as const,
        itemId: specimenId,
        examples: sortedCorpseExamples(examplesByKey),
        totalCarriers,
        premiumSpecimenItemIds: Object.freeze([]),
        conditionalOnBaseItemId: baseItemId,
      }),
    );
  }

  return out;
}

function buildNodeSources(): ReadonlyMap<string, NodeMaterialSource> {
  const out = new Map<string, NodeMaterialSource>();
  const nodeTypes: readonly GatherNodeType[] = ['ore', 'wood', 'herb'];

  for (const type of nodeTypes) {
    const baseTierByItemZone = new Map<string, Map<string, number>>();
    const fineTierByItemZone = new Map<string, Map<string, number>>();

    for (const node of GATHER_NODES) {
      if (node.type !== type) continue;
      const baseItemId = nodeMaterialFor(type, node.zoneId).itemId;
      recordMinTier(baseTierByItemZone, baseItemId, node.zoneId, node.tier);
      const fineItemId = fineMaterialFor(baseItemId);
      if (fineItemId && fineGradeReachable(baseItemId, node.tier)) {
        recordMinTier(fineTierByItemZone, fineItemId, node.zoneId, node.tier);
      }
    }

    for (const [itemId, tierByZone] of baseTierByItemZone) {
      out.set(
        itemId,
        Object.freeze({
          kind: 'node' as const,
          itemId,
          nodeType: type,
          zones: zoneSourcesOf(tierByZone),
          isFineGrade: false,
        }),
      );
    }
    for (const [itemId, tierByZone] of fineTierByItemZone) {
      const baseItemId = baseMaterialFor(itemId);
      const fineGatherTier = baseItemId ? gatherMaterialTier(baseItemId) : undefined;
      out.set(
        itemId,
        Object.freeze({
          kind: 'node' as const,
          itemId,
          nodeType: type,
          zones: zoneSourcesOf(tierByZone),
          isFineGrade: true,
          fineGatherTier,
        }),
      );
    }
  }
  return out;
}

/** Records the LOWEST node tier seen for (itemId, zoneId): the cheapest real
 *  vein in that zone is what actually decides the minimum tool tier a player
 *  needs there, never the highest or an assumed tier-1 floor. */
function recordMinTier(
  map: Map<string, Map<string, number>>,
  itemId: string,
  zoneId: string,
  tier: number,
): void {
  let byZone = map.get(itemId);
  if (!byZone) {
    byZone = new Map();
    map.set(itemId, byZone);
  }
  const existing = byZone.get(zoneId);
  if (existing === undefined || tier < existing) byZone.set(zoneId, tier);
}

function zoneSourcesOf(tierByZone: ReadonlyMap<string, number>): readonly NodeZoneSource[] {
  return Object.freeze(
    [...tierByZone.entries()]
      .map(([zoneId, minimumNodeTier]) => ({ zoneId, minimumNodeTier }))
      .sort((a, b) => a.zoneId.localeCompare(b.zoneId)),
  );
}

function buildFarmSources(): ReadonlyMap<string, FarmMaterialSource> {
  const out = new Map<string, FarmMaterialSource>();
  // plantCrop gates on the CROP's own skill/hoe requirements, never on the
  // patch's tier (no equal-tier restriction exists at the command), so every
  // crop is reachable at every real patch once those two gates are met.
  const zoneIds = Object.freeze([...new Set(FARM_PATCHES.map((patch) => patch.zoneId))].sort());
  for (const crop of Object.values(FARM_CROPS)) {
    const minimumFarmingSkill = farmCropSkillThreshold(crop.tier);
    const requiredHoeTier = crop.tier;
    out.set(
      crop.produceItemId,
      Object.freeze({
        kind: 'farm' as const,
        itemId: crop.produceItemId,
        cropId: crop.id,
        zoneIds,
        isFineGrade: false,
        growDurationMs: crop.durationMs,
        minimumFarmingSkill,
        requiredHoeTier,
      }),
    );
    out.set(
      crop.fineProduceItemId,
      Object.freeze({
        kind: 'farm' as const,
        itemId: crop.fineProduceItemId,
        cropId: crop.id,
        zoneIds,
        isFineGrade: true,
        growDurationMs: crop.durationMs,
        minimumFarmingSkill,
        requiredHoeTier,
      }),
    );
  }
  return out;
}

/** The runtime fallback completeFishing itself applies (src/sim/professions/
 *  fishing.ts: `bandTables[zoneId] ?? bandTables.eastbrook_vale`), restated
 *  here so the source lookup answers what a cast actually resolves rather
 *  than only the zones that author their own table. */
function resolvedFishingTable(band: number, zoneId: string): readonly FishingEntry[] {
  const byZone = FISHING_TABLES_BY_BAND[band];
  return byZone[zoneId] ?? byZone.eastbrook_vale;
}

/** Fixed sample offsets as fractions of a lake's own radius: the centre plus
 *  an 8-direction ring at three radii, so a lake whose deep water is not
 *  perfectly centred is still very likely caught. A FIXED point count
 *  regardless of radius is what keeps this a probe rather than an area scan
 *  (contrast tests/fishing_zones.test.ts's own 0.5-yard grid census, which
 *  exists to PROVE the two known decorative lakes hold zero wet cells at
 *  all, not to be re-run at content-load time). */
const LAKE_PROBE_RADIUS_FRACTIONS = [0.5, 0.6, 0.85] as const;
const LAKE_PROBE_RING_DIRECTIONS = 8;

/** A cheap, bounded, pure probe for "does this declared lake actually hold a
 *  spot a real cast accepts", reusing the EXACT depth rule startFishing's own
 *  firstFishableSampleAhead casts against (isInWaterBody plus the
 *  groundHeight/waterLevel swim-depth compare), sampled at the shipped
 *  WORLD_SEED. A fixed set of offsets per lake, never a per-lake area scan
 *  and never a Sim: this runs once, at first cache build, over every
 *  declared lake in every fishing-eligible zone (61 lakes across 14 zones on
 *  the shipped tree), not per material lookup. A lake with no real water at
 *  any sampled point (a decorative disc a terrain lift dried out) fails
 *  every offset. */
function lakeHasFishableWater(lake: {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}): boolean {
  const isWet = (x: number, z: number): boolean =>
    isInWaterBody(x, z) && groundHeight(x, z, WORLD_SEED) < waterLevel() - PLAYER_SWIM_DEPTH;
  if (isWet(lake.x, lake.z)) return true;
  for (const fraction of LAKE_PROBE_RADIUS_FRACTIONS) {
    const r = lake.radius * fraction;
    for (let i = 0; i < LAKE_PROBE_RING_DIRECTIONS; i++) {
      const angle = (i / LAKE_PROBE_RING_DIRECTIONS) * Math.PI * 2;
      if (isWet(lake.x + Math.cos(angle) * r, lake.z + Math.sin(angle) * r)) return true;
    }
  }
  return false;
}

/** Every fishing-eligible zone (a FISHING_ZONE_ROD_TIERS row) that declares
 *  at least one real, cast-accepting lake: computed once and cached, never
 *  per lookup. A zone with zero declared lakes, or whose declared lakes are
 *  all decorative, is honestly absent rather than assumed present. */
function buildProvenFishingZoneIds(): ReadonlySet<string> {
  const proven = new Set<string>();
  for (const zone of ZONES) {
    if (!Object.hasOwn(FISHING_ZONE_ROD_TIERS, zone.id)) continue;
    if (zone.lakes.some((lake) => lakeHasFishableWater(lake))) proven.add(zone.id);
  }
  return proven;
}

function buildFishingSources(
  provenZoneIds: ReadonlySet<string>,
): ReadonlyMap<string, FishingMaterialSource> {
  const zoneIds = Object.keys(FISHING_ZONE_ROD_TIERS);
  const bandByItemByZone = new Map<string, Map<string, number>>();
  for (let band = 0; band < FISHING_TABLES_BY_BAND.length; band++) {
    for (const zoneId of zoneIds) {
      for (const entry of resolvedFishingTable(band, zoneId)) {
        if (entry.itemId === null) continue;
        if (ITEMS[entry.itemId]?.quality === 'poor') continue;
        let byZone = bandByItemByZone.get(entry.itemId);
        if (!byZone) {
          byZone = new Map();
          bandByItemByZone.set(entry.itemId, byZone);
        }
        const existing = byZone.get(zoneId);
        if (existing === undefined || band < existing) byZone.set(zoneId, band);
      }
    }
  }

  const out = new Map<string, FishingMaterialSource>();
  for (const [itemId, byZone] of bandByItemByZone) {
    const zones = [...byZone.entries()]
      .map(([zoneId, band]) => ({
        zoneId,
        band,
        minimumProficiency: FISHING_CATCH_BAND_THRESHOLDS[band],
        minimumRodTier: Math.max(rodTierRequiredForZone(zoneId), band + 1),
        provenLocation: provenZoneIds.has(zoneId),
      }))
      .sort((a, b) => a.zoneId.localeCompare(b.zoneId));
    out.set(
      itemId,
      Object.freeze({ kind: 'fishing' as const, itemId, zones: Object.freeze(zones) }),
    );
  }
  return out;
}

interface SourceCache {
  readonly corpse: ReadonlyMap<string, CorpseMaterialSource>;
  readonly node: ReadonlyMap<string, NodeMaterialSource>;
  readonly farm: ReadonlyMap<string, FarmMaterialSource>;
  readonly fishing: ReadonlyMap<string, FishingMaterialSource>;
  readonly provenFishingZoneIds: ReadonlySet<string>;
}

let cache: SourceCache | null = null;

function sourceCache(): SourceCache {
  if (cache === null) {
    const provenFishingZoneIds = buildProvenFishingZoneIds();
    cache = {
      corpse: buildCorpseSources(),
      node: buildNodeSources(),
      farm: buildFarmSources(),
      fishing: buildFishingSources(provenFishingZoneIds),
      provenFishingZoneIds,
    };
  }
  return cache;
}

/** Where `itemId` actually comes from, across every gathering family, read
 *  live off the shipped content and cached after the first call. A material
 *  no family produces (a retired id, a non-gathered item) answers `unknown`,
 *  never a thrown error or an invented location. */
export function materialSourceInfo(itemId: string): MaterialSourceInfo {
  const c = sourceCache();
  return (
    c.corpse.get(itemId) ??
    c.node.get(itemId) ??
    c.farm.get(itemId) ??
    c.fishing.get(itemId) ?? { kind: 'unknown' as const, itemId }
  );
}

/** Every fishing-eligible zone with at least one real, cast-accepting
 *  declared lake, computed once and cached. Exported for direct testing of
 *  the geography invariant without walking it through one fallback-table
 *  item's zone list. */
export function fishingLocationProvenZoneIds(): ReadonlySet<string> {
  return sourceCache().provenFishingZoneIds;
}
