// The Wildheart Basin's encounter ids and tuning, as a dependency-free leaf:
// the content (wildheart.ts), the encounter modules, the trash kit's death
// clouds (mob/trash_kit/wildheart_kit.ts), the dev helpers, the renderer's
// telegraphs and the tests all key on these.
//
// docs/design/dungeon-rework/wildheart_basin.md sections 4 and 5.

export const WILDHEART_DUNGEON = 'wildheart_basin';

/** The three bosses, in route order (their cores are phase B). The Fanglord
 *  Beastmaster fights beside his Great Jaguar (one pack). */
export const BEASTMASTER_ID = 'wildheart_beastmaster';
export const FANGLORD_JAGUAR_ID = 'fanglord_jaguar';
export const GORGEBLOOM_ID = 'the_gorgebloom';
export const ZULGAR_ID = 'wildheart_high_priest';
/** The showpiece patrol of the River Ford, and the rider its howdah drops. */
export const GREAT_SAURIAN_ID = 'great_saurian';
export const HOWDAH_HEXCALLER_ID = 'howdah_hexcaller';
/** The trash. */
export const STALKER_ID = 'wildheart_stalker';
export const RAVAGER_ID = 'wildheart_ravager';
export const HEXCALLER_ID = 'wildheart_hexcaller';
export const TOTEM_BINDER_ID = 'sunbone_totem_binder';
export const SUNBONE_TOTEM_ID = 'sunbone_totem';
/** The Totem-Binder's second totem: a bone post under a red skull whose
 *  Rattling Dread sends everyone near it fleeing (the trash mechanics pass). */
export const SUNBONE_DREAD_TOTEM_ID = 'sunbone_dread_totem';
export const BASIN_RAPTOR_ID = 'basin_raptor';
export const SPORE_TOAD_ID = 'spore_toad';
export const VINE_LASHER_ID = 'vine_lasher';

// ---- the Great Saurian (section 4.3) -------------------------------------------

/** Tail Swipe: a sweep of its tail through a rear cone, with a knockback. */
export const SAURIAN_TAIL_SWIPE = 'wildheart_saurian_tail_swipe';
/** Earthshaking Stomp: a telegraphed stomp round it that knocks everyone down. */
export const SAURIAN_STOMP = 'wildheart_saurian_stomp';
/** The knockdown an Earthshaking Stomp leaves (a short stun). */
export const SAURIAN_KNOCKDOWN = 'wildheart_saurian_knockdown';
/** Howdah Rider: the moment the howdah breaks and its rider jumps down (a
 *  `nova` spellfx on the Saurian; the renderer drops the howdah from the
 *  model while the Saurian stays under half health or fights on). */
export const SAURIAN_HOWDAH_BREAK = 'wildheart_saurian_howdah_break';
/** The Howdah Hexcaller hits the water behind the Saurian's right flank (a
 *  `nova` spellfx on the rider): the model's HowdahBreak clip throws its
 *  render-only rider there, and the real one takes over on this beat. */
export const SAURIAN_RIDER_LANDS = 'wildheart_saurian_rider_lands';
/** The Saurian's Enrage under a fifth of its health (a damage-done aura). */
export const SAURIAN_ENRAGE = 'wildheart_saurian_enrage';

/**
 * The Saurian's numbers (normal; heroic scales the damage through the claim's
 * mechanicDamageMult). Damage is stated LANDED on a level-20 cloth wearer of
 * about 950 health (README section 7): Tail Swipe about 21 percent, the Stomp
 * about 19 percent, both avoidable.
 */
export const SAURIAN_TUNING = {
  /** Tail Swipe: every 12 s a 1 s bar, then a rear 120 degree cone 12 yd deep. */
  tailEvery: 12,
  tailFirst: 5,
  tailCast: 1,
  tailRange: 12,
  tailArcDeg: 120,
  tailMin: 180,
  tailMax: 220,
  /** Yards the Tail Swipe throws a player. */
  tailKnockback: 8,
  /** Earthshaking Stomp: every 16 s a 2 s bar, then 12 yd round it. */
  stompEvery: 16,
  stompFirst: 9,
  stompCast: 2,
  stompRadius: 12,
  stompMin: 160,
  stompMax: 200,
  /** The knockdown (a stun) on everyone the Stomp lands on. */
  knockdown: 1,
  /** Howdah Rider: the howdah breaks at half health. */
  howdahAtHpPct: 0.5,
  /** Seconds from the break to the rider landing (the HowdahBreak clip's
   *  leap: it leaves the saddle at 0.9 s and lands at 1.8 s). */
  riderLandDelay: 1.8,
  /** Where it lands, in yards from the Saurian's centre at its drawn size:
   *  to its right and behind (the clip's landing point, clear of the tail's
   *  root and the forefeet). */
  riderLandRight: 5.5,
  riderLandBack: 4.9,
  /** Enrage under a fifth of its health: 30 percent more damage. */
  enrageAtHpPct: 0.2,
  enrageDamage: 0.3,
} as const;

/** The Saurian's chat line when the howdah breaks (re-localized by src/ui/sim_i18n.ts). */
export const SAURIAN_HOWDAH_LOG =
  'The howdah splinters! A Howdah Hexcaller leaps down to tend the Great Saurian.';

// ---- encounter objects: their template id carries their look -----------------

/** A Spore Burst cloud on the floor where a Spore Toad died (scale = radius). */
export const WILDHEART_SPORE_CLOUD = 'wildheart_spore_cloud';

/** The Great Saurian deed: it and its Howdah Hexcaller fall within 20 s. */
export const SAURIAN_DEED = 'dgn_great_saurian';
export const SAURIAN_DEED_WINDOW = 20;

// ---- Boss 1: the Fanglord Beastmaster and his Great Jaguar (section 5.1) -----

/** Pack Bond: while master and jaguar stand within reach of each other, both
 *  take less damage (`buff_dr`) and deal more (`buff_dmg_done`, the twin aura
 *  id below). The renderer draws the jade spirit cord between them while it
 *  holds, brighter as they close. */
export const BEAST_PACK_BOND = 'wildheart_pack_bond';
export const BEAST_PACK_BOND_FURY = 'wildheart_pack_bond_fury';
/** Stalk: the fang mark over the jaguar's prey (a mark aura on the player;
 *  `sourceId` = the jaguar, `remaining` = the seconds left on the hunt). */
export const BEAST_STALKED = 'wildheart_stalked';
/** The jaguar's bite on its prey (spellfx + damage ability), and its bleed. */
export const BEAST_JAGUAR_BITE = 'wildheart_jaguar_bite';
export const BEAST_RENDING_BITE = 'wildheart_rending_bite';
/** The jaguar's control windows: once a stun, a root or a slow has landed on
 *  it, that kind of control slides off for the rest of the window (auras on
 *  the jaguar, `remaining` = the window left). */
export const BEAST_WARY_STUN = 'wildheart_jaguar_wary_stun';
export const BEAST_WARY_ROOT = 'wildheart_jaguar_wary_root';
export const BEAST_WARY_SLOW = 'wildheart_jaguar_wary_slow';
/** Beast Pit Quake: a 1.5 s bar on the Beastmaster, then a ring round him. */
export const BEAST_PIT_QUAKE = 'wildheart_beast_pit_quake';
/** Call of the Hunt: both beasts attack faster for a few seconds (an aura on
 *  each, and a `nova` spellfx on the Beastmaster). */
export const BEAST_CALL_OF_THE_HUNT = 'wildheart_call_of_the_hunt';
/** Thickhide Ward: an absorb shield on the jaguar (aura + `nova` spellfx). */
export const BEAST_THICKHIDE_WARD = 'wildheart_thickhide_ward';
/** Heroic Heel!: a 2 s bar on the jaguar (`castTargetId` = its master; the
 *  floor arc runs from the jaguar to him), then it leaps to his side. */
export const BEAST_HEEL = 'wildheart_jaguar_heel';

export const BEAST_TUNING = {
  /** Pack Bond reach (heroic Frenzied Bond: 20). */
  bondReach: 15,
  heroicBondReach: 20,
  /** Damage taken cut and damage done rise while bonded. */
  bondDr: 0.5,
  bondDamage: 0.2,
  /** Stalk: a mark lasts 10 s, then the jaguar picks another prey. */
  stalkSeconds: 10,
  stalkFirst: 2,
  /** In a group the jaguar never stalks the master's tank. With nobody else
   *  in the pits it hunts one standing back within this many yards past the
   *  pits' rim; with nobody there either it waits where it stands. */
  stalkFarReach: 40,
  /** Each kind of control lands once per window. */
  controlWindow: 20,
  /** The jaguar bites its prey every 2 s in reach: 120 to 150, then a bleed
   *  (20 every 2 s for 6 s). Call of the Hunt quickens the bites too. */
  biteEvery: 2,
  biteMin: 120,
  biteMax: 150,
  bleedPerTick: 20,
  bleedInterval: 2,
  bleedSeconds: 6,
  /** Beast Pit Quake: every 13 s a 1.5 s bar, then 8 yd round him. */
  quakeEvery: 13,
  quakeFirst: 8,
  quakeCast: 1.5,
  quakeRadius: 8,
  quakeMin: 180,
  quakeMax: 220,
  /** Call of the Hunt: every 20 s, 20 percent faster attacks for 7 s. */
  huntEvery: 20,
  huntFirst: 10,
  huntSeconds: 7,
  huntHaste: 1.2,
  /** Thickhide Ward: every 18 s an absorb on the jaguar for 8 s (heroic 900). */
  wardEvery: 18,
  wardFirst: 13,
  wardSeconds: 8,
  wardAmount: 600,
  heroicWardAmount: 900,
  /** Heroic Heel!: every 25 s a 2 s bar, then the jaguar is at his side. */
  heelEvery: 25,
  heelFirst: 16,
  heelCast: 2,
  /** The deed: Pack Bond held for less than this many seconds in total. */
  bondDeedSeconds: 10,
} as const;

/** The control group a control aura kind belongs to (the jaguar's windows),
 *  or null when the kind is not one the windows count. */
export function controlGroupOf(kind: string): 'stun' | 'root' | 'slow' | null {
  if (kind === 'root') return 'root';
  if (kind === 'slow') return 'slow';
  // Every hard control shares the stun window; a blind (a miss chance) is
  // not a control and is never counted.
  if (kind === 'stun' || kind === 'incapacitate' || kind === 'polymorph') return 'stun';
  return null;
}

/** The wary aura id each control group leaves on the jaguar. */
export const BEAST_WARY_AURA: Readonly<Record<'stun' | 'root' | 'slow', string>> = {
  stun: BEAST_WARY_STUN,
  root: BEAST_WARY_ROOT,
  slow: BEAST_WARY_SLOW,
};

/** Pack Bond's reach for a difficulty. */
export function bondReachFor(heroic: boolean): number {
  return heroic ? BEAST_TUNING.heroicBondReach : BEAST_TUNING.bondReach;
}

/** How bright the spirit cord burns (0 when the bond is broken, rising to 1
 *  as master and jaguar close): what the renderer reads. */
export function bondStrength(distance: number, reach: number): number {
  if (!(distance <= reach) || reach <= 0) return 0;
  return Math.max(0.15, Math.min(1, 1 - distance / reach + 0.15));
}

export const BEASTMASTER_DEED = 'dgn_beastmaster_apart';

/** The Beastmaster's lines (re-localized by src/ui/sim_i18n.ts). */
export const BEASTMASTER_LINES = {
  engage: 'Into the pit with them, my beauty! Hunt!',
  heel: 'Heel! To me!',
  death: 'Run... little one... run...',
} as const;

// ---- Boss 2: the Gorgebloom (section 5.2) ---------------------------------------

/** The Thorn Sprout a missed Seedpod grows into (an elite biter). */
export const THORN_SPROUT_ID = 'thorn_sprout';
/** Seed Rain: a 1.5 s bar, then six Seedpods on the loam beds. */
export const BLOOM_SEED_RAIN = 'wildheart_gorgebloom_seed_rain';
/** A Seedpod on the loam (encounter object, `scale` = the touch radius); it
 *  turns RIPE for its last seconds before it sprouts. */
export const WILDHEART_SEEDPOD = 'wildheart_seedpod';
export const WILDHEART_SEEDPOD_RIPE = 'wildheart_seedpod_ripe';
/** A pod stomped flat (spellfx on the stomper), a pod sprouting (spellfx at
 *  the sprout), heroic Burrowing Seeds (spellfx as a pod sinks away). */
export const BLOOM_SEED_STOMP = 'wildheart_seedpod_stomp';
export const BLOOM_SEED_SPROUT = 'wildheart_seedpod_sprout';
export const BLOOM_SEED_BURROW = 'wildheart_seedpod_burrow';
/** Pollinate: two players glow gold for 8 s (a mark aura); a pollinated
 *  touch makes a pod sprout at once. */
export const BLOOM_POLLINATE = 'wildheart_gorgebloom_pollinate';
export const BLOOM_POLLINATED = 'wildheart_pollinated';
/** Vine Lash: a 1.5 s bar, a 30 yd lane along the bloom's locked facing; the
 *  root it leaves (the vines climb the rooted player). */
export const BLOOM_VINE_LASH = 'wildheart_gorgebloom_vine_lash';
export const BLOOM_VINE_LASHED = 'wildheart_vine_lashed';
/** Gorge: a 1.5 s bar on the tank, a heavy bite, then Digesting (a dot). */
export const BLOOM_GORGE = 'wildheart_gorgebloom_gorge';
export const BLOOM_DIGESTING = 'wildheart_digesting';
/** Bloom Spit: what the rooted bloom does to a target it cannot reach. */
export const BLOOM_SPIT = 'wildheart_gorgebloom_spit';

export const BLOOM_TUNING = {
  /** Seed Rain: every 15 s, six pods; a pod sprouts 12 s after it lands
   *  (heroic Burrowing Seeds: it burrows at 6 s and rises by a player). */
  seedEvery: 15,
  seedFirst: 6,
  seedCast: 1.5,
  seedCount: 6,
  /** A body within this of a pod's centre touches it. */
  podTouch: 1.6,
  podSprout: 12,
  heroicBurrow: 6,
  /** The pod reads RIPE for its last seconds. */
  podRipeFor: 4,
  /** Pollinate: every 10 s two players for 8 s. Heroic Pollen Cloud: anyone
   *  within 3 yd of a pollinated player for 2 s is pollinated too. */
  pollinateEvery: 10,
  pollinateFirst: 4,
  pollinateCount: 2,
  pollinateSeconds: 8,
  cloudRadius: 3,
  cloudSeconds: 2,
  /** Vine Lash: every 10 s a 1.5 s bar, a 30 yd lane 2 yd either side of its
   *  line: 180 to 220 and a 2 s root. */
  lashEvery: 10,
  lashFirst: 8,
  lashCast: 1.5,
  lashLength: 30,
  lashHalfWidth: 2,
  lashMin: 180,
  lashMax: 220,
  lashRoot: 2,
  /** Gorge: every 15 s a 1.5 s bar, then twice its melee on the tank and
   *  Digesting, 40 nature a second for 6 s. */
  gorgeEvery: 15,
  gorgeFirst: 11,
  gorgeCast: 1.5,
  gorgeMult: 2,
  digestPerSecond: 40,
  digestSeconds: 6,
  /** Bloom Spit: once its target stands out of its reach for 1.5 s, a spit
   *  every 2 s, 140 to 170 nature (the rooted bloom is never kited). */
  spitDelay: 1.5,
  spitEvery: 2,
  spitMin: 140,
  spitMax: 170,
} as const;

export const GORGEBLOOM_DEED = 'dgn_gorgebloom_clean';

/** The Gorgebloom has no voice; its lines are emotes of the terrace
 *  (re-localized by src/ui/sim_i18n.ts). */
export const GORGEBLOOM_LINES = {
  seeds: 'The Gorgebloom spits a rain of seeds across the loam!',
  sprout: 'A Thorn Sprout bursts from the loam!',
} as const;

// ---- Boss 3: Zulgar, Voice of the Basin (section 5.3) ------------------------------

/** Wildheart Pulse: a 1.5 s bar, then a ring 14 yd round him. */
export const ZULGAR_PULSE = 'wildheart_zulgar_pulse';
/** Spirit of the Hunt: a 1.5 s bar as the jaguar spirit takes him. */
export const ZULGAR_SPIRIT_HUNT = 'wildheart_zulgar_spirit_hunt';
/** The Jaguar Avatar: an aura on Zulgar for the whole hunt (`remaining` =
 *  the hunt left). The renderer dresses him in the spirit jaguar and lights
 *  the stone jaguar's eyes while it holds. */
export const ZULGAR_AVATAR = 'wildheart_jaguar_avatar';
/** The Prey: the jade claw mark on the hunted player (`sourceId` = Zulgar;
 *  `value2` 1 on the prey he is chasing right now). */
export const ZULGAR_PREY = 'wildheart_prey';
/** Mauled: a caught prey is knocked down (a stun aura) and bitten. */
export const ZULGAR_MAULED = 'wildheart_mauled';
/** Sunstruck: a slow on the avatar when it crosses a lit sun glyph. */
export const ZULGAR_SUNSTRUCK = 'wildheart_sunstruck';
/** The six sun glyphs (encounter objects, `scale` = radius): lit or dark. */
export const WILDHEART_SUN_GLYPH_LIT = 'wildheart_sun_glyph_lit';
export const WILDHEART_SUN_GLYPH_DARK = 'wildheart_sun_glyph_dark';
/** Heroic Ambush: he vanishes (an aura on him; immune and hidden), a 6 yd
 *  circle marks the farthest player's spot (encounter object, `scale` =
 *  radius), and he pounces there. */
export const ZULGAR_VANISHED = 'wildheart_zulgar_vanished';
export const ZULGAR_AMBUSH = 'wildheart_zulgar_ambush';
export const WILDHEART_AMBUSH_MARK = 'wildheart_ambush_mark';

export const ZULGAR_TUNING = {
  /** Wildheart Pulse: every 12 s a 1.5 s bar, 14 yd, 170 to 243 landed. */
  pulseEvery: 12,
  pulseFirst: 7,
  pulseCast: 1.5,
  pulseRadius: 14,
  pulseMin: 170,
  pulseMax: 243,
  /** Spirit of the Hunt at 70 and 40 percent: a 1.5 s bar, then 20 s. */
  huntAtHpPct: [0.7, 0.4],
  huntCast: 1.5,
  huntSeconds: 20,
  /** He chases at 110 percent of his run (a player's run speed, 7 yd a second). */
  huntSpeedMult: 1.1,
  /** He catches his prey within this of his reach. */
  catchReach: 1.5,
  /** Mauled: 500 landed and a 2 s knockdown; he feeds 1 s, then hunts on. */
  maulDamage: 500,
  maulStun: 2,
  maulPause: 1,
  /** A Mauled player's respite: never Prey again for 5 s from the maul (the
   *  2 s knockdown, then a 3 s head start). He hunts another Prey meanwhile,
   *  or, with nobody else to hunt, roars over the kill and waits it out. */
  preyRespite: 5,
  /** Stuns land half as long on the avatar. */
  huntStunScale: 0.5,
  /** Sunstruck: 60 percent slower for 3 s; the glyph goes dark for 15 s. */
  sunstruckSlow: 0.6,
  sunstruckSeconds: 3,
  glyphDarkSeconds: 15,
  /** Heroic Twin Prey: two marks, he switches every 6 s. */
  twinSwitch: 6,
  /** Heroic Ambush: 2 s gone, the circle paints 0.5 s in (1.5 s warning),
   *  6 yd, 250 to 300 landed. */
  ambushSeconds: 2,
  ambushWarning: 1.5,
  ambushRadius: 6,
  ambushMin: 250,
  ambushMax: 300,
} as const;

export const ZULGAR_DEED = 'dgn_zulgar_uncaught';

/** Zulgar's lines (re-localized by src/ui/sim_i18n.ts). */
export const ZULGAR_LINES = {
  hunt: 'The jaguar wakes in me! Run, little prey!',
  huntEnds: 'The spirit sleeps... for now.',
  ambush: 'You cannot hide from the hunter!',
} as const;
