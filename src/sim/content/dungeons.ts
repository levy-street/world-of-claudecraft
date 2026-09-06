// Dungeon content: mob templates that only spawn inside instances, spawn
// lists, and the DungeonDef registry merged by sim/data.ts.

import {
  IGNIVAR_BOSS_SPAWN_Z,
  IGNIVAR_CONDUITS,
  IGNIVAR_WATER_CONDUIT_TEMPLATES,
} from '../ignivar_arena';
import {
  IGNIVAR_CINDER_ARTIFICER_ID,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_GATE_LOCKED_TEMPLATE,
  IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../ignivar_raid_ids';
import { VARKHUL_CRUCIBLE_QUAKE_CAST_ID } from '../mob/healer_channel';
import type {
  DungeonDef,
  DungeonSpawn,
  DungeonSpawnMinibossTuning,
  ItemDef,
  LootEntry,
  MobTemplate,
} from '../types';
import { HEROIC_FINALE_COPPER, NYTHRAXIS_HEROIC_COPPER } from './dungeon_difficulty';
import { CRUCIBLE_VENDOR_NPC_ID } from './ignivar_loot';
import {
  IGNIVAR_LORE_OBJECTS,
  IGNIVAR_MAELIN_NPC_ID,
  IGNIVAR_MAELIN_PROJECTION_NPC_ID,
  IGNIVAR_RECORD_IDS,
} from './ignivar_raid_lore';

// Keepsake ground-object items owned by the walk-in castle interiors below
// (their zone item modules are other workstreams' files), merged into ITEMS
// by sim/data.ts. The Last Keep's signet lives in drakelands.ts; Dawnhold's
// posy lands here beside its dungeon def.
export const DUNGEON_KEEPSAKE_ITEMS: Record<string, ItemDef> = {
  // Dawnhold Castle's conservatory souvenir: the interior instance's one
  // ground object (a dungeon must place at least one encounter; the
  // zero-combat palace places a keepsake instead of a fight).
  dawnhold_posy: {
    id: 'dawnhold_posy',
    name: 'Dawnhold Garden Posy',
    kind: 'junk',
    sellValue: 25,
  },
};

// A Normal-only exclusive-group row (LootEntry.normalOnly): a heroic claim
// skips the whole group and the boss's HEROIC_BOSS_LOOT slot pays instead, so
// Heroic REPLACES the slot rather than stacking on it (loot_difficulty_gate.ts).
const normalOnlyRow = (rollGroup: string, itemId: string, chance: number): LootEntry => ({
  itemId,
  chance,
  rollGroup,
  normalOnly: true,
});

export const DUNGEON_MOBS: Record<string, MobTemplate> = {
  // WIP forge mech enemy: a downed automaton that lies still on the ground until
  // pulled, then crawls, lurches up to strike, and dies (visual mob_mech /
  // mech.glb). idleStationary keeps it motionless in its pack formation; the
  // render side freezes it on the first crawl frame (VisualDef.idleFrozen).
  // Placeholder stats, tune per role.
  derelict_mech: {
    id: 'derelict_mech',
    name: 'Derelict Mech',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 400,
    hpPerLevel: 60,
    dmgBase: 24,
    dmgPerLevel: 4.5,
    attackSpeed: 2.6,
    armorPerLevel: 40,
    moveSpeed: 6.5,
    aggroRadius: 14,
    hardLeashRadius: 18,
    idleStationary: true,
    // Suicide bomber: crawl to the target, stand up over ~the StandUp clip length
    // (2.8s) flashing red, then detonate an AoE fire blast and die. Blast tuned
    // to the classic living-bomb proportion (about 70% of a cloth raider's HP
    // when unavoided, about a third of a warrior's): measured BiS level-20
    // pools run cloth ~870-910 / warrior ~1700, so 550-700 keeps the classic
    // "move out or a clothie nearly dies" pressure without a guaranteed kill.
    meleeBomb: { windup: 2.8, min: 550, max: 700, radius: 8, name: 'Meltdown', school: 'fire' },
    loot: [],
    scale: 0.8,
    color: 0x8a8f96,
  },
  [VARKHUL_BOSS_ID]: {
    id: VARKHUL_BOSS_ID,
    name: 'Varkhul, Forgefather of the Last Flame',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    boss: true,
    ccImmune: true,
    slowImmune: true,
    damageFloorPct: 0.5,
    hpBase: 120000 / 2.3,
    hpPerLevel: 0,
    dmgBase: 52,
    dmgPerLevel: 10.5,
    attackSpeed: 2.6,
    armorPerLevel: 46,
    moveSpeed: 6.8,
    aggroRadius: 30,
    // Ilvl-35 loot per docs/prd/ignivar-raid-loot.md "Boss loot tables": ONE
    // item per five raiders per kill (two on the 10-player raid). Slot one is
    // the merged sigil partition (legging + helm), slot two the Normal-only
    // feet / held / ring partition; a heroic claim skips slot two
    // (LootEntry.normalOnly) and the HEROIC_BOSS_LOOT exclusive slot pays in
    // its place, so Heroic pays the same count at the same ilvl 35 (this raid
    // has NO heroic item-level layer) and differs only in WHICH items drop.
    // Copper rides the raid-finale base on the Ignivar wiring. Re-cut
    // 2026-09-02 from the launch tables' four groups; draw order is
    // parity-sensitive from here: entries APPEND, never reorder.
    loot: [
      // Varkhul is the Inner Crucible's registered heroic finale boss
      // (dungeon_difficulty.ts), so his money entry carries the shared raid
      // heroic base like Ignivar's (tests/heroic_finale_gold.test.ts).
      { copper: 200000, heroicCopper: NYTHRAXIS_HEROIC_COPPER, chance: 1 },
      // Both axes of the sigil partition stay balanced: leggings 0.50 / helms
      // 0.50, Anvil 0.34 / Ember 0.33 / Tempest 0.33 (the old per-group thirds).
      { itemId: 'sigil_anvil_legs', chance: 0.17, rollGroup: 'varkhul_sigils' },
      { itemId: 'sigil_ember_legs', chance: 0.17, rollGroup: 'varkhul_sigils' },
      { itemId: 'sigil_tempest_legs', chance: 0.16, rollGroup: 'varkhul_sigils' },
      { itemId: 'sigil_anvil_helmet', chance: 0.17, rollGroup: 'varkhul_sigils' },
      { itemId: 'sigil_ember_helmet', chance: 0.16, rollGroup: 'varkhul_sigils' },
      { itemId: 'sigil_tempest_helmet', chance: 0.17, rollGroup: 'varkhul_sigils' },
      // The rings keep the half of this slot their own group used to own
      // outright (0.50); the feet and held offhands split the other half
      // 0.3125 / 0.1875. Every weight is a binary fraction (1/8, 1/32, 3/32)
      // so the partition sums to EXACTLY 1.00 in floating point: the roller's
      // `roll < cumulative` walk and the at-or-below-100% guard in
      // tests/loot_roll.test.ts both read the float sum, and decimal weights
      // like 0.035 drift past 1 by an ulp.
      normalOnlyRow('varkhul_offset', 'cindersoaked_slippers', 0.03125),
      normalOnlyRow('varkhul_offset', 'steps_of_quiet_water', 0.03125),
      normalOnlyRow('varkhul_offset', 'ashenbark_treads', 0.03125),
      normalOnlyRow('varkhul_offset', 'ashrunner_boots', 0.03125),
      normalOnlyRow('varkhul_offset', 'scorchgrove_striders', 0.03125),
      normalOnlyRow('varkhul_offset', 'dewfall_moccasins', 0.03125),
      normalOnlyRow('varkhul_offset', 'anvilstance_sabatons', 0.03125),
      normalOnlyRow('varkhul_offset', 'furnace_march_greaves', 0.03125),
      normalOnlyRow('varkhul_offset', 'thundershock_treads', 0.03125),
      normalOnlyRow('varkhul_offset', 'springwarden_sabatons', 0.03125),
      normalOnlyRow('varkhul_offset', 'orb_of_the_last_spring', 0.09375),
      normalOnlyRow('varkhul_offset', 'cinder_of_the_first_design', 0.09375),
      // Neither legendary drops on Normal. Emberward's 3 percent roll lives
      // in Varkhul's heroic-only exclusive group; Forgebreaker remains reserved
      // for the crafting professions until its recipe chain lands.
      normalOnlyRow('varkhul_offset', 'seal_of_the_forgewall', 0.125),
      normalOnlyRow('varkhul_offset', 'band_of_marked_strikes', 0.125),
      normalOnlyRow('varkhul_offset', 'circle_of_cinders', 0.125),
      normalOnlyRow('varkhul_offset', 'loop_of_quiet_springs', 0.125),
      // The professions fast-follow's core reagent starts dropping AHEAD of
      // its recipes (maintainer staging call): the classic molten-core band,
      // one guaranteed plus a 50 percent second, so crafters bank cores
      // before the scroll-taught tier lands (PR 3704 extends this exact
      // shape with the scroll roll group and the hammer chain starter).
      { itemId: 'lastflame_core', chance: 1 },
      { itemId: 'lastflame_core', chance: 0.5 },
    ],
    scale: 3.2,
    color: 0x9f351c,
  },
  [IGNIVAR_EMBER_SENTINEL_ID]: {
    id: IGNIVAR_EMBER_SENTINEL_ID,
    name: 'Ember Sentinel',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 250,
    hpPerLevel: 50,
    dmgBase: 22,
    dmgPerLevel: 4.2,
    attackSpeed: 2.4,
    armorPerLevel: 32,
    moveSpeed: 7.4,
    aggroRadius: 13,
    hardLeashRadius: 18,
    arcCleave: {
      every: 3,
      arcDeg: 100,
      range: 7,
      mult: 0.65,
      name: 'Tempered Sweep',
      burn: {
        perTick: 7,
        interval: 3,
        duration: 9,
        name: 'Tempered Cinders',
        school: 'fire',
      },
    },
    loot: [],
    scale: 1.45,
    color: 0xb94b23,
  },
  [IGNIVAR_CRUCIBLE_WARDEN_ID]: {
    id: IGNIVAR_CRUCIBLE_WARDEN_ID,
    name: 'Crucible Warden',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    hpBase: 350,
    hpPerLevel: 55,
    dmgBase: 20,
    dmgPerLevel: 3.8,
    attackSpeed: 2.8,
    armorPerLevel: 42,
    moveSpeed: 6.8,
    aggroRadius: 13,
    hardLeashRadius: 18,
    bigCast: {
      castId: VARKHUL_CRUCIBLE_QUAKE_CAST_ID,
      name: 'Crucible Quake',
      castTime: 2.5,
      every: 12,
      radius: 10,
      min: 28,
      max: 38,
      school: 'fire',
    },
    loot: [],
    scale: 1.7,
    color: 0x7c4529,
  },
  [IGNIVAR_CINDER_ARTIFICER_ID]: {
    id: IGNIVAR_CINDER_ARTIFICER_ID,
    name: 'Cinder Artificer',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    ccImmune: false,
    slowImmune: false,
    hpBase: 650,
    hpPerLevel: 80,
    dmgBase: 10,
    dmgPerLevel: 2,
    attackSpeed: 2.6,
    armorPerLevel: 44,
    moveSpeed: 8.2,
    aggroRadius: 15,
    hardLeashRadius: 18,
    petSpell: {
      name: 'Cinderbolt',
      school: 'fire',
      min: 55,
      max: 75,
      range: 25,
      every: 3,
      windup: 0.7,
    },
    channelHeal: {
      radius: 20,
      every: 5,
      baseHeal: 160,
      rampAdd: 120,
      maxHeal: 640,
      name: 'Recalibrate',
      school: 'fire',
    },
    loot: [],
    scale: 1.55,
    color: 0xd17936,
  },
  // Ignivar's dedicated visual is dispatched by render/characters/manifest.ts.
  // Encounter behavior lives in encounters/ignivar.ts, not on generic template hooks.
  ignivar_herald_of_the_last_flame: {
    id: 'ignivar_herald_of_the_last_flame',
    name: 'Ignivar, Herald of the Last Flame',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    boss: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 120000 / 2.3,
    hpPerLevel: 0,
    dmgBase: 48,
    dmgPerLevel: 10,
    attackSpeed: 2.6,
    armorPerLevel: 42,
    moveSpeed: 7,
    aggroRadius: 30,
    // Raid-finale money ladder, the Nythraxis wiring mirrored: 15g normal
    // base, and a heroic-claim kill substitutes the shared 20g raid base on
    // the same single draw (tests/heroic_finale_gold.test.ts). Item drops are
    // still to be authored for the development raid tier.
    // Ilvl-35 loot per docs/prd/ignivar-raid-loot.md "Boss loot tables": ONE
    // item per five raiders per kill (two on the 10-player raid). Slot one is
    // the merged sigil partition (mantle + grip), slot two the Normal-only
    // neck / waist / smaller-weapon partition; a heroic claim skips slot two
    // (LootEntry.normalOnly) and the HEROIC_BOSS_LOOT exclusive slot pays in
    // its place, so Heroic pays the same count at the same ilvl 35 (this raid
    // has NO heroic item-level layer) and differs only in WHICH items drop.
    // Re-cut 2026-09-02 from the launch tables' four groups; draw order is
    // parity-sensitive from here: entries APPEND, never reorder.
    loot: [
      { copper: 150000, heroicCopper: NYTHRAXIS_HEROIC_COPPER, chance: 1 },
      // Both axes of the sigil partition stay balanced: shoulders 0.50 / gloves
      // 0.50, Anvil 0.34 / Ember 0.33 / Tempest 0.33 (the old per-group thirds).
      { itemId: 'sigil_anvil_shoulder', chance: 0.17, rollGroup: 'ignivar_sigils' },
      { itemId: 'sigil_ember_shoulder', chance: 0.17, rollGroup: 'ignivar_sigils' },
      { itemId: 'sigil_tempest_shoulder', chance: 0.16, rollGroup: 'ignivar_sigils' },
      { itemId: 'sigil_anvil_gloves', chance: 0.17, rollGroup: 'ignivar_sigils' },
      { itemId: 'sigil_ember_gloves', chance: 0.16, rollGroup: 'ignivar_sigils' },
      { itemId: 'sigil_tempest_gloves', chance: 0.17, rollGroup: 'ignivar_sigils' },
      // The necks keep the half of this slot their own group used to own
      // outright (0.50); the waists and the three smaller weapons split the
      // other half 0.3125 / 0.1875. Every weight is a binary fraction (1/8,
      // 1/32, 1/16) so the partition sums to EXACTLY 1.00 in floating point:
      // the roller's `roll < cumulative` walk and the at-or-below-100% guard in
      // tests/loot_roll.test.ts both read the float sum, and decimal weights
      // like 0.035 drift past 1 by an ulp.
      normalOnlyRow('ignivar_offset', 'pendant_of_the_first_tempering', 0.125),
      normalOnlyRow('ignivar_offset', 'ignivars_ember_choker', 0.125),
      normalOnlyRow('ignivar_offset', 'locket_of_the_last_flame', 0.125),
      normalOnlyRow('ignivar_offset', 'heartspring_amulet', 0.125),
      normalOnlyRow('ignivar_offset', 'cord_of_the_last_flame', 0.03125),
      normalOnlyRow('ignivar_offset', 'springbinder_sash', 0.03125),
      normalOnlyRow('ignivar_offset', 'cinderbark_cinch', 0.03125),
      normalOnlyRow('ignivar_offset', 'slagstalker_belt', 0.03125),
      normalOnlyRow('ignivar_offset', 'moonscorch_waistwrap', 0.03125),
      normalOnlyRow('ignivar_offset', 'grovetender_belt', 0.03125),
      normalOnlyRow('ignivar_offset', 'forgewall_girdle', 0.03125),
      normalOnlyRow('ignivar_offset', 'warforged_waistguard', 0.03125),
      normalOnlyRow('ignivar_offset', 'stormkindled_chain', 0.03125),
      normalOnlyRow('ignivar_offset', 'tidebinder_links', 0.03125),
      normalOnlyRow('ignivar_offset', 'cinderfang_kris', 0.0625),
      normalOnlyRow('ignivar_offset', 'slagrender_cleaver', 0.0625),
      normalOnlyRow('ignivar_offset', 'wand_of_quenched_sparks', 0.0625),
      // The professions fast-follow's core reagent starts dropping AHEAD of
      // its recipes (maintainer staging call): the classic molten-core band,
      // one guaranteed plus a 50 percent second, so crafters bank cores
      // before the scroll-taught tier lands (PR 3704 extends this exact
      // shape with the scroll roll group and the hammer chain starter).
      { itemId: 'lastflame_core', chance: 1 },
      { itemId: 'lastflame_core', chance: 0.5 },
    ],
    scale: 3.4,
    color: 0xd64316,
    // Deliberately NO hasteMult: the encounter script owns Ignivar's frenzy.
    // Last Inferno flips `enraged` itself at 20% (so dmgMult applies) and
    // carries the swing-speed half as its encounter-owned 1.2x haste aura;
    // a template hasteMult would stack on that aura and double-dip. Pinned
    // by tests/mob_enrage.test.ts and tests/ignivar_encounter.test.ts.
    enrage: { belowHpPct: 0.25, dmgMult: 1.35 },
  },
  // Stationary priority target for Ignivar's Normal intermission.
  ignivar_heart_of_the_end: {
    id: 'ignivar_heart_of_the_end',
    name: 'Ignivar Ashcaller',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    ccImmune: true,
    slowImmune: true,
    hpBase: 7000 / 2.3,
    hpPerLevel: 0,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 2.6,
    armorPerLevel: 12,
    moveSpeed: 0,
    aggroRadius: 0,
    loot: [],
    scale: 2.25,
    color: 0xff6a1a,
  },
  // ---- The Hollow Crypt (5-player elite instance) ----
  crypt_shambler: {
    id: 'crypt_shambler',
    name: 'Crypt Shambler',
    minLevel: 7,
    maxLevel: 8,
    family: 'undead',
    elite: true,
    hpBase: 50,
    hpPerLevel: 20,
    dmgBase: 7,
    dmgPerLevel: 2.2,
    attackSpeed: 2.4,
    armorPerLevel: 18,
    moveSpeed: 6.5,
    aggroRadius: 12,
    charge: {
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      name: 'Onrush',
      school: 'physical',
    },
    loot: [
      { copper: 90, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.8 },
    ],
    scale: 1.1,
    color: 0xb8c4c4,
  },
  hollow_acolyte: {
    id: 'hollow_acolyte',
    name: 'Hollow Acolyte',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    elite: true,
    hpBase: 44,
    hpPerLevel: 18,
    dmgBase: 8,
    dmgPerLevel: 2.3,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 110, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.6 },
    ],
    scale: 1.0,
    color: 0x5b2c6f,
  },
  bonechill_widow: {
    id: 'bonechill_widow',
    name: 'Bonechill Widow',
    minLevel: 8,
    maxLevel: 9,
    family: 'spider',
    elite: true,
    hpBase: 48,
    hpPerLevel: 19,
    dmgBase: 8,
    dmgPerLevel: 2.4,
    attackSpeed: 1.8,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 13,
    loot: [
      { copper: 120, chance: 1 },
      { itemId: 'spider_leg', chance: 0.7 },
    ],
    scale: 1.25,
    color: 0xd6eaf8,
  },
  sexton_marrow: {
    id: 'sexton_marrow',
    name: 'Sexton Marrow',
    minLevel: 9,
    maxLevel: 9,
    family: 'undead',
    elite: true,
    // Named mid-boss: the boss CC/snare immunity rule applies on both
    // difficulties even without the boss: true flag (see morthen).
    ccImmune: true,
    slowImmune: true,
    hpBase: 110,
    hpPerLevel: 24,
    dmgBase: 9,
    dmgPerLevel: 2.5,
    attackSpeed: 2.2,
    armorPerLevel: 22,
    moveSpeed: 7,
    aggroRadius: 14,
    charge: {
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      name: 'Onrush',
      school: 'physical',
    },
    loot: [
      { copper: 400, chance: 1 },
      { itemId: 'quilted_trousers', chance: 0.4 },
      { itemId: 'oiled_boots', chance: 0.4 },
    ],
    scale: 1.2,
    color: 0x839192,
  },
  morthen: {
    id: 'morthen',
    name: 'Morthen the Gravecaller',
    minLevel: 10,
    maxLevel: 10,
    family: 'undead',
    elite: true,
    boss: true,
    // Endgame-instance bosses can be neither controlled nor kited on EITHER
    // difficulty (the heroic entity stamp in instances/difficulty.ts stays as
    // belt and braces): the normal-difficulty economy retune assumes swings land.
    ccImmune: true,
    slowImmune: true,
    hpBase: 230,
    hpPerLevel: 32,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.6,
    armorPerLevel: 26,
    moveSpeed: 7,
    aggroRadius: 16,
    aoePulse: { min: 12, max: 18, radius: 12, every: 10, name: 'Shadow Pulse' },
    loot: [
      { copper: 2500, heroicCopper: HEROIC_FINALE_COPPER, chance: 1 },
      { itemId: 'cryptbone_greaves', chance: 0.34, rollGroup: 'morthen_guaranteed_uncommon' },
      { itemId: 'quilted_trousers', chance: 0.33, rollGroup: 'morthen_guaranteed_uncommon' },
      { itemId: 'oiled_boots', chance: 0.33, rollGroup: 'morthen_guaranteed_uncommon' },
      { itemId: 'greyjaw_hide_boots', chance: 0.25, rollGroup: 'morthen_bonus' },
      { itemId: 'gravewoven_bag', chance: 0.2, rollGroup: 'morthen_bonus' },
      { itemId: 'cryptbone_helm', chance: 0.18, rollGroup: 'morthen_bonus' },
      { itemId: 'cryptbone_pauldrons', chance: 0.18, rollGroup: 'morthen_bonus' },
    ],
    scale: 1.35,
    color: 0x4a235a,
  },

  // ---- The Sunken Bastion (5-player elite instance, ~L13) ----
  bastion_revenant: {
    id: 'bastion_revenant',
    name: 'Bastion Revenant',
    minLevel: 12,
    maxLevel: 13,
    family: 'undead',
    elite: true,
    hpBase: 54,
    hpPerLevel: 21,
    dmgBase: 9,
    dmgPerLevel: 2.4,
    attackSpeed: 2.3,
    armorPerLevel: 18,
    moveSpeed: 6.5,
    aggroRadius: 12,
    charge: {
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      name: 'Onrush',
      school: 'physical',
    },
    loot: [
      { copper: 150, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.7 },
      { itemId: 'mistveil_cord', chance: 0.06, rollGroup: 'revenant_bonus' },
    ],
    scale: 1.1,
    color: 0x7fa8a0,
    mortalStrike: { chance: 0.3, healReduction: 0.5, duration: 6, name: 'Maiming Strike' },
  },
  tidebound_acolyte: {
    id: 'tidebound_acolyte',
    name: 'Tidebound Acolyte',
    minLevel: 12,
    maxLevel: 13,
    family: 'humanoid',
    elite: true,
    hpBase: 50,
    hpPerLevel: 20,
    dmgBase: 10,
    dmgPerLevel: 2.5,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 7,
    aggroRadius: 12,
    loot: [
      { copper: 170, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.5 },
      { itemId: 'mistveil_grips', chance: 0.06, rollGroup: 'acolyte_bonus' },
    ],
    desperateHeal: { belowHpPct: 0.3, healPct: 0.25 },
    scale: 1.0,
    color: 0x1f618d,
  },
  drowned_thrall: {
    id: 'drowned_thrall',
    name: 'Drowned Thrall',
    minLevel: 11,
    maxLevel: 11,
    family: 'undead',
    hpBase: 40,
    hpPerLevel: 14,
    dmgBase: 7,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 7.5,
    aggroRadius: 12,
    charge: {
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      name: 'Onrush',
      school: 'physical',
    },
    loot: [], // summoned add — nothing to loot
    scale: 0.95,
    color: 0x6fae9e,
  },
  knight_commander_olen: {
    id: 'knight_commander_olen',
    name: 'Knight-Commander Olen',
    minLevel: 13,
    maxLevel: 13,
    family: 'undead',
    elite: true,
    // Named mid-boss: CC- and snare-immune on both difficulties (see morthen).
    ccImmune: true,
    slowImmune: true,
    hpBase: 120,
    hpPerLevel: 26,
    dmgBase: 11,
    dmgPerLevel: 2.6,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 7,
    aggroRadius: 14,
    charge: {
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      name: 'Onrush',
      school: 'physical',
    },
    loot: [
      { copper: 800, chance: 1 },
      { itemId: 'trollhide_leggings', chance: 0.5, rollGroup: 'olen_guaranteed_uncommon' },
      { itemId: 'marshstrider_boots', chance: 0.5, rollGroup: 'olen_guaranteed_uncommon' },
      { itemId: 'fenmist_robe', chance: 0.25, rollGroup: 'olen_bonus' },
      { itemId: 'tideguard_greaves', chance: 0.1, rollGroup: 'olen_bonus' },
      { itemId: 'tideguard_sabatons', chance: 0.1, rollGroup: 'olen_bonus' },
      { itemId: 'eelscale_leggings', chance: 0.1, rollGroup: 'olen_bonus' },
    ], // his greaves are Maren's quest reward, not a drop
    scale: 1.2,
    color: 0x95a5a6,
    cleave: { radius: 8, mult: 0.6, name: 'Reaping Arc' },
  },
  vael_the_mistcaller: {
    id: 'vael_the_mistcaller',
    name: 'Vael the Fogbinder',
    minLevel: 13,
    maxLevel: 13,
    family: 'humanoid',
    elite: true,
    boss: true,
    // Boss rule: CC- and snare-immune on both difficulties (see morthen).
    ccImmune: true,
    slowImmune: true,
    hpBase: 240,
    hpPerLevel: 34,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.4,
    armorPerLevel: 26,
    moveSpeed: 7,
    aggroRadius: 16,
    aoePulse: { min: 16, max: 24, radius: 12, every: 10, name: 'Mist Surge' },
    summonAdds: { mobId: 'drowned_thrall', count: 2, atHpPct: [0.6, 0.3] },
    loot: [
      { copper: 5000, heroicCopper: HEROIC_FINALE_COPPER, chance: 1 },
      { itemId: 'trollhide_leggings', chance: 0.34, rollGroup: 'vael_guaranteed_uncommon' },
      { itemId: 'marshstrider_boots', chance: 0.33, rollGroup: 'vael_guaranteed_uncommon' },
      { itemId: 'fenmist_robe', chance: 0.33, rollGroup: 'vael_guaranteed_uncommon' },
      { itemId: 'deepfen_pearl', chance: 1 },
      { itemId: 'eelskin_tunic', chance: 0.2, rollGroup: 'vael_bonus' },
      { itemId: 'tidescale_vest', chance: 0.1, rollGroup: 'vael_bonus' },
      { itemId: 'drowned_prayer_leggings', chance: 0.1, rollGroup: 'vael_bonus' },
      { itemId: 'drowned_prayer_sandals', chance: 0.1, rollGroup: 'vael_bonus' },
      { itemId: 'eelscale_treads', chance: 0.1, rollGroup: 'vael_bonus' },
      { itemId: 'mistveil_cord', chance: 0.12, rollGroup: 'vael_bonus' },
      { itemId: 'mistveil_grips', chance: 0.12, rollGroup: 'vael_bonus' },
      { itemId: 'mistcallers_duffel', chance: 0.1, rollGroup: 'vael_bonus' },
    ],
    scale: 1.35,
    color: 0x48c9b0,
  },

  // ---- Gravewyrm Sanctum (5-player elite instance, L20 finale) ----
  sanctum_boneguard: {
    id: 'sanctum_boneguard',
    name: 'Sanctum Boneguard',
    minLevel: 19,
    maxLevel: 19,
    family: 'undead',
    elite: true,
    hpBase: 64,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.7,
    attackSpeed: 2.3,
    armorPerLevel: 22,
    moveSpeed: 6.5,
    aggroRadius: 12,
    charge: {
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      name: 'Onrush',
      school: 'physical',
    },
    loot: [
      { copper: 300, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.6 },
      { itemId: 'boundstone_helm', chance: 0.04, rollGroup: 'boneguard_bonus' },
      { itemId: 'boundstone_girdle', chance: 0.04, rollGroup: 'boneguard_bonus' },
    ],
    scale: 1.15,
    color: 0xcfc8b0,
  },
  sanctum_drakonid: {
    id: 'sanctum_drakonid',
    name: 'Sanctum Scaleguard',
    minLevel: 19,
    maxLevel: 20,
    family: 'dragonkin',
    elite: true,
    hpBase: 68,
    hpPerLevel: 24,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.2,
    armorPerLevel: 26,
    moveSpeed: 7,
    aggroRadius: 13,
    loot: [
      { copper: 350, chance: 1 },
      { itemId: 'cracked_wyrm_scale', chance: 0.5 },
      { itemId: 'gravewyrm_mantle', chance: 0.05, rollGroup: 'drakonid_bonus' },
      { itemId: 'gravewyrm_gauntlets', chance: 0.05, rollGroup: 'drakonid_bonus' },
      { itemId: 'gravewyrm_thornmaul', chance: 0.05 },
    ],
    scale: 1.45,
    color: 0x567d46, // Korzul's rig at 0.8x his bulk
  },
  raised_bonewalker: {
    id: 'raised_bonewalker',
    name: 'Raised Bonewalker',
    minLevel: 18,
    maxLevel: 18,
    family: 'undead',
    hpBase: 42,
    hpPerLevel: 15,
    dmgBase: 9,
    dmgPerLevel: 2.2,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    charge: {
      minRange: 5,
      maxRange: 30,
      cooldown: 12,
      stunDuration: 0.5,
      name: 'Onrush',
      school: 'physical',
    },
    loot: [], // summoned add — nothing to loot
    scale: 1.0,
    color: 0xc8cfc8,
  },
  korgath_the_bound: {
    id: 'korgath_the_bound',
    name: 'Korgath the Bound',
    minLevel: 20,
    maxLevel: 20,
    family: 'ogre',
    elite: true,
    // Named mid-boss: CC- and snare-immune on both difficulties (see morthen).
    ccImmune: true,
    slowImmune: true,
    hpBase: 260,
    hpPerLevel: 36,
    dmgBase: 14,
    dmgPerLevel: 2.9,
    attackSpeed: 2.8,
    armorPerLevel: 30,
    moveSpeed: 7,
    aggroRadius: 15,
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    stomp: { radius: 10, every: 12, duration: 1.5, min: 20, max: 30, name: 'Shuddering Stomp' },
    loot: [
      { copper: 5000, chance: 1 },
      { itemId: 'boneplate_vest', chance: 0.34, rollGroup: 'korgath_guaranteed_uncommon' },
      { itemId: 'revenant_silk_robe', chance: 0.33, rollGroup: 'korgath_guaranteed_uncommon' },
      { itemId: 'nightwalk_jerkin', chance: 0.33, rollGroup: 'korgath_guaranteed_uncommon' },
      { itemId: 'zealotsbane_blade', chance: 0.19, rollGroup: 'korgath_bonus' },
      { itemId: 'korgaths_chainwraps', chance: 0.1, rollGroup: 'korgath_bonus' },
      { itemId: 'staff_of_velkhar', chance: 0.1, rollGroup: 'korgath_bonus' },
      { itemId: 'shadowmeld_tunic', chance: 0.1, rollGroup: 'korgath_bonus' },
      { itemId: 'wyrmcult_grand_robe', chance: 0.1, rollGroup: 'korgath_bonus' },
      { itemId: 'gravewyrm_sabatons', chance: 0.1, rollGroup: 'korgath_bonus' },
      { itemId: 'wyrmcult_soulsteps', chance: 0.1, rollGroup: 'korgath_bonus' },
      { itemId: 'wyrmshadow_treads', chance: 0.05, rollGroup: 'korgath_bonus' },
      { itemId: 'boundstone_helm', chance: 0.08, rollGroup: 'korgath_bonus' },
      { itemId: 'gravewyrm_mantle', chance: 0.08, rollGroup: 'korgath_bonus' },
    ],
    scale: 1.5,
    color: 0x8f6f46,
  },
  grand_necromancer_velkhar: {
    id: 'grand_necromancer_velkhar',
    name: 'Grand Necromancer Velkhar',
    minLevel: 20,
    maxLevel: 20,
    family: 'humanoid',
    elite: true,
    // Named mid-boss: CC- and snare-immune on both difficulties (see morthen).
    ccImmune: true,
    slowImmune: true,
    hpBase: 230,
    hpPerLevel: 33,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.0,
    armorPerLevel: 20,
    moveSpeed: 7,
    aggroRadius: 15,
    summonAdds: { mobId: 'raised_bonewalker', count: 3, atHpPct: [0.66, 0.33] },
    loot: [
      { copper: 5000, chance: 1 },
      { itemId: 'boneplate_vest', chance: 0.34, rollGroup: 'velkhar_guaranteed_uncommon' },
      { itemId: 'revenant_silk_robe', chance: 0.33, rollGroup: 'velkhar_guaranteed_uncommon' },
      { itemId: 'nightwalk_jerkin', chance: 0.33, rollGroup: 'velkhar_guaranteed_uncommon' },
      { itemId: 'emberwood_staff', chance: 0.2, rollGroup: 'velkhar_bonus' },
      { itemId: 'boneguard_breastplate', chance: 0.1, rollGroup: 'velkhar_bonus' },
      { itemId: 'shadowmeld_tunic', chance: 0.1, rollGroup: 'velkhar_bonus' },
      { itemId: 'staff_of_velkhar', chance: 0.1, rollGroup: 'velkhar_bonus' },
      { itemId: 'gravewyrm_stalkers_treads', chance: 0.1, rollGroup: 'velkhar_bonus' },
      { itemId: 'deathlord_legguards', chance: 0.05, rollGroup: 'velkhar_bonus' },
      { itemId: 'necromancers_soulsteps', chance: 0.05, rollGroup: 'velkhar_bonus' },
      { itemId: 'wyrmshadow_legguards', chance: 0.05, rollGroup: 'velkhar_bonus' },
      // The dungeon rung of the materials-satchel ladder, same shape and rate
      // as the Gravewoven Bag on Morthen. Velkhar is the one Sanctum boss with
      // room for it: velkhar_bonus sums to 0.75, so a 0.2 row lands fully
      // inside the partition and still leaves slack for a no-bonus kill, the
      // way morthen_bonus does at 0.81. korgath_bonus already sums to exactly
      // 1.0 (an appended row could never be rolled) and korzul_bonus to 0.87
      // (0.2 would overflow and clip its own tail), so neither could carry it
      // without re-pricing the pieces already there.
      { itemId: 'necromancers_reagent_satchel', chance: 0.2, rollGroup: 'velkhar_bonus' },
    ],
    scale: 1.25,
    color: 0x512e5f,
  },
  korzul_the_gravewyrm: {
    id: 'korzul_the_gravewyrm',
    name: 'Korzul the Gravewyrm',
    minLevel: 20,
    maxLevel: 20,
    family: 'dragonkin',
    elite: true,
    boss: true,
    // Boss rule: CC- and snare-immune on both difficulties (see morthen).
    ccImmune: true,
    slowImmune: true,
    hpBase: 420,
    hpPerLevel: 48,
    dmgBase: 15,
    dmgPerLevel: 3.0,
    attackSpeed: 2.6,
    armorPerLevel: 34,
    moveSpeed: 7,
    aggroRadius: 18,
    // Grave Inferno (2026-07): the old Necrotic Shockwave aoePulse hit every
    // melee for an unavoidable, unmitigated 570-798 each 8s. Replaced by a
    // Geddon-style stationary channel: 8s rooted, no melee, four escalating
    // fire pulses (base x1/2/3/4 x the per-mob mechanic multiplier), 14yd.
    // Moving out at the windup eats the small first pulse or nothing.
    // The 50% hp gate (2026-07-26) guarantees the channel fires once per kill
    // on BOTH difficulties: a group out-pacing the 30s cadence used to skip
    // the mechanic entirely. One gate only, and it lands before the 30% enrage
    // so the burn phase never stacks on enraged melee.
    infernoChannel: {
      every: 30,
      duration: 8,
      pulses: 4,
      min: 7,
      max: 9,
      radius: 14,
      name: 'Grave Inferno',
      school: 'fire',
      atHpPct: [0.5],
    },
    enrage: { belowHpPct: 0.3, dmgMult: 1.5, hasteMult: 1.3 },
    loot: [
      // 15000c base rolls to 9000c to 21000c (the 0.6x to 1.4x loot band):
      // roughly the 1g to 2g finale payout, a 3x premium over the 5000c the
      // other Sanctum bosses pay. The old 50000c base paid 3g to 7g per pop
      // on a lockout-free, skip-pullable finale, the prime repeat gold-farm
      // target (Zulgar in Wildheart took the same nerf). The daily-lockout
      // heroic clear pays the 10g finale base instead;
      // tests/gravewyrm_boss_gold.test.ts pins both bands.
      { copper: 15000, heroicCopper: HEROIC_FINALE_COPPER, chance: 1 },
      { itemId: 'boneplate_vest', chance: 0.34, rollGroup: 'korzul_guaranteed_uncommon' },
      { itemId: 'revenant_silk_robe', chance: 0.33, rollGroup: 'korzul_guaranteed_uncommon' },
      { itemId: 'nightwalk_jerkin', chance: 0.33, rollGroup: 'korzul_guaranteed_uncommon' },
      { itemId: 'cultist_flayer', chance: 0.1, rollGroup: 'korzul_bonus' },
      { itemId: 'wyrmfang_greatblade', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'staff_of_the_gravewyrm', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'fang_of_korzul', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'deathlord_warplate', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'necromancers_starshroud', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'wyrmshadow_harness', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'boundstone_girdle', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'gravewyrm_gauntlets', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'deathlords_dread_visage', chance: 0.04, rollGroup: 'korzul_bonus' },
      { itemId: 'necromancers_soulspire_mantle', chance: 0.04, rollGroup: 'korzul_bonus' },
      { itemId: 'wyrmshadow_talongrips', chance: 0.04, rollGroup: 'korzul_bonus' },
      { itemId: 'nightfangs_greatstaff', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'wildgrowth_leggings', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'grovewardens_grips', chance: 0.05, rollGroup: 'korzul_bonus' },
      { itemId: 'verdant_walkers', chance: 0.05, rollGroup: 'korzul_bonus' },
      // korzul_bonus deliberately sums below 1 (some kills yield no bonus
      // piece), so the quiver takes its 0.05 from that slack at the same
      // per-class rate as every other piece here, diluting none of them.
      { itemId: 'gravewyrm_bone_quiver', chance: 0.05, rollGroup: 'korzul_bonus' },
    ],
    scale: 1.8,
    color: 0x3d5c45,
  },

  // ---- Abandoned Crypt raid encounter (10-player, Nythraxis) ----
  nythraxis_skeleton_warrior: {
    id: 'nythraxis_skeleton_warrior',
    name: 'Risen Royal Guard',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    ccImmune: true,
    hpBase: 150,
    hpPerLevel: 28,
    dmgBase: 26,
    dmgPerLevel: 5.6,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 10,
    aggroRadius: 14,
    loot: [],
    scale: 1.25,
    color: 0xc7c0b2,
  },
  nythraxis_heroic_warrior_add: {
    id: 'nythraxis_heroic_warrior_add',
    name: 'Spirit of Aldren',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    ccImmune: true,
    hpBase: 150,
    hpPerLevel: 28,
    dmgBase: 26,
    dmgPerLevel: 5.6,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 10,
    aggroRadius: 14,
    cleave: { radius: 8, mult: 0.55, name: 'Royal Cleave' },
    loot: [],
    scale: 1.25,
    color: 0xc7c0b2,
  },
  nythraxis_heroic_priest_add: {
    id: 'nythraxis_heroic_priest_add',
    name: 'Spirit of Malric',
    quietMechanics: true,
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    // Deliberately CC-able (unlike the other adds): the raid MUST stun/silence him
    // to break his escalating heal channel. See channelHeal and the priest-add
    // exemption in the Nythraxis control-immunity gate (sim.applyAura).
    ccImmune: false,
    // Squishy: low health so a focused raid can burn him, but his heal is strong,
    // so stunning/silencing is usually the better answer than racing his HP.
    hpBase: 80,
    hpPerLevel: 14,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.4,
    armorPerLevel: 14,
    moveSpeed: 9.5,
    aggroRadius: 14,
    // Escalating channeled heal on Nythraxis. Tuned against ~550 raid DPS (10 x
    // ~55) at the heroic gear level: the adds inherit mechanicHealMult (1.6), so
    // the raw 400 -> 1800 ramp lands ~640 (a light drain early) up to ~2880 per 3s
    // at cap (~960 HPS, ~1.7x raid DPS). Ignoring Malric a few ticks lets the boss
    // gain ground; a stun/incapacitate/silence resets the ramp. Even a max-geared
    // raid (~850 DPS) cannot out-damage a capped channel, so the interrupt stays
    // mandatory rather than optional.
    channelHeal: {
      radius: 45,
      // 4s per cast: slow enough that each heal is a visible, reactable channel (the
      // old 3s felt too fast), with the per-heal amount cut ~20% so he is not
      // out-healing a fair raid DPS check.
      every: 4,
      baseHeal: 320,
      rampAdd: 240,
      maxHeal: 1440,
      name: "Malric's Mending",
      school: 'shadow',
    },
    loot: [],
    scale: 1.18,
    color: 0x6b4a89,
  },
  nythraxis_heroic_rogue_add: {
    id: 'nythraxis_heroic_rogue_add',
    name: 'Spirit of Voss',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    // Untauntable (ignoreTaunt) but CC-able: the raid cannot tank-lock him onto a
    // target, they have to stun/root him off the healers. Low health so a peel
    // plus CC handles him. See the controllable-add exemption in sim.applyAura.
    ccImmune: false,
    hpBase: 90,
    hpPerLevel: 16,
    dmgBase: 16,
    dmgPerLevel: 3.4,
    attackSpeed: 2.0,
    armorPerLevel: 16,
    moveSpeed: 8,
    aggroRadius: 14,
    ignoreTaunt: true,
    loot: [],
    scale: 1.12,
    color: 0x776f83,
  },
  // Brother Aldric is now a dynamically-spawned NPC (see NPCS.brother_aldric_raid
  // in zone3.ts and spawnNythraxisAldric in sim.ts), not a mob.
  nythraxis_scourge_of_thornpeak: {
    id: 'nythraxis_scourge_of_thornpeak',
    name: 'Nythraxis, Scourge of Thornpeak',
    minLevel: 20,
    maxLevel: 20,
    family: 'undead',
    elite: true,
    boss: true,
    ccImmune: true,
    // Boss rule: snare-immune on both difficulties too (the raid boss was
    // ccImmune from day one but still slowable on normal; see morthen).
    slowImmune: true,
    // 60k on normal (createMob applies the 2.3x elite factor); heroic scales
    // this via the nythraxis_boss_arena healthMultiplier.
    hpBase: 60000 / 2.3,
    hpPerLevel: 0,
    dmgBase: 54,
    dmgPerLevel: 11.4,
    attackSpeed: 2.6,
    armorPerLevel: 42,
    moveSpeed: 10.5,
    aggroRadius: 22,
    // Each nythraxis_drop_* rollGroup is exclusive (one partitioned rng draw per
    // group) and sums to exactly 1.00. The offhand/two-hander epics ride the
    // existing four groups, with the set-piece chances rebalanced; group 3 is
    // the offhand group and carries two (the caster orb and the hunter quiver).
    loot: [
      { copper: 150000, heroicCopper: NYTHRAXIS_HEROIC_COPPER, chance: 1 },
      { itemId: 'deathless_heartwood', chance: 0.03, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'bonewrought_greatsword', chance: 0.13, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'crownforged_dreadhelm', chance: 0.14, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'nighttalon_crown', chance: 0.14, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'soulflame_cowl', chance: 0.14, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'stormcallers_crown', chance: 0.14, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'nighttalon_shoulderguards', chance: 0.14, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'soulflame_mantle', chance: 0.14, rollGroup: 'nythraxis_drop_1' },
      { itemId: 'kingsbane_last_oath', chance: 0.03, rollGroup: 'nythraxis_drop_2' },
      { itemId: 'bonewrought_bulwark', chance: 0.13, rollGroup: 'nythraxis_drop_2' },
      { itemId: 'crownforged_warspaulders', chance: 0.14, rollGroup: 'nythraxis_drop_2' },
      { itemId: 'nighttalon_shoulderguards', chance: 0.14, rollGroup: 'nythraxis_drop_2' },
      { itemId: 'soulflame_mantle', chance: 0.14, rollGroup: 'nythraxis_drop_2' },
      { itemId: 'crownforged_dreadhelm', chance: 0.14, rollGroup: 'nythraxis_drop_2' },
      { itemId: 'nighttalon_crown', chance: 0.14, rollGroup: 'nythraxis_drop_2' },
      { itemId: 'stormcallers_spaulders', chance: 0.14, rollGroup: 'nythraxis_drop_2' },
      // Group 3 is the offhand group and now carries both offhand epics, the
      // caster orb and the hunter quiver, at an equal 0.14. The group is
      // exclusive and must sum to exactly 1, so seating an eighth entry is the
      // one place a quiver costs existing drops: the two offhands come down from
      // 0.16 and the six shared set pieces from 0.14 to 0.12.
      { itemId: 'wraithfire_orb', chance: 0.14, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'direfang_quiver', chance: 0.14, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'crownforged_dreadhelm', chance: 0.12, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'nighttalon_crown', chance: 0.12, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'soulflame_cowl', chance: 0.12, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'stormcallers_crown', chance: 0.12, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'nighttalon_shoulderguards', chance: 0.12, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'soulflame_mantle', chance: 0.12, rollGroup: 'nythraxis_drop_3' },
      { itemId: 'direfang_greatblade', chance: 0.16, rollGroup: 'nythraxis_drop_4' },
      { itemId: 'soulflame_mantle', chance: 0.14, rollGroup: 'nythraxis_drop_4' },
      { itemId: 'crownforged_warspaulders', chance: 0.14, rollGroup: 'nythraxis_drop_4' },
      { itemId: 'nighttalon_shoulderguards', chance: 0.14, rollGroup: 'nythraxis_drop_4' },
      { itemId: 'stormcallers_spaulders', chance: 0.14, rollGroup: 'nythraxis_drop_4' },
      { itemId: 'crownforged_dreadhelm', chance: 0.14, rollGroup: 'nythraxis_drop_4' },
      { itemId: 'nighttalon_crown', chance: 0.14, rollGroup: 'nythraxis_drop_4' },
      // The feral ladder's top rung rides its own bonus group: a fifth,
      // independent draw so the four guaranteed groups above keep their exact
      // 1.00 partitions (a 25% bonus shot, never displacing a set piece).
      { itemId: 'maul_of_the_scourged_wilds', chance: 0.25, rollGroup: 'nythraxis_drop_5' },
    ],
    scale: 3.1,
    color: 0x221b2d,
  },
};

// Trash packs of 2 elites (spaced beyond social-aggro range so groups can
// pull them one pack at a time), a miniboss pair, then Morthen with guards.
const CRYPT_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: 'crypt_shambler', x: -3, z: 18 },
  { mobId: 'crypt_shambler', x: 3, z: 19 },
  { mobId: 'crypt_shambler', x: -9, z: 38 },
  { mobId: 'hollow_acolyte', x: -5, z: 39 },
  { mobId: 'crypt_shambler', x: 9, z: 54 },
  { mobId: 'hollow_acolyte', x: 5, z: 55 },
  { mobId: 'bonechill_widow', x: -5, z: 68 },
  { mobId: 'bonechill_widow', x: -1, z: 70 },
  { mobId: 'sexton_marrow', x: -4, z: 82 },
  { mobId: 'hollow_acolyte', x: 1, z: 83 },
  { mobId: 'morthen', x: 0, z: 98 },
  { mobId: 'crypt_shambler', x: -4, z: 96 },
  { mobId: 'crypt_shambler', x: 4, z: 96 },
];

// Sunken Bastion: same 13-spawn pacing as the crypt — packs of 2 elites,
// the Knight-Commander as miniboss, then Vael on the dais with two guards.
const BASTION_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: 'bastion_revenant', x: -3, z: 18 },
  { mobId: 'bastion_revenant', x: 3, z: 19 },
  { mobId: 'bastion_revenant', x: -9, z: 38 },
  { mobId: 'tidebound_acolyte', x: -5, z: 39 },
  { mobId: 'tidebound_acolyte', x: 9, z: 54 },
  { mobId: 'bastion_revenant', x: 5, z: 55 },
  { mobId: 'bastion_revenant', x: -5, z: 68 },
  { mobId: 'tidebound_acolyte', x: -1, z: 70 },
  { mobId: 'knight_commander_olen', x: -4, z: 82 },
  { mobId: 'bastion_revenant', x: 1, z: 83 },
  { mobId: 'vael_the_mistcaller', x: 0, z: 98 },
  { mobId: 'tidebound_acolyte', x: -4, z: 96 },
  { mobId: 'bastion_revenant', x: 4, z: 96 },
];

// Gravewyrm Sanctum: three chambers — the Boneworks (z<60), the Ritual Vault
// (75-115) and the Wyrm's Hollow (115+) — with Korgath holding the first
// waist, Velkhar the second, and Korzul on the great dais at the end.
const SANCTUM_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: 'sanctum_boneguard', x: -3, z: 20 },
  { mobId: 'sanctum_boneguard', x: 3, z: 21 },
  { mobId: 'sanctum_boneguard', x: -8, z: 30 },
  { mobId: 'sanctum_drakonid', x: -4, z: 31 },
  { mobId: 'sanctum_drakonid', x: 7, z: 44 },
  { mobId: 'sanctum_boneguard', x: 3, z: 45 },
  { mobId: 'sanctum_boneguard', x: -6, z: 58 },
  { mobId: 'sanctum_drakonid', x: -2, z: 59 },
  { mobId: 'korgath_the_bound', x: 0, z: 72 },
  { mobId: 'sanctum_drakonid', x: -7, z: 86 },
  { mobId: 'sanctum_boneguard', x: -3, z: 87 },
  { mobId: 'sanctum_boneguard', x: 6, z: 100 },
  { mobId: 'sanctum_drakonid', x: 2, z: 101 },
  { mobId: 'grand_necromancer_velkhar', x: 0, z: 114 },
  { mobId: 'sanctum_boneguard', x: -4, z: 112 },
  { mobId: 'sanctum_boneguard', x: 4, z: 112 },
  { mobId: 'sanctum_drakonid', x: -5, z: 130 },
  { mobId: 'sanctum_drakonid', x: -1, z: 132 },
  { mobId: 'korzul_the_gravewyrm', x: 0, z: 146 },
  { mobId: 'sanctum_drakonid', x: -5, z: 144 },
  { mobId: 'sanctum_drakonid', x: 5, z: 144 },
];

const NYTHRAXIS_RAID_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: 'nythraxis_scourge_of_thornpeak', x: 0, z: 96 },
];

const IGNIVAR_RAID_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: 'ignivar_herald_of_the_last_flame', x: 0, z: IGNIVAR_BOSS_SPAWN_Z },
];

const IGNIVAR_WARDEN_MINIBOSS: DungeonSpawnMinibossTuning = {
  healthMultiplier: 2.35,
  scale: 2.75,
  ccImmune: true,
  slowImmune: true,
};

// First-room packs: five tight, inward-facing huddles up the Halls of the First
// Tempering, hand-placed from live in-world coordinates (instance origin
// (116200, -1250) subtracted to local). "crawler" = derelict_mech. Each pack is
// a rough circle ~3 to 4 yards across, every mob facing the pack centre. Every
// mob is idleStationary so the whole formation holds until pulled (the mechs
// already are via their template; the guardians take the per-spawn flag).
const IGNIVAR_FORGE_APPROACH_SPAWN_LIST: DungeonSpawn[] = [
  // Pack 1 (2 crawlers + 1 Ember Sentinel), center local (-16, -15)
  { mobId: 'derelict_mech', x: -16, z: -17, facing: 0, packId: 'approach_1' },
  { mobId: 'derelict_mech', x: -14.3, z: -14, facing: -2.09, packId: 'approach_1' },
  {
    mobId: IGNIVAR_EMBER_SENTINEL_ID,
    x: -17.7,
    z: -14,
    facing: 2.09,
    idleStationary: true,
    packId: 'approach_1',
  },
  // Pack 2 (2 crawlers + 1 Crucible Warden), center local (13, 4)
  { mobId: 'derelict_mech', x: 13, z: 2, facing: 0, packId: 'approach_2' },
  { mobId: 'derelict_mech', x: 14.7, z: 5, facing: -2.09, packId: 'approach_2' },
  {
    mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
    x: 11.3,
    z: 5,
    facing: 2.09,
    idleStationary: true,
    packId: 'approach_2',
  },
  // Pack 3 (1 promoted Warden + 2 crawlers), center local (-21, 9)
  {
    mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
    x: -21,
    z: 7,
    facing: 0,
    idleStationary: true,
    packId: 'approach_3',
    miniboss: IGNIVAR_WARDEN_MINIBOSS,
  },
  { mobId: 'derelict_mech', x: -19.3, z: 10, facing: -2.09, packId: 'approach_3' },
  { mobId: 'derelict_mech', x: -22.7, z: 10, facing: 2.09, packId: 'approach_3' },
  // Pack 4 (2 crawlers + 1 Crucible Warden + 1 Ember Sentinel), center local (19, 42)
  { mobId: 'derelict_mech', x: 19, z: 39.7, facing: 0, packId: 'approach_4' },
  { mobId: 'derelict_mech', x: 21.3, z: 42, facing: -1.57, packId: 'approach_4' },
  {
    mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
    x: 19,
    z: 44.3,
    facing: -3.14,
    idleStationary: true,
    packId: 'approach_4',
  },
  {
    mobId: IGNIVAR_EMBER_SENTINEL_ID,
    x: 16.7,
    z: 42,
    facing: 1.57,
    idleStationary: true,
    packId: 'approach_4',
  },
  // Pack 5 (2 crawlers + 2 Wardens + 1 Ember Sentinel), center local (-22, 42)
  { mobId: 'derelict_mech', x: -22, z: 39.4, facing: 0, packId: 'approach_5' },
  { mobId: 'derelict_mech', x: -19.5, z: 41.2, facing: -1.26, packId: 'approach_5' },
  {
    mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
    x: -20.5,
    z: 44.1,
    facing: -2.51,
    idleStationary: true,
    packId: 'approach_5',
  },
  {
    mobId: IGNIVAR_EMBER_SENTINEL_ID,
    x: -23.5,
    z: 44.1,
    facing: 2.51,
    idleStationary: true,
    packId: 'approach_5',
  },
  {
    mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
    x: -24.5,
    z: 41.2,
    facing: 1.26,
    idleStationary: true,
    packId: 'approach_5',
    miniboss: IGNIVAR_WARDEN_MINIBOSS,
  },
];

const IGNIVAR_MOLTEN_ASSEMBLY_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: -5, z: -24, packId: 'intake' },
  { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 0, z: -22, packId: 'intake' },
  { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 5, z: -24, packId: 'intake' },
  { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: -5, z: 4, packId: 'middle' },
  { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 0, z: 6, packId: 'middle' },
  { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 5, z: 4, packId: 'middle' },
  {
    mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
    x: -5,
    z: 31,
    packId: 'final',
    miniboss: IGNIVAR_WARDEN_MINIBOSS,
  },
  { mobId: IGNIVAR_EMBER_SENTINEL_ID, x: 0, z: 33, packId: 'final' },
  {
    mobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
    x: 5,
    z: 31,
    packId: 'final',
    miniboss: IGNIVAR_WARDEN_MINIBOSS,
  },
];

const IGNIVAR_INNER_CRUCIBLE_SPAWN_LIST: DungeonSpawn[] = [
  { mobId: VARKHUL_BOSS_ID, x: 0, z: 16, facing: 0 },
];

// The Ignivar raid family's ONE overworld entrance: the keep tower door on
// Forgefather's Isle (the forge-lift's walk-up). Every raid room's doorPos
// points here so any outside displacement or front-room leave sets players
// down beside the keep. The old Eastbrook walk-up testing door is retired.
const IGNIVAR_KEEP_DOOR_POS = { x: 503.05, z: 2243.7 };

export const DUNGEON_DEFS: Record<string, DungeonDef> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    name: 'The Hollow Crypt',
    index: 0,
    doorPos: { x: 80, z: 90 }, // entrance portal at the chapel ruin
    // Arrive back near the exit portal so the first pack (z 18+) is outside aggro
    // range on entry: no mob can pull the moment you zone in. See dungeon_entry_clearance test.
    entry: { x: 0, z: -2 },
    exitOffset: { x: 0, z: -6 },
    spawns: CRYPT_SPAWN_LIST,
    interior: 'crypt',
    tombDressing: 'coffins',
    suggestedPlayers: 5,
    enterText: 'You descend into the Hollow Crypt...',
    leaveText: 'You climb back into daylight.',
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    name: 'The Sunken Bastion',
    index: 1,
    doorPos: { x: 45, z: 515 }, // drowned keep south of the Gravecaller camp
    entry: { x: 0, z: -2 }, // clear-of-aggro arrival (see dungeon_entry_clearance test)
    exitOffset: { x: 0, z: -6 },
    spawns: BASTION_SPAWN_LIST,
    interior: 'crypt',
    tombDressing: 'cargo',
    suggestedPlayers: 5,
    enterText: 'You wade down into the Sunken Bastion...',
    leaveText: 'You climb out of the drowning dark.',
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    name: 'Gravewyrm Sanctum',
    index: 2,
    doorPos: { x: 0, z: 858 }, // sealed gate in the graveyard, off the Sanctum Approach slope
    entry: { x: 0, z: -2 }, // clear-of-aggro arrival (see dungeon_entry_clearance test)
    exitOffset: { x: 0, z: -6 },
    spawns: SANCTUM_SPAWN_LIST,
    interior: 'sanctum',
    suggestedPlayers: 5,
    enterText: 'The air goes cold. Something vast breathes below...',
    leaveText: 'You stagger back into the mountain wind.',
  },
  nythraxis_crypt: {
    id: 'nythraxis_crypt',
    name: 'Abandoned Crypt',
    index: 4,
    doorPos: { x: -152, z: 610 },
    entry: { x: 0, z: 4 },
    exitOffset: { x: 0, z: -6 },
    spawns: [],
    objects: [
      // The three attunement relics: interacting raises the guardian undead
      // (fallen_captain_aldren/corrupted_priest_malric/deathstalker_voss) that
      // drop the keystone halves + diary — see activateNythraxisRelic in sim.ts.
      // Spread down the nave so they read as the crypt's quest interactables.
      // (The Royal Graves live in the overworld for q_nythraxis_graves; they do
      // not belong inside the crypt, where that quest is already complete.)
      { itemId: 'captains_crest', name: 'Crypt Keystone Upper', x: -7, z: 28 },
      { itemId: 'priests_sigil', name: 'Crypt Keystone Lower', x: 0, z: 52 },
      { itemId: 'royal_seal', name: 'Ancient Diary', x: 7, z: 76 },
      // Sealed royal door to the raid: flush-centre on the crypt back wall.
      // Back wall collider spans z 111-113 (centre 112, hd 1); sit the door just
      // in front of its inner face so it reads as set into the wall but stays
      // interactable (isBlocked r=0.5 needs centre z <= 110.5).
      {
        itemId: '',
        name: 'Sealed Royal Door',
        x: 0,
        z: 110.4,
        templateId: 'dungeon_door',
        dungeonId: 'nythraxis_boss_arena',
      },
    ],
    interior: 'crypt',
    tombDressing: 'coffins',
    suggestedPlayers: 1,
    enterText: 'You cross the threshold of the Abandoned Crypt.',
    leaveText: 'You return to the cold air of Thornpeak.',
  },
  the_last_keep: {
    id: 'the_last_keep',
    name: 'The Last Keep',
    // Overflow band: indexes 0..7 are taken (temple 3, orkadia 6, wildheart 7),
    // so the keep claims 8 (instanceOrigin: DUNGEON_OVERFLOW_X_BASE + 600).
    index: 8,
    // On the keep model's door axis (the keep sits at 421,2001.5 at scale
    // 9.5, face at z 2012.2, facing +z), standing 1.2yd PROUD of the facade
    // as a porch rather than flush against it. Flush put the arch's stone
    // jambs 0.3yd off the keep's collision circle, and the two slivers of
    // floor pinched between them were narrower than a body could turn around
    // in. The apron cannot be fenced off instead: the restore path below
    // drops a player inside the keep's own circle, which depenetrates them
    // south across exactly this ground. Leaving drops the player FORWARD onto
    // the terrace (leaveOffset +z) instead of the default z - 4, which would
    // land inside the keep's decor collider (castle_layout)
    doorPos: { x: 421, z: 2013.4 },
    leaveOffset: { x: 0, z: 3.5 },
    staticDoor: true,
    // Arrival just inside the entrance hall's south end, 4yd north of the exit
    // portal so zoning in never lands inside the exit's 2yd door trigger.
    entry: { x: 0, z: -5 },
    exitOffset: { x: 0, z: -9 },
    // Zero combat, zero loot by design: the keep is a place to walk, not a
    // fight (the zero-spawn Nythraxis attunement crypt is the precedent). It is
    // deliberately absent from FINDER_ACTIVITIES, so the Dungeon Finder never
    // queues a group into an empty instance (orkadia/wildheart precedent: the
    // finder catalogue is explicit, not derived from DUNGEONS).
    spawns: [],
    objects: [
      // the hall's keepsake: a signet dropped by the garrison that never
      // came home, on the entrance hall floor east of the door
      { itemId: 'last_keep_signet', name: 'Signet of the Last Keep', x: 4, z: 0 },
    ],
    interior: 'lastkeep',
    suggestedPlayers: 1,
    enterText: 'You step into the cold, silent halls of the Last Keep.',
    leaveText: 'You pull the keep door shut and step back into the Drakelands wind.',
  },
  dawnhold_castle: {
    id: 'dawnhold_castle',
    name: 'Dawnhold Castle',
    // Overflow band: the Last Keep took 8, so Dawnhold claims 9
    // (instanceOrigin: DUNGEON_OVERFLOW_X_BASE + 1200).
    index: 9,
    // FLUSH against the keep model's south face on its door axis (the keep
    // sits at 258,878 at scale 7.5, facing +z into the bailey with its hall
    // wing): the portal arch emerges from the palace stone and reads as the
    // castle's own door. Leaving therefore drops the player FORWARD onto the
    // courtyard lawn (leaveOffset +z) instead of the default z - 4, which
    // would land inside the keep's decor collider (dawnhold_layout).
    doorPos: { x: 258, z: 886.6 },
    leaveOffset: { x: 0, z: 3.2 },
    staticDoor: true,
    // Arrival just inside the entrance hall's south end, 4yd north of the
    // exit portal so zoning in never lands inside the exit's 2yd door trigger.
    entry: { x: 0, z: -5 },
    exitOffset: { x: 0, z: -9 },
    // Zero combat, zero loot by design: a warm garden palace to walk, not a
    // fight (the Last Keep is the direct precedent). Deliberately absent from
    // FINDER_ACTIVITIES, so the Dungeon Finder never queues a group into an
    // empty instance.
    spawns: [],
    objects: [
      // the palace's keepsake: a pressed posy from the conservatory beds,
      // dropped on the entrance hall floor east of the door
      { itemId: 'dawnhold_posy', name: 'Dawnhold Garden Posy', x: 4, z: -3 },
    ],
    interior: 'dawnhold',
    suggestedPlayers: 1,
    enterText: 'You step into the warm, flower-scented halls of Dawnhold Castle.',
    leaveText: 'You slip back out onto the sunlit garden lawn.',
  },
  nythraxis_boss_arena: {
    id: 'nythraxis_boss_arena',
    name: 'Nythraxis Raid Arena',
    index: 5,
    doorPos: { x: -152, z: 610 },
    overworldDoor: false,
    entry: { x: 0, z: 4 },
    exitOffset: { x: 0, z: -6 },
    spawns: NYTHRAXIS_RAID_SPAWN_LIST,
    objects: [
      // Three soul wardstones in a wide forward triangle in front of the boss
      // (spawn 0,96), well clear of his body so all three read distinctly and
      // raiders must split to channel them. Kept within the encounter's
      // wardstone search radius (see nythraxisWardstones in sim.ts). The item id
      // doubles as the Sunken Bastion quest pickup, so without interactOnly the
      // quest-collectable display gate hides them from every raider who is not on
      // that zone 2 quest.
      { itemId: 'bastion_ward_stone', name: 'Left Wardstone', x: -40, z: 79, interactOnly: true },
      { itemId: 'bastion_ward_stone', name: 'Right Wardstone', x: 40, z: 79, interactOnly: true },
      {
        itemId: 'bastion_ward_stone',
        name: 'Threshold Wardstone',
        x: 0,
        z: 63,
        interactOnly: true,
      },
    ],
    interior: 'nythraxis',
    tombDressing: 'coffins',
    suggestedPlayers: 10,
    enterText: 'You pass through the sealed royal door.',
    leaveText: 'You return to the cold air of Thornpeak.',
  },
  [IGNIVAR_LIFT_ROOM_ID]: {
    id: IGNIVAR_LIFT_ROOM_ID,
    name: 'The Forge-Lift',
    // 14, not 13: the raid arm's Molten Assembly took 13 in parallel, and
    // two rooms sharing an instance slot resolve door triggers to the
    // wrong interior (found in the Drakelands entrance merge).
    index: 14,
    // The raid's overworld entrance: the Forgefather's Isle keep tower's
    // south face, at the top of the keep stair (the owner's chosen spot).
    // Walking into the keep's doorway boards the forge-lift: a sealed car
    // that "rides down" for a fixed spell (the room never moves; the
    // shaft illusion sells it), then its exit gate becomes an ordinary
    // portal into the Halls. src/sim/ignivar_forge_lift.ts owns the ride.
    doorPos: IGNIVAR_KEEP_DOOR_POS,
    guideVisible: false,
    entry: { x: 0, z: -4 },
    exitOffset: { x: 0, z: -6.5 },
    spawns: [],
    npcs: [],
    objects: [
      {
        itemId: '',
        name: 'Forge-Lift Gate',
        x: 0,
        z: 6.5,
        templateId: IGNIVAR_LIFT_GATE_LOCKED_TEMPLATE,
        dungeonId: IGNIVAR_FORGE_APPROACH_ID,
        lootable: false,
      },
    ],
    interior: 'ignivar_lift',
    suggestedPlayers: 10,
    enterText: 'The forge-lift shudders and sinks; hammerfall rises to meet you.',
    leaveText: 'The lift hauls you back into the open air of the keep.',
  },
  [IGNIVAR_FORGE_APPROACH_ID]: {
    id: IGNIVAR_FORGE_APPROACH_ID,
    name: 'Halls of the First Tempering',
    index: 10,
    // Interior raid room reached through the Forge-Lift's opened gate; doorPos
    // is only where leaving drops players, beside the keep entrance. The old
    // Eastbrook walk-up testing door is retired.
    doorPos: IGNIVAR_KEEP_DOOR_POS,
    overworldDoor: false,
    guideVisible: false,
    entry: { x: 0, z: -50 },
    exitOffset: { x: 0, z: -54 },
    // Return below the keep stair, clear of the lift door's walk-in trigger.
    leaveOffset: { x: 0, z: -6.5 },
    spawns: IGNIVAR_FORGE_APPROACH_SPAWN_LIST,
    npcs: [
      { npcId: IGNIVAR_MAELIN_NPC_ID, x: 0, z: -47 },
      { npcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID, x: 0, z: 48 },
      // The sigil-redemption vendor beside the raid entrance (APPEND-only:
      // instance entity ids allocate in list order).
      { npcId: CRUCIBLE_VENDOR_NPC_ID, x: 6, z: -47 },
    ],
    objects: [
      {
        itemId: IGNIVAR_RECORD_IDS.firstTempering,
        name: IGNIVAR_LORE_OBJECTS[IGNIVAR_RECORD_IDS.firstTempering].name,
        x: -13,
        z: -40,
        interactOnly: true,
      },
      {
        itemId: IGNIVAR_RECORD_IDS.livingMetal,
        name: IGNIVAR_LORE_OBJECTS[IGNIVAR_RECORD_IDS.livingMetal].name,
        x: 13,
        z: -8,
        interactOnly: true,
      },
      {
        itemId: IGNIVAR_RECORD_IDS.heraldKey,
        name: IGNIVAR_LORE_OBJECTS[IGNIVAR_RECORD_IDS.heraldKey].name,
        x: -13,
        z: 21,
        interactOnly: true,
      },
      {
        itemId: '',
        name: 'Sealed Herald Gate',
        x: 0,
        z: 53,
        templateId: IGNIVAR_GATE_LOCKED_TEMPLATE,
        dungeonId: IGNIVAR_RAID_ARENA_ID,
        lootable: false,
      },
    ],
    interior: 'ignivar_approach',
    suggestedPlayers: 10,
    enterText: 'Hammerfall echoes through the Halls of the First Tempering.',
    leaveText: 'You step away from the first forge and breathe freely again.',
  },
  [IGNIVAR_RAID_ARENA_ID]: {
    id: IGNIVAR_RAID_ARENA_ID,
    name: 'Crucible of the Last Spring',
    index: 11,
    // Internal raid room reached through the Herald gate in the approach;
    // doorPos is only where leaving drops players, beside the keep entrance.
    doorPos: IGNIVAR_KEEP_DOOR_POS,
    overworldDoor: false,
    guideVisible: false,
    entry: { x: 0, z: -27 },
    exitOffset: { x: 0, z: -30 },
    spawns: IGNIVAR_RAID_SPAWN_LIST,
    // Between the north pillars, facing south into the arena (Math.PI = -z).
    npcs: [{ npcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID, x: 10, z: 24, facing: Math.PI }],
    objects: [
      // The four water pumps ARE the water conduits: each pump is promoted to
      // a sim object so the encounter can flip its state (ready/active/
      // cooldown) and cleanse players standing in its water. Positions match
      // the baked water_pump dressing placements (IGNIVAR_CONDUITS), so the
      // state overlay renders on the pump the player sees.
      ...IGNIVAR_CONDUITS.map((conduit) => ({
        itemId: '',
        name: `${conduit.id} Water Conduit`,
        x: conduit.x,
        z: conduit.z,
        templateId: IGNIVAR_WATER_CONDUIT_TEMPLATES.ready,
        lootable: false,
      })),
      {
        itemId: '',
        name: 'Sealed Assembly Gate',
        x: 0,
        z: 31.5,
        templateId: IGNIVAR_GATE_LOCKED_TEMPLATE,
        dungeonId: IGNIVAR_MOLTEN_ASSEMBLY_ID,
        lootable: false,
      },
    ],
    interior: 'ignivar',
    suggestedPlayers: 10,
    enterText: 'Heat shimmers above the sealed waters of the Crucible.',
    leaveText: 'You step away from the Crucible and breathe freely again.',
  },
  [IGNIVAR_MOLTEN_ASSEMBLY_ID]: {
    id: IGNIVAR_MOLTEN_ASSEMBLY_ID,
    name: 'Molten Assembly',
    index: 13,
    // Internal raid route reached only through the gate behind Ignivar;
    // doorPos is only where leaving drops players, beside the keep entrance.
    doorPos: IGNIVAR_KEEP_DOOR_POS,
    overworldDoor: false,
    guideVisible: false,
    entry: { x: 0, z: -50 },
    exitOffset: { x: 0, z: -54 },
    spawns: IGNIVAR_MOLTEN_ASSEMBLY_SPAWN_LIST,
    npcs: [{ npcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID, x: 0, z: -47 }],
    objects: [
      {
        itemId: '',
        name: 'Sealed Inner Crucible Gate',
        x: 0,
        z: 53,
        templateId: IGNIVAR_GATE_LOCKED_TEMPLATE,
        dungeonId: IGNIVAR_SECOND_WING_ID,
        lootable: false,
      },
    ],
    interior: 'ignivar_approach',
    suggestedPlayers: 10,
    enterText: 'The opened gate leads into a molten assembly hall.',
    leaveText: 'You leave the assembly line and return to the Crucible.',
  },
  [IGNIVAR_SECOND_WING_ID]: {
    id: IGNIVAR_SECOND_WING_ID,
    name: 'The Inner Crucible',
    index: 12,
    // Internal raid wing reached only through the Molten Assembly gate;
    // doorPos is only where leaving drops players, beside the keep entrance.
    doorPos: IGNIVAR_KEEP_DOOR_POS,
    overworldDoor: false,
    guideVisible: false,
    entry: { x: 0, z: -34 },
    exitOffset: { x: 0, z: -38 },
    spawns: IGNIVAR_INNER_CRUCIBLE_SPAWN_LIST,
    npcs: [{ npcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID, x: 14, z: 31 }],
    interior: 'ignivar_depths',
    suggestedPlayers: 10,
    enterText: 'The opened gate leads deeper into the Crucible.',
    leaveText: 'You leave the silent depths of the Crucible.',
  },
};
