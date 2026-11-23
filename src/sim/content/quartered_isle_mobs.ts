// The Quartered Isle's creatures: the council's servants in each art, the quarters'
// wildlife, and a named elite in each of the three ground quarters (the Gyre has no
// room for mobs). Every isle mob is level 20, the cap, on the band the other level-20
// zones share (content/galecrest.ts): regulars on Galecrest's open-ground band (base
// 52 to 58 + 18 to 19 a level, 11 to 12 + 2.2 to 2.3 a level, 105 copper), named
// elites on the Wreck Warden's (155 + 34, 17 + 3.0, a 2.2 to 2.3 s swing, 17 armour a
// level, 8 to 8.5 yd/s).
//
// Camps are `offStream`: they draw from their own private rng sub-streams, never the
// shared world-gen stream, so adding the isle's camps moves no earlier camp's draws
// (the same rule the Proving Shore follows; see the CAMPS array in data.ts). Every
// camp centre was chosen against the real terrain: dry plate ground in its quarter, off
// the roads, the lakes, the Challengers' Ring, Rivalmoot and every decor collider, on
// ground that varies by under 5 yd across its wander (tests/quartered_isle_mobs.test.ts).
import type { CampDef, MobTemplate } from '../types';

/** Where the Remnant stands guard: in the lee of the Fallen Giant (the Heavestone POI
 *  at (-122, 2306)), clear of the statue head, its block and the broken columns. */
export const REMNANT_CAMP_CENTER = { x: -124, z: 2292 } as const;

type Band = Pick<
  MobTemplate,
  | 'minLevel'
  | 'maxLevel'
  | 'hpBase'
  | 'hpPerLevel'
  | 'dmgBase'
  | 'dmgPerLevel'
  | 'attackSpeed'
  | 'armorPerLevel'
  | 'moveSpeed'
>;
/** The level-20 open-ground regular (Galecrest's Gale Wisp and Moor Ram). */
const REGULAR: Band = {
  minLevel: 20,
  maxLevel: 20,
  hpBase: 54,
  hpPerLevel: 18,
  dmgBase: 12,
  dmgPerLevel: 2.3,
  attackSpeed: 1.9,
  armorPerLevel: 11,
  moveSpeed: 8.5,
};
/** The level-20 named elite (the Wreck Warden, the Pale Huntsman, the Topiary Bull). */
const NAMED: Band = {
  minLevel: 20,
  maxLevel: 20,
  hpBase: 155,
  hpPerLevel: 34,
  dmgBase: 17,
  dmgPerLevel: 3.0,
  attackSpeed: 2.3,
  armorPerLevel: 17,
  moveSpeed: 8,
};
const REGULAR_LOOT = [{ copper: 105, chance: 1 }];
const NAMED_LOOT = [{ copper: 100, chance: 1 }];

export const QUARTERED_ISLE_MOBS: Record<string, MobTemplate> = {
  // ---- the Hoarshelf (the Quench, ice) ----
  quench_shardling: {
    ...REGULAR,
    id: 'quench_shardling',
    name: 'Quench Splinter',
    family: 'elemental',
    aggroRadius: 11, // the Quench's servants still keep the ice
    loot: REGULAR_LOOT,
    scale: 1,
    color: 0x9fd8ff,
  },
  rimeglass_bear: {
    ...REGULAR,
    id: 'rimeglass_bear',
    name: 'Rimeglass Bear',
    family: 'beast',
    hpBase: 58,
    hpPerLevel: 19,
    armorPerLevel: 13, // a frosted, matted coat
    attackSpeed: 2.0,
    moveSpeed: 8,
    aggroRadius: 9,
    loot: REGULAR_LOOT,
    scale: 1.1,
    color: 0xeef6ff,
    componentTags: ['hide', 'claw', 'meat'],
  },
  warden_of_the_quench: {
    ...NAMED,
    id: 'warden_of_the_quench',
    name: 'Warden of the Quench',
    family: 'elemental',
    aggroRadius: 14, // the last of the Quench's wardens holds the Crevasses
    elite: true,
    loot: NAMED_LOOT,
    scale: 1.2,
    color: 0xbfe6ff,
  },
  // ---- the Cinderscar (the Heat, fire) ----
  heatsworn_ember: {
    ...REGULAR,
    id: 'heatsworn_ember',
    name: 'Heatsworn Ember',
    family: 'elemental',
    aggroRadius: 11,
    loot: REGULAR_LOOT,
    scale: 1,
    color: 0xff9a3c,
  },
  cinderscar_caller: {
    ...REGULAR,
    id: 'cinderscar_caller',
    name: 'Cinderscar Caller',
    family: 'elemental',
    hpBase: 52,
    armorPerLevel: 9, // robed in ash, not stone
    aggroRadius: 12,
    // A ranged caster (the hostile-caster petSpell path, as the delve casters):
    // it holds at range and throws a fire bolt. Sized to its melee band's damage
    // per second at level 20: the melee swing averages 57 every 1.9 s (30 dps);
    // the bolt rolls 78 to 108 (min/max plus the level terms) every 3 s (31 dps).
    // The windup lands the release on Spellcast_Shoot's throw (manifest.ts).
    petSpell: {
      name: 'Burnway Flare',
      school: 'fire',
      min: 62,
      max: 86,
      range: 26,
      every: 3.0,
      windup: 0.45,
    },
    loot: REGULAR_LOOT,
    scale: 1,
    color: 0xd8542a,
  },
  ember_hound: {
    ...REGULAR,
    id: 'ember_hound',
    name: 'Ember Hound',
    family: 'beast',
    hpBase: 56,
    hpPerLevel: 19,
    armorPerLevel: 10,
    attackSpeed: 2.0,
    moveSpeed: 9, // a pack runner
    aggroRadius: 10,
    loot: REGULAR_LOOT,
    scale: 1.1,
    color: 0x3a2a24,
    componentTags: ['hide', 'fang', 'meat'],
  },
  the_glassfield_brute: {
    ...NAMED,
    id: 'the_glassfield_brute',
    name: 'The Glassfield Brute',
    family: 'elemental',
    aggroRadius: 14, // the Heat's warden, sunk in the glass it made
    elite: true,
    loot: NAMED_LOOT,
    scale: 1,
    color: 0xc0583a,
  },
  // ---- the Heavestone Wilds (the Hammer, earth) ----
  heaved_shardling: {
    ...REGULAR,
    id: 'heaved_shardling',
    name: 'Heaved Splinter',
    family: 'elemental',
    armorPerLevel: 14, // heaved sandstone
    aggroRadius: 11,
    loot: REGULAR_LOOT,
    scale: 1.1,
    color: 0xc8903c,
  },
  veinback_burrower: {
    ...REGULAR,
    id: 'veinback_burrower',
    name: 'Veinback Burrower',
    family: 'beast',
    hpBase: 56,
    hpPerLevel: 19,
    armorPerLevel: 13, // a crystal-veined shell
    attackSpeed: 2.0,
    moveSpeed: 7,
    aggroRadius: 8,
    loot: REGULAR_LOOT,
    scale: 1,
    color: 0xb08a5a,
    componentTags: ['hide', 'claw'],
  },
  // The council's first, failed try at the colossus that would hold Korzul: abandoned
  // half-carved, it has stood guard over its own fallen head ever since.
  remnant_first_colossus: {
    ...NAMED,
    id: 'remnant_first_colossus',
    name: 'Remnant of the First Colossus',
    family: 'elemental',
    aggroRadius: 14, // it still watches the ground the council gave it
    elite: true,
    loot: NAMED_LOOT,
    scale: 1,
    // two and a half players tall: a player's melee reaches it from its stone, not
    // from inside the model (combat/player_attack_reach.ts)
    bodyRadius: 1.6,
    color: 0xb59a7a,
  },
};

const camp = (mobId: string, x: number, z: number, radius: number, count: number): CampDef => ({
  mobId,
  center: { x, z },
  radius,
  count,
  offStream: true,
});

export const QUARTERED_ISLE_CAMPS: CampDef[] = [
  // The Remnant's camp shipped first: it stays first, so its spawn keeps its id.
  camp('remnant_first_colossus', REMNANT_CAMP_CENTER.x, REMNANT_CAMP_CENTER.z, 5, 1),
  // the Hoarshelf: Splinters on the Rimeglass and west of the bridge road, bears on the
  // floes east of it, the Warden alone in the Crevasses
  camp('quench_shardling', -78, 2034, 7, 3),
  camp('quench_shardling', -112, 2000, 7, 3),
  camp('quench_shardling', -126, 2064, 7, 3),
  camp('rimeglass_bear', 32, 2016, 8, 2),
  camp('rimeglass_bear', 4, 1996, 8, 2),
  camp('warden_of_the_quench', 62, 2036, 5, 1),
  // the Cinderscar: Embers in the Burnways, Callers beside them, hound packs set back
  // from the Cinderscar road, the Brute alone in the Glassfield
  camp('heatsworn_ember', 184, 2248, 7, 3),
  camp('heatsworn_ember', 190, 2224, 7, 3),
  camp('heatsworn_ember', 202, 2270, 7, 3),
  camp('cinderscar_caller', 172, 2202, 6, 2),
  camp('cinderscar_caller', 194, 2188, 6, 2),
  camp('ember_hound', 128, 2164, 8, 3),
  camp('ember_hound', 146, 2136, 8, 3),
  camp('the_glassfield_brute', 128, 2284, 5, 1),
  // the Heavestone Wilds: Splinters on the Heaved Slabs, Burrowers in and below the
  // Hammer's Cut (the Remnant's camp is above)
  camp('heaved_shardling', -212, 2210, 7, 3),
  camp('heaved_shardling', -174, 2208, 7, 3),
  camp('heaved_shardling', -184, 2246, 7, 3),
  camp('veinback_burrower', -144, 2182, 7, 3),
  camp('veinback_burrower', -148, 2136, 7, 3),
];
