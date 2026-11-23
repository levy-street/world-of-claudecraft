// The Hollow Crypt's trash (docs/design/dungeon-rework/hollow_crypt.md,
// "Trash"): simple, readable pack mechanics in the style of classic five-man
// trash, NOT lessons for the next boss. Each type has one job the group learns
// to answer:
//
//   Ossuary Warrior         Grave Cleave: a telegraphed frontal cone. Step out.
//   Gravecaller Adept       Grave Bolt: a hard shadow bolt. Interrupt it.
//                           (Heroic only since the second wave: its normal
//                           job is the volley below.)
//   Ossuary Cutthroat       Rending Leap: leaps onto the farthest caster, bleeds.
//   Gravecaller Necromancer Raise Bones: a channel. Interrupt it, or a minion rises.
//   Bone Minion             grows into a Bone Brute in 8 s; dies in a Bone Burst.
//   Chapel Gargoyle         waits on its perch, dives in; Stone Shriek stuns. Kick it.
//   Crow Caller             Murder Call summons another flock. Kick it.
//   Carrion Crow            weak fast fliers, in flocks.
//   Ossuary Drake           the flying patrol: fire breath in front, tail behind, a wing gust.
//
// The trash mechanics pass (mob/trash_kit/crypt_kit.ts) gives the crypt one
// group idea: the necromancers rule the bones. Kill the one who makes the
// others strong.
//
//   Ossuary Warrior         Reassemble: falls by a living necromancer of its
//                           pack and its bones stand back up 8 s later. Kill
//                           the necromancer first, or break the bones.
//   Gravecaller Necromancer Grave Rupture: bursts a fallen packmate's corpse.
//                           Kick it, or fight away from the dead.
//   Ossuary Cutthroat       Torn Tendon: its leap halves the victim's speed.
//                           Heroic: unanswered (no taunt, stun, root or slow)
//                           it leaps again at the next caster.
//   Bone Minion             Splinter Burst: its burst also cuts the skeletons
//                           round it. Drag the pack onto it before it dies.
//   Bone Brute              Marrow Crush: a narrow telegraphed smash. Face it
//                           away, or brace for it.
//   Chapel Gargoyle         Granite Skin: its stone thickens; a stun shatters
//                           it and leaves it Cracked Stone. Save a stun.
//   Crow Caller             Carrion Eye: every crow hunts one marked player.
//                           Run to the tank and burn the flock down together.
//   Carrion Crow            Gouging Beak: a peck that can blind (misses more).
//   Ossuary Drake           heroic Barrow Embers: its breath leaves the cone
//                           burning for 5 s. Keep the drake moving.
//   (Bonechill Widow        Rimesilk Spit: a web lane that roots, dungeons.ts.)
//
// The second wave, on the engine's line-of-sight nova (kit_nova.ts):
//
//   Gravecaller Adept       Gravespark Volley: a 3 s kickable bar, then grave
//                           sparks at every player who can SEE it. Kick it,
//                           or step behind a cloister pillar. On normal it
//                           replaces the Grave Bolt; heroic casts both, so
//                           the group saves its kick for the one that matters.
//
// Numbers are classic-era normal-mode bases for levels 7 to 10, anchored to
// the shipped crypt trash (Crypt Shambler 7 + 2.2/level, 437 health at level 8)
// and to Morthen's 12 to 18 Shadow Pulse at level 10: a Grave Bolt costs a
// cloth wearer about a sixth of their health, so an uninterrupted one hurts
// but never kills on normal. Heroic scales them through the dungeon's
// difficulty transform (mechanicDamageMult). Merged by data.ts.

import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_BONE_PILE,
  CRYPT_CARRION_EYE,
  CRYPT_GRAVE_BOLT,
  CRYPT_GRAVE_CLEAVE,
  CRYPT_GRAVE_RUPTURE,
  CRYPT_GRAVESPARK_VOLLEY,
  CRYPT_MARROW_CRUSH,
  CRYPT_MURDER_CALL,
  CRYPT_RAISE_BONES,
  CRYPT_STONE_SHRIEK,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../mob/trash_kit/cast_ids';
import type { MobTemplate } from '../types';

const BONE_LOOT = [
  { copper: 95, chance: 1 },
  { itemId: 'bone_fragments', chance: 0.8 },
];
const CASTER_LOOT = [
  { copper: 110, chance: 1 },
  { itemId: 'linen_scrap', chance: 0.6 },
];

export const HOLLOW_CRYPT_TRASH_MOBS: Record<string, MobTemplate> = {
  crypt_ossuary_warrior: {
    id: 'crypt_ossuary_warrior',
    name: 'Ossuary Warrior',
    minLevel: 8,
    maxLevel: 9,
    family: 'undead',
    elite: true,
    hpBase: 55,
    hpPerLevel: 21,
    dmgBase: 7,
    dmgPerLevel: 2.2,
    attackSpeed: 2.4,
    armorPerLevel: 20,
    moveSpeed: 6.5,
    aggroRadius: 12,
    // A wide, slow, telegraphed swing across its front: only the tank eats it.
    breathCone: {
      castId: CRYPT_GRAVE_CLEAVE,
      name: 'Grave Cleave',
      castTime: 1.6,
      every: 10,
      range: 8,
      arcDeg: 110,
      min: 16,
      max: 24,
      school: 'physical',
    },
    // Reassemble: fallen beside a living necromancer of its pack, its bones
    // stand back up with a third of its health 8 s later (once; heroic: half,
    // twice). The pile is about a fifth of its health (86 at level 8, 752 on
    // heroic): two or three swings break it. A risen warrior pays nothing twice.
    trashKit: {
      reassemble: {
        name: 'Reassemble',
        masters: ['crypt_gravecaller_necromancer'],
        pile: CRYPT_BONE_PILE,
        seconds: 8,
        hpPct: 0.33,
        heroicHpPct: 0.5,
        rises: 1,
        heroicRises: 2,
      },
    },
    loot: BONE_LOOT,
    scale: 1.1,
    color: 0xd8cfb8,
  },
  crypt_gravecaller_adept: {
    id: 'crypt_gravecaller_adept',
    name: 'Gravecaller Adept',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    elite: true,
    hpBase: 40,
    hpPerLevel: 17,
    dmgBase: 6,
    dmgPerLevel: 1.8,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    // Stands back and throws grave sparks between its Grave Bolts.
    petSpell: {
      name: 'Grave Spark',
      school: 'shadow',
      min: 8,
      max: 12,
      range: 26,
      every: 3,
      windup: 0.6,
    },
    trashKit: {
      // Heroic only (the second wave): on normal the volley is its one job.
      bolt: {
        castId: CRYPT_GRAVE_BOLT,
        name: 'Grave Bolt',
        castTime: 2.5,
        every: 9,
        first: 3,
        school: 'shadow',
        range: 30,
        min: 26,
        max: 34,
        heroicOnly: true,
      },
      // Gravespark Volley (the engine's G6 nova): 3 s of raised hands, then a
      // spark at every player within 30 yd who can see it; a pillar between
      // them shields them. Math, landed raw: normal 12 to 16, about 7 percent
      // of a level 8 cloth wearer's ~210 (a quarter of a Grave Bolt), so even
      // an unkicked volley every 14 s is pressure, never a threat. Heroic rides
      // the adept's x24 (dungeon_difficulty.ts: its melee lift to the 500
      // floor, which its mechanics follow): 288 to 384, 23 to 31 percent of a
      // level 20 heroic cloth wearer's ~1,250; an adept pair's two volleys
      // stagger (pack_cast_stagger.ts), so the worst unkicked beat is one.
      nova: {
        castId: CRYPT_GRAVESPARK_VOLLEY,
        name: 'Gravespark Volley',
        castTime: 3,
        every: 14,
        first: 6,
        school: 'shadow',
        radius: 30,
        min: 12,
        max: 16,
      },
    },
    loot: CASTER_LOOT,
    scale: 1.0,
    color: 0x8f6cc4,
  },
  crypt_ossuary_cutthroat: {
    id: 'crypt_ossuary_cutthroat',
    name: 'Ossuary Cutthroat',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    elite: true,
    hpBase: 45,
    hpPerLevel: 18,
    dmgBase: 6,
    dmgPerLevel: 1.9,
    attackSpeed: 1.8,
    armorPerLevel: 14,
    moveSpeed: 7.5,
    aggroRadius: 12,
    trashKit: {
      leap: {
        name: 'Rending Leap',
        every: 14,
        first: 2,
        minRange: 8,
        maxRange: 30,
        seconds: 0.7,
        fixate: 4,
        bleed: { perTick: 5, interval: 2, duration: 8 },
        // Torn Tendon: the victim runs at half speed for the fixate, so it
        // cannot shake the cutthroat alone (the tank taunts, a stun or a slow
        // answers it). Heroic: unanswered, it leaps at the next caster.
        slow: { mult: 0.5, seconds: 4, name: 'Torn Tendon' },
        releapOnHeroic: true,
      },
    },
    loot: BONE_LOOT,
    scale: 1.0,
    color: 0xa8b0b0,
  },
  crypt_gravecaller_necromancer: {
    id: 'crypt_gravecaller_necromancer',
    name: 'Gravecaller Necromancer',
    minLevel: 9,
    maxLevel: 9,
    family: 'undead',
    elite: true,
    hpBase: 44,
    hpPerLevel: 18,
    dmgBase: 6,
    dmgPerLevel: 1.8,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    petSpell: {
      name: 'Grave Spark',
      school: 'shadow',
      min: 9,
      max: 13,
      range: 26,
      every: 3.4,
      windup: 0.6,
    },
    trashKit: {
      raise: {
        castId: CRYPT_RAISE_BONES,
        name: 'Raise Bones',
        castTime: 3,
        every: 15,
        first: 3,
        school: 'shadow',
        summon: 'crypt_bone_minion',
        maxAlive: 2,
      },
      // Grave Rupture: a fallen packmate's corpse bursts under the fight. 22 to
      // 30 shadow is about a seventh of a level 8 cloth wearer (a hair under
      // the Grave Bolt), so normal shrugs it off. Heroic rides the
      // necromancer's x12 mechanic factor (dungeon_difficulty.ts, the balance
      // audit; on its x24 melee lift it was 528 to 720 plus a 432 to 720 pool,
      // a one-shot of a full heroic cloth wearer): 264 to 360 (21 to 29
      // percent of ~1,250), and the corpse burns 3 s at 72 to 120 a second;
      // standing in both is 480 to 720 (38 to 58 percent).
      rupture: {
        castId: CRYPT_GRAVE_RUPTURE,
        name: 'Grave Rupture',
        castTime: 2.5,
        every: 14,
        first: 8,
        school: 'shadow',
        range: 30,
        radius: 5,
        min: 22,
        max: 30,
        pool: { seconds: 3, tick: 1, min: 6, max: 10 },
      },
    },
    loot: CASTER_LOOT,
    scale: 1.05,
    color: 0x6fd6a8,
  },
  crypt_bone_minion: {
    id: 'crypt_bone_minion',
    name: 'Bone Minion',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    hpBase: 30,
    hpPerLevel: 12,
    dmgBase: 4,
    dmgPerLevel: 1.3,
    attackSpeed: 1.6,
    armorPerLevel: 8,
    moveSpeed: 9,
    aggroRadius: 10,
    // Kill it fast: left alive it swells into a Bone Brute. Killed, it bursts.
    trashKit: { grow: { after: 8, into: 'crypt_bone_brute', name: 'Bone Growth' } },
    deathThroes: {
      min: 12,
      max: 18,
      radius: 3.5,
      delay: 1.8,
      name: 'Bone Burst',
      school: 'physical',
      // Splinter Burst: the bone shards also cut the skeletons round it, a
      // tenth of their health each (about 46 on an Ossuary Warrior), never
      // a killing blow. Drag the pack onto the minion before it falls.
      shrapnel: { family: 'undead', maxHpPct: 0.1, name: 'Splinter Burst' },
    },
    loot: [],
    scale: 0.85,
    color: 0xe8e0c8,
  },
  crypt_bone_brute: {
    id: 'crypt_bone_brute',
    name: 'Bone Brute',
    minLevel: 9,
    maxLevel: 9,
    family: 'undead',
    elite: true,
    hpBase: 70,
    hpPerLevel: 24,
    dmgBase: 10,
    dmgPerLevel: 2.6,
    attackSpeed: 2.8,
    armorPerLevel: 22,
    moveSpeed: 6,
    aggroRadius: 12,
    // Marrow Crush: a narrow, slow, telegraphed smash at the tank. Its swing
    // is 37 to 58 (level 9 elite), the crush 55 to 70 raw: the punishment for
    // letting a minion grow, and the tank's first big hit to respect (face it
    // away from the group, or brace). Heroic rides the summoned-add line (x9.5).
    breathCone: {
      castId: CRYPT_MARROW_CRUSH,
      name: 'Marrow Crush',
      castTime: 2,
      every: 12,
      range: 7,
      arcDeg: 50,
      min: 55,
      max: 70,
      school: 'physical',
    },
    loot: [{ copper: 60, chance: 1 }],
    scale: 1.0,
    color: 0xd9d0bc,
  },
  crypt_chapel_gargoyle: {
    id: 'crypt_chapel_gargoyle',
    name: 'Chapel Gargoyle',
    minLevel: 9,
    maxLevel: 9,
    family: 'elemental',
    elite: true,
    hpBase: 50,
    hpPerLevel: 20,
    dmgBase: 8,
    dmgPerLevel: 2.3,
    attackSpeed: 2.2,
    armorPerLevel: 30,
    moveSpeed: 7,
    // A statue until its pack is pulled (it only wakes this close on its own).
    aggroRadius: 5,
    trashKit: {
      perch: { diveSeconds: 1.1, name: 'Stone Dive' },
      screech: {
        castId: CRYPT_STONE_SHRIEK,
        name: 'Stone Shriek',
        castTime: 2,
        every: 16,
        first: 5,
        school: 'nature',
        radius: 10,
        stun: 2.5,
        min: 6,
        max: 10,
      },
      // Granite Skin: a layer of stone every 3 s, 6 percent less damage each
      // (heroic 10) up to five; a stun shatters it and leaves it Cracked Stone,
      // taking 25 percent more for 6 s. Save a stun for the gargoyle. Five
      // layers ward 30 percent (heroic 50), under the classic shield-wall
      // style 50 to 75 percent cooldowns, and the crack's 25 percent sits at
      // the classic armor-break band; it never touches player health.
      granite: {
        name: 'Granite Skin',
        every: 3,
        perStack: 0.06,
        heroicPerStack: 0.1,
        maxStacks: 5,
        cracked: { name: 'Cracked Stone', seconds: 6, taken: 0.25 },
      },
    },
    loot: [
      { copper: 120, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.4 },
    ],
    // A great stone brute over three times a player's height crouched on its
    // arch (the body is authored at 5.8 yd; the melee reach follows the body).
    scale: 1.5,
    color: 0x8c8f99,
  },
  crypt_crow_caller: {
    id: 'crypt_crow_caller',
    name: 'Crow Caller',
    minLevel: 8,
    maxLevel: 8,
    family: 'humanoid',
    elite: true,
    hpBase: 42,
    hpPerLevel: 17,
    dmgBase: 6,
    dmgPerLevel: 1.8,
    attackSpeed: 2.2,
    armorPerLevel: 12,
    moveSpeed: 7,
    aggroRadius: 12,
    petSpell: {
      name: 'Carrion Hex',
      school: 'nature',
      min: 7,
      max: 11,
      range: 26,
      every: 3.2,
      windup: 0.6,
    },
    trashKit: {
      call: {
        castId: CRYPT_MURDER_CALL,
        name: 'Murder Call',
        castTime: 3,
        every: 18,
        first: 5,
        school: 'nature',
        summon: 'crypt_carrion_crow',
        count: 4,
        maxAlive: 6,
      },
      // Carrion Eye: one player marked for 6 s, every crow in the fight on
      // them. The marked runs to the tank and the flock dies together.
      eye: {
        castId: CRYPT_CARRION_EYE,
        name: 'Carrion Eye',
        castTime: 1.5,
        every: 16,
        first: 9,
        school: 'nature',
        range: 30,
        seconds: 6,
        flock: 'crypt_carrion_crow',
      },
    },
    loot: CASTER_LOOT,
    scale: 1.0,
    color: 0x3a3440,
  },
  crypt_carrion_crow: {
    id: 'crypt_carrion_crow',
    name: 'Carrion Crow',
    minLevel: 7,
    maxLevel: 7,
    family: 'beast',
    hpBase: 18,
    hpPerLevel: 7,
    dmgBase: 3,
    dmgPerLevel: 1,
    attackSpeed: 2,
    armorPerLevel: 4,
    moveSpeed: 11,
    aggroRadius: 12,
    untameable: true,
    // Gouging Beak: a peck that can blind (a fifth more misses for 4 s).
    // Rare per swing, but a flock of five pecks often: the flock is never safe
    // to leave on the tank.
    blind: { chance: 0.08, miss: 0.2, duration: 4, name: 'Gouging Beak', school: 'physical' },
    trashKit: { land: { seconds: 1 } },
    loot: [],
    scale: 1.0,
    color: 0x2b2830,
  },
  crypt_ossuary_drake: {
    id: 'crypt_ossuary_drake',
    name: 'Ossuary Drake',
    minLevel: 10,
    maxLevel: 10,
    family: 'undead',
    elite: true,
    hpBase: 110,
    hpPerLevel: 38,
    dmgBase: 11,
    dmgPerLevel: 2.8,
    attackSpeed: 2.2,
    armorPerLevel: 24,
    moveSpeed: 7.5,
    // It sees you from the sky: a pass overhead is a pull.
    aggroRadius: 16,
    // Spectral fire from the soul caged in its ribs, poured down a long cone.
    breathCone: {
      castId: CRYPT_BARROWFLAME_BREATH,
      name: 'Barrowflame Breath',
      castTime: 2,
      every: 12,
      range: 14,
      arcDeg: 70,
      min: 26,
      max: 34,
      school: 'fire',
    },
    trashKit: {
      land: { seconds: 2.2 },
      // Heroic only: Barrow Embers, the breath's cone burns 5 s after it lands
      // (6 to 9 fire a second, x20 on heroic: 120 to 180). Keep it moving.
      scorch: { name: 'Barrow Embers', seconds: 5, tick: 1, min: 6, max: 9, school: 'fire' },
      tailLash: {
        castId: CRYPT_TAIL_LASH,
        name: 'Tail Lash',
        castTime: 1,
        every: 9,
        first: 6,
        school: 'physical',
        range: 10,
        arcDeg: 120,
        min: 18,
        max: 26,
      },
      wingGust: {
        castId: CRYPT_WING_GUST,
        name: 'Wing Gust',
        castTime: 1.5,
        every: 16,
        first: 10,
        school: 'physical',
        radius: 10,
        knockback: 8,
        min: 10,
        max: 16,
      },
    },
    loot: [
      { copper: 400, chance: 1 },
      { itemId: 'bone_fragments', chance: 1 },
    ],
    scale: 1.0,
    color: 0xe3dccb,
  },
  // Reassemble's bones (crypt_kit.ts): an Ossuary Warrior fallen beside a
  // living necromancer of its pack lies here as a pile that will stand. It
  // never moves or swings; break it (two or three swings) to keep the warrior
  // down. Pays nothing (xpMult 0, no loot).
  [CRYPT_BONE_PILE]: {
    id: CRYPT_BONE_PILE,
    name: 'Stirring Bones',
    minLevel: 8,
    maxLevel: 8,
    family: 'undead',
    hpBase: 30,
    hpPerLevel: 8,
    dmgBase: 0,
    dmgPerLevel: 0,
    attackSpeed: 999,
    armorPerLevel: 0,
    moveSpeed: 0,
    aggroRadius: 0,
    xpMult: 0,
    idleStationary: true,
    offStreamIdle: true,
    trashKit: { bonePile: { name: 'Reassemble' } },
    loot: [],
    scale: 1.1,
    color: 0xd8cfb8,
  },
};
