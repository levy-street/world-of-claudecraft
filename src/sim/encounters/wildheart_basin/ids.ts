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
/** The totem the howdah's rider throws onto the ford (the rework): it feeds
 *  the Saurian until it is destroyed. A body of the claim, raised by the
 *  encounter (never placed in the spawn list). */
export const SAP_TOTEM_ID = 'sunbone_sap_totem';
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

// The rider's totems (the rework, 2026-10-14, the owner's approved design):
// the Howdah Hexcaller fights from his seat from the pull, throwing Sunbone
// Sap Totems onto the ford that heal the beast until the group breaks them.

/** The rider's throw (a `nova` spellfx on the Saurian, its target the totem
 *  that has just landed: the renderer draws the arc from the howdah). */
export const SAURIAN_TOTEM_THROW = 'wildheart_saurian_totem_throw';
/** A totem's own clock, carried as its cast bar: the seconds to its next
 *  mending of the Saurian (`castTargetId` = the Saurian; the first bar is the
 *  longer arming one). Also the spellfx of each mending (source the totem,
 *  target the Saurian: the pulse down the tether) and the heal's cast id. */
export const SAURIAN_SAP_TETHER = 'wildheart_saurian_sap_tether';
/** Fed by its totems: an aura on the Saurian while any Sap Totem stands
 *  (`stacks` = how many; it carries no stat, the totems do the healing). */
export const SAURIAN_SAPPED = 'wildheart_saurian_sapped';
/** A totem breaks: its stored sap snaps back down the tether into the beast
 *  (a `nova` spellfx on the Saurian, its source the broken totem), and the
 *  damage name of that backlash. */
export const SAURIAN_SAP_BACKLASH = 'wildheart_saurian_sap_backlash';
/** Heroic: the second rider's drum. An aura on the Saurian while it beats
 *  (the Stomp's clock runs faster), its twin while a broken totem's backlash
 *  has knocked the drummer off his beat (`remaining` = the silence left), and
 *  the spellfx of each beat (a `nova` on the Saurian). */
export const SAURIAN_WAR_DRUM = 'wildheart_saurian_war_drum';
export const SAURIAN_DRUM_SILENCED = 'wildheart_saurian_drum_silenced';
export const SAURIAN_DRUM_BEAT = 'wildheart_saurian_drum_beat';

/**
 * The Saurian's numbers (normal; heroic scales the damage through the claim's
 * mechanicDamageMult). Damage is stated LANDED on a level-20 cloth wearer of
 * about 950 health (README section 7): Tail Swipe about 21 percent, the Stomp
 * about 19 percent, both avoidable.
 *
 * The totem rework moves no pool and adds no damage on normal:
 *   - A totem mends nothing for its first 4 s, so a group that breaks each
 *     one promptly is healed for nothing at all.
 *   - What the group spent on the totem comes straight back: a broken totem's
 *     backlash deals the Saurian exactly the totem's own health. A group that
 *     keeps the totems down has the fight it had before, to the second.
 *   - A totem left alone mends 0.8 percent of the Saurian every 2 s; three
 *     stand at most. On the planning party (150 a second against about 10,000:
 *     1.5 percent a second) three totems give back 1.2: the fight still moves,
 *     at a fifth of its pace. Ignoring them loses, breaking them never costs.
 * Heroic adds the drum, and pays for it out of the Stomp it quickens (below).
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

  // ---- the rider's totems ------------------------------------------------------
  /** The rider throws his first totem 5 s into the pull and one every 10 s
   *  after it, while he sits the howdah: three before it breaks on the 65 s
   *  plan. On the ground he throws none (his bundle went down with the
   *  howdah): from there his own Ancestral Sap is the thing to stop. */
  totemFirst: 5,
  totemEvery: 10,
  /** At most three stand at once; with three up he holds his throw and tries
   *  again this often. */
  totemMax: 3,
  totemRetry: 2,
  /** A totem lands this far from the Saurian's centre: past the Stomp's 12 yd
   *  ring and the Tail Swipe's 12 yd cone, so whoever breaks it stands clear
   *  of both. One of eight spots round it, picked by a hash, on its own floor
   *  and at least `totemSpacing` from every standing totem. */
  totemRange: 14,
  totemSpots: 8,
  totemSpacing: 6,
  /** Its first mending comes 4 s after it lands (the arming bar: a solo
   *  player's run to it and a couple of global cooldowns), then one every
   *  2 s: 0.8 percent of the Saurian's health each. */
  totemArm: 4,
  totemHealEvery: 2,
  totemHealPct: 0.008,

  // ---- heroic: the drum ----------------------------------------------------------
  // A second rider beats a drum from the howdah: while it beats, the Stomp's
  // clock runs twice as fast (a Stomp every 8 s instead of 16). The answer is
  // the totems again: a broken totem's backlash knocks the drummer off his
  // beat for 6 s. Totems land 10 s apart, so a group that breaks each inside
  // its 4 s arming bar hears the drum 4 s in every 10: the Stomp's clock runs
  // 1.4 times as fast for them. The Stomp is priced to that: while the drum is
  // aboard a heroic Stomp lands at 0.7 of its roll, so the group that answers
  // takes 1.4 x 0.7 = 0.98 of the Stomp damage it took before, and a group
  // that lets the drum run takes 2 x 0.7 = 1.4. The drum goes down with the
  // howdah at half health, and the Stomp is whole again from there.
  /** How fast the Stomp's clock runs while the drum beats. */
  drumStompRate: 2,
  /** Seconds a broken totem silences the drum. */
  drumSilence: 6,
  /** The drum's beat (the pulse the renderer lands on the ford). */
  drumBeatEvery: 1,
  /** A heroic Stomp's share of its roll while the drum is aboard. */
  drumStompScale: 0.7,
} as const;

/** The Saurian's chat line when the howdah breaks (re-localized by src/ui/sim_i18n.ts). */
export const SAURIAN_HOWDAH_LOG =
  'The howdah splinters! A Howdah Hexcaller leaps down to tend the Great Saurian.';
/** The emote of the rider's first throw of a pull (re-localized by src/ui/sim_i18n.ts). */
export const SAURIAN_TOTEM_LOG =
  'The Howdah Hexcaller hurls a Sunbone Sap Totem onto the ford. Break it before it feeds the Great Saurian!';

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
//
// The hunt rework (2026-10-13, the owner's approved design): the sun glyphs
// start dark and the players who are NOT the Prey light them; between hunts he
// pins a player with a Hunting Spear; and at 30 percent the stone jaguar wakes
// (The Idol Wakes) in place of the template enrage he used to carry.

/** His terrace as the encounter reads it: this far round ZULGAR_SPOT (the
 *  arena and a margin). The HUD's alert reads the same reach. */
export const ZULGAR_TERRACE_RADIUS = 34;

/** Wildheart Pulse: a 1.5 s bar, then a ring 14 yd round him. */
export const ZULGAR_PULSE = 'wildheart_zulgar_pulse';
/** Spirit of the Hunt: a 1.5 s bar as the jaguar spirit takes him. */
export const ZULGAR_SPIRIT_HUNT = 'wildheart_zulgar_spirit_hunt';
/** The Jaguar Avatar: an aura on Zulgar for the whole hunt (`remaining` =
 *  the hunt left; permanent once the idol wakes). The renderer dresses him in
 *  the spirit jaguar and lights the stone jaguar's eyes while it holds. */
export const ZULGAR_AVATAR = 'wildheart_jaguar_avatar';
/** The Prey: the jade claw mark on the hunted player (`sourceId` = Zulgar;
 *  `value2` 1 on the prey he is chasing right now). */
export const ZULGAR_PREY = 'wildheart_prey';
/** Mauled: a caught prey is knocked down (a stun aura) and bitten. */
export const ZULGAR_MAULED = 'wildheart_mauled';
/** Sunstruck: a slow on the avatar when it crosses a lit sun glyph, and its
 *  twin, the damage window (a `vulnerability` aura for the same seconds: the
 *  renderer turns the spirit jaguar gold and the HUD says "burn him" off it). */
export const ZULGAR_SUNSTRUCK = 'wildheart_sunstruck';
export const ZULGAR_SUNSTRUCK_EXPOSED = 'wildheart_sunstruck_exposed';
/** Wary of the Sun: once struck, no glyph strikes the avatar again until
 *  this fades (an aura on him that shows the rule; the clock is the fight
 *  state's). */
export const ZULGAR_SUN_WARY = 'wildheart_sun_wary';
/** The six sun glyphs (encounter objects, `scale` = radius): lit or dark. */
export const WILDHEART_SUN_GLYPH_LIT = 'wildheart_sun_glyph_lit';
export const WILDHEART_SUN_GLYPH_DARK = 'wildheart_sun_glyph_dark';
/** A dark glyph's own clocks, carried on the glyph object as a cast bar (the
 *  replicated presentation clock of an encounter object, as the Ghost
 *  Captain's lanes carry theirs): KINDLE while a player stands on it lighting
 *  it (`castTotal` the seconds it takes, `castRemaining` what is left,
 *  `castTargetId` the one lighting it), COLD while a glyph that just struck
 *  him cannot be lit again (`castRemaining` the seconds left). */
export const WILDHEART_GLYPH_KINDLE = 'wildheart_sun_glyph_kindle';
export const WILDHEART_GLYPH_COLD = 'wildheart_sun_glyph_cold';
/** A glyph catching light (a `nova` spellfx on the glyph, from its lighter). */
export const WILDHEART_GLYPH_LIT_FX = 'wildheart_sun_glyph_lights';
/** Heroic Ambush: he vanishes (an aura on him; immune and hidden), a 6 yd
 *  circle marks the farthest player's spot (encounter object, `scale` =
 *  radius), and he pounces there. */
export const ZULGAR_VANISHED = 'wildheart_zulgar_vanished';
export const ZULGAR_AMBUSH = 'wildheart_zulgar_ambush';
export const WILDHEART_AMBUSH_MARK = 'wildheart_ambush_mark';

/** Hunting Spear: a 1.5 s bar at a player (`castTargetId`), then the spear
 *  pins them. Also the spellfx of the throw landing and the damage name of
 *  its bleed. */
export const ZULGAR_HUNTING_SPEAR = 'wildheart_zulgar_hunting_spear';
/** Pinned: the root the spear leaves on its victim (`sourceId` = the spear's
 *  body, so a client finds the spear from the aura as it finds an Iron Cage;
 *  `value2` 1 while the victim may wrench it out themself: nobody else stands
 *  free to help). */
export const ZULGAR_PINNED = 'wildheart_pinned';
/** The spear standing in the terrace: a usable body (the trash engine's G3
 *  use, mob/trash_kit/encounter_use.ts). A teammate targets it and presses
 *  interact; the victim's own press is claimed by zulgar_spear.ts. */
export const HUNTING_SPEAR_ID = 'wildheart_hunting_spear';
/** The use's cast id (the player's bar). A literal: this leaf imports
 *  nothing, and tests/wildheart_basin_zulgar_spear.test.ts pins it to
 *  types.ts KIT_USE_CAST_PREFIX. */
export const HUNTING_SPEAR_PULL_CAST = 'kituse_wildheart_pull_spear';
/** The spear coming out (a `nova` spellfx on the freed player). */
export const ZULGAR_SPEAR_FREED = 'wildheart_hunting_spear_freed';

/** The Idol Wakes: the 2 s bar that opens the final phase when it begins
 *  outside a hunt, and the aura on Zulgar that says the stone jaguar is awake
 *  (the renderer burns its eyes and its throat off it). */
export const ZULGAR_IDOL_WAKES = 'wildheart_zulgar_idol_wakes';
export const ZULGAR_IDOL_AWAKE = 'wildheart_idol_awake';
/** Idol's Breath: the warned half of the terrace (an encounter object on the
 *  terrace's centre line; `facing` points across the marked half, a quarter
 *  turn east or west; its cast bar is the warning's clock), then the breath
 *  itself pouring over it (the same object, its template flipped, its cast
 *  bar the seconds the breath plays out). Also the spellfx of the landing and
 *  the damage name. */
export const WILDHEART_IDOL_BREATH_WARNING = 'wildheart_idol_breath_warning';
export const WILDHEART_IDOL_BREATH = 'wildheart_idol_breath';
export const ZULGAR_IDOLS_BREATH = 'wildheart_idols_breath';

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
  /** Avatar contact: standard 5 yd melee reach, not the giant priest's
   *  scaled reach plus a catch bonus. This is centre-to-centre. */
  catchReach: 5,
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

  // ---- the sun glyphs ------------------------------------------------------
  /** A player who is not the Prey lights a dark glyph by standing on it this
   *  long (the bar on the glyph; stepping off resets it). Only while the
   *  spirit hunts: every glyph goes dark again when a hunt ends. */
  glyphKindleSeconds: 2,
  /** With nobody else free to light on the terrace the Prey lights for
   *  themself, and faster: he runs 7.7 yd a second against a player's 7, so a
   *  lone Prey who stood 2 s would be caught on the glyph every time. One
   *  second is the lead a Sunstruck (3 s at 40 percent of his run) buys on the
   *  14 yd to the next glyph. */
  glyphKindleAloneSeconds: 1,
  /** A glyph that just struck him is spent: it cannot be lit again for this
   *  long, so one player camping one glyph is no route (it would strike him
   *  once every 10 s; two glyphs lit in turn strike him every 5). */
  glyphColdSeconds: 8,
  /** Sunstruck: 60 percent slower for 3 s, and he takes 25 percent more
   *  damage for those 3 s (the size of every other boss's window: Ysolei's
   *  Eclipsed, the Knellwyrm's Bared Ribs, Morthen's Shattered Ward). No pool
   *  moves for it: the best route keeps him struck about 60 percent of a
   *  hunt, so a perfect group gains about 15 percent while he is the avatar,
   *  which is what the lighters and the Prey give up by not attacking. */
  sunstruckSlow: 0.6,
  sunstruckSeconds: 3,
  sunstruckVuln: 0.25,
  /** Wary of the Sun: from a strike, no glyph strikes him again for this long
   *  (the 3 s window and 2 s after it; a lit glyph he crosses meanwhile stays
   *  lit). Without it six lit glyphs chain into one endless window: slowed,
   *  he crawls the 7 yd from one glyph's rim to the next inside its 3 s. */
  sunWarySeconds: 5,

  // ---- Hunting Spear -------------------------------------------------------
  // Priced off the Pulse (about 206 on everyone within 14 yd, one every
  // 13.5 s: its 12 s clock waits out its own bar; 15 a second each). A spear
  // costs nothing on impact. Pulled within 3 s it bled 45, a fifth of a Pulse;
  // left in for its whole 10 s it bled 150 and its Pulse landed for half as
  // much again (about 103 more): 253, or 9 a second over the 28.5 s between
  // spears, for a mistake the whole group can see.
  /** Due every 20 s (the first 8 s in), and thrown when the next Pulse is
   *  `spearLeadsPulse` off, so every spear is followed by a Pulse on the same
   *  fuse. In a plain phase that is before every second Pulse, 28.5 s apart
   *  (two Pulse periods of 13.5 s and the spear's own bar); a due clock under
   *  15 s would put one before EVERY Pulse. Never during a hunt, an Ambush or
   *  the final phase, never over another bar; a hunt beginning pulls every
   *  spear out. */
  spearEvery: 20,
  spearFirst: 8,
  spearCast: 1.5,
  /** Seconds left on the Pulse's clock when the spear's bar opens (the clock
   *  waits out the spear's bar as it does every bar of his): the spear lands,
   *  3.5 s later the Pulse's own 1.5 s bar opens, so the Pulse lands 5 s
   *  after the pin. */
  spearLeadsPulse: 3.5,
  /** Pinned: rooted until the spear is pulled, at most this long. */
  pinSeconds: 10,
  /** The bleed: this much (landed) every `pinBleedEvery` s while Pinned. */
  pinBleed: 15,
  pinBleedEvery: 1,
  /** A Pinned player is struck by the Wildheart Pulse wherever they stand
   *  (it runs down the spear), for this much of its roll. */
  pinPulseMult: 1.5,
  /** A teammate pulls the spear in 1.5 s from within 4 yd (3.5 s to get
   *  there before the Pulse lands); alone, the victim wrenches it out in 3 s
   *  (2 s to spare). */
  spearPullSeconds: 1.5,
  spearWrenchSeconds: 3,
  spearPullRange: 4,
  /** The spear stands this far from its victim, on the side it came from. */
  spearStandoff: 1.1,

  // ---- the final phase: The Idol Wakes -------------------------------------
  // It REPLACES the template enrage (under 30 percent: melee x 1.5 at x 1.28
  // speed, so x 1.92). On the reference tank (level-20 prot, 2861 armor,
  // Defensive Stance) his average swing lands 257 every 2.55 s, 101 a second;
  // enraged, 194 a second, about 9,300 over the 48 s the last 30 percent of
  // his 160 s plan takes. In the final phase he never swings (the avatar's
  // swings are held), so that whole 194 a second is what the phase may spend.
  // The Idol's Breath spends it on the people who do not move: 300 to 360 an
  // exhale, one every 10 s, is 165 a second across a party of five that eats
  // EVERY exhale (under what the tank alone used to take) and nothing across a
  // party that crosses in time. One exhale is 35 percent of the 950 cloth
  // pool, between the Pulse (22) and the Maul (53): the dearest mistake of
  // the phase and the one with the longest warning. Heroic takes both through
  // the claim's mechanic factor (2.5), as every boss mechanic here does.
  /** The idol wakes at 30 percent: a 2 s bar from a plain phase; a hunt in
   *  flight simply never ends. */
  idolAtHpPct: 0.3,
  idolWakeCast: 2,
  /** He switches Prey every 8 s (heroic Twin Prey: a fresh pair every 12 s,
   *  each chased for one 6 s turn). In the final phase the tank is hunted
   *  like anyone: there is nothing left to tank. */
  finalPreySeconds: 8,
  /** A switch is unannounced, and the new Prey may be a melee at his feet:
   *  he turns on it for 1.5 s before he runs (planted, as when he feeds), so
   *  a fresh mark is never caught where it stands. At a run a player clears
   *  his reach (melee range and 1.5 yd) in under a second; the other half
   *  second is the time it takes to see the mark. The turn comes out of the
   *  8 s, never on top of it: 6.5 s of chase per mark. */
  finalSwitchPause: 1.5,
  /** Idol's Breath: the first warning 5 s after it wakes, then one every
   *  10 s, alternating halves. The warning stands 5 s: a player on the far
   *  rim, 30 yd from the centre line, needs 4.3 s to cross at a run. */
  breathFirst: 5,
  breathEvery: 10,
  breathWarning: 5,
  breathMin: 300,
  breathMax: 360,
  /** Seconds the breath plays out over its half once it has landed (the hit
   *  is the landing; the pour is its look). */
  breathLinger: 1.6,

  /** Heroic Twin Prey: two marks, he switches every 6 s. */
  twinSwitch: 6,
  /** Heroic Ambush: 2 s gone, the circle paints 0.5 s in (1.5 s warning),
   *  6 yd, 250 to 300 landed. The glyphs stay lit until he lands, so a group
   *  that stood the far player on a lit glyph opens a Sunstruck window on his
   *  own pounce. */
  ambushSeconds: 2,
  ambushWarning: 1.5,
  ambushRadius: 6,
  ambushMin: 250,
  ambushMax: 300,
} as const;

/** The Idol's Breath marks one half of the terrace: +1 the east half (local
 *  x above the centre line), -1 the west. */
export type IdolBreathSide = 1 | -1;

/** The facing an Idol's Breath object carries for a side (it points across
 *  the marked half, away from the centre line). */
export function idolBreathFacing(side: IdolBreathSide): number {
  return (side * Math.PI) / 2;
}

/** The side an Idol's Breath object marks, read back off its facing. */
export function idolBreathSideOf(facing: number): IdolBreathSide {
  return Math.sin(facing) >= 0 ? 1 : -1;
}

/** Is a spot (instance-local x) inside the half an Idol's Breath marks? The
 *  centre line itself is safe: the edge the floor paints is the edge tested. */
export function inIdolBreathHalf(localX: number, side: IdolBreathSide): boolean {
  return localX * side > 0;
}

export const ZULGAR_DEED = 'dgn_zulgar_uncaught';

/** Zulgar's lines (re-localized by src/ui/sim_i18n.ts). */
export const ZULGAR_LINES = {
  hunt: 'The jaguar wakes in me! Run, little prey!',
  huntEnds: 'The spirit sleeps... for now.',
  ambush: 'You cannot hide from the hunter!',
  spear: 'Hold still, little prey.',
  idolWakes: 'Wake, old stone! Breathe on them!',
} as const;

/** The emote as the stone jaguar draws breath (re-localized by src/ui/sim_i18n.ts). */
export const ZULGAR_IDOL_BREATH_LOG = 'The stone jaguar draws breath!';

/** What a Pinned player is told when they press interact while a teammate
 *  stands free to pull the spear (re-localized by src/ui/sim_i18n.ts). */
export const ZULGAR_SPEAR_HELP_ERROR = 'You are pinned: a teammate must pull the spear out.';
