// Zone 1 — Eastbrook Vale (levels 1-7). The starter zone: town of Eastbrook,
// wolves and boars, the bandit camp, and Brother Aldric's Gravecaller chain
// leading to the Hollow Crypt.

import {
  EASTBROOK_LAYOUT,
  EASTBROOK_NPC_PLACEMENTS_BY_ID,
  wallSegmentMirrored,
} from '../eastbrook_layout';
import { WORK_ORDER_CADENCE_TICKS } from '../professions/cadence';
import type {
  CampDef,
  GroundObjectDef,
  HeightStamp,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';

export const TOWN_RADIUS = 26;
export const GRAVEYARD_POS = { ...EASTBROOK_LAYOUT.services.graveyard.legacyReleasePoint };
// The Copper Dig's phase 0b home: northeast of the Wolf Run on the Mirefen
// road, on the rise beyond Mirror Lake's northeast shore (the New Eastbrook
// program, docs/design/eastbrook-revamp/master-plan.md). This level stamp
// authors the working grade (the jail cage pad precedent); its taper drains
// the lake's shallow northeast blend apron by design (the diggers' spoil
// ground), while the declared lake circle stays fully wet: verified against
// applyStamp over every sub-waterline cell inside LAKE.radius. Radius covers
// the kobold scatter disc, all six ore veins, and Grix's camp.
export const COPPER_DIG_TERRAIN_EDITS: HeightStamp[] = [
  { x: -32, z: 144, radius: 64, delta: -1.2, falloff: 'smooth', mode: 'level' },
];

// The harbor-town plat: grading for New Eastbrook's reserved basin footprint
// (master plan section 7). The basin lobes in world.ts VALE_LAND_LOBES hold
// the ground out of the sea; these level stamps take the lobe bulges down to
// town grade so the plat reads as buildable coastal shelf. Street- and
// pad-level grading lands with the measured site plan; this is the plat.
export const TOWN_PLAT_TERRAIN_EDITS: HeightStamp[] = [
  { x: -14, z: -112, radius: 80, delta: -1.0, falloff: 'smooth', mode: 'level' },
  { x: -48, z: -126, radius: 46, delta: -0.8, falloff: 'smooth', mode: 'level' },
];

// The plat's beach apron (owner direction 2026-08-18: no cliff edges, smooth
// beach shores). A row of wide, low level stamps centered on the waterline
// arc pulls the last ~25yd of land down through the shore band (-4.3 to
// -2.7) and eases the first ~15yd of seabed up to a wading shelf, so the
// coast reads as beach the whole way. Applied after the plat stamps (array
// order is application order), tuned against the shore profile probe:
// slope through the band stays under 0.2 and the beach band runs 12yd plus
// at every sampled x. Sea cells under a stamp stay sea (verified: below
// waterline ground inside a stamp still reads water -4.3).
// The harbor quay (wave A of the site plan): a flat-falloff pad at working
// grade fronting the carved cove, read as a built edge (the quay wall props
// face the drop in the dock wave), with a smooth approach blend from the
// flank so the walk onto the pad never exceeds the movement slope gate.
// The flat stamps stop at x -99; the cove's water starts near x -102, so
// no wet cell is lifted (the Mirror Lake lesson).
export const EASTBROOK_QUAY_TERRAIN_EDITS: HeightStamp[] = [
  { x: -84, z: -54, radius: 18, delta: -1.9, falloff: 'smooth', mode: 'level' },
  { x: -92, z: -46, radius: 13, delta: -2.0, falloff: 'smooth', mode: 'level' },
  { x: -92, z: -54, radius: 13, delta: -2.0, falloff: 'smooth', mode: 'level' },
  { x: -92, z: -62, radius: 13, delta: -2.0, falloff: 'smooth', mode: 'level' },
  { x: -88, z: -67, radius: 10, delta: -2.0, falloff: 'smooth', mode: 'level' },
  { x: -92, z: -46, radius: 7, delta: -2.0, falloff: 'flat', mode: 'level' },
  { x: -92, z: -54, radius: 7, delta: -2.0, falloff: 'flat', mode: 'level' },
  { x: -92, z: -62, radius: 7, delta: -2.0, falloff: 'flat', mode: 'level' },
  // Round 6: a narrow graded strip under the quay boardwalk itself. A berm ran
  // along x -99 and punched up THROUGH the planks (groundHeight takes the max
  // of terrain and deck surface, so the player walked over a dirt hump in the
  // middle of the boardwalk and the boards drew underground). Radius 4.5 keeps
  // every stamp east of x -103.5, clear of the cove water near x -104, so no
  // wet cell is lifted.
  { x: -98.5, z: -40, radius: 4, delta: -2.0, falloff: 'flat', mode: 'level' },
  { x: -98.5, z: -46, radius: 4, delta: -2.0, falloff: 'flat', mode: 'level' },
  { x: -98.5, z: -52, radius: 4, delta: -2.0, falloff: 'flat', mode: 'level' },
  { x: -98.5, z: -58, radius: 4, delta: -2.0, falloff: 'flat', mode: 'level' },
  { x: -98.5, z: -64, radius: 4, delta: -2.0, falloff: 'flat', mode: 'level' },
  { x: -98.5, z: -70, radius: 4, delta: -2.0, falloff: 'flat', mode: 'level' },
];

// Sandy shoreline around the harbor cove's rims near the town (owner
// refinement): narrow aprons pulled into the shore band so the splat reads
// sand where the town meets the water, north and south of the quay.
export const HARBOR_SAND_TERRAIN_EDITS: HeightStamp[] = [
  { x: -99, z: -37, radius: 9, delta: -3.4, falloff: 'smooth', mode: 'level' },
  { x: -100, z: -71, radius: 9, delta: -3.4, falloff: 'smooth', mode: 'level' },
];

// Round 3 (owner): the sea now starts a dozen yards below the town's south
// lots, so the strand is a NARROW apron riding the new lobe line, not a wide
// shelf. Each stamp centers ~8yd north of the local open-sea line with a
// radius that dies before the nearest building pad (the tight middle stretch
// runs small radii on purpose: the toolworks lot is 4-9yd from the line
// there, and the natural field slope already reads as beach).
export const SOWFIELD_BEACH_TERRAIN_EDITS: HeightStamp[] = [
  { x: -66, z: -139, radius: 13, delta: -3.6, falloff: 'smooth', mode: 'level' },
  { x: -54, z: -138, radius: 14, delta: -3.9, falloff: 'smooth', mode: 'level' },
  { x: -42, z: -136, radius: 14, delta: -4.0, falloff: 'smooth', mode: 'level' },
  { x: -30, z: -135, radius: 13, delta: -4.0, falloff: 'smooth', mode: 'level' },
  { x: -23, z: -136, radius: 10, delta: -4.0, falloff: 'smooth', mode: 'level' },
  { x: -8, z: -131, radius: 7, delta: -3.9, falloff: 'smooth', mode: 'level' },
  { x: 4, z: -130, radius: 9, delta: -3.9, falloff: 'smooth', mode: 'level' },
  { x: 16, z: -132, radius: 11, delta: -3.9, falloff: 'smooth', mode: 'level' },
  { x: 28, z: -136, radius: 12, delta: -3.9, falloff: 'smooth', mode: 'level' },
  { x: 40, z: -137, radius: 13, delta: -3.9, falloff: 'smooth', mode: 'level' },
];

// The seabed apron: the wide plat stamps above still reach past the coast
// and would hold a dry shelf inside cells the (un-stamped) field already
// calls open sea. This row rides ~5yd SOUTH of the field's sea line and
// takes the stamped ground below the waterline there, so the water you see
// starts where the sea actually is. Applied after the beach row (order is
// application order); every center sits in open-sea cells, so no dry land
// is ever pulled wet (the stamps-never-create-water rule is about the field,
// which this row does not touch).
export const SOWFIELD_SEABED_TERRAIN_EDITS: HeightStamp[] = [
  { x: -66, z: -152, radius: 13, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: -54, z: -150, radius: 13, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: -42, z: -148, radius: 13, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: -30, z: -148, radius: 13, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: -20, z: -146, radius: 13, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: -10, z: -142, radius: 12, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: 0, z: -137, radius: 11, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: 10, z: -140, radius: 12, delta: -5.2, falloff: 'smooth', mode: 'level' },
  { x: 20, z: -146, radius: 13, delta: -5.2, falloff: 'smooth', mode: 'level' },
];
// Flower drifts beside the lamplit town streets (owner refinement round 3).
// The renderer's grass ring treats these circles as guaranteed bloom cells
// (the REALM_FLOWER_MEADOWS mechanism); placement inside them still skips
// water, steep ground, and roads, so the drifts read as blooming verges.
export const ZONE1_FLOWER_MEADOWS: { x: number; z: number; r: number }[] = [
  { x: -22, z: -100, r: 7 }, // the civic green, west of the square
  // Round 6c (owner): the boar meadow at the west road's end blooms, so the
  // walk out of town pays off in ground cover rather than plain grass
  { x: 52, z: -62, r: 9 },
  { x: 66, z: -79, r: 8 },
  { x: 47, z: -80, r: 7 },
  { x: -4, z: -73, r: 8 }, // the chapel rise, blooms among the headstones
  { x: -36, z: -103, r: 6 }, // the main-street verge by the market home
  { x: -6, z: -116, r: 6 }, // the beach promenade's east verge
  // Owner refinement round 4: the Wolf Run reads green meadow, not strand.
  { x: -6, z: 2, r: 9 },
  { x: 14, z: -18, r: 8 },
  { x: 4, z: 14, r: 8 },
];

// Basin carved into the heightfield. Pushed to the far northeast so its
// shoreline meets the fishing dock and the murloc camp instead of drowning them.
export const LAKE = { x: -92, z: 88, radius: 30 };

export const ZONE1_ZONE: ZoneDef = {
  id: 'eastbrook_vale',
  name: 'Eastbrook Vale',
  zMin: -180,
  zMax: 180,
  levelRange: [1, 7],
  biome: 'vale',
  hub: { x: -14, z: -100, radius: TOWN_RADIUS, name: 'Eastbrook' },
  graveyard: GRAVEYARD_POS,
  lakes: [LAKE],
  pois: [
    { x: -14, z: -102, label: 'Eastbrook', id: 'eastbrook' },
    { x: 2, z: -4, label: 'Wolf Run', id: 'wolf_run' },
    // follows the boars to their new downs (round 6 swap, then the westward push)
    // pulled off the causeway's latitude: both labels sat at z -46 and the
    // world map drew them on the same line, overlapping
    { x: 60, z: -64, label: 'Boar Meadow', id: 'boar_meadow' },
    { x: -88, z: 82, label: 'Mirror Lake', id: 'mirror_lake' },
    { x: -60, z: 4, label: 'Sableweb', id: 'sableweb' },
    { x: -34, z: 142, label: 'Copper Dig', id: 'copper_dig' },
    // stays with Gorrak's camp, which did not move in the round 6 swap
    { x: 98, z: 28, label: 'Bandit Camp', id: 'bandit_camp' },
    { x: 80, z: 80, label: 'Fallen Chapel', id: 'fallen_chapel' },
    { x: -136, z: 112, label: 'Reliquary Hill', id: 'reliquary_hill' },
    { x: 40, z: 140, label: 'Brightwood Glade', id: 'brightwood_glade' },
    // The stadium is demolished and the ground is town now, so the label stops
    // drawing. The RECORD stays: the shipped exp_vale_wayfarer deed counts a
    // visit to this id, and the deeds catalog is append-only, so deleting the
    // entry would strand a frozen trigger.
    { x: -11, z: -112, label: 'The Sowfield', id: 'the_sowfield', hideOnMap: true },
    { x: 150, z: -46, label: 'The Farshore Causeway', id: 'the_farshore_causeway' },
    // APPENDED, never inserted: poi labels resolve through positional locale
    // keys, so a mid-list insert renumbers every later landmark's translation.
    { x: -101, z: -54, label: 'Eastbrook Docks', id: 'eastbrook_docks' },
  ],
  welcome: 'Find Marshal Redbrook in town - he has work for you.',
  welcomeQuestId: 'q_wolves',
};

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

export const ZONE1_MOBS: Record<string, MobTemplate> = {
  warlock_imp: {
    id: 'warlock_imp',
    name: 'Fire Demon',
    minLevel: 1,
    maxLevel: 20,
    family: 'demon',
    hpBase: 24,
    hpPerLevel: 11,
    dmgBase: 2,
    dmgPerLevel: 0.7,
    attackSpeed: 2.0,
    armorPerLevel: 5,
    moveSpeed: 8,
    aggroRadius: 0,
    loot: [],
    scale: 0.65,
    color: 0xff5a2e,
    petRole: 'ranged_dps',
    petSpell: { name: 'Ashbolt', school: 'fire', min: 8, max: 11, range: 24, every: 2.0 },
  },
  warlock_voidwalker: {
    id: 'warlock_voidwalker',
    name: 'Void Demon',
    minLevel: 10,
    maxLevel: 20,
    family: 'demon',
    hpBase: 95,
    hpPerLevel: 24,
    dmgBase: 3,
    dmgPerLevel: 1.0,
    attackSpeed: 2.4,
    armorPerLevel: 28,
    moveSpeed: 7.2,
    aggroRadius: 0,
    loot: [],
    scale: 0.9,
    color: 0x6b4bb5,
    petRole: 'melee_tank',
  },
  forest_wolf: {
    id: 'forest_wolf',
    name: 'Forest Wolf',
    minLevel: 1,
    maxLevel: 2,
    family: 'beast',
    hpBase: 40,
    hpPerLevel: 14,
    dmgBase: 3,
    dmgPerLevel: 1.6,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 8,
    aggroRadius: 10,
    loot: [
      { copper: 8, chance: 1 },
      { itemId: 'wolf_fang', chance: 0.45 },
      { itemId: 'milepost_boots', chance: 0.017 },
      { itemId: 'wolfhide_satchel', chance: 0.003 },
    ],
    scale: 0.9,
    color: 0x7f8c8d,
    packFrenzy: { radius: 12, hasteMult: 1.3, duration: 8 },
    componentTags: ['hide', 'fang'],
  },
  old_greyjaw: {
    id: 'old_greyjaw',
    name: 'Old Greyjaw',
    minLevel: 4,
    maxLevel: 4,
    family: 'beast',
    rare: true,
    hpBase: 110,
    hpPerLevel: 20,
    dmgBase: 5,
    dmgPerLevel: 2.0,
    attackSpeed: 1.8,
    armorPerLevel: 16,
    moveSpeed: 8.5,
    aggroRadius: 12,
    // The old wolf turns savage as the fight wears on: each wound it takes can
    // send it into a blood frenzy, swinging 30% faster for 8s.
    frenzyOnHit: { chance: 0.25, hasteMult: 1.3, duration: 8, name: 'Blood Frenzy' },
    loot: [
      { copper: 60, chance: 1 },
      { itemId: 'greyjaw_fang', chance: 1, questId: 'q_greyjaw' },
      { itemId: 'wolf_fang', chance: 1 },
      { itemId: 'wolfhide_satchel', chance: 0.35 },
      { itemId: 'acolyte_chain_grips', chance: 0.25 },
    ],
    scale: 1.25,
    color: 0x566061,
    componentTags: ['hide', 'fang', 'claw'],
  },
  wild_boar: {
    id: 'wild_boar',
    name: 'Wild Boar',
    minLevel: 2,
    maxLevel: 3,
    family: 'beast',
    hpBase: 38,
    hpPerLevel: 16,
    dmgBase: 4,
    dmgPerLevel: 1.8,
    attackSpeed: 2.2,
    armorPerLevel: 14,
    moveSpeed: 7.5,
    aggroRadius: 9,
    // Stiff bristles prick anyone who melees the boar.
    thorns: { value: 2, name: 'Bristled Hide' },
    loot: [
      { copper: 12, chance: 1 },
      { itemId: 'boar_hide', chance: 0.6, questId: 'q_boars' },
      { itemId: 'tough_jerky', chance: 0.3 },
      { itemId: 'trail_leggings', chance: 0.02 },
    ],
    scale: 0.85,
    color: 0x935116,
    componentTags: ['hide', 'tusk', 'meat'],
  },
  webwood_spider: {
    id: 'webwood_spider',
    name: 'Sableweb Lurker',
    minLevel: 2,
    maxLevel: 4,
    family: 'spider',
    hpBase: 36,
    hpPerLevel: 15,
    dmgBase: 4,
    dmgPerLevel: 1.7,
    attackSpeed: 1.8,
    armorPerLevel: 8,
    moveSpeed: 8,
    aggroRadius: 10,
    venom: {
      chance: 0.35,
      perTick: 2,
      interval: 2,
      duration: 10,
      name: 'Spider Venom',
      school: 'nature',
    },
    ensnare: { chance: 0.25, duration: 3, name: 'Sticky Web', school: 'nature' },
    loot: [
      { copper: 14, chance: 1 },
      { itemId: 'webwood_silk', chance: 0.55, questId: 'q_spiders' },
      { itemId: 'spider_leg', chance: 0.4 },
      { itemId: 'mosshide_vest', chance: 0.02 },
    ],
    scale: 0.9,
    color: 0x4a235a,
    componentTags: ['venomSac', 'silk'],
  },
  mogger: {
    id: 'mogger',
    name: 'Mogger',
    minLevel: 6,
    maxLevel: 6,
    family: 'humanoid',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 4,
    hpBase: 300,
    hpPerLevel: 58,
    dmgBase: 12,
    dmgPerLevel: 3.5,
    attackSpeed: 2.2,
    armorPerLevel: 34,
    moveSpeed: 7.4,
    aggroRadius: 14,
    aoePulse: { min: 14, max: 20, radius: 8, every: 10, name: 'Ground Pound', school: 'physical' },
    summonAdds: { mobId: 'mogger_lackey', count: 2, atHpPct: [0.7] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.6, hasteMult: 1.3 },
    wardAllies: {
      radius: 12,
      every: 12,
      amount: 70,
      duration: 8,
      name: 'Bracing Order',
      school: 'physical',
    },
    loot: [
      { copper: 180, chance: 1 },
      { itemId: 'linen_scrap', chance: 1 },
      { itemId: 'moggers_stomper_boots', chance: 0.3 },
      { itemId: 'moggers_shiv', chance: 0.25, rollGroup: 'mogger_chase' },
      { itemId: 'cryptstalker_jerkin', chance: 0.25, rollGroup: 'mogger_chase' },
      { itemId: 'valefire_lantern', chance: 0.2 },
      // The hunter offhand rides its own independent roll beside the caster
      // lantern, so neither class's odds depend on the other's.
      { itemId: 'moggers_hide_quiver', chance: 0.2 },
    ],
    scale: 1.28,
    color: 0x8e5b33,
  },
  mogger_lackey: {
    id: 'mogger_lackey',
    name: 'Mogger Lackey',
    minLevel: 5,
    maxLevel: 6,
    family: 'humanoid',
    hpBase: 44,
    hpPerLevel: 18,
    dmgBase: 6,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 18,
    moveSpeed: 7.5,
    aggroRadius: 12,
    stunOnHit: { chance: 0.12, duration: 1, name: 'Skullthump', school: 'physical' },
    loot: [],
    scale: 0.95,
    color: 0x7b4b2b,
  },
  mudfin_murloc: {
    id: 'mudfin_murloc',
    name: 'Mudfin Skulker',
    minLevel: 3,
    maxLevel: 5,
    family: 'mudfin',
    hpBase: 36,
    hpPerLevel: 17,
    dmgBase: 5,
    dmgPerLevel: 1.9,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 13, // murlocs aggro from far and bring friends
    loot: [
      { copper: 18, chance: 1 },
      { itemId: 'mudfin_scale', chance: 0.5 },
      { itemId: 'linen_scrap', chance: 0.2 },
    ],
    scale: 0.8,
    color: 0x52be80,
    componentTags: ['gills', 'hide'],
    // Mudfin Hex: the skulker's oracle-chant briefly turns a foe into a critter.
    // Low chance and it breaks the instant the victim takes damage (the murloc's
    // own next bite ends it), so it's a brief flavor incap — but a murloc pack
    // can chain it just long enough to make a careless pull dangerous.
    polymorphHex: { chance: 0.12, duration: 4, name: 'Mudfin Hex', school: 'nature' },
  },
  tunnel_rat: {
    id: 'tunnel_rat',
    name: 'Deeprock Digger',
    minLevel: 4,
    maxLevel: 6,
    family: 'burrower',
    hpBase: 42,
    hpPerLevel: 18,
    dmgBase: 6,
    dmgPerLevel: 2.0,
    attackSpeed: 2.1,
    armorPerLevel: 16,
    moveSpeed: 7,
    aggroRadius: 10,
    loot: [
      { copper: 22, chance: 1 },
      { itemId: 'tallow_candle', chance: 0.6 },
      { itemId: 'blessed_wax', chance: 0.45, questId: 'q_rite' },
      { itemId: 'linen_scrap', chance: 0.25 },
      { itemId: 'mossy_handwraps', chance: 0.01 },
      { itemId: 'thornling_grips', chance: 0.01 },
    ],
    scale: 0.85,
    color: 0x9c640c,
  },
  grix_the_tunnelking: {
    id: 'grix_the_tunnelking',
    name: 'Grix the Tunnelking',
    minLevel: 7,
    maxLevel: 7,
    family: 'burrower',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    // Random respawn window, drawn fresh per death: 36 to 72 times the 25s base
    // is 15 to 30 minutes (was a fixed 432, three hours).
    //
    // WHY THE CADENCE MOVED. A level 7 named miniboss is content for players
    // passing through Zone 1, and an experienced player solos an account to cap
    // in about four hours, so a three-hour timer meant most of his audience
    // never saw him at all. WHY THIS WINDOW. Zone 1's rare ladder runs from
    // Mogger and Old Greyjaw at 4x (100s) up to Wraithbinder Maldrec at 432x
    // (three hours); the geometric midpoint of that span is about 42x, and this
    // window brackets it. Grix stays strictly rarer than the plain rares and far
    // rarer than trash, while a Zone 1 visit now contains two to four of his
    // spawns instead of a fraction of one. The randomness is separate and is
    // what stops the camp being clock-farmed.
    respawnWindow: { minMult: 36, maxMult: 72 },
    hpBase: 280,
    hpPerLevel: 52,
    dmgBase: 11,
    dmgPerLevel: 3.3,
    attackSpeed: 2.0,
    armorPerLevel: 24,
    moveSpeed: 7,
    aggroRadius: 13,
    // Hard tether: the Tunnelking fights on his own ground. Kiting him past 50
    // yards of his spawn (the town square is 100+) sends him home to a full
    // reset, adds swept with him.
    hardLeashRadius: 50,
    aoePulse: { min: 12, max: 18, radius: 8, every: 9, name: 'Cave-In', school: 'physical' },
    summonAdds: { mobId: 'tunnel_rat', count: 2, atHpPct: [0.55, 0.3] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 150, chance: 1 },
      { itemId: 'tallow_candle', chance: 1 },
      // The hoarder's stash — a guaranteed step up the potion ladder this early.
      { itemId: 'lesser_healing_potion', chance: 1 },
      { itemId: 'tunnelkings_spade', chance: 0.3 },
      { itemId: 'moggers_copper_cudgel', chance: 0.25, rollGroup: 'grix_tunnelking_chase' },
      { itemId: 'hollowbone_hauberk', chance: 0.25, rollGroup: 'grix_tunnelking_chase' },
      { itemId: 'briarroot_staff', chance: 0.3 },
    ],
    // Half again the Deeprock Diggers he summons (tunnel_rat scale 0.85 x 1.5),
    // up from 1.15. Not purely cosmetic: mob_combat's scaledDefaultMobMeleeRange
    // adds 3 yd of reach per unit of scale ABOVE 1, so this widens his melee
    // reach by 0.375 yd (and desiredRange, which is 0.8x of it) as well as his
    // silhouette. That is the intended read for a rare elite standing in a pack
    // of its own adds; it is also why this is a parity-affecting change.
    scale: 1.275,
    color: 0xb9770e,
  },
  vale_bandit: {
    id: 'vale_bandit',
    name: 'Vale Bandit',
    minLevel: 3,
    maxLevel: 5,
    family: 'humanoid',
    hpBase: 40,
    hpPerLevel: 18,
    dmgBase: 5,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 11,
    loot: [
      { copper: 25, chance: 1 },
      { itemId: 'bandit_bandana', chance: 0.5 },
      { itemId: 'linen_scrap', chance: 0.3 },
    ],
    scale: 1.0,
    color: 0x943126,
    // A practiced thug flings a handful of road grit to foul your aim.
    blind: { chance: 0.25, miss: 0.3, duration: 5, name: 'Blinding Powder', school: 'physical' },
    componentTags: ['cloth'],
  },
  restless_bones: {
    id: 'restless_bones',
    name: 'Restless Bones',
    minLevel: 5,
    maxLevel: 7,
    family: 'undead',
    hpBase: 46,
    hpPerLevel: 19,
    dmgBase: 7,
    dmgPerLevel: 2.1,
    attackSpeed: 2.3,
    armorPerLevel: 14,
    moveSpeed: 6.5,
    aggroRadius: 11,
    loot: [
      { copper: 30, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.6 },
      { itemId: 'ghostly_essence', chance: 0.55, questId: 'q_rite' },
      { itemId: 'restless_skull', chance: 1, questId: 'q_bones' },
    ],
    scale: 1.0,
    color: 0xd5dbdb,
    // A grave-cold wail saps the strength from the living it strikes.
    demoralize: { ap: 20, duration: 8, name: 'Withering Wail' },
    // Grave-touch: a clawing swing may fester a creeping necrotic rot (shadow DoT).
    soulrot: { chance: 0.25, perTick: 4, interval: 3, duration: 12, name: 'Soulrot' },
  },
  captain_verlan: {
    // A rare named undead champion risen among the ruins' Restless Bones —
    // the undead family's rare elite, filling the gap beside Old Greyjaw
    // (beast), Elder Bristleback (beast), Sableweb Matriarch (spider) and
    // Mogger (humanoid). A heavy, slow striker that erupts in a shadow nova
    // and goes berserk when low; loot mirrors the other rare elites.
    id: 'captain_verlan',
    name: 'Captain Verlan',
    minLevel: 7,
    maxLevel: 7,
    family: 'undead',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 280,
    hpPerLevel: 56,
    dmgBase: 12,
    dmgPerLevel: 3.4,
    attackSpeed: 2.6,
    armorPerLevel: 32,
    moveSpeed: 7.4,
    aggroRadius: 13,
    aoePulse: {
      min: 13,
      max: 19,
      radius: 9,
      every: 9,
      name: 'Hollow Nova',
      school: 'shadow',
      fx: 'nova',
    },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 160, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
      { itemId: 'oathbound_greaves', chance: 0.3 },
      { itemId: 'verlans_oathblade', chance: 0.25, rollGroup: 'verlan_chase' },
      { itemId: 'hollow_vigil_staff', chance: 0.25, rollGroup: 'verlan_chase' },
      { itemId: 'gravewardens_shiv', chance: 0.25, rollGroup: 'verlan_chase' },
    ],
    scale: 1.26,
    color: 0x3b4a5a,
  },
  wraithbinder_maldrec: {
    id: 'wraithbinder_maldrec',
    name: 'Wraithbinder Maldrec',
    minLevel: 7,
    maxLevel: 7,
    family: 'undead',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 432,
    hpBase: 320,
    hpPerLevel: 60,
    dmgBase: 12,
    dmgPerLevel: 3.4,
    attackSpeed: 2.3,
    armorPerLevel: 28,
    moveSpeed: 6.8,
    aggroRadius: 13,
    // A fallen Gravecaller who bound his own soul to the chapel dead. A pulse of
    // grave-cold shadow rolls off him, and he tears the restless bones from the
    // ground to fight at his side, growing frantic as he is unmade.
    aoePulse: { min: 13, max: 19, radius: 9, every: 9, name: 'Grave Chill', school: 'shadow' },
    summonAdds: { mobId: 'restless_bones', count: 2, atHpPct: [0.65, 0.35] },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      { copper: 160, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
      { itemId: 'maldrecs_soulbinder', chance: 0.25 },
      { itemId: 'hollowbone_hauberk', chance: 0.25, rollGroup: 'maldrec_chase' },
      { itemId: 'gravewoven_raiment', chance: 0.25, rollGroup: 'maldrec_chase' },
      { itemId: 'cryptstalker_jerkin', chance: 0.25, rollGroup: 'maldrec_chase' },
    ],
    scale: 1.22,
    color: 0x6f7f8f,
  },
  gorrak: {
    id: 'gorrak',
    name: 'Gorrak the Ruthless',
    minLevel: 6,
    maxLevel: 6,
    family: 'humanoid',
    hpBase: 160,
    hpPerLevel: 30,
    dmgBase: 8,
    dmgPerLevel: 2.4,
    attackSpeed: 2.4,
    armorPerLevel: 30,
    moveSpeed: 7,
    aggroRadius: 13,
    boss: true,
    loot: [
      { copper: 250, chance: 1 },
      { itemId: 'bandit_bandana', chance: 1 },
      { itemId: 'oiled_boots', chance: 0.5 },
      { itemId: 'quilted_trousers', chance: 0.5 },
      { itemId: 'gorraks_cruel_chopper', chance: 0.25 },
      { itemId: 'gorraks_cleaver', chance: 0.3 },
      { itemId: 'votive_chain_belt', chance: 0.3 },
    ],
    scale: 1.25,
    color: 0x6c3483,
  },
};

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

export const ZONE1_NPCS: Record<string, NpcDef> = {
  the_merchant: {
    id: 'the_merchant',
    name: 'The Merchant',
    title: 'Keeper of the World Market',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.the_merchant.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.the_merchant.facing,
    color: 0xd4af37,
    questIds: [],
    market: true,
    greeting:
      'Welcome to the World Market, $C. Buy from every adventurer in the realm — or set out your own wares and let coin find you.',
  },
  marshal_redbrook: {
    id: 'marshal_redbrook',
    name: 'Marshal Redbrook',
    title: 'Town Marshal',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.facing,
    color: 0xb7950b,
    questIds: ['q_wolves', 'q_greyjaw', 'q_bandits', 'q_ringleader', 'q_mogger'],
    greeting: 'Keep your blade close, $C. The Vale is not what it was.',
  },
  trader_wilkes: {
    id: 'trader_wilkes',
    name: 'Trader Wilkes',
    title: 'Provisioner',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.trader_wilkes.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.trader_wilkes.facing,
    color: 0x1e8449,
    questIds: ['q_boars', 'q_supplies'],
    vendorItems: [
      'baked_bread',
      'spring_water',
      'roasted_boar',
      'tough_jerky',
      'minor_healing_potion',
      'minor_mana_potion',
      'linen_pouch',
      'travelers_knapsack',
      // Gathering tools, TIER 1 ONLY (#2343's rule: each zone hub stocks the
      // tiers its own nodes use). Eastbrook is entirely tier-1 ground, so a
      // tier-2 or tier-3 land tool opens nothing here; the marsh and the peaks
      // sell the rungs their own veins need, and this counter used to be the
      // one place in the world that sold the whole ladder at the front door.
      // The tiered rods stay, and Wilkes is now the one counter carrying the
      // WHOLE rod ladder rather than the only one carrying any of it: each
      // zone's water has a required rod tier of its own now
      // (professions/fishing_zones.ts), so the marsh and the peaks stock the
      // rung they ask for and this counter is where you buy ahead.
      'copper_mining_pick',
      'handaxe',
      'gathering_sickle',
      'ironreel_fishing_rod',
      'silverstream_fishing_rod',
      // The one materials-only satchel a vendor stocks, sold beside the two
      // general pouches above so the two-pool trade is legible at the counter.
      'burlap_reagent_pouch',
    ],
    greeting: 'Fresh bread, clean water, fair prices. What can I get you?',
  },
  apothecary_lin: {
    id: 'apothecary_lin',
    name: 'Apothecary Lin',
    title: 'Herbalist',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.apothecary_lin.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.apothecary_lin.facing,
    color: 0x7d3c98,
    questIds: ['q_spiders'],
    greeting: 'Careful where you step in the northeastern woods, friend.',
  },
  brother_aldric: {
    id: 'brother_aldric',
    name: 'Brother Aldric',
    title: 'Priest of the Vale',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.brother_aldric.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.brother_aldric.facing,
    color: 0xf7f9f9,
    questIds: [
      'q_bones',
      'q_whispers',
      'q_names_of_the_dead',
      'q_silence_the_call',
      'q_rite',
      'q_sexton',
      'q_hollow',
      'q_gravecallers_trail',
      'q_divine_tome',
      'q_fenbridge_muster',
    ],
    greeting: 'The Light keep you. Even the dead find no rest here of late.',
  },
  smith_haldren: {
    id: 'smith_haldren',
    name: 'Smith Haldren',
    title: 'Armorer & Weaponsmith',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.smith_haldren.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.smith_haldren.facing,
    color: 0x707b7c,
    questIds: ['q_prof_hobby_switch'],
    vendorItems: [
      'eastbrook_arming_sword',
      'eastbrook_greatsword',
      'bronzework_mace',
      'vale_carving_knife',
      'hickory_shortstaff',
      'eastbrook_buckler',
      'eastbrook_chain_vest',
      'valespun_robe',
      'tanned_leather_jerkin',
      'hobnail_boots',
      'eastbrook_wool_trousers',
    ],
    greeting: 'Mind the sparks, $C. Good steel is the difference between a scar and a grave.',
  },
  fisherman_brandt: {
    id: 'fisherman_brandt',
    name: 'Fisherman Brandt',
    title: 'Old Salt',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.fisherman_brandt.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.fisherman_brandt.facing,
    color: 0x2471a3,
    questIds: ['q_murlocs'],
    vendorItems: ['simple_fishing_pole'],
    greeting: 'Blrb-glub— sorry, been listening to those fish-men too long.',
  },
  foreman_odell: {
    id: 'foreman_odell',
    name: 'Foreman Odell',
    title: 'Mine Foreman',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.foreman_odell.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.foreman_odell.facing,
    color: 0xa04000,
    questIds: ['q_prof_intro', 'q_mine'],
    greeting: "Whole dig's crawling with those dirt-caked vermin!",
  },
  bursar_fernando: {
    id: 'bursar_fernando',
    name: 'Bursar Fernando',
    title: 'The Gilded Strongbox',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.bursar_fernando.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.bursar_fernando.facing,
    color: 0xc9a227,
    questIds: [],
    banker: true,
    greeting: 'Welcome to the Gilded Strongbox. Your goods rest safe behind our locks.',
  },
  card_master: {
    id: 'card_master',
    name: 'Card Master',
    title: 'Dealer of Chance',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.card_master.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.card_master.facing,
    color: 0x7a2f8f,
    questIds: [],
    cardMaster: true,
    greeting: 'Care for a Card Duel? Best of three, winner takes the bragging rights.',
  },
  chronicler_saul: {
    id: 'chronicler_saul',
    name: 'Saul the Chronicler',
    title: 'The Vale Chronicle',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.chronicler_saul.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.chronicler_saul.facing,
    color: 0xd08a2e, // warm amber: the chronicler tint is his identity (shared mage visual)
    questIds: [],
    greeting:
      'Every deed worth doing is worth writing down twice, $N: once for the ledger and once for the fireside.',
  },
  // Crafting-station masters (Professions 2.0): each stands 1 to 3
  // units beside their station (content/professions.ts STATIONS) with a
  // guard-safe camp margin (pinned in tests/professions_station_placement.test.ts).
  forgemistress_darva: {
    id: 'forgemistress_darva',
    name: 'Forgemistress Darva',
    title: 'Master of the Forge',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.forgemistress_darva.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.forgemistress_darva.facing,
    color: 0xb5541c,
    // Professions 2.0: the Smith pair's anchor master. Attunement and
    // its escalating make-amends return live here now (moved off Smith Haldren),
    // plus the repeatable forge work order.
    questIds: ['q_prof_attune_smith', 'q_prof_amends_smith', 'q_prof_workorder_forge'],
    // Station stocking: the forge master sells the tools and the vendor-only
    // staple its station's recipes need. thorium_ore, the premium reagent
    // recipe_sootscale_mantle consumes, is NOT here: it is a node yield, and no
    // NPC stocks a gathered material (professions.md, Locked rulings). The
    // pick is tier 1 alone, the tier Eastbrook's own veins use; the higher
    // rungs moved to the hubs whose ground needs them.
    vendorItems: ['copper_mining_pick', 'smithing_flux'],
    greeting: 'The forge answers to me, $C. Bring good ore and it will answer to you too.',
  },
  cook_marlow: {
    id: 'cook_marlow',
    name: 'Cook Marlow',
    title: 'Master of the Kitchens',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.cook_marlow.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.cook_marlow.facing,
    color: 0xc98a4b,
    // Professions 2.0: the Apothecary pair's (alchemy + cooking) anchor
    // master. Attunement, make-amends return, and the repeatable kitchens work
    // order live here.
    questIds: ['q_prof_attune_apothecary', 'q_prof_amends_apothecary', 'q_prof_workorder_kitchens'],
    vendorItems: [
      'baked_bread',
      'spring_water',
      'roasted_boar',
      'tough_jerky',
      'brightwood_venison',
      'cooking_salt',
    ],
    greeting: 'Nothing leaves my kitchens half-cooked, $C. Sit, eat, then get back out there.',
  },
  weaver_ottilie: {
    id: 'weaver_ottilie',
    name: 'Weaver Ottilie',
    title: 'Master of the Loom',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.weaver_ottilie.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.weaver_ottilie.facing,
    color: 0x7161a8,
    // Professions 2.0: the Outfitter pair's (leatherworking + tailoring)
    // anchor master. Attunement, make-amends return, and the repeatable loom work
    // order live here.
    questIds: ['q_prof_attune_outfitter', 'q_prof_amends_outfitter', 'q_prof_workorder_loom'],
    // Station stocking: the loom master sells its own goods, the tier-1 sickle,
    // and the vendor-only thread staple. thorium_ore used to sit here as a
    // premium reagent; it is a node yield, and no NPC stocks a gathered
    // material (professions.md, Locked rulings).
    vendorItems: [
      'linen_pouch',
      'travelers_knapsack',
      'gathering_sickle',
      'spool_of_thread',
      'burlap_reagent_pouch',
    ],
    greeting: 'Mind the threads, $C. A steady hand at the loom beats a strong one.',
  },
  tinker_gizzel: {
    id: 'tinker_gizzel',
    name: 'Tinker Gizzel',
    title: 'Master of the Toolworks',
    pos: { ...EASTBROOK_NPC_PLACEMENTS_BY_ID.tinker_gizzel.position },
    facing: EASTBROOK_NPC_PLACEMENTS_BY_ID.tinker_gizzel.facing,
    color: 0xb08d57,
    // Professions 2.0: the Bombardier pair's (engineering + alchemy)
    // anchor master. Attunement, make-amends return, and the repeatable toolworks
    // work order live here.
    questIds: [
      'q_prof_attune_bombardier',
      'q_prof_amends_bombardier',
      'q_prof_workorder_toolworks',
    ],
    // Station stocking: the toolworks tools, plus arcanite_bar, the one premium
    // reagent TOOL_RECIPES consume that a counter may carry. The other five
    // (thorium_ore, ashwood_log, elderwood_log, goldleaf_herb, sunpetal_herb)
    // are node yields, and no NPC stocks a gathered material (professions.md,
    // Locked rulings): a tool above tier 3 is gathered up to, not bought.
    // Tier-1 implements only, the tier Eastbrook's own stands and patches use.
    // The tier-2 and tier-3 axes and sickles moved to the marsh and the peaks;
    // the tier-1 sickle still sits on Ottilie rather than here, the shipped
    // split between the two masters.
    vendorItems: ['handaxe', 'simple_fishing_pole', 'arcanite_bar'],
    greeting:
      'Springs, sprockets, and sharp edges, $C: the toolworks has whatever your hands lack.',
  },
};

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

export const ZONE1_QUESTS: Record<string, QuestDef> = {
  // Professions onboarding (issue #1701 follow-up): the very first quest a
  // new adventurer can take, no prerequisite and no minLevel gate (defaults
  // to available at level 1, same as q_wolves). Gathering/crafting/town focus
  // are otherwise entirely undiscoverable: nothing in the starting flow ever
  // points a new player at them (see the professions.ts GATHERING_PROFESSIONS
  // comment: no level/quest/tool gate exists at the mechanic level either, so
  // there was no natural "unlock" moment to hang a quest off before this).
  // A genuine gather objective credits successful ore-node harvests directly.
  // It deliberately does not target the node's shared bone_fragments output:
  // that material also drops from mobs, salvage, and the market, so inventory
  // ownership cannot prove that the player mined it. foreman_odell is the
  // existing mine-themed NPC (already gives q_mine), so this reuses him rather
  // than inventing a new trainer NPC.
  q_prof_intro: {
    id: 'q_prof_intro',
    name: 'A Trade for Every Hand',
    giverNpcId: 'foreman_odell',
    turnInNpcId: 'foreman_odell',
    text: "Every soul in Eastbrook works a trade besides the sword, $N. There are ore veins in the rocks around the Copper Dig, northeast of town past the wolf runs. Go swing a pick and work 5 of them yourself, mind; I'll know the difference.",
    completionText:
      "See? Ore gathered and callus on your hands. Keep at the mining, logging, and herb-picking as you travel the roads, and when you're back in town, mind the Town Focus board by the market and the crafting bench nearby. There's a fair trade waiting in all of it, if you want it.",
    objectives: [{ type: 'gather', nodeType: 'ore', count: 5, label: 'Ore vein harvested' }],
    xpReward: 150,
    copperReward: 50,
    itemRewards: {},
    // The quest says to go swing a pick, and under the always-require-tool rule
    // (#2343) a bare-handed harvest is denied outright. A new character starts
    // with zero copper, so the game's FIRST quest silently required a detour to
    // earn 20 copper and buy a pick before its objective could move at all (the
    // pick is a vendor staple, so this was a dead end only until the player
    // found that out). questFallbackGrants hands the pick over on accept and
    // re-grants it if it is ever lost, exactly like a prerequisite quest item.
    requiredItems: ['copper_mining_pick'],
  },
  q_wolves: {
    id: 'q_wolves',
    name: 'Wolves at the Door',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'The forest wolves grow bold, snapping at travelers on the north road. Thin their numbers, $N. Slay 8 Forest Wolves and Eastbrook will breathe easier.',
    completionText: 'Fine work. The road feels safer already.',
    objectives: [
      { type: 'kill', targetMobId: 'forest_wolf', count: 8, label: 'Forest Wolf slain' },
    ],
    xpReward: 250,
    copperReward: 75,
    itemRewards: {},
  },
  q_greyjaw: {
    id: 'q_greyjaw',
    name: 'The Old Wolf',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: "There is one wolf no trap has held: Old Greyjaw. He has taken three hounds and a stable boy's arm. He prowls the deep woods north of the wolf runs. Bring me his fang.",
    completionText:
      'So the old devil is dead at last. The stable boy will sleep easier — and so will I.',
    objectives: [
      { type: 'collect', itemId: 'greyjaw_fang', count: 1, label: "Old Greyjaw's Fang" },
    ],
    xpReward: 450,
    copperReward: 150,
    itemRewards: {
      warrior: 'greyjaw_pelt_cloak',
      mage: 'greyjaw_pelt_cloak',
      rogue: 'greyjaw_pelt_cloak',
    },
    requiresQuest: 'q_wolves',
  },
  q_boars: {
    id: 'q_boars',
    name: 'Bristly Boar Hides',
    giverNpcId: 'trader_wilkes',
    turnInNpcId: 'trader_wilkes',
    text: 'Boar hide makes the finest travel packs, and the meadows northwest of town are crawling with the beasts. Bring me 5 Bristly Boar Hides and I will make it worth your time.',
    completionText: 'Ah, fine bristly hides! These will fetch a good price.',
    objectives: [{ type: 'collect', itemId: 'boar_hide', count: 5, label: 'Bristly Boar Hide' }],
    xpReward: 350,
    copperReward: 120,
    itemRewards: {},
  },
  q_spiders: {
    id: 'q_spiders',
    name: 'Sableweb Menace',
    giverNpcId: 'apothecary_lin',
    turnInNpcId: 'apothecary_lin',
    text: 'The lurkers in the northeastern woods spin a silk I need for my poultices, and they have grown far too numerous besides. Cull 6 Sableweb Lurkers and cut 4 silk glands from their bellies.',
    completionText: "Ugh, still twitching. Perfect. Here, you've earned this.",
    objectives: [
      { type: 'kill', targetMobId: 'webwood_spider', count: 6, label: 'Sableweb Lurker slain' },
      { type: 'collect', itemId: 'webwood_silk', count: 4, label: 'Sableweb Silk Gland' },
    ],
    xpReward: 420,
    copperReward: 140,
    itemRewards: {},
    minLevel: 2,
  },
  q_murlocs: {
    id: 'q_murlocs',
    name: 'Trouble at the Lake',
    giverNpcId: 'fisherman_brandt',
    turnInNpcId: 'fisherman_brandt',
    text: 'Twenty years I have fished Mirror Lake, and never lost a net until those gurgling fish-men crawled out of the shallows. Drive the Mudfin back — slay 8 of them. And watch yourself: where there is one mudfin, there are five.',
    completionText: 'Hah! That will teach them to mind their own mudholes.',
    objectives: [
      { type: 'kill', targetMobId: 'mudfin_murloc', count: 8, label: 'Mudfin Skulker slain' },
    ],
    xpReward: 520,
    copperReward: 180,
    itemRewards: {},
    minLevel: 3,
  },
  q_mine: {
    id: 'q_mine',
    name: 'Rats in the Mine',
    giverNpcId: 'foreman_odell',
    turnInNpcId: 'foreman_odell',
    text: 'We struck a fine copper vein and then those burrowing vermin came boiling out of the hillside. My crew will not set foot in the dig until it is cleared. Put down 10 Deeprock Diggers.',
    completionText: 'Ha! Back to work, lads! You have my thanks — and my coin.',
    objectives: [
      { type: 'kill', targetMobId: 'tunnel_rat', count: 10, label: 'Deeprock Digger slain' },
    ],
    xpReward: 620,
    copperReward: 220,
    itemRewards: {},
    minLevel: 4,
  },
  q_bones: {
    id: 'q_bones',
    rev: 1, // objective rework (zones 1-3 dedupe): pre-rework in-flight runs reset on restore
    name: 'The Restless Dead',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'The old ruin on the northwest hill was a chapel once, and its yard a resting place. Something has stirred the dead from their sleep. Put them down and bring me a skull from each you lay to rest, $N, eight in all, so I may speak the rites over them and grant the peace they were denied.',
    completionText: 'May they rest now, and may the Light forgive whatever woke them.',
    objectives: [
      {
        type: 'collect',
        itemId: 'restless_skull',
        count: 8,
        label: 'Restless Skulls recovered',
      },
    ],
    xpReward: 700,
    copperReward: 260,
    itemRewards: {},
    minLevel: 5,
  },
  q_supplies: {
    id: 'q_supplies',
    name: 'Stolen Supplies',
    giverNpcId: 'trader_wilkes',
    turnInNpcId: 'trader_wilkes',
    text: 'Those bandits hit my last wagon and made off with four crates of goods: tools, salt, good Eastbrook linen. The crates are stacked around their camp in the northwest hills. Steal them back for me, would you?',
    completionText: 'My crates! Barely a scratch on them. You are a wonder.',
    objectives: [
      { type: 'collect', itemId: 'supply_crate', count: 4, label: 'Stolen Supply Crate' },
    ],
    xpReward: 550,
    copperReward: 250,
    itemRewards: {},
    minLevel: 3,
  },
  q_whispers: {
    id: 'q_whispers',
    name: 'Whispers Below',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'You have laid the dead to rest, but they will not stay resting — something calls them back. Search the chapel ruin for any trace of the one doing the calling. If you find a sigil or seal, bring it to me untouched.',
    completionText:
      'This sigil... it bears the mark of the Gravecallers, a sect I had prayed was extinct. This is worse than I feared, $N.',
    objectives: [
      { type: 'collect', itemId: 'gravecaller_sigil', count: 1, label: "Gravecaller's Sigil" },
    ],
    xpReward: 400,
    copperReward: 150,
    itemRewards: {},
    requiresQuest: 'q_bones',
  },
  q_names_of_the_dead: {
    id: 'q_names_of_the_dead',
    name: 'The Names of the Dead',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'If the Gravecallers raised our dead, I must know whose graves they robbed. The chapel sexton kept a burial ledger, and the wind has scattered its pages across the chapel yard. Gather 3 of them for me, $N — the dead deserve to be called by their names.',
    completionText:
      "These poor souls... and look here. Sexton Marrow — the chapel's own living caretaker — his grave the first disturbed. Morthen began with the very man who buried Eastbrook's dead.",
    objectives: [
      {
        type: 'collect',
        itemId: 'weathered_ledger_page',
        count: 3,
        label: 'Weathered Ledger Page',
      },
    ],
    xpReward: 600,
    copperReward: 250,
    itemRewards: {},
    requiresQuest: 'q_whispers',
  },
  q_silence_the_call: {
    id: 'q_silence_the_call',
    name: 'Silence the Call',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: "Every name in that ledger is a soul Morthen means to drag from the earth, and the chapel yard already crawls with those he has called. Return 12 Restless Bones to their graves, $N, before the Gravecaller's whisper swells into a chorus.",
    completionText:
      'The yard grows quieter — but the calling has not stopped. It rises from below now, $N. From the crypt itself.',
    objectives: [
      { type: 'kill', targetMobId: 'restless_bones', count: 12, label: 'Restless Bones silenced' },
    ],
    xpReward: 750,
    copperReward: 300,
    itemRewards: {},
    requiresQuest: 'q_names_of_the_dead',
  },
  q_rite: {
    id: 'q_rite',
    name: 'The Binding Rite',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: "The crypt beneath the chapel must be unsealed if we are to stop the Gravecaller — but only a binding rite will let the living pass. I need 4 lumps of Blessed Tallow — the mine's burrowers hoard tallow by the crate — and 6 Ghostly Essences from the restless dead.",
    completionText:
      'It is done. The way below stands open... and may the Light forgive me for opening it. Gather your strongest companions before you descend, $N. No one should face the Hollow alone.',
    objectives: [
      { type: 'collect', itemId: 'blessed_wax', count: 4, label: 'Blessed Tallow' },
      { type: 'collect', itemId: 'ghostly_essence', count: 6, label: 'Ghostly Essence' },
    ],
    xpReward: 700,
    copperReward: 500,
    itemRewards: {},
    requiresQuest: 'q_whispers',
  },
  q_hollow: {
    id: 'q_hollow',
    name: 'Into the Hollow',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: "Morthen the Gravecaller waits at the bottom of the Hollow Crypt, ringed by the elite dead he has raised. He is far beyond any one hero — take four companions, no fewer. End him, and the Vale's dead will finally sleep.",
    completionText:
      'The whispering has stopped. You have done what the whole Vale could not, $N — the dead sleep, and Eastbrook owes you everything it has.',
    objectives: [
      { type: 'kill', targetMobId: 'morthen', count: 1, label: 'Morthen the Gravecaller slain' },
    ],
    xpReward: 1500,
    copperReward: 10000,
    itemRewards: {
      warrior: 'gravecaller_blade',
      rogue: 'widowfang_dirk',
      mage: 'gravecaller_staff',
    },
    requiresQuest: 'q_rite',
    suggestedPlayers: 5,
  },
  q_sexton: {
    id: 'q_sexton',
    name: "The Sexton's Bell",
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: "The ledger named him and the crypt holds him: Sexton Marrow, the chapel's caretaker, the first man Morthen raised — guarding his master's door in death as faithfully as he kept the chapel in life. Take four companions into the Hollow Crypt and grant the old sexton the rest he was robbed of, $N.",
    completionText:
      'So Marrow is free at last. Ring no bell for him — he heard enough of them in life.',
    objectives: [
      { type: 'kill', targetMobId: 'sexton_marrow', count: 1, label: 'Sexton Marrow laid to rest' },
    ],
    xpReward: 1000,
    copperReward: 600,
    itemRewards: {
      warrior: 'marrowtread_boots',
      mage: 'sextons_slippers',
      rogue: 'gravewalker_softboots',
    },
    requiresQuest: 'q_rite',
    suggestedPlayers: 5,
  },
  q_gravecallers_trail: {
    id: 'q_gravecallers_trail',
    name: "The Gravecaller's Trail",
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'Morthen is dead, yet a question gnaws at me: a sect that hid for a century does not spend itself on one village chapel. He kept a grimoire — his rites, his correspondence. If anything of it survives, it lies in the vestry of the ruined chapel above the crypt. Search the ruin and bring me whatever remains of his writings, $N.',
    completionText:
      "Morthen wrote to a 'Fogbinder' in the northern fen. The sect is not dead, $N — it has merely been patient.",
    objectives: [
      { type: 'collect', itemId: 'morthen_grimoire', count: 1, label: "Morthen's Grimoire" },
    ],
    xpReward: 900,
    copperReward: 400,
    itemRewards: {},
    requiresQuest: 'q_hollow',
  },
  // --- Paladin-only Dawnbound Tome chain (learn Recall the Fallen). Step 1 with Brother
  // Aldric in the Vale opens the rite and sends you after him; the rite itself is
  // completed with Aldric in Mirefen Marsh (q_rite_of_redemption, zone2), which
  // grants the resurrection on turn-in. ---
  q_divine_tome: {
    id: 'q_divine_tome',
    name: 'The Dawnbound Tome',
    giverNpcId: 'brother_aldric',
    turnInNpcId: 'brother_aldric',
    text: 'The Light does not rest in you quietly, $N. I have watched you lay the dead to peace, and I believe you are ready for what few paladins are ever taught: the Rite of Recall, by which a fallen soul is called back to the living. Its words are kept in the Dawnbound Tome, here in my keeping, but a book is no blessing while the restless dead still walk this ground. Return 6 more Restless Bones to the earth, and I will begin to teach you.',
    completionText:
      'The chapel yard grows quiet. You are ready for the words, $N, but the Rite of Recall cannot be spoken in a warm chapel. It must be sung where the veil between life and death wears thin. I mean to carry the Tome north into the Mirefen Marsh. Follow me there, and we will finish this.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'restless_bones',
        count: 6,
        label: 'Restless Bones laid to rest',
      },
    ],
    xpReward: 650,
    copperReward: 200,
    itemRewards: {},
    requiredClass: ['paladin'],
    requiresQuest: 'q_bones',
    minLevel: 6,
  },
  q_bandits: {
    id: 'q_bandits',
    name: 'Bandits of the Vale',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'A pack of cutthroats has made camp in the northwest hills. They have robbed three wagons this week. Drive them out: slay 10 Vale Bandits.',
    completionText: 'Ten fewer knives in the dark. Take this — you have earned it.',
    objectives: [
      { type: 'kill', targetMobId: 'vale_bandit', count: 10, label: 'Vale Bandit slain' },
    ],
    xpReward: 550,
    copperReward: 200,
    itemRewards: { warrior: 'redbrook_blade', mage: 'apprentice_staff', rogue: 'keen_dirk' },
    requiresQuest: 'q_wolves',
  },
  q_ringleader: {
    id: 'q_ringleader',
    name: 'The Ringleader',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'The bandits answer to one man: Gorrak the Ruthless. Cut off the head and the body will scatter. He skulks at the heart of their camp. End him, $N.',
    completionText:
      'Gorrak is dead? Then the Vale is free of his shadow. You have done Eastbrook a great service.',
    objectives: [
      { type: 'kill', targetMobId: 'gorrak', count: 1, label: 'Gorrak the Ruthless slain' },
    ],
    xpReward: 800,
    copperReward: 500,
    itemRewards: { warrior: 'militia_vest', mage: 'woven_robe', rogue: 'shadow_jerkin' },
    requiresQuest: 'q_bandits',
  },
  q_mogger: {
    id: 'q_mogger',
    name: 'Mogger Must Fall',
    giverNpcId: 'marshal_redbrook',
    turnInNpcId: 'marshal_redbrook',
    text: 'Mogger has split carts, flattened fences, and killed enough livestock to empty half the Vale. Do not face him alone. Take two strong companions into the western meadow and put the brute down for good.',
    completionText:
      "Mogger dead at last. Eastbrook's fields are safer, and you leave the Vale with one more tale worth retelling.",
    objectives: [{ type: 'kill', targetMobId: 'mogger', count: 1, label: 'Mogger slain' }],
    xpReward: 1200,
    copperReward: 900,
    itemRewards: {
      warrior: 'bristleback_maul',
      mage: 'sableweb_slippers',
      rogue: 'moggers_stomper_boots',
    },
    requiresQuest: 'q_gravecallers_trail',
    minLevel: 6,
    suggestedPlayers: 3,
  },
  // Profession attunement (Professions 2.0): each of the four wave-one
  // archetype pairs has its own anchor master and its own fixed-pair acceptance
  // quest, so the masters are independent entry points (no q_prof_intro gate).
  // The chosen pair is carried on the quest's completionEffect.pairId; the
  // authoritative turn-in effect revalidates it before attuning. Each acceptance
  // quest's body states the whole bargain up front (which two crafts become
  // majors, that a hobby slot exists, that other crafts go dormant not lost, and
  // that returning to an abandoned pair later costs an escalating make-amends
  // task) so the choice is legible before it is made.
  q_prof_attune_smith: {
    id: 'q_prof_attune_smith',
    name: "The Smith's Promise",
    giverNpcId: 'forgemistress_darva',
    turnInNpcId: 'forgemistress_darva',
    text: 'Steel does not forgive a wandering hand, so I will tell you plain before you swear anything. Bind yourself to my forge and Weaponcrafting and Armorcrafting become your two majors, the only crafts you may carry past rare work. The craft across the wheel from them settles in as your hobby, worked to rare and no further. Your other trades do not burn away, $N: they simply go quiet, dormant until you call them back. And know this before the hammer falls: leave this pair for another and you will crawl back through honest labor to return to it, five foes put down the first time you come home, eight the next, eleven after that, more each time you stray. Still standing here? Then bring me three veins of ore worked from the Vale with your own hands, and we will call the promise struck.',
    completionText:
      'Good ore, and good hands to work it. Weaponcrafting and Armorcrafting are yours to master now. Earn the rest.',
    objectives: [{ type: 'gather', nodeType: 'ore', count: 3, label: 'Ore vein harvested' }],
    xpReward: 150,
    copperReward: 0,
    itemRewards: {},
    shareable: false,
    // An anchor master is an independent entry point (no q_prof_intro gate), so
    // this one cannot lean on the intro quest's pick: it grants its own.
    requiredItems: ['copper_mining_pick'],
    completionEffect: { type: 'attunePair', mode: 'new', pairId: 'weaponcrafting+armorcrafting' },
  },
  // STALE-OVERLAY NOTE (docs/i18n-scaling/translation-workflow.md, "Rewording an
  // existing English value"): the giver text and objectives.0.label for this key
  // were reworded (mob display names webwood spider -> Sableweb Lurker) without a
  // matching overlay re-fill. The status registry has no staleness detection yet
  // (srcHash/enHash comparison is dormant), so translated locales keep rendering
  // the OLD mob name and the release-tier pending gate will NOT catch it. Flagging
  // here for the next maintainer i18n-locale-fill pass to re-do
  // entities.quests.q_prof_attune_outfitter.{text,objectives.0.label} in every
  // locale overlay.
  q_prof_attune_outfitter: {
    id: 'q_prof_attune_outfitter',
    name: "The Outfitter's Measure",
    giverNpcId: 'weaver_ottilie',
    turnInNpcId: 'weaver_ottilie',
    text: 'Measure the cost before you cut, that is the first rule at my loom. Choose me and Leatherworking and Tailoring become your two majors, the pair you may carry beyond rare work; the craft opposite them settles in as your hobby, taken to rare and left there. The trades you set aside are not unravelled, $N, only folded away, dormant until you take them up again. Be certain, though: should you leave this pair and later want it back, the way home is paid in labor that lengthens each time, five culled at first, then eight, then eleven, always a little more. If your mind is made, cull four Sableweb Lurkers and bring their silk to the loom, for good thread starts every good garment.',
    completionText:
      'Even thread, even hand. Leatherworking and Tailoring are yours to carry as far as your skill will reach. Measure twice, and they will not fail you.',
    objectives: [
      { type: 'kill', targetMobId: 'webwood_spider', count: 4, label: 'Sableweb Lurker culled' },
    ],
    xpReward: 150,
    copperReward: 0,
    itemRewards: {},
    shareable: false,
    completionEffect: { type: 'attunePair', mode: 'new', pairId: 'leatherworking+tailoring' },
  },
  q_prof_attune_apothecary: {
    id: 'q_prof_attune_apothecary',
    name: 'A Recipe Worth Keeping',
    giverNpcId: 'cook_marlow',
    turnInNpcId: 'cook_marlow',
    text: 'Every good dish is two flavors that belong together, and so is a good craft, $N. Sit with me and Alchemy and Cooking become your two majors, the two you may simmer past rare work; the craft on the far side of the wheel is your hobby, seasoned up to rare and no hotter. The rest of your trades keep in the pantry, dormant, not spoiled, ready whenever you fetch them back. Fair warning while the pot is still cold: wander off to another pair and coming home is a chore that grows, five beasts seen to the first time, eight the next, eleven the time after, heavier with every helping. Still hungry for it? Then hunt me four wild boars, because a kitchen worth its salt starts with good meat.',
    completionText:
      'Now that is a start with some meat on it. Alchemy and Cooking are yours to cook as high as you like. Come back hungry.',
    objectives: [{ type: 'kill', targetMobId: 'wild_boar', count: 4, label: 'Wild Boar hunted' }],
    xpReward: 150,
    copperReward: 0,
    itemRewards: {},
    shareable: false,
    completionEffect: { type: 'attunePair', mode: 'new', pairId: 'alchemy+cooking' },
  },
  q_prof_attune_bombardier: {
    id: 'q_prof_attune_bombardier',
    name: 'A Volatile Arrangement',
    giverNpcId: 'tinker_gizzel',
    turnInNpcId: 'tinker_gizzel',
    text: 'Oh, oh, you want the good stuff, the loud stuff, yes? Listen, listen, before you touch anything that ticks: say the word and Engineering and Alchemy become your two majors, the only two you get to push past rare work (that is where it gets FUN, trust me). The craft opposite goes in your pocket as a hobby, rare and no further, do not pout. Your other trades? Not gone, $N, just napping, dormant, wake them whenever you like. But (there is always a but, hold the fuse) ditch this pair and waddle back later and it costs you sweat that piles up, five things put down the first time, eight the next, eleven after, more, more, every single time you get cold feet. Yes? YES? Then go pick me three patches of herbs, the volatile ones, do not ask which, they are all a little volatile if you believe hard enough.',
    completionText:
      'HA. Reagents, real ones, and all your fingers still attached, good, good. Engineering and Alchemy, yours, go make something that regrets it. Off you go.',
    objectives: [{ type: 'gather', nodeType: 'herb', count: 3, label: 'Herb patch harvested' }],
    xpReward: 150,
    copperReward: 0,
    itemRewards: {},
    shareable: false,
    // A herb objective, so this one grants the SICKLE, not the pick: a mining
    // tool does not satisfy the herbalism tool gate.
    requiredItems: ['gathering_sickle'],
    completionEffect: { type: 'attunePair', mode: 'new', pairId: 'engineering+alchemy' },
  },
  // Make-amends returns (Professions 2.0): repeatable, one per anchor
  // master, taken only for a pair the character has held before. The first
  // objective's count is resolved at accept time from the character's return
  // history (resolvedObjectiveCounts 'archetypeAmends' -> 5 + 3 * switchCount),
  // so the authored count is only a placeholder. The turn-in effect returns the
  // former pair to active (attunePair mode 'return').
  q_prof_amends_smith: {
    id: 'q_prof_amends_smith',
    name: 'Back to the Forge',
    giverNpcId: 'forgemistress_darva',
    turnInNpcId: 'forgemistress_darva',
    text: 'So you have come back to the forge. I will not pretend it does not sting, $N, but I am a fair hand and the work is fair too. You know the price of returning: labor, and more of it each time you have strayed. Put down the wolves harrying the north road, and the swing of it will remind your arms what this pair once asked of them.',
    completionText:
      'The rhythm is back in your hands. Weaponcrafting and Armorcrafting are your majors once more. Do not make a habit of leaving.',
    objectives: [
      { type: 'kill', targetMobId: 'forest_wolf', count: 5, label: 'Forest Wolf slain' },
    ],
    xpReward: 100,
    copperReward: 0,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    resolvedObjectiveCounts: 'archetypeAmends',
    completionEffect: {
      type: 'attunePair',
      mode: 'return',
      pairId: 'weaponcrafting+armorcrafting',
    },
  },
  // STALE-OVERLAY NOTE: same reword-without-refill gap as q_prof_attune_outfitter
  // above (webwood spider -> Sableweb Lurker), needs an i18n-locale-fill pass for
  // entities.quests.q_prof_amends_outfitter.{text,objectives.0.label}.
  q_prof_amends_outfitter: {
    id: 'q_prof_amends_outfitter',
    name: 'Threads Rejoined',
    giverNpcId: 'weaver_ottilie',
    turnInNpcId: 'weaver_ottilie',
    text: 'Back at my loom after all. I hold no grudge, $N, but the thread remembers a hand that let it go, and the cost of taking it up again is measured out longer each time. Cull the Sableweb Lurkers crowding the northeastern woods, and the labor will settle your hands before they touch good silk again.',
    completionText:
      'Steady again. Leatherworking and Tailoring return to your hands as majors. Measure twice this time before you wander.',
    objectives: [
      { type: 'kill', targetMobId: 'webwood_spider', count: 5, label: 'Sableweb Lurker culled' },
    ],
    xpReward: 100,
    copperReward: 0,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    resolvedObjectiveCounts: 'archetypeAmends',
    completionEffect: { type: 'attunePair', mode: 'return', pairId: 'leatherworking+tailoring' },
  },
  q_prof_amends_apothecary: {
    id: 'q_prof_amends_apothecary',
    name: 'Back on the Stove',
    giverNpcId: 'cook_marlow',
    turnInNpcId: 'cook_marlow',
    text: 'Well, look who is back at my pot. No hard feelings, $N, a kitchen always has room, but you know the tab runs longer every time you walk out on it. Go thin the wild boars in the northwest meadow, because honest sweat is the first ingredient, and it will remind your hands of the work.',
    completionText:
      'There is the old flavor. Alchemy and Cooking are back on your stove as majors. Stay a while this time.',
    objectives: [{ type: 'kill', targetMobId: 'wild_boar', count: 5, label: 'Wild Boar hunted' }],
    xpReward: 100,
    copperReward: 0,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    resolvedObjectiveCounts: 'archetypeAmends',
    completionEffect: { type: 'attunePair', mode: 'return', pairId: 'alchemy+cooking' },
  },
  // STALE-OVERLAY NOTE: same reword-without-refill gap as q_prof_attune_outfitter
  // above (tunnel rat -> Deeprock Digger), needs an i18n-locale-fill pass for
  // entities.quests.q_prof_amends_bombardier.{text,objectives.0.label}.
  q_prof_amends_bombardier: {
    id: 'q_prof_amends_bombardier',
    name: 'The Ledger Grows',
    giverNpcId: 'tinker_gizzel',
    turnInNpcId: 'tinker_gizzel',
    text: 'You came BACK, ha, they always come back, the loud stuff has a pull, yes? No sulking from me, $N, but the ledger, oh the ledger, it grows every time you skip out, more each return, that is only fair. Go clear the Deeprock Diggers out of the dig for me, sweat first, sparks later, that is the rule I just made up.',
    completionText:
      'THERE it is, the itch is back in your hands. Engineering and Alchemy, majors again, go on, go make a bang. Try to stay put this time, eh?',
    objectives: [
      { type: 'kill', targetMobId: 'tunnel_rat', count: 5, label: 'Deeprock Digger exterminated' },
    ],
    xpReward: 100,
    copperReward: 0,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    resolvedObjectiveCounts: 'archetypeAmends',
    completionEffect: { type: 'attunePair', mode: 'return', pairId: 'engineering+alchemy' },
  },
  // Repeatable craft work orders (Professions 2.0): a master takes a
  // stack of their craft's staple material off your hands for coin, a light
  // economy sink on a fixed cadence (repeatCadenceTicks WORK_ORDER_CADENCE_TICKS).
  // The collect turn-in consumes the materials (turnInQuestCore via
  // removePreferFungible: plain stacks first, signed copies last).
  // copperReward is floor(0.5 * summed vendor sell value of the requested
  // materials); xpReward matches the only repeatable-quest precedent in the game,
  // the make-amends band (100), since no zone-2/3 repeatable exists to scale to.
  q_prof_workorder_forge: {
    id: 'q_prof_workorder_forge',
    name: 'Forge Work Order',
    giverNpcId: 'forgemistress_darva',
    turnInNpcId: 'forgemistress_darva',
    text: 'The forge always wants feeding, $N. Bring me eight lumps of copper ore and I will see you paid for the haul. No ceremony, just ore and coin.',
    completionText:
      'Good weight, no slag. Here is your due. The forge will be hungry again soon enough.',
    objectives: [
      { type: 'collect', itemId: 'copper_ore', count: 8, label: 'Copper Ore delivered' },
    ],
    xpReward: 100,
    // floor(0.5 * 8 * 4) = 16 (copper_ore sellValue 4).
    copperReward: 16,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    repeatCadenceTicks: WORK_ORDER_CADENCE_TICKS,
  },
  q_prof_workorder_kitchens: {
    id: 'q_prof_workorder_kitchens',
    name: 'Kitchens Work Order',
    giverNpcId: 'cook_marlow',
    turnInNpcId: 'cook_marlow',
    text: 'My larder is looking thin, $N, and thin larders make grumpy cooks. Fetch me eight cuts of game meat and there is coin in it for you, plus my undying gratitude, which is worth less but tastes better.',
    completionText:
      'Now that is a full pantry. Here is your pay. Come back when your bags are heavy again.',
    objectives: [{ type: 'collect', itemId: 'game_meat', count: 8, label: 'Game Meat delivered' }],
    xpReward: 100,
    // floor(0.5 * 8 * 4) = 16 (game_meat sellValue 4).
    copperReward: 16,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    repeatCadenceTicks: WORK_ORDER_CADENCE_TICKS,
  },
  q_prof_workorder_loom: {
    id: 'q_prof_workorder_loom',
    name: 'Loom Work Order',
    giverNpcId: 'weaver_ottilie',
    turnInNpcId: 'weaver_ottilie',
    text: 'The loom runs dry and idle hands waste daylight, $N. Bring me six skeins of spider silk and I will pay you a fair rate, counted out to the copper.',
    completionText:
      'Fine silk, evenly spun. Your coin, exactly measured. The loom thanks you, and so do I.',
    objectives: [
      { type: 'collect', itemId: 'spider_silk', count: 6, label: 'Spider Silk delivered' },
    ],
    xpReward: 100,
    // floor(0.5 * 6 * 5) = 15 (spider_silk sellValue 5).
    copperReward: 15,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    repeatCadenceTicks: WORK_ORDER_CADENCE_TICKS,
  },
  q_prof_workorder_toolworks: {
    id: 'q_prof_workorder_toolworks',
    name: 'Toolworks Work Order',
    giverNpcId: 'tinker_gizzel',
    turnInNpcId: 'tinker_gizzel',
    text: 'Hafts, handles, stocks, I go through wood like it is going out of style, which it is NOT, wood is eternal, $N. Haul me eight ironbark logs and I will pay you, coin, real coin, not a favor, I promise, mostly.',
    completionText:
      'Perfect, perfect, straight grain, no rot. Here, your coin, see, I keep my word (mostly). Bring more when you trip over a tree.',
    objectives: [
      { type: 'collect', itemId: 'ironbark_log', count: 8, label: 'Ironbark Log delivered' },
    ],
    xpReward: 100,
    // floor(0.5 * 8 * 4) = 16 (ironbark_log sellValue 4).
    copperReward: 16,
    itemRewards: {},
    repeatable: true,
    shareable: false,
    repeatCadenceTicks: WORK_ORDER_CADENCE_TICKS,
  },
  q_prof_hobby_switch: {
    id: 'q_prof_hobby_switch',
    name: 'A Different Pastime',
    giverNpcId: 'smith_haldren',
    turnInNpcId: 'smith_haldren',
    text: 'Majors demand a vow. A hobby only asks where your curiosity wanders, $N. Gather a few herbs and decide which craft opposite your majors you want to pursue.',
    completionText:
      'A lighter choice, but a useful one. Follow that curiosity as far as rare work will take it.',
    objectives: [{ type: 'gather', nodeType: 'herb', count: 3, label: 'Herb patch harvested' }],
    // 0 XP on purpose. The hobby switch is a repeatable identity
    // toggle; any XP on it becomes a farmable trickle, so it pays nothing.
    xpReward: 0,
    copperReward: 0,
    itemRewards: {},
    requiresQuest: 'q_prof_intro',
    repeatable: true,
    shareable: false,
    // The same 30-minute window its four work-order siblings carry. The iron
    // gate on the tool mint is the accept-time presence predicate
    // (quests/quest_item_presence.ts, spanning bank/mail/escrow). The cadence
    // bounds ONLY the turn-in loop (armCadence fires in turnInQuestCore;
    // abandoning arms nothing), so the one transfer route left deliberately
    // open (direct trade, R10) still moves one sickle per accept-abandon
    // cycle. What actually bounds that route is the value ceiling: the tools
    // carry noVendorSell and noMarketList, so a traded copy has no route to
    // copper (guarded in tests/professions_starter_tools.test.ts).
    repeatCadenceTicks: WORK_ORDER_CADENCE_TICKS,
    // Also a herb objective, so also the sickle. This is the repeatable one, so
    // it is the reason the tier-1 tools carry noVendorSell (items.ts): without
    // that flag, accept-sell-abandon would be an unbounded copper faucet.
    requiredItems: ['gathering_sickle'],
    completionEffect: { type: 'switchHobby' },
  },
};

export const ZONE1_QUEST_ORDER = [
  'q_prof_intro',
  'q_wolves',
  'q_boars',
  'q_spiders',
  'q_greyjaw',
  'q_murlocs',
  'q_supplies',
  'q_bandits',
  'q_mine',
  'q_bones',
  'q_ringleader',
  'q_whispers',
  'q_names_of_the_dead',
  'q_silence_the_call',
  'q_rite',
  'q_sexton',
  'q_hollow',
  'q_gravecallers_trail',
  'q_divine_tome',
  'q_mogger',
  'q_prof_attune_smith',
  'q_prof_attune_outfitter',
  'q_prof_attune_apothecary',
  'q_prof_attune_bombardier',
  'q_prof_amends_smith',
  'q_prof_amends_outfitter',
  'q_prof_amends_apothecary',
  'q_prof_amends_bombardier',
  'q_prof_workorder_forge',
  'q_prof_workorder_kitchens',
  'q_prof_workorder_loom',
  'q_prof_workorder_toolworks',
  'q_prof_hobby_switch',
];

// ---------------------------------------------------------------------------
// World layout. Town sits at origin. +z north, +x WEST (east is -x:
// facing 0 looks along +z and turning right decreases facing, so the
// rendered world and the corrected map both put -x on your right).
// ---------------------------------------------------------------------------

// STARTER PACING: every packed camp whose disc reaches within 100 yd of the town
// hub is spaced so adjacent mobs stand at least 11.5 yd apart (radius / sqrt(count),
// camp_scatter.ts), no disc comes closer than 38 yd to the hub, and NO TWO
// POPULATIONS OVERLAP: two camps of DIFFERENT mobIds keep their discs fully apart
// (distance >= radiusA + radiusB + 2). Two camps of the SAME mobId are one
// population split in two, so they may still abut ((rA + rB) * 0.75 + 8).
// Below that the packs chain-pull: aggro radii here run 9-13 yd, so a camp
// scattered tighter than its own aggro radius drags neighbours onto a level-1
// player, and two interleaved camps pull two different families at once. The
// lever is spacing and (where a camp could not otherwise fit) a small count cut;
// aggroRadius and the social-aggro flee-rally (src/sim/mob/social_aggro.ts) are
// deliberately unchanged, and no named rare or elite was ever thinned. Counts were
// trimmed by one per crowded camp (murlocs by three, see below) on maintainer
// authorization, 2026-07-28, and every camp stays at or above half of the largest
// single kill-quest requirement against its mobId. Camps were pushed OUTWARD along
// their existing bearing so each stays in its own corner.
// Guarded by tests/eastbrook_camp_spacing.test.ts. Row ORDER is a determinism
// contract (see the CAMPS merge in data.ts): edit values, never reorder.
export const ZONE1_CAMPS: CampDef[] = [
  // Compass check for every placement comment and quest text below: the
  // canonical convention statement lives higher in this file (the pois
  // block: +z north, +x WEST, east is -x), and reading +X as east is what
  // produced a run of mirrored quest directions; verify any direction claim
  // against that note, never against raw signs.
  // Wolves: north woods
  { mobId: 'forest_wolf', center: { x: -10, z: 6 }, radius: 28.5, count: 6 },
  { mobId: 'forest_wolf', center: { x: 12, z: 52 }, radius: 26, count: 5 },
  // Nudged north to stay ahead of the widened wolf runs (q_greyjaw sends the
  // player to "the deep woods north of the wolf runs").
  { mobId: 'old_greyjaw', center: { x: 0, z: 100 }, radius: 8, count: 1 },
  // Boars: west meadow
  // Round 6 (owner + team): the boar meadow and the bandit camp trade ground.
  // The bandits sat closest of any hostile camp to the town gate (disc edge 41
  // yd from the hub) while the harmless boars had the far meadow, so the two
  // populations swap and both step north, spacing the zone's encounters more
  // evenly. Row ORDER is untouched (a reorder would move every later camp's
  // spawn); only the centers move. BOTH boar rows travel, because the bandit
  // disc (radius 28.5) does not fit the meadow while the second boar camp
  // holds its corner of it.
  // Round 6b (owner): pushed further WEST, off the town's doorstep. Three
  // things forced the exact spots: a camp levels a disc of radius*1.8 around
  // itself, so the first placement was flattening the vale road at (30,-30) and
  // lifting it a yard and a half; camp B sat close enough to Gorrak's camp that
  // his tents read as bandit gear abandoned in the boar meadow; and camp A's
  // disc edge was only 42 yd from the town hub. Now the road is outside both
  // flatten discs, Gorrak's dressing is well clear, camp A's edge is 76 yd from
  // town, and camp B rejoins Mogger on the downs, who was left behind by the
  // first move.
  // Round 6c (owner): the meadow settles where the west road actually ENDS,
  // (65,-65), so the path leads a player somewhere instead of petering out
  // in empty grass. Camp A holds the road-end meadow; camp B sits on the
  // downs at the same-population spacing floor, keeping Mogger 27 yd off
  // its disc so the rare still patrols his boars. The A centre keeps the
  // vale-road probe at (30,-30) outside its flatten reach (50.5 vs 47.8),
  // the trap this corridor sprang once already this round.
  { mobId: 'wild_boar', center: { x: 58, z: -72 }, radius: 26, count: 5 },
  { mobId: 'wild_boar', center: { x: 97, z: -43 }, radius: 23.5, count: 4 },
  { mobId: 'mogger', center: { x: 118, z: -26 }, radius: 5, count: 1 },
  // Spiders: eastern woods
  { mobId: 'webwood_spider', center: { x: -70, z: 2 }, radius: 28.5, count: 6 },
  // Murlocs: lake shore northeast, camp still straddles the waterline. This camp is
  // radius-capped by Mirror Lake, not by its neighbours: the terrain flatten disc is
  // radius * 1.8, so a radius wide enough for 11.5 yd spacing drags a 59 yd flatten
  // across the lake and lifts its bed above swim depth (the lake stops needing a
  // swim, fish stop leaping, the map stops painting it as water). Even radius 15.5
  // reshapes the south shore enough to break the mount-versus-swimmer waterline
  // (tests/mount_transition.test.ts), so 15 is the measured shore-safe ceiling and
  // the COUNT comes down instead: 8 to 5. That keeps Fisher Dunwall's "where there
  // is one mudfin, there are five" literal, still covers half of his slay-8, and
  // lifts spacing from 4.95 to 6.71 yd. It is the one camp that cannot reach 11.5;
  // the documented exception and the lake guard live in
  // tests/eastbrook_camp_spacing.test.ts.
  { mobId: 'mudfin_murloc', center: { x: -75, z: 57 }, radius: 15, count: 5 },
  // Kobolds: the Copper Dig, northeast of the Wolf Run on the Mirefen road
  // (phase 0b of the New Eastbrook program: the interim dig headland went
  // back to open sea for the ferry lane, and the whole cluster moved rigidly
  // +110,+230 to the rise past Mirror Lake). Keep-outs verified empirically:
  // 54yd to Old Greyjaw's prowl disc, 74yd+ to both wolf runs, the camp edge
  // stops 3yd inside the zone 1 band.
  { mobId: 'tunnel_rat', center: { x: -32, z: 144 }, radius: 33, count: 8 },
  // Bandits: southwest camp. Shifted off its own campfire collider and clear of the
  // boar meadow; the tents, crates and supply drops all stay inside the disc, and it
  // no longer merges with the outpost below.
  // The main bandit band takes the old boar meadow, a step north of where the
  // boars stood. Gorrak's own camp below stays put with the boss, so the
  // Bandit Camp landmark and the ringleader fight keep their ground.
  { mobId: 'vale_bandit', center: { x: 80, z: 15 }, radius: 28.5, count: 6 },
  // Round 6b (owner): Gorrak's camp joins the main band. The two bandit
  // camps were 105 yd apart with the boar meadow sitting between them, so
  // half the vale bandits read as a separate population with no camp.
  { mobId: 'vale_bandit', center: { x: 115, z: 42 }, radius: 16, count: 5 },
  { mobId: 'gorrak', center: { x: 118, z: 45 }, radius: 2, count: 1 },
  // Undead: ruins northwest. The chapel guardians below are the same population, so
  // they may still flank the altar inside this disc.
  { mobId: 'restless_bones', center: { x: 82, z: 78 }, radius: 28.5, count: 6 },
  { mobId: 'captain_verlan', center: { x: 92, z: 90 }, radius: 4, count: 1 },
];

// Spawned LAST in the merged CAMPS array (see data.ts) so these appended draws
// fall after every other zone's camp spawns — and the camp loop is the final
// RNG consumer at construction (ground objects, dungeon doors and addPlayer draw
// none). Keeping the rare elite at the tail means adding it shifts no other
// content's deterministic spawn rolls, so fixed-seed tests stay stable.
export const ZONE1_CHAPEL_CAMPS: CampDef[] = [
  // A pair of bone guardians flank the chapel's broken altar; their binder lurks within.
  { mobId: 'restless_bones', center: { x: 88, z: 90 }, radius: 6, count: 2 },
  { mobId: 'wraithbinder_maldrec', center: { x: 88, z: 92 }, radius: 3, count: 1 },
];

export const ZONE1_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'supply_crate',
    name: 'Stolen Supply Crate',
    positions: [
      { x: 58, z: -58 },
      { x: 73, z: -70 },
      { x: 86, z: -82 },
      { x: 95, z: -97 },
      { x: 64, z: -76 },
      { x: 81, z: -94 },
    ],
  },
  {
    itemId: 'gravecaller_sigil',
    name: "Gravecaller's Sigil",
    positions: [
      { x: 84, z: 88 },
      { x: 76, z: 92 },
    ],
  },
  {
    itemId: 'weathered_ledger_page',
    name: 'Weathered Ledger Page',
    positions: [
      { x: 78, z: 84 },
      { x: 83, z: 88 },
      { x: 86, z: 92 },
    ],
  },
  {
    itemId: 'morthen_grimoire',
    name: "Morthen's Grimoire",
    positions: [{ x: 78, z: 86 }],
  },
];

// Roads from town toward each hub — used for terrain painting and the map.
// Roads from town toward each hub — used for terrain painting and the map.
export const ZONE1_ROADS: { x: number; z: number }[][] = [
  [
    ...EASTBROOK_LAYOUT.roads[0].points,
    { x: -2, z: -34 },
    { x: 2, z: -4 },
    { x: -8, z: 30 },
    { x: -15, z: 55 },
    { x: -2, z: 78 },
    { x: -16, z: 104 },
    { x: -26, z: 124 },
    { x: -32, z: 140 },
  ], // north over the chapel green, through the Wolf Run on the old town ground, on past Mirror Lake to the Copper Dig and the Mirefen road
  [...EASTBROOK_LAYOUT.roads[1].points], // the main street: market square east to the harbor quay
  [
    ...EASTBROOK_LAYOUT.roads[2].points,
    // Owner report (round 6e): the old beach line (-24,-132)(-12,-135)(12,-131)
    // dipped under the bay south of town (min height -4.49 vs water -4.3), so
    // the map painted the meadow road cut by the sea. This arc hugs the dry
    // sand instead: every sample along it, across a 2.5yd half-width, holds at
    // least 1.2yd of freeboard over WATER_LEVEL (probed against live terrain).
    { x: -24, z: -128.5 },
    { x: -16, z: -130 },
    { x: -10, z: -126.5 },
    { x: -4, z: -123.5 },
    { x: 4, z: -123 },
    { x: 12, z: -126 },
    { x: 30, z: -30 },
    { x: 50, z: -50 },
    { x: 65, z: -65 },
  ], // crafts lane, then the coast track along the bay, north to the boar meadow
  [...EASTBROOK_LAYOUT.roads[3].points], // the beach promenade
  [...EASTBROOK_LAYOUT.roads[4].points], // civic link across the squares
  [...EASTBROOK_LAYOUT.roads[5].points, { x: -96, z: -66 }], // the quay walk, joining the flank track (the freed dig ground)
  [...EASTBROOK_LAYOUT.roads[6].points], // the inn lane down to the main street
];

// ---------------------------------------------------------------------------
// Static props (rendering + collision share this placement data)
// ---------------------------------------------------------------------------

export const ZONE1_PROPS: ZonePropsDef = {
  buildings: [
    // Round 4: the preserved Grand Armoury row left this table; the KayKit
    // barracks and its watch tower stand on the lot as decorProps below.
    ...EASTBROOK_LAYOUT.buildings.map((building) => ({
      id: building.id,
      assetId: building.assetId,
      kind: building.kind,
      x: building.position.x,
      z: building.position.z,
      w: building.nativeDimensions.width,
      d: building.nativeDimensions.depth,
      rot: building.rotation,
      height: building.nativeDimensions.height,
    })),
  ],
  wells: [
    {
      id: EASTBROOK_LAYOUT.civic.wellBeacon.id,
      assetId: EASTBROOK_LAYOUT.civic.wellBeacon.assetId,
      x: EASTBROOK_LAYOUT.civic.wellBeacon.position.x,
      z: EASTBROOK_LAYOUT.civic.wellBeacon.position.z,
      r: EASTBROOK_LAYOUT.civic.wellBeacon.radius,
      height: EASTBROOK_LAYOUT.civic.wellBeacon.height,
    },
  ],
  stalls: EASTBROOK_LAYOUT.market.stalls.map((stall) => ({
    id: stall.id,
    assetId: stall.assetId,
    x: stall.position.x,
    z: stall.position.z,
    rot: stall.rotation,
    r: Math.hypot(stall.width / 2, stall.depth / 2),
    w: stall.width,
    d: stall.depth,
    height: stall.height,
    canopyVariant: stall.canopyVariant,
  })),
  mines: [{ x: -38, z: 138, rot: 0.8 }],
  // The harbor fleet, moored on the piers' open water only (berths verified
  // against the deck rectangles in sim/eastbrook_harbor.ts: each hull's
  // collider stays a full radius plus half-width clear of every walkway, the
  // Wickharbor rule, so nobody wedges between hull and rail).
  decorProps: [
    // The harbor fleet on the Wickharbor pattern (owner refinement): the same
    // hulls Galecrest moors, on the piers' open sides only. Berths verified
    // against the fanned deck rectangles in sim/eastbrook_harbor.ts: each
    // hull's collider stays a full radius plus half-width clear of every
    // walkway, so nobody wedges between hull and rail.
    // Round 6 (owner + team): the fleet re-berthed and grown. Four of the five
    // hulls used to sit partly on dry land, one of them a yard and a half ABOVE
    // the waterline in the middle of the graded quay pad, because a decorProp
    // seats on raw terrain and only sinks to its float draft where the ground
    // is already below the sea. These berths were measured against the cove
    // bathymetry so every hull is wet across its whole footprint, and each lies
    // alongside a pier in the gap the round 6 respacing opened.
    { key: 'hexShipBlue', x: -115, z: -45, rot: -1.6, scale: 7, r: 4.6, h: 11, float: 0.55 },
    { key: 'hexShipBlue', x: -115, z: -63, rot: 1.55, scale: 7, r: 4.6, h: 11, float: 0.55 },
    // a smaller fishing hull riding the fairway west of the ferry berth
    { key: 'seaBoatFishing', x: -122, z: -54, rot: 0, scale: 2.5, r: 2.4, h: 7, float: 0.5 },
    // dinghies riding the water in the pier gaps, Wickharbor-style
    // the two dinghies pulled off the pad and into real water beside the piers
    { key: 'hexBoat', x: -107.5, z: -47, rot: 0.7, scale: 6, float: 0.1 },
    { key: 'hexBoat', x: -107, z: -61, rot: -1.9, scale: 6, float: 0.1 },
    // Round 6 (owner): rowboats hauled up the strand south of the quay, the
    // beached pose the Palmreach shore uses (a hull with no float rides the
    // ground it stands on).
    { key: 'rowboat', x: -98.5, z: -74.5, rot: 1.2, scale: 1, r: 1.4, h: 1.2 },
    { key: 'rowboat', x: -95, z: -78, rot: -0.5, scale: 1, r: 1.4, h: 1.2 },
    { key: 'rowboat', x: -100, z: -33, rot: 2.4, scale: 1, r: 1.4, h: 1.2 },
    // the small watch tower on the quay's north shoulder, eyes on the fairway
    { key: 'hexWatchtower', x: -89, z: -41, rot: -2.3, scale: 6.5, r: 2.4, h: 12 },
    // tidy quay dressing: the anchor by the tower, cargo clustered at the
    // boardwalk roots rather than scattered
    { key: 'hexAnchor', x: -87.5, z: -44.5, rot: -0.9, scale: 6 },
    { key: 'hexCrateBig', x: -95.5, z: -44, rot: 0.3, scale: 5, r: 1.2, h: 2 },
    { key: 'hexCrateOpen', x: -95.5, z: -46.2, rot: -0.5, scale: 5, r: 1.1, h: 1.6 },
    { key: 'hexSack', x: -95.8, z: -62, rot: 1.1, scale: 5 },
    { key: 'hexBarrel', x: -95.4, z: -64, rot: 0, scale: 5, r: 1, h: 1.8 },
    // The three extra homes moved into EASTBROOK_LAYOUT.buildings (round 3):
    // as first-class houses they get lots, skirts, and lit windows there.
    // Flower plantings along the lamplit streets (owner refinement round 3):
    // walk-through dressing (no r/h), every cluster a hand-checked 2.2yd plus
    // off its street's centerline so nothing sits on the track.
    { key: 'shrubFlowering', x: -19, z: -95.5, rot: 1.8, scale: 1.0 },
    { key: 'shrubFlowering', x: 8.6, z: -82.6, rot: -1.2, scale: 0.95 },
    { key: 'shrubFlowering', x: -30, z: -96.4, rot: 0.2, scale: 1.05 },
    { key: 'shrubFlowering', x: -7.2, z: -124, rot: 2.7, scale: 0.95 },
    // fairway buoys marking the channel to the ferry berth
    { key: 'seaBuoy', x: -126, z: -46, rot: 0.4, scale: 3, float: 0.15 },
    { key: 'seaBuoyFlag', x: -124, z: -62, rot: -0.8, scale: 3, float: 0.15 },
    // round 4: the KayKit barracks takes the armoury's lot as the Wolf Run
    // garrison. r 5.2 stays the clearance radius scatter and keep-outs read
    // (the dawnhold_layout.ts pattern); hw/hd collide the model's real wall
    // box instead of that circle (the ZonePropsDef box rule): hw matches the
    // measured local-x wall half (4.68), hd is trimmed to the lot's authored
    // half-depth 4.5 so the barracks-approach route front at (12, -5.5)
    // keeps its route-body (0.8) clearance off the facade.
    {
      key: 'hexBarracks',
      x: 17.5,
      z: -5.5,
      rot: -1.5707963267948966,
      scale: 6.5,
      r: 5.2,
      h: 11,
      hw: 4.7,
      hd: 4.5,
    },
    // eyes over the runs
    { key: 'hexWatchtower', x: 27, z: -13, rot: 2.2, scale: 6.5, r: 2.4, h: 12 },
    // Round 5 (owner): Smith Haldren gets his own KayKit blacksmith on the
    // green between the civic square and the crafts lane, facing west toward
    // the lane. The kmed hollow variant is the BLUE-awning colourway the owner
    // asked for; it shares the hex blacksmith mesh byte for byte, so the
    // measured wall box (1.2876 x 1.2452 at scale 6.5) and the r clearance
    // radius carry over unchanged.
    {
      key: 'kmedBlacksmith',
      x: 2,
      z: -112,
      rot: -1.5707963267948966,
      scale: 6.5,
      r: 4.5,
      h: 9,
      hw: 4.2,
      hd: 4.05,
    },
    // Round 6 (owner): the Pale Keeper's yard rebuilt on the Evergarden
    // churchyard idiom (content/evergarden.ts): a wrought-iron enclosure of
    // corner pillars and 4yd rails at a 3.5yd pitch, walk-through dressing with
    // no colliders, wrapping the graves with ONE side left gateless. The open
    // side is the EAST, because that is where the chapel, Brother Aldric, the
    // north road and the graveyard approach route all arrive; a closed box
    // there would fence the road out of its own churchyard. The town chapel at
    // (2,-78) sits a stride south of the south run, so church and yard read as
    // one place, and the lot the removed rise house left is the west half.
    { key: 'gardenIronPillar', x: -13, z: -73.5 },
    { key: 'gardenIronPillar', x: 3.2, z: -73.5 },
    { key: 'gardenIronPillar', x: -13, z: -66 },
    { key: 'gardenIronPillar', x: 3.2, z: -66 },
    { key: 'gardenIronFence', x: -11, z: -73.5 },
    { key: 'gardenIronFence', x: -7.5, z: -73.5 },
    { key: 'gardenIronFence', x: -4, z: -73.5 },
    { key: 'gardenIronFence', x: -0.5, z: -73.5 },
    { key: 'gardenIronFence', x: 2.2, z: -73.5 },
    { key: 'gardenIronFence', x: -11, z: -66 },
    { key: 'gardenIronFence', x: -7.5, z: -66 },
    { key: 'gardenIronFence', x: -4, z: -66 },
    { key: 'gardenIronFence', x: -0.5, z: -66 },
    { key: 'gardenIronFence', x: 2.2, z: -66 },
    { key: 'gardenIronFence', x: -13, z: -71.5, rot: Math.PI / 2 },
    { key: 'gardenIronFence', x: -13, z: -68, rot: Math.PI / 2 },
    // two yews for churchyard shade, clear of both grave plots
    { key: 'oakTree', x: -11.5, z: -71.8, rot: 0.6, scale: 1.3, r: 0.8, h: 9 },
    { key: 'oakTree', x: -11.5, z: -67.6, rot: -1.1, scale: 1.2, r: 0.8, h: 9 },
    // Round 6 (owner): kitchen gardens behind the harbour quarter's houses and
    // a bench at each door. Walk-through dressing like the churchyard rails, so
    // a garden never becomes an invisible wall across the seaward approach.
    // Every spot was probed clear of the roads and of its own house footprint.
    { key: 'fence', x: -77.1, z: -98.5, rot: 0.94, scale: 3 },
    { key: 'fence', x: -75, z: -96.9, rot: 0.94, scale: 3 },
    { key: 'fence', x: -78.7, z: -96.4, rot: -0.63, scale: 3 },
    { key: 'fence', x: -45.1, z: -108.5, rot: 0.94, scale: 3 },
    { key: 'fence', x: -43, z: -106.9, rot: 0.94, scale: 3 },
    { key: 'fence', x: -46.7, z: -106.4, rot: -0.63, scale: 3 },
    { key: 'shrubFlowering', x: -76.2, z: -97.6, rot: 0.3, scale: 0.9 },
    { key: 'shrubFlowering', x: -44.2, z: -107.6, rot: -0.8, scale: 0.95 },
    // Round 6c (owner): blooms where the west road ends in the boar meadow,
    // walk-through like every flower, set off the painted track
    { key: 'shrubFlowering', x: 55, z: -66, rot: -1.2, scale: 0.95 },
    { key: 'shrubFlowering', x: 50, z: -76, rot: 0.3, scale: 0.9 },
    { key: 'kcasBench', x: -86.4, z: -105.2, rot: -2.2, scale: 1.6 },
    { key: 'kcasBench', x: -72.4, z: -111.2, rot: -2.2, scale: 1.6 },
    { key: 'kcasBench', x: -54.4, z: -115.2, rot: -2.2, scale: 1.6 },
  ],
  docks: [{ x: -64, z: 60, rot: -2.2, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } }],
  // The first two tents, the first two crates and the first campfire are the
  // main bandit band's camp dressing and travelled north with it in the round 6
  // swap; the rest belong to Gorrak's camp, which did not move.
  tents: [
    { x: 58, z: 25, rot: 0.4, scale: 1 },
    { x: 68, z: 16, rot: 2.1, scale: 1 },
    { x: 113, z: 47, rot: 1.2, scale: 1.3 },
    { x: 119, z: 39, rot: -0.6, scale: 1 },
    // Round 6 (owner): a fisherman's camp on the strand south of the quay,
    // sharing its fire with the rowboats hauled up beside it
    { x: -90.5, z: -78.5, rot: -0.9, scale: 1 },
  ],
  crates: [
    [56, 22],
    [64, 26],
    [112, 44],
    [118, 40],
    [66, 14],
  ],
  campfires: [
    // off the camp centre on purpose: a campfire carries a collider, and a
    // camp whose centre is blocked cannot seat its spawns
    [59, 17],
    [111, 46],
    // the shore camp's fire, beside the beached rowboats (round 6)
    [-93.5, -76.5],
    [-30, 146],
    [-61, 56],
  ],
  mudHuts: [
    [-73, 59],
    [-78, 54],
    [-69, 55],
  ],
  marshReeds: [],
  ruinRings: [
    { x: 80, z: 78, ringR: 7, columns: 7 },
    { x: -5, z: -60, ringR: 8, columns: 6 },
  ],
  fences: EASTBROOK_LAYOUT.fences.map((fence) => ({
    id: fence.id,
    assetId: fence.assetId,
    x1: fence.start.x,
    z1: fence.start.z,
    x2: fence.end.x,
    z2: fence.end.z,
    width: fence.width,
    height: fence.height,
  })),
  benches: EASTBROOK_LAYOUT.civic.benches.map((bench) => ({
    id: bench.id,
    assetId: bench.assetId,
    x: bench.position.x,
    z: bench.position.z,
    w: bench.width,
    d: bench.depth,
    rot: bench.rotation,
    height: 1,
  })),
  walls: EASTBROOK_LAYOUT.wall.segments.map((segment) => ({
    id: segment.id,
    assetId: segment.assetId,
    x: segment.footprint.center.x,
    z: segment.footprint.center.z,
    w: segment.footprint.halfWidth * 2,
    d: segment.footprint.halfDepth * 2,
    rot: segment.footprint.rotation,
    height: segment.height,
    // The wing's tall lantern pillar sits gate-side on mirrored segments;
    // the collider builder places the pylon colliders from this.
    ...(wallSegmentMirrored(segment) ? { mirrored: true as const } : {}),
  })),
  // The third anchor is the north-Vale yard on the Copper Dig road: every
  // graveyard record spawns a Pale Keeper, and a keeper with no graves under
  // her reads as a bug, so the headstone cluster goes where the release does
  // (content/graveyards.ts gy_vale_north).
  graveyards: [
    { ...EASTBROOK_LAYOUT.services.graveyard.position },
    { x: -22, z: 118 },
    // Round 6 (owner): a second plot filling the west half of the churchyard
    // enclosure. Anchors here render six more standable headstones; only the
    // OVERWORLD_GRAVEYARDS rows spawn a Pale Keeper, so this plot adds graves
    // without a second angel hovering ten yards from the first.
    { x: -9, z: -70 },
  ],
  // Round 6b (owner): the Collapsed Reliquary moved off the town's chapel rise
  // to the Mirror Lake shore. The lake's own margin is marsh and the north
  // beach sits barely a foot above the tideline, so the mouth takes the
  // nearest stable ground, 18 yd off the water.
  delveMarkers: [{ x: -136, z: 112, delveId: 'collapsed_reliquary' }],
};
