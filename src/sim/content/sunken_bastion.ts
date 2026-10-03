// The Sunken Bastion rework (docs/design/dungeon-rework/sunken_bastion.md): the
// new trash, the Turretback Hermit and Gaoler Ossick, the packs placed on the
// open-air sea fortress (sunken_bastion_layout.ts), the patrols, and the gates
// and encounter seals that make every pack mandatory. The shipped Bastion
// templates (Bastion Revenant, Tidebound Acolyte, Drowned Thrall,
// Knight-Commander Olen, Vael the Fogbinder) stay in dungeons.ts under their
// frozen ids. Merged by data.ts (mobs) and dungeons.ts (spawns, gates,
// objects).
//
// Trash is simple and readable (README section 5): one job per type, never a
// boss lesson.
//
//   Bastion Revenant    Onrush and Maiming Strike (shipped).
//   Tidebound Acolyte   Brine Mend: an interruptible heal on a hurt ally. Kick it.
//   Drowned Watchman    Halberd Sweep: a telegraphed frontal. Step out.
//   Fogbound Arbalest   Piercing Bolt: a lane shot at one player. Step aside.
//   Barnacle Crawler    Brine Burst: bursts where it dies. Move off the corpse.
//   Bastion Warhound    Lunge: leaps onto the farthest caster and stuns them.
//   Mistweaver          Fog Ward: an interruptible shield on an ally. Kick it.
//   Drowned Sergeant    Rally the Watch (haste to its pack), enrages when low.
//   Shackled Prisoner   fodder, in fours and fives.
//
// The Gaol Turnkey is the gaol's miniboss (encounters/sunken_bastion/
// turnkey.ts): the Iron Cage, a button-mash escape, and Open the Cells.
//
// Numbers are classic-era normal-mode bases for levels 11 to 13, anchored to
// the shipped Bastion Revenant and Vael's Mist Surge (16 to 24) and to a level
// 13 cloth wearer of about 430 health (README section 7). Heroic scales them
// through the dungeon's difficulty transform (mechanicDamageMult).

import {
  BASTION_BRINE_MEND,
  BASTION_CLAW_SWEEP,
  BASTION_FOG_WARD,
  BASTION_HALBERD_SWEEP,
  BASTION_PIERCING_BOLT,
  BASTION_SHELL_SLAM,
} from '../mob/trash_kit/bastion_cast_ids';
import type {
  DungeonGateDef,
  DungeonObjectSpawn,
  DungeonSpawn,
  MobTemplate,
  TrashKitDef,
} from '../types';
import {
  BAILEY_CHAPEL,
  BASTION_BUTTRESSES,
  DROWNING_YARD,
  FOGBEACON,
} from './sunken_bastion_layout';

const BONE_LOOT = [
  { copper: 150, chance: 1 },
  { itemId: 'bone_fragments', chance: 0.7 },
];
const CASTER_LOOT = [
  { copper: 165, chance: 1 },
  { itemId: 'linen_scrap', chance: 0.5 },
];

/** The Tidebound Acolyte's Brine Mend (the shipped acolyte's new kit). */
export const BRINE_MEND_KIT: TrashKitDef = {
  mend: {
    castId: BASTION_BRINE_MEND,
    name: 'Brine Mend',
    castTime: 2.5,
    every: 12,
    first: 4,
    school: 'nature',
    range: 25,
    healPct: 0.3,
    below: 0.75,
  },
};

export const SUNKEN_BASTION_MOBS: Record<string, MobTemplate> = {
  drowned_watchman: {
    id: 'drowned_watchman',
    name: 'Drowned Watchman',
    minLevel: 12,
    maxLevel: 12,
    family: 'undead',
    elite: true,
    hpBase: 54,
    hpPerLevel: 21,
    dmgBase: 9,
    dmgPerLevel: 2.4,
    attackSpeed: 2.6,
    armorPerLevel: 20,
    moveSpeed: 6.5,
    aggroRadius: 12,
    // A wide, slow, telegraphed halberd sweep: only the tank should be in it.
    breathCone: {
      castId: BASTION_HALBERD_SWEEP,
      name: 'Halberd Sweep',
      castTime: 1.5,
      every: 11,
      range: 6,
      arcDeg: 100,
      min: 45,
      max: 55,
      school: 'physical',
    },
    loot: BONE_LOOT,
    scale: 1.1,
    color: 0x9fb3ae,
  },
  fogbound_arbalest: {
    id: 'fogbound_arbalest',
    name: 'Fogbound Arbalest',
    minLevel: 12,
    maxLevel: 12,
    family: 'undead',
    elite: true,
    hpBase: 44,
    hpPerLevel: 18,
    dmgBase: 7,
    dmgPerLevel: 2,
    attackSpeed: 2.4,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 14,
    // Keeps its distance and looses rusted bolts between its Piercing Bolts.
    petSpell: {
      name: 'Rusted Bolt',
      school: 'physical',
      min: 14,
      max: 20,
      range: 28,
      every: 3,
      windup: 0.6,
    },
    trashKit: {
      line: {
        castId: BASTION_PIERCING_BOLT,
        name: 'Piercing Bolt',
        castTime: 2,
        every: 10,
        first: 4,
        school: 'physical',
        length: 25,
        halfWidth: 1.1,
        min: 55,
        max: 65,
      },
    },
    loot: BONE_LOOT,
    scale: 1.0,
    color: 0x8fa39a,
  },
  barnacle_crawler: {
    id: 'barnacle_crawler',
    name: 'Barnacle Crawler',
    minLevel: 11,
    maxLevel: 11,
    family: 'beast',
    hpBase: 40,
    hpPerLevel: 10,
    // Priced so ONE template serves both roles on heroic: a pack crawler at the
    // 18x trash line clears the 500 floor, the Hermit's summoned crawler at the
    // 9.75x add line stays between the 150 add floor and 500. Normal damps it
    // back to its fodder swing (dungeon_difficulty.ts, the normal row).
    dmgBase: 14.5,
    dmgPerLevel: 4.06,
    attackSpeed: 2,
    armorPerLevel: 16,
    moveSpeed: 7.5,
    aggroRadius: 10,
    untameable: true,
    // Burst where it dies: move off the shell before the brine goes up.
    deathThroes: {
      min: 30,
      max: 40,
      radius: 4,
      delay: 1.5,
      name: 'Brine Burst',
      school: 'frost',
    },
    loot: [{ copper: 30, chance: 1 }],
    scale: 1.2,
    color: 0xcfc6b0,
  },
  bastion_warhound: {
    id: 'bastion_warhound',
    name: 'Bastion Warhound',
    minLevel: 12,
    maxLevel: 12,
    family: 'beast',
    elite: true,
    hpBase: 48,
    hpPerLevel: 19,
    dmgBase: 8,
    dmgPerLevel: 2.2,
    attackSpeed: 1.8,
    armorPerLevel: 14,
    moveSpeed: 8.5,
    aggroRadius: 12,
    untameable: true,
    // Lunge: leaps onto the farthest caster and knocks them flat for a second.
    trashKit: {
      leap: {
        name: 'Lunge',
        every: 14,
        first: 3,
        minRange: 8,
        maxRange: 25,
        seconds: 0.6,
        fixate: 3,
        stun: 1,
      },
    },
    loot: [{ copper: 120, chance: 1 }],
    scale: 1.25,
    color: 0x5e6f6a,
  },
  mistweaver: {
    id: 'mistweaver',
    name: 'Mist Chanter',
    minLevel: 13,
    maxLevel: 13,
    family: 'humanoid',
    elite: true,
    hpBase: 46,
    hpPerLevel: 18,
    dmgBase: 7,
    dmgPerLevel: 2,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    petSpell: {
      name: 'Chilling Mist',
      school: 'frost',
      min: 14,
      max: 20,
      range: 26,
      every: 3.2,
      windup: 0.6,
    },
    trashKit: {
      ward: {
        castId: BASTION_FOG_WARD,
        name: 'Fog Ward',
        castTime: 2,
        every: 14,
        first: 4,
        school: 'frost',
        range: 20,
        shieldPct: 0.25,
        duration: 12,
      },
    },
    loot: CASTER_LOOT,
    scale: 1.0,
    color: 0x9fe0b0,
  },
  drowned_sergeant: {
    id: 'drowned_sergeant',
    name: 'Drowned Sergeant',
    minLevel: 13,
    maxLevel: 13,
    family: 'undead',
    elite: true,
    hpBase: 70,
    hpPerLevel: 25,
    dmgBase: 11,
    dmgPerLevel: 2.7,
    attackSpeed: 2.6,
    armorPerLevel: 26,
    moveSpeed: 6.5,
    aggroRadius: 12,
    // Rally the Watch: quickens its pack's swings. Kill it first or tank it apart.
    warcry: {
      radius: 12,
      every: 16,
      hasteMult: 1.2,
      duration: 8,
      name: 'Rally the Watch',
      school: 'physical',
    },
    // Classic trash frenzy: harder and faster, the shipped 1.3 / 1.2 pairing.
    enrage: { belowHpPct: 0.3, dmgMult: 1.3, hasteMult: 1.2 },
    yells: { enrage: 'Hold the wall, you dogs!' },
    loot: [
      { copper: 220, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.9 },
    ],
    scale: 1.4,
    color: 0x7d8f8a,
  },
  shackled_prisoner: {
    id: 'shackled_prisoner',
    name: 'Shackled Prisoner',
    minLevel: 11,
    maxLevel: 11,
    family: 'undead',
    hpBase: 30,
    hpPerLevel: 9,
    // Same two-role pricing as the Barnacle Crawler (pack prisoner and the
    // Turnkey's released prisoners share the template).
    dmgBase: 11.6,
    dmgPerLevel: 3.77,
    attackSpeed: 2.2,
    armorPerLevel: 6,
    moveSpeed: 6,
    aggroRadius: 10,
    xpMult: 0.4,
    loot: [{ copper: 12, chance: 1 }],
    scale: 0.9,
    color: 0x9a9480,
  },
  // The gaol's miniboss (encounters/sunken_bastion/turnkey.ts): the drowned
  // jailer drops the Iron Cage on a player, who mashes the interact key to
  // break out while the group smashes the bars. About 3,600 health on normal
  // through the Bastion's tuning row (a 50 s fight at planning DPS).
  gaol_turnkey: {
    id: 'gaol_turnkey',
    name: 'Gaol Turnkey',
    minLevel: 13,
    maxLevel: 13,
    family: 'humanoid',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 150,
    hpPerLevel: 32,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.6,
    armorPerLevel: 24,
    moveSpeed: 6.5,
    aggroRadius: 12,
    // Open the Cells: at half health the lantern goes up and two prisoners
    // break out. Kill them fast.
    summonAdds: { mobId: 'shackled_prisoner', count: 2, atHpPct: [0.5] },
    yells: { summon: 'Out, all of you! Out and at them!' },
    // One guaranteed piece per archetype group, like the bosses, a tier under.
    loot: [
      { copper: 600, chance: 1 },
      { itemId: 'jailers_iron_gauntlets', chance: 0.34, rollGroup: 'turnkey_guaranteed' },
      { itemId: 'turnkeys_keyring_belt', chance: 0.33, rollGroup: 'turnkey_guaranteed' },
      { itemId: 'turnkeys_lantern_cowl', chance: 0.33, rollGroup: 'turnkey_guaranteed' },
    ],
    // The body's gameplay scale (reach, collision) stays the trash turnkey's;
    // the miniboss presence is its drawn height (the VISUALS row).
    scale: 1.3,
    color: 0x6a5a48,
  },
  // The Turnkey's Iron Cage (encounters/sunken_bastion/turnkey.ts): a WARD
  // (ward_hits.ts), never a fighter. Its health is its points, set at the drop;
  // the prisoner's escape presses and the group's hits break them.
  bastion_gaol_cage: {
    id: 'bastion_gaol_cage',
    name: 'Iron Cage',
    minLevel: 13,
    maxLevel: 13,
    family: 'undead',
    ccImmune: true,
    slowImmune: true,
    ignoreTaunt: true,
    quietMechanics: true,
    xpMult: 0,
    hpBase: 16,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 999,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    idleStationary: true,
    loot: [],
    scale: 1,
    color: 0x5a4a3c,
  },
  // Ossick's Drowned Anchor (encounters/sunken_bastion/ossick.ts): a WARD
  // riding its hooked victim. Its health is the chain's links, set at the throw.
  bastion_drowned_anchor: {
    id: 'bastion_drowned_anchor',
    name: 'Drowned Anchor',
    minLevel: 13,
    maxLevel: 13,
    family: 'undead',
    ccImmune: true,
    slowImmune: true,
    ignoreTaunt: true,
    quietMechanics: true,
    xpMult: 0,
    hpBase: 12,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 999,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    idleStationary: true,
    loot: [],
    scale: 1,
    color: 0x4a5250,
  },
  // The showpiece: a colossal hermit crab that took a fallen watchtower turret
  // for its shell and walks the moat ring round the Drowned Chapel.
  turretback_hermit: {
    id: 'turretback_hermit',
    name: 'The Turretback Hermit',
    minLevel: 13,
    maxLevel: 13,
    family: 'beast',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    untameable: true,
    // About 4,500 health on normal and 13,800 on heroic through the Bastion's
    // tuning rows (dungeon_difficulty.ts healthMultiplierByMob).
    hpBase: 150,
    hpPerLevel: 32,
    dmgBase: 12,
    dmgPerLevel: 2.8,
    attackSpeed: 2.8,
    armorPerLevel: 30,
    moveSpeed: 5,
    aggroRadius: 11,
    // The crab is drawn 8.6 yd wide under its 15 yd tower: melee reaches it
    // from 7.5 yd (bodyRadius + 3) instead of from under the shell, still
    // inside the Shell Slam's 8, and its own claws reach 8.5.
    bodyRadius: 4.5,
    // Claw Sweep: a wide frontal. The tank turns it away from the group.
    breathCone: {
      castId: BASTION_CLAW_SWEEP,
      name: 'Claw Sweep',
      castTime: 2,
      every: 12,
      range: 10,
      arcDeg: 120,
      min: 90,
      max: 110,
      school: 'physical',
    },
    trashKit: {
      // Shell Slam: the tower comes down round it and throws the close ones back.
      wingGust: {
        castId: BASTION_SHELL_SLAM,
        name: 'Shell Slam',
        castTime: 1.5,
        every: 16,
        first: 8,
        school: 'physical',
        radius: 8,
        knockback: 6,
        min: 50,
        max: 60,
      },
      // Withdraw: once, under a quarter, it pulls into the tower for six seconds.
      withdraw: { belowHpPct: 0.25, seconds: 6, reduction: 0.6, name: 'Withdraw' },
    },
    // Barnacle Brood: crawlers drop off the shell at 60 and 30 percent.
    summonAdds: { mobId: 'barnacle_crawler', count: 2, atHpPct: [0.6, 0.3] },
    yells: { summon: 'Barnacles rain from the swaying tower!' },
    loot: [
      { copper: 600, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
    ],
    scale: 1.0,
    color: 0xb8a078,
  },
  // Vael's shadow copies (encounters/sunken_bastion/vael.ts): during a Fog Veil
  // three of them stand on the rim with the real Vael, wearing his name, his
  // health and his reaper's look. They never fight back; one hit bursts a shade.
  vael_fog_shade: {
    id: 'vael_fog_shade',
    name: 'Vael the Fogbinder',
    minLevel: 13,
    maxLevel: 13,
    family: 'humanoid',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 240,
    hpPerLevel: 34,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 999,
    armorPerLevel: 26,
    moveSpeed: 0,
    aggroRadius: 0,
    xpMult: 0,
    idleStationary: true,
    loot: [],
    scale: 1.35,
    color: 0x48c9b0,
  },
  // Boss 2: Gaoler Ossick in the Drowning Yard (encounter module:
  // src/sim/encounters/sunken_bastion/ossick.ts).
  gaoler_ossick: {
    id: 'gaoler_ossick',
    name: 'Gaoler Ossick',
    minLevel: 13,
    maxLevel: 13,
    family: 'undead',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    // About 6,800 health on normal through the Bastion's tuning row.
    hpBase: 120,
    hpPerLevel: 26,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.4,
    armorPerLevel: 24,
    moveSpeed: 7,
    aggroRadius: 14,
    // One guaranteed piece per archetype group, plus the Cudgel chase row.
    // Heroic rides HEROIC_BOSS_LOOT.gaoler_ossick.
    loot: [
      { copper: 1000, chance: 1 },
      {
        itemId: 'gaolers_chain_girdle',
        chance: 0.34,
        rollGroup: 'ossick_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'rusted_shackle_grips',
        chance: 0.33,
        rollGroup: 'ossick_guaranteed',
        normalOnly: true,
      },
      {
        itemId: 'drowned_wardens_mantle',
        chance: 0.33,
        rollGroup: 'ossick_guaranteed',
        normalOnly: true,
      },
      { itemId: 'gaolyard_cudgel', chance: 0.1, normalOnly: true },
    ],
    scale: 1.4,
    color: 0x6f6252,
  },
};

// ---- Spawns ---------------------------------------------------------------

const FACE_SOUTH = Math.PI; // toward the entrance
const FACE_NORTH = 0;
const FACE_EAST = Math.PI / 2;
const FACE_WEST = -Math.PI / 2;

/** A pack member holding formation until pulled. */
function held(
  mobId: string,
  x: number,
  z: number,
  packId: string,
  facing = FACE_SOUTH,
): DungeonSpawn {
  return { mobId, x, z, facing, packId, idleStationary: true };
}

function patrolling(
  mobId: string,
  points: readonly { x: number; z: number }[],
  packId: string,
  offset: number,
  pace?: number,
): DungeonSpawn {
  return {
    mobId,
    x: points[0].x,
    z: points[0].z,
    packId,
    patrol: { points, offset, ...(pace !== undefined ? { pace } : {}) },
  };
}

// Pack ids read as <area><n>: f the flats, b the bailey, r the ramparts, g
// the gaol, k the keep. Seven patrols: fa the watch on the flats, fb the
// tideline hunters, hermit the Turretback round the moat, bc the bailey watch,
// rc the arbalests on the wall-walk, gd the gaol yard's round, kc the court
// hounds. The Gaol Turnkey, the gaol's miniboss, holds its own pull.

/** Patrol A: three watchmen walking between the wrecks. */
const FLATS_LOOP = [
  { x: -32, z: -168 },
  { x: 24, z: -168 },
  { x: 24, z: -192 },
  { x: -32, z: -192 },
];
/** The Turretback Hermit's walk round the moat ring (clockwise from the south). */
const MOAT_LOOP = Array.from({ length: 12 }, (_, i) => {
  const a = Math.PI + (i / 12) * Math.PI * 2;
  const r = (BAILEY_CHAPEL.island + BAILEY_CHAPEL.moat) / 2;
  return { x: BAILEY_CHAPEL.x + Math.sin(a) * r, z: BAILEY_CHAPEL.z + Math.cos(a) * r };
});
/** Patrol C: a round of the wall-walk between the two towers, passing close
 *  under both tower packs (it used to walk straight through them). */
const RAMPART_LOOP = [
  { x: 51, z: 51 },
  { x: 51, z: 58 },
  { x: 63, z: 58 },
  { x: 63, z: 51 },
];
/** Patrol E: two crawlers and a warhound working the western flats, between
 *  the wreck and the Sea Gate: in the way of the f1 pull and of the f3 pull. */
const TIDELINE_LOOP = [
  { x: -80, z: -146 },
  { x: -40, z: -140 },
  { x: -40, z: -150 },
  { x: -78, z: -154 },
];
/** Patrol F: a watch of three walking the bailey's north lip, from the Chapel
 *  Yard to the drawbridge ditch, passing over the Hermit's moat walk. */
const BAILEY_WATCH = [
  { x: -62, z: -52 },
  { x: 40, z: -52 },
];
/** Patrol D: the watch's round of the gaol yard. */
const GAOL_LOOP = [
  { x: -16, z: 76 },
  { x: 16, z: 76 },
  { x: 16, z: 96 },
  { x: -16, z: 96 },
];
/** Patrol G: two warhounds circling the Keep Court's west half, beside the
 *  court's last guard (k3). */
const COURT_LOOP = [
  { x: -72, z: 142 },
  { x: -72, z: 168 },
  { x: -62, z: 168 },
  { x: -62, z: 142 },
];

export const SUNKEN_BASTION_SPAWNS: DungeonSpawn[] = [
  // ---- The Tidal Flats --------------------------------------------------------
  // f1: the first wreck. Two revenants and two crawlers picking at the hull.
  held('bastion_revenant', -54, -178, 'f1', FACE_EAST),
  held('bastion_revenant', -54, -186, 'f1', FACE_EAST),
  held('barnacle_crawler', -58, -172, 'f1', FACE_EAST),
  held('barnacle_crawler', -59, -190, 'f1', FACE_EAST),
  // f2: the broken outwork. An acolyte behind two watchmen and a warhound.
  held('drowned_watchman', 48, -162, 'f2', FACE_WEST),
  held('drowned_watchman', 48, -154, 'f2', FACE_WEST),
  held('tidebound_acolyte', 54, -158, 'f2', FACE_WEST),
  held('bastion_warhound', 44, -166, 'f2', FACE_WEST),
  // Patrol A: three watchmen walking between the wrecks.
  patrolling('drowned_watchman', FLATS_LOOP, 'fa', 0),
  patrolling('drowned_watchman', FLATS_LOOP, 'fa', 3),
  patrolling('drowned_watchman', FLATS_LOOP, 'fa', 6),
  // Patrol E: the tideline hunters, two crawlers and a warhound.
  patrolling('barnacle_crawler', TIDELINE_LOOP, 'fb', 0),
  patrolling('barnacle_crawler', TIDELINE_LOOP, 'fb', 2.5),
  patrolling('bastion_warhound', TIDELINE_LOOP, 'fb', 5),
  // f3: before the Sea Gate. A sergeant and two revenants.
  held('drowned_sergeant', 0, -146, 'f3'),
  held('bastion_revenant', -5, -150, 'f3'),
  held('bastion_revenant', 5, -150, 'f3'),
  // ---- The Lower Bailey ---------------------------------------------------------
  // b1: the Chapel Yard (west). A Mistweaver, two revenants, two crawlers.
  held('mistweaver', -60, -88, 'b1', FACE_EAST),
  held('bastion_revenant', -54, -84, 'b1', FACE_EAST),
  held('bastion_revenant', -54, -92, 'b1', FACE_EAST),
  held('barnacle_crawler', -50, -80, 'b1', FACE_EAST),
  held('barnacle_crawler', -50, -96, 'b1', FACE_EAST),
  // b2: the Cistern Yard (east). Two acolytes and two warhounds.
  held('tidebound_acolyte', 58, -86, 'b2', FACE_WEST),
  held('tidebound_acolyte', 58, -94, 'b2', FACE_WEST),
  held('bastion_warhound', 52, -84, 'b2', FACE_WEST),
  held('bastion_warhound', 52, -96, 'b2', FACE_WEST),
  // Patrol B: the Turretback Hermit, round the moat.
  patrolling('turretback_hermit', MOAT_LOOP, 'hermit', 0, 0.35),
  // Patrol F: the bailey watch, a watchman, an arbalest and a revenant.
  patrolling('drowned_watchman', BAILEY_WATCH, 'bc', 0),
  patrolling('fogbound_arbalest', BAILEY_WATCH, 'bc', 2.5),
  patrolling('bastion_revenant', BAILEY_WATCH, 'bc', 5),
  // ---- The Rampart Walk ---------------------------------------------------------
  // r1: the first tower. Three arbalests at the crenels and their sergeant.
  held('drowned_sergeant', 61, 32, 'r1'),
  held('fogbound_arbalest', 64, 38, 'r1'),
  held('fogbound_arbalest', 58, 40, 'r1'),
  held('fogbound_arbalest', 62, 43, 'r1'),
  // r2: the second tower. A Mistweaver, two watchmen and two crawlers.
  held('drowned_watchman', 58, 67, 'r2'),
  held('drowned_watchman', 64, 67, 'r2'),
  held('mistweaver', 61, 76, 'r2'),
  held('barnacle_crawler', 55, 72, 'r2'),
  held('barnacle_crawler', 66, 73, 'r2'),
  // Patrol C: two arbalests and a warhound walking the wall.
  patrolling('fogbound_arbalest', RAMPART_LOOP, 'rc', 0),
  patrolling('fogbound_arbalest', RAMPART_LOOP, 'rc', 3),
  patrolling('bastion_warhound', RAMPART_LOOP, 'rc', 6),
  // Boss 1: Knight-Commander Olen on the Breach Bastion.
  {
    mobId: 'knight_commander_olen',
    x: 57,
    z: 128,
    facing: FACE_SOUTH,
    idleStationary: true,
  },
  // ---- The Sunken Gaol ---------------------------------------------------------
  // The Gaol Turnkey, the gaol's miniboss, by the dead turnkeys' cell doors
  // under the north-west cliff, where the Postern Stair comes down.
  held('gaol_turnkey', -24, 102, 'turnkey', Math.PI * 0.75),
  // g1: the cell row (west). Four prisoners.
  held('shackled_prisoner', -28, 76, 'g1', FACE_EAST),
  held('shackled_prisoner', -28, 88, 'g1', FACE_EAST),
  held('shackled_prisoner', -35, 76, 'g1', FACE_EAST),
  held('shackled_prisoner', -35, 88, 'g1', FACE_EAST),
  // g2: the flooded well (east). Two revenants, an acolyte and a Mistweaver.
  held('bastion_revenant', 30, 80, 'g2', FACE_WEST),
  held('bastion_revenant', 30, 72, 'g2', FACE_WEST),
  held('tidebound_acolyte', 38, 76, 'g2', FACE_WEST),
  held('mistweaver', 38, 84, 'g2', FACE_WEST),
  // g3: the gibbet row (south). A sergeant and three prisoners.
  held('drowned_sergeant', 0, 62, 'g3', FACE_NORTH),
  held('shackled_prisoner', -5, 65, 'g3', FACE_NORTH),
  held('shackled_prisoner', 5, 65, 'g3', FACE_NORTH),
  held('shackled_prisoner', 0, 67, 'g3', FACE_NORTH),
  // Patrol D: a watchman and two warhounds on their round of the yard.
  patrolling('drowned_watchman', GAOL_LOOP, 'gd', 0),
  patrolling('bastion_warhound', GAOL_LOOP, 'gd', 3),
  patrolling('bastion_warhound', GAOL_LOOP, 'gd', 6),
  // Boss 2: Gaoler Ossick by the Drowning Winch, facing the grate.
  {
    mobId: 'gaoler_ossick',
    x: DROWNING_YARD.x,
    z: DROWNING_YARD.z - 12,
    facing: FACE_NORTH,
    idleStationary: true,
  },
  // ---- The Keep Stair and the Keep Court ------------------------------------
  // k1: the first balcony. Three arbalests over the Drowning Yard and an acolyte.
  held('fogbound_arbalest', -60, 20, 'k1', FACE_EAST),
  held('fogbound_arbalest', -64, 26, 'k1', FACE_EAST),
  held('fogbound_arbalest', -58, 28, 'k1', FACE_EAST),
  held('tidebound_acolyte', -66, 20, 'k1', FACE_EAST),
  // k2: the second landing. Two revenants and two warhounds.
  held('bastion_revenant', -60, 84, 'k2'),
  held('bastion_revenant', -66, 84, 'k2'),
  held('bastion_warhound', -58, 90, 'k2'),
  held('bastion_warhound', -67, 90, 'k2'),
  // k3: the Keep Court. The last guard before the Beacon Ward.
  held('drowned_sergeant', -48, 162, 'k3', FACE_WEST),
  held('drowned_watchman', -52, 157, 'k3', FACE_WEST),
  held('drowned_watchman', -52, 167, 'k3', FACE_WEST),
  held('mistweaver', -42, 158, 'k3', FACE_WEST),
  held('tidebound_acolyte', -42, 166, 'k3', FACE_WEST),
  // Patrol G: two warhounds circling the court.
  patrolling('bastion_warhound', COURT_LOOP, 'kc', 0),
  patrolling('bastion_warhound', COURT_LOOP, 'kc', 4),
  // Boss 3: Vael the Fogbinder on the Beacon Crown, north of the Fogbeacon.
  { mobId: 'vael_the_mistcaller', x: -4, z: 226, facing: FACE_SOUTH, idleStationary: true },
];

/** Every mandatory trash pull, patrols included, in route order (dev helpers, tests). */
export const SUNKEN_BASTION_PACKS = [
  'f1',
  'f2',
  'fa',
  'fb',
  'f3',
  'b1',
  'b2',
  'hermit',
  'bc',
  'r1',
  'r2',
  'rc',
  'turnkey',
  'g1',
  'g2',
  'g3',
  'gd',
  'k1',
  'k2',
  'k3',
  'kc',
] as const;

/** The seven patrols (dev helpers, tests). */
export const SUNKEN_BASTION_PATROLS = ['fa', 'fb', 'hermit', 'bc', 'rc', 'gd', 'kc'] as const;

/** The three bosses, in route order. */
export const SUNKEN_BASTION_BOSSES = [
  'knight_commander_olen',
  'gaoler_ossick',
  'vael_the_mistcaller',
] as const;

// ---- Gates and seals --------------------------------------------------------

/** Yaw of a gate box spanning a passage that runs along (dx, dz). */
function across(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export const SUNKEN_BASTION_GATES: DungeonGateDef[] = [
  {
    id: 'sea_gate',
    name: 'Sea Gate',
    kind: 'portcullis',
    x: 0,
    z: -130,
    hw: 7.6,
    rot: 0,
    packs: ['f1', 'f2', 'fa', 'fb', 'f3'],
    openText: 'Chains shriek in the fog. The Sea Gate grinds open.',
  },
  {
    id: 'bailey_drawbridge',
    name: 'Bailey Drawbridge',
    kind: 'drawbridge',
    x: 57,
    z: -44,
    hw: 6,
    rot: 0,
    packs: ['b1', 'b2', 'hermit', 'bc'],
    openText: 'The drawbridge crashes down over the ditch.',
  },
  {
    id: 'rampart_door',
    name: 'Rampart Door',
    kind: 'portcullis',
    x: 57,
    z: 100,
    hw: 7,
    rot: 0,
    packs: ['r1', 'r2', 'rc'],
    sealWhileEngaged: 'knight_commander_olen',
    openText: 'The Rampart Door lifts onto the Breach Bastion.',
  },
  {
    id: 'postern_fog',
    name: 'Postern Fog Wall',
    kind: 'fog_wall',
    x: 31,
    z: 126,
    hw: 5.6,
    rot: across(-1, 0),
    bosses: ['knight_commander_olen'],
    openText: 'The fog over the Postern Stair parts.',
  },
  {
    id: 'gaol_grate',
    name: 'Gaol Grate',
    kind: 'portcullis',
    x: -2,
    z: 50,
    hw: 8.6,
    rot: 0,
    packs: ['turnkey', 'g1', 'g2', 'g3', 'gd'],
    sealWhileEngaged: 'gaoler_ossick',
    openText: 'The Gaol Grate rattles up into the rock.',
  },
  {
    id: 'keep_chain',
    name: 'Keep Stair Chain',
    kind: 'portcullis',
    x: -27,
    z: 20,
    hw: 5.6,
    rot: across(-1, 0),
    bosses: ['gaoler_ossick'],
    openText: 'The chain grate at the Keep Stair winds up.',
  },
  {
    id: 'beacon_ward',
    name: 'Beacon Ward',
    kind: 'fog_wall',
    x: -21.5,
    z: 180,
    hw: 6,
    rot: across(9, 12),
    packs: ['k1', 'k2', 'k3', 'kc'],
    sealWhileEngaged: 'vael_the_mistcaller',
    openText: 'The fog on the beacon stair thins to nothing.',
  },
];

/** One inert ground object per gate: its template id carries the state. */
export const SUNKEN_BASTION_GATE_OBJECTS: DungeonObjectSpawn[] = SUNKEN_BASTION_GATES.map((g) => ({
  itemId: '',
  name: g.name,
  x: g.x,
  z: g.z,
  templateId: 'dungeon_gate_closed',
  dungeonId: 'sunken_bastion',
  lootable: false,
}));

/** The encounter objects (encounters/sunken_bastion): Olen's four buttresses
 *  and the Fogbeacon's lamp. Their template ids carry their state (intact,
 *  cracked or broken), so the online client mirrors each with the entity. */
export const SUNKEN_BASTION_ENCOUNTER_OBJECTS: DungeonObjectSpawn[] = [
  ...BASTION_BUTTRESSES.map(
    (b): DungeonObjectSpawn => ({
      itemId: '',
      name: 'Buttress',
      x: b.x,
      z: b.z,
      templateId: 'bastion_buttress_intact',
      dungeonId: 'sunken_bastion',
      lootable: false,
    }),
  ),
  {
    itemId: '',
    name: 'Fogbeacon',
    x: FOGBEACON.x,
    z: FOGBEACON.z,
    templateId: 'bastion_beacon_lamp',
    dungeonId: 'sunken_bastion',
    lootable: false,
  },
];
