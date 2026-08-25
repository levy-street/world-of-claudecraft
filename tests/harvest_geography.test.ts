// ---------------------------------------------------------------------------
// THE HARVEST GEOGRAPHY INVARIANT (masterwrought R22, Phase 11m DECISION 12)
// ---------------------------------------------------------------------------
//
// The rule, stated once so a contributor who has never read the Masterwrought
// packet can act on a red here:
//
//   EVERY MAPPED CORPSE-HARVEST FAMILY MUST BE REACHABLE ACROSS THE WORLD. A
//   component tag that HARVEST_COMPONENT_ITEMS maps to an item is a promise
//   that a player levelling anywhere can farm that item; a family carried by
//   two templates in two starter zones is a promise the mid and high game
//   cannot keep, and the hole is invisible until a player at level 12 needs
//   thirty-five of something only a level-3 spider drops.
//
// masterwrought R22 (docs/prd/masterwrought/farming/state.md rows 11m-D-12 and
// qr-11m-SPREAD, the settled DECISION 12 of
// docs/prd/masterwrought/phase-11m-harvest-geography.md) fixes the floor:
// every mapped tag reaches at least REACH_FLOOR.templates templates across at
// least REACH_FLOOR.zones distinct zones spanning at least REACH_FLOOR.bands
// level bands, COUNTED OVER THE REACHABLE SUBSET AND NEVER OVER MEMBERSHIP.
//
// WHY REACHABILITY IS THE RULING AND NOT A REFINEMENT. R22 states its floor in
// its own words as reachability: a floor met by tagging a raid boss and a
// dungeon rare is the same bug with a passing test. Counted over membership,
// this suite would pass on exactly the shape R22 names as still broken (the
// `fang` family alone carries four instance-roster templates today). So the
// predicate lives IN THIS FILE as a named function (isReachable), the floor
// walks it, and the teeth arm at the bottom proves a family whose count
// depends on instance-only templates FAILS.
//
// THE REACHABILITY PREDICATE, spelled out:
//   a template is REACHABLE when it has at least one CAMPS row (src/sim/data.ts
//   CAMPS, the overworld spawn table the Sim camp loop scatters at world
//   build) whose center is an OVERWORLD position: not on the far-east instance
//   plane, and resolving by zoneAt to an authored ZONES entry.
// EVERY ZONES ENTRY IS OPEN WORLD, the Proving Shore included. The tutorial
// island is an ordinary revisitable zone: src/sim/interactions/ferry_bell.ts
// tryRingFerryBell routes EITHER bell to the other shore with no graduation
// gate (graduation only bumps a deed stat there; PROVING_SHORE_PORTALS is
// empty, so the bell is the whole crossing mechanism). A player of any level
// can ring back onto it, so its camps count and shore_scuttler (camped on the
// island only) is a reachable carrier; the predicate arm below pins that.
// THE ONE EXCLUSION is structural, not a judgment: instance, raid, delve and
// rift rosters spawn from their own DungeonDef / delve / rift spawn lists on
// the far-east instance plane (x beyond DUNGEON_X_THRESHOLD, src/sim/data.ts:
// dungeonAt, isDelvePos and isRiftPos all read that plane, which is why the
// predicate cites them rather than a zone "kind" field the tree does not
// have) and NEVER from CAMPS. So "no camp" IS "no overworld spawn", and the
// tagged templates in that state today, each with its spawn site cited, are
// pinned by the zero-camp arm below: the four Wildheart Basin templates (an
// open-field DungeonDef, content/wildheart.ts WILDHEART_SPAWN_LIST),
// mister_crabs (a summon-only miniboss, interactions/crab_summon.ts), and
// dragonkin_whelp (hatched from a dragonkin_brood_egg's broodEgg.hatchMobId,
// content/drakelands.ts, never a camp of its own). A camp authored ON the
// instance plane would be refused too (the plane arm proves it), though the
// shipped CAMPS carries none.
// Count-1 rares and elites at overworld camps ARE reachable members: the
// settled row says count-1 named mobs are legal floor members and spawn
// density is RECORDED in the ledger, not asserted here (qr-11m-SPREAD (3)).
// old_greyjaw, a count-1 rare at an Eastbrook camp, pins that reading.
//
// LEVEL BANDS are THE PHASE'S OWN QUANTIZATION (the tree has no zone-band
// constant to import): LEVEL_BAND_WIDTH-wide buckets of a template's
// minLevel, floor((minLevel - 1) / 5), so band 0 is levels 1 to 5, band 1 is
// 6 to 10, band 2 is 11 to 15, band 3 is 16 to 20 (levelBandOf). This
// reproduces the settled reading that silk's shipped spread, webwood_spider
// at 2 to 4 plus widowsilk_spinner at 20, already spans two bands, which is
// WHY the floor alone cannot force a mid-band silk source and qr-11m-SPREAD
// (2) directs mire_widow by name instead.
//
// THE MAP IS NOT INJECTIVE AND THE FLOOR IS PER TAG. After 11m-ORPHAN horn
// maps to curved_tusk, which is also tusk's item, so nothing here keys a
// measurement on the item side: the subject list is the map's KEYS, each tag
// is measured over its own carriers, and the per-tag arm in the teeth block
// proves two tags sharing one item are judged separately.
//
// FAILURE MESSAGES NAME THE FAMILY AND WHAT IT IS SHORT OF (templates x of 6,
// zones y of 4, bands z of 2), and the floor arm reports EVERY short family
// at once (collect, then expect toEqual([])), never just the first, so the
// failure output IS the spread audit.
//
// EVERY COUNT DERIVES FROM THE FUNCTION UNDER TEST'S INPUTS (MOBS, CAMPS,
// ZONES, HARVEST_COMPONENT_ITEMS), read live. The mapped-tag list is
// Object.keys(HARVEST_COMPONENT_ITEMS), never a hand list, so mapping a new
// family (11m-ORPHAN maps horn and gills) puts it under the floor with no
// edit here. Nothing in this file pastes a census number into a pin.
//
// WHAT THIS FILE MEASURED BEFORE 11m'S SPREAD LANDED, kept as the record of
// its own calibration: on the pre-spread tree the floor arm reported silk
// (templates 3 of 6, zones 3 of 4), tusk (templates 2 of 6, zones 2 of 4),
// venomSac (templates 4 of 6) and claw (zones 3 of 4), and the unmapped-tag
// arm reported gills and horn until 11m-ORPHAN mapped them. Those reds were
// the phase's deliverable, and the same arms are what a future regression
// reds on.

import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import {
  CAMPS,
  DELVE_BAND_X_MIN,
  DUNGEON_X_THRESHOLD,
  dungeonAt,
  instanceOrigin,
  isDelvePos,
  isRiftPos,
  MOBS,
  RIFT_X_MIN,
  ZONES,
  zoneAt,
  zoneContaining,
} from '../src/sim/data';
import type { CampDef, MobTemplate, ZoneDef } from '../src/sim/types';
import { UNMAPPED_FAMILY, UNMAPPED_FAMILY_2 } from './helpers/unmapped_family';

const WHERE_THE_RULE_LIVES =
  'masterwrought R22, docs/prd/masterwrought/phase-11m-harvest-geography.md DECISION 12 ' +
  '(state.md rows 11m-D-12 and qr-11m-SPREAD)';

/** The decision-12 TARGET, the whole floor in one triple. */
// biome-ignore lint/suspicious/noExportsInTest: the floor is read by the live arm, the teeth arm and the mutation probes alike, and one triple keeps them the same floor
export const REACH_FLOOR = { templates: 6, zones: 4, bands: 2 } as const;

/** Level-band width in character levels (bands 1 to 5, 6 to 10, 11 to 15, 16 to 20). */
// biome-ignore lint/suspicious/noExportsInTest: the band definition is the phase's, exported so the band arm and the floor share it
export const LEVEL_BAND_WIDTH = 5;

/** The phase's level band of a template: its minLevel bucketed LEVEL_BAND_WIDTH
 *  wide, floor((minLevel - 1) / LEVEL_BAND_WIDTH). The phase's own
 *  quantization: the tree carries no zone-band constant this could import. */
// biome-ignore lint/suspicious/noExportsInTest: the band function is part of the invariant, not a private helper
export function levelBandOf(minLevel: number): number {
  return Math.floor((minLevel - 1) / LEVEL_BAND_WIDTH);
}

/** A band as a player reads it, for failure messages: "1 to 5". */
function bandLabel(band: number): string {
  const low = band * LEVEL_BAND_WIDTH + 1;
  return `${low} to ${low + LEVEL_BAND_WIDTH - 1}`;
}

/** The inputs the floor reads. The live world is the merged content; the
 *  teeth arm builds a synthetic one with the same shape. */
// biome-ignore lint/suspicious/noExportsInTest: the fixture shape is the floor's contract, shared by the live arm and the synthetic one
export interface HarvestWorld {
  readonly mobs: Readonly<Record<string, MobTemplate>>;
  readonly camps: readonly CampDef[];
  readonly zones: readonly ZoneDef[];
  readonly zoneOf: (x: number, z: number) => ZoneDef;
}

// biome-ignore lint/suspicious/noExportsInTest: the merged tree as one fixture, so every arm names the same inputs
export const LIVE_WORLD: HarvestWorld = {
  mobs: MOBS,
  camps: CAMPS,
  zones: ZONES,
  zoneOf: zoneAt,
};

/** Whether a position is on the far-east instance plane (dungeons, delves,
 *  rifts, the arena): the one class of position no open-world zone covers.
 *  Reads the same plane the engine reads (DUNGEON_X_THRESHOLD, dungeonAt,
 *  isDelvePos, isRiftPos in src/sim/data.ts). */
// biome-ignore lint/suspicious/noExportsInTest: the exclusion half of the predicate, exported so the plane arm can prove it bites
export function isInstancePlanePosition(x: number): boolean {
  return x > DUNGEON_X_THRESHOLD || dungeonAt(x) !== null || isDelvePos(x) || isRiftPos(x);
}

/** An overworld camp: its center is off the instance plane and zoneAt
 *  resolves it to an authored zone of the world. Every authored zone is open
 *  world (the Proving Shore included, see the header). */
// biome-ignore lint/suspicious/noExportsInTest: the admission half of the predicate, exported with the other half
export function isOverworldCamp(camp: CampDef, world: HarvestWorld): boolean {
  const { x, z } = camp.center;
  if (isInstancePlanePosition(x)) return false;
  return world.zones.includes(world.zoneOf(x, z));
}

/** The template's overworld camps. */
// biome-ignore lint/suspicious/noExportsInTest: the predicate's evidence, exported so an arm can show WHICH camps counted
export function overworldCampsOf(templateId: string, world: HarvestWorld): CampDef[] {
  return world.camps.filter((camp) => camp.mobId === templateId && isOverworldCamp(camp, world));
}

/** THE REACHABILITY PREDICATE (header): at least one overworld camp. */
// biome-ignore lint/suspicious/noExportsInTest: R22 requires the predicate to live in the test as a named function
export function isReachable(templateId: string, world: HarvestWorld): boolean {
  return overworldCampsOf(templateId, world).length > 0;
}

/** Every template whose componentTags carries `tag`, membership only. */
// biome-ignore lint/suspicious/noExportsInTest: the membership half the floor deliberately does NOT count, exported so the teeth arm can show the contrast
export function carriersOf(tag: string, world: HarvestWorld): MobTemplate[] {
  return Object.values(world.mobs).filter((mob) => (mob.componentTags ?? []).includes(tag));
}

/** One family's measured reach over a world. */
// biome-ignore lint/suspicious/noExportsInTest: the census row shape the ledger records
export interface FamilyReach {
  readonly tag: string;
  /** Every carrier, membership. */
  readonly carriers: readonly string[];
  /** The carriers isReachable admits; the ONLY ones the floor counts. */
  readonly reachable: readonly string[];
  /** Carriers the floor refused (no overworld camp). */
  readonly unreachable: readonly string[];
  /** Distinct zoneOf(camp.center).id over the reachable carriers' overworld camps. */
  readonly zones: readonly string[];
  /** Distinct levelBandOf(minLevel) over the reachable carriers. */
  readonly bands: readonly number[];
  /** Sum of camp.count over the reachable carriers' overworld camps: RECORDED, never asserted. */
  readonly spawnPoints: number;
}

// biome-ignore lint/suspicious/noExportsInTest: the measurement the floor judges, exported so a probe can print the census the ledger records
export function familyReach(tag: string, world: HarvestWorld): FamilyReach {
  const carriers = carriersOf(tag, world);
  const reachable = carriers.filter((mob) => isReachable(mob.id, world));
  const zones = new Set<string>();
  const bands = new Set<number>();
  let spawnPoints = 0;
  for (const mob of reachable) {
    for (const camp of overworldCampsOf(mob.id, world)) {
      zones.add(world.zoneOf(camp.center.x, camp.center.z).id);
      spawnPoints += camp.count;
    }
    bands.add(levelBandOf(mob.minLevel));
  }
  return {
    tag,
    carriers: carriers.map((mob) => mob.id),
    reachable: reachable.map((mob) => mob.id),
    unreachable: carriers.filter((mob) => !isReachable(mob.id, world)).map((mob) => mob.id),
    zones: [...zones].sort(),
    bands: [...bands].sort((a, b) => a - b),
    spawnPoints,
  };
}

/** THE FLOOR. One message per short family, naming the family and every
 *  dimension it is short of; an empty list is a pass. Keyed by TAG: two tags
 *  that share an item are two rows. */
// biome-ignore lint/suspicious/noExportsInTest: the function under test for both the live and the synthetic arm
export function floorShortfalls(tags: readonly string[], world: HarvestWorld): string[] {
  const short: string[] = [];
  for (const tag of tags) {
    const reach = familyReach(tag, world);
    const shortOf: string[] = [];
    if (reach.reachable.length < REACH_FLOOR.templates) {
      shortOf.push(`templates ${reach.reachable.length} of ${REACH_FLOOR.templates}`);
    }
    if (reach.zones.length < REACH_FLOOR.zones) {
      shortOf.push(`zones ${reach.zones.length} of ${REACH_FLOOR.zones}`);
    }
    if (reach.bands.length < REACH_FLOOR.bands) {
      shortOf.push(`bands ${reach.bands.length} of ${REACH_FLOOR.bands}`);
    }
    if (shortOf.length === 0) continue;
    short.push(
      `${tag} is short of the masterwrought R22 floor over the REACHABLE subset: ` +
        `${shortOf.join(', ')}. Reachable carriers [${reach.reachable.join(', ')}] in zones ` +
        `[${reach.zones.join(', ')}] spanning bands [${reach.bands.map(bandLabel).join(', ')}]; ` +
        `not counted (no overworld camp) [${reach.unreachable.join(', ')}]. ` +
        `Fix by adding the '${tag}' tag to a thematically fitting EXISTING overworld template ` +
        `(SPREAD, never add: no new mob, camp or item id). Rule: ${WHERE_THE_RULE_LIVES}.`,
    );
  }
  return short;
}

/** Every (template, tag) pair whose tag the yield map does not list. */
// biome-ignore lint/suspicious/noExportsInTest: the unmapped-tag pin's function under test, so a cloned MOBS can drive it
export function unmappedTagCarriers(
  mobs: Readonly<Record<string, MobTemplate>>,
  mapped: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const mob of Object.values(mobs)) {
    for (const tag of mob.componentTags ?? []) {
      if (tag in mapped) continue;
      out.push(
        `${mob.id} carries the component tag '${tag}', which HARVEST_COMPONENT_ITEMS does not map ` +
          `to an item. Every shipped tag must be a key of that map (11m-ORPHAN): map it to a ` +
          `shipped item id or remove the tag. Rule: ${WHERE_THE_RULE_LIVES}.`,
      );
    }
  }
  return out;
}

const MAPPED_TAGS = Object.keys(HARVEST_COMPONENT_ITEMS);

describe('masterwrought R22: every mapped harvest family is reachable across the world', () => {
  it('reports EVERY family short of the floor at once, counted over the REACHABLE subset', () => {
    // Collected and asserted as one list on purpose: the failure output is
    // the spread audit, one row per short family, not a whack-a-mole loop.
    expect(floorShortfalls(MAPPED_TAGS, LIVE_WORLD)).toEqual([]);
  });

  it('no shipped template carries a tag absent from HARVEST_COMPONENT_ITEMS', () => {
    // The real fix for the orphan-tag class (Agent 2's pin): a tag the map
    // does not list is never harvested, never yields, and silently widens
    // the concentration-bonus denominator of every template carrying it.
    expect(unmappedTagCarriers(MOBS, HARVEST_COMPONENT_ITEMS)).toEqual([]);
  });

  it('binds every key of the yield map, read live, never a hand list', () => {
    // The subject list is derived; a family mapped tomorrow is under the
    // floor tomorrow. The one thing worth pinning about it is that it is
    // not empty (an empty map would make the floor arm a statement about
    // nothing) and that every key is carried by at least one shipped
    // template (a mapped tag nobody carries is a yield nobody can reach,
    // which is the same hole in different clothes).
    expect(MAPPED_TAGS.length).toBeGreaterThan(0);
    const uncarried = MAPPED_TAGS.filter((tag) => carriersOf(tag, LIVE_WORLD).length === 0);
    expect(uncarried, 'mapped tags no shipped template carries').toEqual([]);
  });
});

describe('the reachability predicate', () => {
  it('admits a count-1 rare at an overworld camp (density is recorded, never asserted)', () => {
    // qr-11m-SPREAD (3): the floor counts templates, so a count-1 named mob
    // is a legal member. old_greyjaw is the Eastbrook count-1 rare.
    const camps = overworldCampsOf('old_greyjaw', LIVE_WORLD);
    expect(MOBS.old_greyjaw.rare, 'old_greyjaw is the rare this arm assumes').toBe(true);
    expect(camps.length).toBeGreaterThan(0);
    expect(camps.every((camp) => camp.count === 1)).toBe(true);
    expect(isReachable('old_greyjaw', LIVE_WORLD)).toBe(true);
  });

  it('admits the Proving Shore as an ordinary open-world zone: shore_scuttler counts', () => {
    // The island is revisitable (interactions/ferry_bell.ts routes either
    // bell to the other shore, no graduation gate), so it is a ZONES entry
    // like any other and its camps count. shore_scuttler is camped on the
    // island and nowhere else, which makes it the live proof that the
    // predicate does NOT carve the tutorial out.
    const allCamps = CAMPS.filter((camp) => camp.mobId === 'shore_scuttler');
    expect(allCamps.length, 'shore_scuttler is camped').toBeGreaterThan(0);
    expect(
      allCamps.map((camp) => zoneAt(camp.center.x, camp.center.z).id),
      'every shore_scuttler camp sits on the Proving Shore',
    ).toEqual(allCamps.map(() => 'proving_shore'));
    expect(overworldCampsOf('shore_scuttler', LIVE_WORLD)).toEqual(allCamps);
    expect(isReachable('shore_scuttler', LIVE_WORLD)).toBe(true);
    // And the zone itself is a member of the world's zone list, so the
    // admission above went through the ZONES check rather than around it.
    expect(ZONES.some((zone) => zone.id === 'proving_shore')).toBe(true);
  });

  it('names every tagged template no camp spawns, each with its spawn site cited', () => {
    // The zero-camp exclusion is structural (no CAMPS row IS no overworld
    // spawn), and this pin records WHICH tagged templates it refuses today
    // so the refusal is a listed fact rather than an unexamined filter. A
    // red here means a tag landed on a template no camp spawns (it cannot
    // count toward the floor, whatever the intent) or a camp was added for
    // one of these; either way, update the row with the spawn site cited.
    const zeroCamp = Object.values(MOBS)
      .filter((mob) => (mob.componentTags?.length ?? 0) > 0)
      .filter((mob) => !CAMPS.some((camp) => camp.mobId === mob.id))
      .map((mob) => mob.id)
      .sort();
    expect(zeroCamp).toEqual([
      // Hatched from a dragonkin_brood_egg (content/drakelands.ts broodEgg.hatchMobId).
      'dragonkin_whelp',
      // Summon-only Proving Shore miniboss (interactions/crab_summon.ts).
      'mister_crabs',
      // The Wildheart Basin open-field DungeonDef roster (content/wildheart.ts WILDHEART_SPAWN_LIST).
      'wildheart_beastmaster',
      'wildheart_hexcaller',
      'wildheart_ravager',
      'wildheart_stalker',
    ]);
    for (const id of zeroCamp) expect(isReachable(id, LIVE_WORLD), id).toBe(false);
  });

  it('refuses a camp on the instance plane, and the shipped CAMPS carries none', () => {
    // The plane check is what keeps a camp authored at an instance origin
    // from counting: zoneAt CLAMPS any query to some zone, so without it a
    // dungeon-plane camp would masquerade as a spawn in the southmost band.
    // One synthetic camp per plane, each with its own plane predicate as the
    // precondition so the refusal is attributed and not a coincidence.
    const dungeon = instanceOrigin(0, 0);
    expect(dungeonAt(dungeon.x), 'instanceOrigin(0, 0) sits in a dungeon band').not.toBeNull();
    expect(isDelvePos(DELVE_BAND_X_MIN), 'DELVE_BAND_X_MIN is a delve position').toBe(true);
    expect(isRiftPos(RIFT_X_MIN), 'RIFT_X_MIN is a rift position').toBe(true);
    const planeCamps: CampDef[] = [
      { mobId: 'synthetic_dungeon', center: { x: dungeon.x, z: dungeon.z }, radius: 4, count: 1 },
      { mobId: 'synthetic_delve', center: { x: DELVE_BAND_X_MIN, z: 0 }, radius: 4, count: 1 },
      { mobId: 'synthetic_rift', center: { x: RIFT_X_MIN, z: 0 }, radius: 4, count: 1 },
    ];
    for (const camp of planeCamps) {
      expect(isInstancePlanePosition(camp.center.x), camp.mobId).toBe(true);
      expect(isOverworldCamp(camp, LIVE_WORLD), camp.mobId).toBe(false);
    }
    // The shipped table has no such camp: every center is off the plane and
    // strictly inside an authored zone rect (zoneContaining agrees with
    // zoneAt), so on the live tree the predicate's zone reads are literal,
    // never clamped.
    const unplaced = CAMPS.filter(
      (camp) =>
        isInstancePlanePosition(camp.center.x) ||
        zoneContaining(camp.center.x, camp.center.z)?.id !==
          zoneAt(camp.center.x, camp.center.z).id,
    ).map((camp) => `${camp.mobId} at (${camp.center.x}, ${camp.center.z})`);
    expect(unplaced).toEqual([]);
    expect(CAMPS.length).toBeGreaterThan(0);
  });
});

describe('the level band definition', () => {
  it('buckets minLevel five wide, from 1 to 5 up to 16 to 20', () => {
    expect(LEVEL_BAND_WIDTH).toBe(5);
    expect([1, 5, 6, 10, 11, 15, 16, 20].map(levelBandOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(bandLabel(0)).toBe('1 to 5');
    expect(bandLabel(3)).toBe('16 to 20');
  });

  it("reproduces the settled reading that silk's shipped spread already spans two bands", () => {
    // qr-11m-SPREAD (2): webwood_spider (2 to 4) and widowsilk_spinner (20)
    // sit in different bands, so the two-band clause is satisfiable without
    // any mid-band source and mire_widow's silk tag is directed by name.
    const spider = MOBS.webwood_spider;
    const spinner = MOBS.widowsilk_spinner;
    expect(spider.componentTags, 'webwood_spider carries silk').toContain('silk');
    expect(spinner.componentTags, 'widowsilk_spinner carries silk').toContain('silk');
    expect(levelBandOf(spider.minLevel)).not.toBe(levelBandOf(spinner.minLevel));
    expect(
      familyReach('silk', LIVE_WORLD).bands.length,
      'silk spans the two-band clause on the shipped tree',
    ).toBeGreaterThanOrEqual(REACH_FLOOR.bands);
  });
});

describe('the predicate has teeth: instance-only carriers cannot carry a family', () => {
  // A synthetic family over a synthetic world with the SAME floor function.
  // The instance-only carriers clone the wildheart shape (a template with no
  // CAMPS row); the camped carriers sit at real zone hubs so zoneAt resolves
  // real zones, one hub per carrier across zones of different level ranges,
  // so zones and bands clear the floor and the ONLY dimension the reachable
  // count can be short of is templates.
  const TAG = 'synthetic_scute';
  const INSTANCE_SHAPES = ['wildheart_stalker', 'wildheart_ravager', 'wildheart_beastmaster'];
  const HUB_ZONES = ZONES.slice(0, REACH_FLOOR.templates);

  function syntheticWorld(campedCarriers: number, tag = TAG): HarvestWorld {
    const mobs: Record<string, MobTemplate> = {};
    const camps: CampDef[] = [];
    for (const [i, shape] of INSTANCE_SHAPES.entries()) {
      const mob = structuredClone(MOBS[shape]);
      mob.id = `synthetic_instance_${i}`;
      mob.componentTags = [tag];
      mobs[mob.id] = mob;
    }
    for (let i = 0; i < campedCarriers; i++) {
      const zone = HUB_ZONES[i % HUB_ZONES.length];
      const mob = structuredClone(MOBS.forest_wolf);
      mob.id = `synthetic_camped_${i}`;
      mob.minLevel = zone.levelRange[0];
      mob.maxLevel = zone.levelRange[1];
      mob.componentTags = [tag];
      mobs[mob.id] = mob;
      camps.push({ mobId: mob.id, center: { x: zone.hub.x, z: zone.hub.z }, radius: 4, count: 1 });
    }
    return { mobs, camps, zones: ZONES, zoneOf: zoneAt };
  }

  it('the fixture is what it claims: the instance shapes have no live camp, the hubs resolve', () => {
    for (const shape of INSTANCE_SHAPES) {
      expect(
        CAMPS.some((camp) => camp.mobId === shape),
        `${shape} has a CAMPS row`,
      ).toBe(false);
    }
    expect(HUB_ZONES.length).toBe(REACH_FLOOR.templates);
    for (const zone of HUB_ZONES) expect(zoneAt(zone.hub.x, zone.hub.z).id).toBe(zone.id);
    expect(
      new Set(HUB_ZONES.map((zone) => levelBandOf(zone.levelRange[0]))).size,
    ).toBeGreaterThanOrEqual(REACH_FLOOR.bands);
  });

  it('FAILS a family whose count clears the floor only by counting instance-only carriers', () => {
    const world = syntheticWorld(REACH_FLOOR.templates - 1);
    // Membership would pass: five camped plus three instance-only is eight.
    expect(carriersOf(TAG, world).length).toBeGreaterThanOrEqual(REACH_FLOOR.templates);
    const short = floorShortfalls([TAG], world);
    expect(short).toHaveLength(1);
    // The short-of clause names the family and EXACTLY the templates
    // dimension: zones and bands clear the floor by construction, so a
    // "zones" or "bands" entry in the clause would mean the fixture, not
    // the predicate, produced the red.
    expect(short[0]).toMatch(
      new RegExp(
        `^${TAG} is short of the masterwrought R22 floor over the REACHABLE subset: ` +
          `templates ${REACH_FLOOR.templates - 1} of ${REACH_FLOOR.templates}\\. Reachable carriers`,
      ),
    );
    expect(short[0]).toContain('synthetic_instance_0');
    expect(familyReach(TAG, world).unreachable).toEqual([
      'synthetic_instance_0',
      'synthetic_instance_1',
      'synthetic_instance_2',
    ]);
  });

  it('PASSES the same family once six camped overworld carriers exist (positive control)', () => {
    const world = syntheticWorld(REACH_FLOOR.templates);
    expect(floorShortfalls([TAG], world)).toEqual([]);
    const reach = familyReach(TAG, world);
    expect(reach.reachable).toHaveLength(REACH_FLOOR.templates);
    expect(reach.zones.length).toBeGreaterThanOrEqual(REACH_FLOOR.zones);
    expect(reach.bands.length).toBeGreaterThanOrEqual(REACH_FLOOR.bands);
  });

  it('a carrier whose only camp sits on the instance plane does not count either', () => {
    // A CAMPS row is necessary but not sufficient: the row's center has to
    // be an overworld position. A sixth carrier camped at a dungeon origin
    // leaves the family short exactly as if it had no camp at all.
    const world = syntheticWorld(REACH_FLOOR.templates - 1);
    const mob = structuredClone(MOBS.forest_wolf);
    mob.id = 'synthetic_plane_camper';
    mob.componentTags = [TAG];
    const origin = instanceOrigin(0, 0);
    const mobs = { ...world.mobs, [mob.id]: mob };
    const camps = [
      ...world.camps,
      { mobId: mob.id, center: { x: origin.x, z: origin.z }, radius: 4, count: 1 },
    ];
    const planeWorld = { ...world, mobs, camps };
    const short = floorShortfalls([TAG], planeWorld);
    expect(short).toHaveLength(1);
    expect(short[0]).toContain(
      `templates ${REACH_FLOOR.templates - 1} of ${REACH_FLOOR.templates}`,
    );
    expect(familyReach(TAG, planeWorld).unreachable).toContain('synthetic_plane_camper');
  });

  it('judges two tags that share one item separately: the floor is per TAG', () => {
    // horn and tusk both map to curved_tusk after 11m-ORPHAN, so an
    // item-keyed count would let tusk's carriers satisfy horn. Here one tag
    // has six camped carriers and its item-twin has none; only the twin
    // reds, and it reds at zero.
    const twin = 'synthetic_scute_twin';
    const world = syntheticWorld(REACH_FLOOR.templates);
    const short = floorShortfalls([TAG, twin], world);
    expect(short).toHaveLength(1);
    expect(short[0]).toMatch(
      new RegExp(`^${twin} is short of .*: templates 0 of ${REACH_FLOOR.templates}, zones 0 of`),
    );
  });
});

describe('the never-mapped synthetic families the corpse-harvest corpus uses', () => {
  it('are absent from the yield map and carried by no shipped template', () => {
    // The corpus (tests/corpse_harvest_*.test.ts via tests/helpers/unmapped_family.ts)
    // needs two families that are unmapped BY CONSTRUCTION, so it can test the
    // refused-pick and forfeited-breadth paths without borrowing gills or horn,
    // which 11m-ORPHAN maps. If either ever lands in the map or on a template,
    // the corpus's premise silently inverts; this is the pin that says so.
    expect(UNMAPPED_FAMILY).not.toBe(UNMAPPED_FAMILY_2);
    for (const family of [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2]) {
      expect(HARVEST_COMPONENT_ITEMS[family], `${family} is mapped`).toBeUndefined();
      expect(
        carriersOf(family, LIVE_WORLD).map((mob) => mob.id),
        `${family} carriers`,
      ).toEqual([]);
    }
    // Non-vacuity: the same lookup finds real carriers for a real family, so
    // the empty result above is a measurement and not a lookup that matches nothing.
    expect(carriersOf(MAPPED_TAGS[0], LIVE_WORLD).length).toBeGreaterThan(0);
  });
});
