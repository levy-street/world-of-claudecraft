// The Drowned Temple bosses' ids, tuning and pure geometry, as a dependency-
// light leaf: the encounter modules, the dev helpers, the renderer's boss
// visuals and the tests all key on these. No SimContext, no rng.

import {
  CHOIR_COURT,
  HYDRA_POOL,
  HYDRA_POOL_COLUMN_R,
  HYDRA_POOL_COLUMNS,
  MOON_ALTAR,
  PRISM_TERRACE,
} from '../../content/drowned_temple_layout';

export const SELTHE_ID = 'choirmother_selthe';
export const COLOSSUS_ID = 'tideglass_colossus';
export const REFLECTION_ID = 'tideglass_reflection';
export const YSOLEI_ID = 'ysolei';
export const MOONSPAWN_ID = 'moonspawn';
export const HYDRA_LEFT_ID = 'mere_hydra_head_left';
export const HYDRA_CENTER_ID = 'mere_hydra_head_center';
export const HYDRA_RIGHT_ID = 'mere_hydra_head_right';
export const HYDRA_HEAD_TEMPLATES: readonly string[] = [
  HYDRA_LEFT_ID,
  HYDRA_CENTER_ID,
  HYDRA_RIGHT_ID,
];

// ---- cast ids (real cast bars on the bosses) -------------------------------------
export const SELTHE_SEA_SONG = 'temple_sea_song';
/** Retired: Selthe's old backhand. She is a caster now and never casts it; the
 *  id stays so the shipped cast-name rows (and an old replay) still resolve. */
export const SELTHE_TIDAL_SLAP = 'temple_tidal_slap';
/** Selthe's filler: a bolt of moonwater at her foe (a bar, kickable). */
export const SELTHE_MOONWATER_BOLT = 'temple_moonwater_bolt';
/** Selthe's sung beam of water on one player (a channel, kickable; line of
 *  sight breaks it, a body in the way catches it). */
export const SELTHE_DROWNING_ARIA = 'temple_drowning_aria';
/** Selthe heaves her pool: a wave crashes through a wedge of the court. */
export const SELTHE_MERE_SURGE = 'temple_mere_surge';
/** The ice head's frost cone (the cast id kept from the first pass; its bar
 *  reads Freezing Breath). */
export const HYDRA_TIDE_BREATH = 'temple_tide_breath';
/** The venom head's spit (the id kept from the first pass; it reads Venom Spit). */
export const HYDRA_BRINE_SPIT = 'temple_brine_spit';
/** The water head's torrent down a lane, with a shove. */
export const HYDRA_CRUSHING_TORRENT = 'temple_crushing_torrent';
/** The whole Hydra sinks and a wave rolls over one half of the pool. */
export const HYDRA_TSUNAMI = 'temple_hydra_tsunami';
/** The Combined Breath (hydra_combo.ts): two heads twine their necks and
 *  fuse their elements, on a bar on each head that takes part. Ice and water:
 *  the torrent freezes into an Ice Wall across the lagoon. */
export const HYDRA_FROSTLOCKED_TORRENT = 'temple_frostlocked_torrent';
/** Venom and water: the venom pools swell and slide down painted currents. */
export const HYDRA_VENOM_CURRENT = 'temple_venom_current';
/** Ice and venom: the venom pools freeze into crystals that burst. */
export const HYDRA_TOXIC_RIME = 'temple_toxic_rime';
export const COLOSSUS_PRISM_FLARE = 'temple_prism_flare';
export const COLOSSUS_MOONLIGHT_LANCE = 'temple_moonlight_lance';
export const COLOSSUS_RESONANT_SLAM = 'temple_resonant_slam';
/** The terrace floor splits into prism slices that detonate in three rounds
 *  (one long planted channel). */
export const COLOSSUS_TIDEGLASS_FRACTURE = 'temple_tideglass_fracture';
export const YSOLEI_LUNAR_TIDE = 'temple_lunar_tide';
export const YSOLEI_UNDERTOW = 'temple_undertow';
/** Ysolei's roar as her Moonspawn rise (a bar, never kicked). */
export const YSOLEI_CALL = 'temple_ysolei_call';
/** Ysolei's roar as she enrages (a bar, never kicked). */
export const YSOLEI_WRATH = 'temple_ysolei_wrath';
/** Ysolei calls the moon down (ysolei_moon.ts): at 75 and 45 percent a bar,
 *  never kicked, then her Moonlight Tears fall on the rim and roll at her. */
export const YSOLEI_BECKONING_MOON = 'temple_beckoning_moon';
/** At 20 percent the moon itself descends: a long bar under her Plenilune
 *  Ward; break the ward before it ends or the moon falls on the island. */
export const YSOLEI_FALLING_MOON = 'temple_falling_moon';

// ---- aura ids ---------------------------------------------------------------------
export const SELTHE_CHORUS_MARK = 'temple_chorus_mark';
export const SELTHE_SOLO_MARK = 'temple_solo_mark';
export const HYDRA_ENRAGED = 'temple_enraged_hydra';
/** A head under the water for the Tsunami: it takes far less damage. */
export const HYDRA_SUBMERGED = 'temple_hydra_submerged';
/** The Freezing Breath's chill on whoever it caught. */
export const HYDRA_FROSTBITE = 'temple_hydra_frostbite';
/** The Frostlocked Torrent's freeze (a short stun) on whoever it caught. */
export const HYDRA_FROZEN = 'temple_hydra_frozen';
export const COLOSSUS_PRISM_WARD = 'temple_prism_ward';
export const REFLECTION_TETHER = 'temple_reflection_tether';
export const YSOLEI_FLOODED = 'temple_flooded';
export const YSOLEI_RIPTIDE_AURA = 'temple_riptide';
/** A Moonlight Tear's burn on whoever stopped it: the next tear on them hurts
 *  far more (stacks). */
export const YSOLEI_MOONSEAR = 'temple_moonsear';
/** A tear that reached her: more damage done (stacks for the fight). */
export const YSOLEI_MOONSWELL = 'temple_moonswell';
/** The Plenilune Ward: the full-moon dome she shelters under while the moon
 *  descends (an absorb; value2 carries the ward's full size). */
export const YSOLEI_PLENILUNE_WARD = 'temple_plenilune_ward';
/** The ward broke in time: the moon is eclipsed and she reels (a stun), */
export const YSOLEI_ECLIPSED = 'temple_eclipsed';
/** ...and takes more damage while it lasts. */
export const YSOLEI_ECLIPSE_EXPOSED = 'temple_eclipse_exposed';
/** The ward held: the fallen moon's power stays on her for the fight. */
export const YSOLEI_MOONBORNE_MIGHT = 'temple_moonborne_might';

// ---- spellfx ability ids (presentation cues, never casts) ------------------------
export const SELTHE_CHORUS_BURST = 'temple_chorus_burst';
export const SELTHE_SOLO_BURST = 'temple_solo_burst';
export const SELTHE_ECHO_BURST = 'temple_echo_burst';
/** A Drowning Aria pulse lands on the player it struck (targetId). */
export const SELTHE_ARIA_PULSE = 'temple_aria_pulse';
/** A Drowning Aria broke (sight lost, kicked, its target fell or fled). */
export const SELTHE_ARIA_BROKEN = 'temple_aria_broken';
/** One red Tideglass Fracture slice detonates (targetId: its slice object). */
export const FRACTURE_BURST = 'temple_fracture_burst';
export const REFLECTION_SHATTER = 'temple_reflection_shatter';
/** A fallen Hydra head grows back (its regrowth burst). */
export const HYDRA_REGROWTH = 'temple_hydra_regrowth';
/** A Tsunami breaks on the Ice Wall and shatters it (targetId: the wall). */
export const HYDRA_ICE_WALL_SHATTER = 'temple_ice_wall_shatter';
/** A Toxic Rime crystal bursts (targetId: its crystal object). */
export const HYDRA_RIME_BURST = 'temple_rime_burst';
export const YSOLEI_TIDAL_CRASH = 'temple_tidal_crash';
/** A Moonlight Tear strikes the island rim (targetId: its tear object). */
export const YSOLEI_TEAR_LAND = 'temple_tear_land';
/** A body stopped a tear (targetId: the player). */
export const YSOLEI_TEAR_CAUGHT = 'temple_tear_caught';
/** A tear reached her (targetId: Ysolei). */
export const YSOLEI_TEAR_ABSORBED = 'temple_tear_absorbed';
/** The Plenilune Ward broke in time: the eclipse (targetId: Ysolei). */
export const YSOLEI_ECLIPSE = 'temple_eclipse';
/** The ward held to the bar's end: the moon falls (targetId: Ysolei). */
export const YSOLEI_MOON_FALLS = 'temple_moon_falls';

/** The boss bars a player interrupt can cut (Kick, Pummel, Counterspell),
 *  by the school the lockout lands in: Selthe's bolt and her aria. Spread into
 *  mob/healer_channel.ts SCRIPTED_INTERRUPTIBLE_CHANNELS. Every other Temple
 *  boss bar is a mechanic to dodge, never kicked. */
export const TEMPLE_BOSS_CAST_SCHOOLS: Readonly<Record<string, { school: 'frost' }>> = {
  [SELTHE_MOONWATER_BOLT]: { school: 'frost' },
  [SELTHE_DROWNING_ARIA]: { school: 'frost' },
};

// ---- encounter object templates (the state rides the template id) ----------------
export const BRINE_SPIT_TEMPLATE = 'temple_brine_spit_pool';
/** The venom a Venom Spit leaves where it burst (a standing hazard). */
export const VENOM_POOL_TEMPLATE = 'temple_venom_pool';
/** The Ice Wall the Frostlocked Torrent leaves (its facing is the wall's
 *  heading from its first end, its scale the wall's length; it stands at the
 *  wall's middle). */
export const ICE_WALL_TEMPLATE = 'temple_ice_wall';
/** A venom pool the Venom Current swelled and set sliding (its facing is the
 *  slide's heading, its scale its radius). */
export const VENOM_CURRENT_TEMPLATE = 'temple_venom_current_pool';
/** A venom pool the Toxic Rime froze into a crystal (scale: its burst radius). */
export const RIME_CRYSTAL_TEMPLATE = 'temple_rime_crystal';
/** The Tsunami's wave: warned, then rolling (its facing is the roll's heading,
 *  its scale the pool's radius). */
export const TSUNAMI_TEMPLATES = {
  warn: 'temple_tsunami_warn',
  surge: 'temple_tsunami_surge',
} as const;
/** One slice of the Tideglass Fracture (its facing is the slice's middle
 *  heading round the terrace centre, its scale the slice's reach): cracking
 *  while the bar opens, then red (it detonates) or safe (clear glass). */
export const FRACTURE_TEMPLATES = {
  crack: 'temple_fracture_crack',
  red: 'temple_fracture_red',
  safe: 'temple_fracture_safe',
} as const;
export type FractureState = keyof typeof FRACTURE_TEMPLATES;
export const CHORUS_ECHO_TEMPLATE = 'temple_chorus_echo';
export const SOLO_ECHO_TEMPLATE = 'temple_solo_echo';
export const RIPTIDE_TEMPLATE = 'temple_riptide_pool';
/** A Moonlight Tear rolling at Ysolei (facing: its heading, scale: its radius). */
export const MOON_TEAR_TEMPLATE = 'temple_moon_tear';
/** Heroic: the light a stopped tear leaves (scale: its radius). */
export const MOONGLOW_TEMPLATE = 'temple_moonglow_pool';
export const TIDE_TEMPLATES = {
  dry: 'temple_tide_dry',
  warn: 'temple_tide_warn',
  flood: 'temple_tide_flood',
} as const;
export type TideState = keyof typeof TIDE_TEMPLATES;

/** Every Temple encounter object template (the renderer draws them itself). */
export const TEMPLE_OBJECT_TEMPLATES: ReadonlySet<string> = new Set([
  BRINE_SPIT_TEMPLATE,
  VENOM_POOL_TEMPLATE,
  ...Object.values(TSUNAMI_TEMPLATES),
  CHORUS_ECHO_TEMPLATE,
  SOLO_ECHO_TEMPLATE,
  RIPTIDE_TEMPLATE,
  MOON_TEAR_TEMPLATE,
  MOONGLOW_TEMPLATE,
  ...Object.values(TIDE_TEMPLATES),
  ...Object.values(FRACTURE_TEMPLATES),
  ICE_WALL_TEMPLATE,
  VENOM_CURRENT_TEMPLATE,
  RIME_CRYSTAL_TEMPLATE,
]);

export function fractureStateOf(templateId: string): FractureState | null {
  if (templateId === FRACTURE_TEMPLATES.crack) return 'crack';
  if (templateId === FRACTURE_TEMPLATES.red) return 'red';
  if (templateId === FRACTURE_TEMPLATES.safe) return 'safe';
  return null;
}

export function tideStateOf(templateId: string): TideState | null {
  if (templateId === TIDE_TEMPLATES.dry) return 'dry';
  if (templateId === TIDE_TEMPLATES.warn) return 'warn';
  if (templateId === TIDE_TEMPLATES.flood) return 'flood';
  return null;
}

// ---- Choirmother Selthe: stack for Chorus, spread for Solo ----------------------------

export const SELTHE_TUNING = {
  chorusFirst: 10,
  chorusEvery: 25,
  /** Solo lands 12 s after each Chorus (heroic Duet: with it). */
  soloOffset: 12,
  markSeconds: 5,
  chorusRadius: 6,
  chorusTotal: 400,
  soloRadius: 8,
  soloDamage: 150,
  songFirst: 6,
  songEvery: 10,
  songCast: 1.5,
  songMin: 35,
  songMax: 45,
  // ---- the caster pass: she never swings her hands and never leaves her pool.
  // Moonwater Bolt replaces her melee as the tank's pressure. Her swing was
  // her weapon roll (63 to 98 on normal, average 80.5: the elite template's
  // 78.75 at 16, rolled 0.8 to 1.25) every 2.2 s: 36.6 raw DPS, about 23
  // after a level-16 tank's 36 percent armor reduction (armor / (armor + 400
  // + 85 x 16) at about 1,000 armor) and about 17 once a tank's dodges and
  // parries (about a quarter of swings) are counted. Her other bars fill
  // about 54 percent of the fight (Sea-Song 1.5 of 10 s, Surge 3 of 18,
  // Aria 5 of 22) and each leaves a 0.5 s breath, so she bolts about 40
  // percent of the time. A bolt is one weapon roll x boltWeaponShare of frost
  // (no armor, no dodge or parry) every boltCast + boltGap = 2.5 s: 1.2 x
  // 80.5 / 2.5 x 0.4 = about 15.5 DPS over the fight, just under the swing's
  // 17, landing as heavy 76 to 118 bolts a kick can stop. Reading her live
  // weapon keeps the heroic row's melee factor on it (the tank-swing floor),
  // where her mechanics ride the row's mechanic factor.
  boltCast: 2,
  boltGap: 0.5,
  boltWeaponShare: 1.2,
  boltRange: 45,
  /** After a kick (any of her kickable bars cut short) she casts neither
   *  bolt nor aria for this long, lockout or not (a boss shrugs the school
   *  lockout's duration off by diminishing returns). */
  kickQuiet: 3,
  // Drowning Aria: a sung beam on one player who is not the tank, a pulse a
  // second for 5 s, each pulse on the same body 10 harder than the last:
  // 30 + 40 + 50 + 60 + 70 = 250 frost if nobody answers it (between one and
  // two Solos, under a lone Chorus's 400). Kick it, break her sight of the
  // target (a lamp pillar), or step into the beam: the first body between her
  // and the target catches the pulse instead, and the climb starts over on
  // whoever is struck anew, so the group can pass it round.
  ariaFirst: 16,
  ariaEvery: 22,
  ariaChannel: 5,
  ariaPulse: 1,
  ariaBase: 30,
  ariaStep: 10,
  ariaRange: 45,
  /** A body this close to the beam's line catches it. */
  ariaCatchWidth: 1.5,
  // Mere Surge (replaces the Tidal Slap): a 3 s bar facing one player, then a
  // wave crashes through a 60 degree wedge out to 30 yd: 110 to 130 frost and
  // a shove of 8 yd (the Slap's 50 to 60 plus its 8 yd throw, priced up to
  // the Hydra's avoidable Crushing Torrent, 90 to 110, since it can catch
  // several players). One wedge on both difficulties: the floor mark is drawn
  // from this cast id alone, so the edge a player sees is the edge it tests.
  surgeFirst: 12,
  surgeEvery: 18,
  surgeCast: 3,
  surgeRange: 30,
  surgeArcDeg: 60,
  surgeMin: 110,
  surgeMax: 130,
  surgeKnockback: 8,
  // Heroic Echo: each mark resolves again at the same spot 4 s later.
  echoAfter: 4,
  chorusEchoDamage: 120,
} as const;

export const COURT = CHOIR_COURT;

/** How a Chorus of `total` splits among the `n` players caught in it. */
export function chorusShare(total: number, n: number): number {
  return n <= 0 ? 0 : total / n;
}

// ---- The Mere Hydra: three elements, one moon pool ------------------------------------

export const HYDRA_TUNING = {
  // Freezing Breath (the ice head): a frost cone that chills.
  breathFirst: 6,
  breathEvery: 12,
  breathCast: 2,
  breathRange: 18,
  breathArcDeg: 60,
  breathMin: 110,
  breathMax: 130,
  chillSlow: 0.3,
  chillSeconds: 4,
  // Venom Spit (the venom head): pools that burst, then linger as venom.
  spitFirst: 4,
  spitEvery: 10,
  spitCount: 3,
  spitWarn: 1.5,
  spitRadius: 4,
  spitMin: 60,
  spitMax: 75,
  venomSeconds: 6,
  venomRadius: 3.5,
  venomPerSecond: 20,
  // Crushing Torrent (the water head): a lane of water that hurls you back.
  torrentFirst: 9,
  torrentEvery: 12,
  torrentCast: 2,
  torrentLength: 26,
  torrentHalfWidth: 2.5,
  torrentMin: 90,
  torrentMax: 110,
  torrentKnockback: 8,
  // Tsunami: the Hydra sinks and a wave rolls over one half of the pool.
  tsunamiFirst: 24,
  tsunamiEvery: 40,
  tsunamiCast: 4.5,
  /** The wave starts rolling this long before the bar ends (render cue). */
  tsunamiRoll: 1.2,
  tsunamiMin: 160,
  tsunamiMax: 190,
  tsunamiKnockback: 10,
  /** The damage a submerged head shrugs off. */
  submergedReduction: 0.75,
  /** Heroic backwash: the wave rolls back over the other half this long after. */
  backwashAfter: 3.5,
  /** A column shelters a body this far behind it, this wide. */
  leeDepth: 5,
  leeHalfWidth: 2,
  // Regrowth: a fallen head grows back while another head lives.
  regrowAfter: 20,
  regrowShare: 0.5,
  /** Enraged Hydra: damage done per fallen head. */
  enragePerHead: 0.15,
  /** The deed: all three heads within this many seconds. */
  deedWindow: 10,
} as const;

export const POOL = HYDRA_POOL;

/** The three heads' elements, left to right: ice, venom, water. */
export type HydraElement = 'frost' | 'venom' | 'tide';
export const HYDRA_ELEMENTS: readonly HydraElement[] = ['frost', 'venom', 'tide'];

/**
 * Which head (0 left, 1 centre, 2 right) wields each element (in HYDRA_ELEMENTS
 * order), given which heads are dead: its own head while that lives, else the
 * next living head round (left, centre, right, left), so the survivors inherit
 * a fallen head's attack. Null when every head is dead. Pure: the renderer
 * reads the same answer off the heads' dead flags.
 */
export function hydraElementOwners(dead: readonly boolean[]): (number | null)[] {
  return HYDRA_ELEMENTS.map((_, i) => {
    for (let k = 0; k < 3; k++) {
      const h = (i + k) % 3;
      if (!dead[h]) return h;
    }
    return null;
  });
}

export type TsunamiSide = 'east' | 'west';

/** The side the n-th Tsunami (0 based) rises on: east, then west, alternating. */
export function tsunamiSide(n: number): TsunamiSide {
  return n % 2 === 0 ? 'east' : 'west';
}

/** The heading (sim yaw, 0 toward +z) a wave rolls on: away from its side. */
export function tsunamiHeading(side: TsunamiSide): number {
  return side === 'east' ? -Math.PI / 2 : Math.PI / 2;
}

/** Is a spot (instance-local) on the half of the pool a wave from `side` rolls
 *  over? The half's rim and the pool's middle line are inside. */
export function inTsunamiPath(side: TsunamiSide, x: number, z: number): boolean {
  if (Math.hypot(x - HYDRA_POOL.x, z - HYDRA_POOL.z) > HYDRA_POOL.r + 3) return false;
  return side === 'east' ? x >= HYDRA_POOL.x - 1 : x <= HYDRA_POOL.x + 1;
}

/** Does a rim column shelter a spot from a wave from `side` (the spot stands in
 *  its lee: behind it along the wave's heading, within the column's shadow)? */
export function inTsunamiLee(side: TsunamiSide, x: number, z: number): boolean {
  const T = HYDRA_TUNING;
  const dir = side === 'east' ? -1 : 1;
  for (const c of HYDRA_POOL_COLUMNS) {
    const along = (x - c.x) * dir;
    if (along < HYDRA_POOL_COLUMN_R * 0.5 || along > T.leeDepth + HYDRA_POOL_COLUMN_R) continue;
    if (Math.abs(z - c.z) <= T.leeHalfWidth) return true;
  }
  return false;
}

// ---- The Mere Hydra's Combined Breath (hydra_combo.ts) -------------------------------

/** The three Combined Breaths, in the fixed order they come round. */
export type HydraComboKind = 'frostlock' | 'current' | 'rime';
export const HYDRA_COMBO_ORDER: readonly HydraComboKind[] = ['frostlock', 'current', 'rime'];
/** Each combo's cast id (the bar on every head that takes part). */
export const HYDRA_COMBO_CASTS: Readonly<Record<HydraComboKind, string>> = {
  frostlock: HYDRA_FROSTLOCKED_TORRENT,
  current: HYDRA_VENOM_CURRENT,
  rime: HYDRA_TOXIC_RIME,
};
/** The two elements each combo fuses (HYDRA_ELEMENTS indices: 0 ice, 1 venom,
 *  2 water). Whoever wields each one takes part, so a lone survivor carrying
 *  both casts it alone. */
export const HYDRA_COMBO_ELEMENTS: Readonly<Record<HydraComboKind, readonly [number, number]>> = {
  frostlock: [0, 2],
  current: [1, 2],
  rime: [0, 1],
};

/** The combo a cast id names, or null. */
export function hydraComboOf(castId: string | null): HydraComboKind | null {
  if (castId === HYDRA_FROSTLOCKED_TORRENT) return 'frostlock';
  if (castId === HYDRA_VENOM_CURRENT) return 'current';
  if (castId === HYDRA_TOXIC_RIME) return 'rime';
  return null;
}

// The Combined Breath comes in the gap between two Tsunamis, never on the
// wave. It opens when the Tsunami clock reads one of comboAt (seconds to the
// next wave): 16 on normal, the middle of the 40 s cycle once the bar's 2 s
// and the wave's 4.5 s bar are counted, so an Ice Wall raised there (at 14 s
// to go) is still standing when that wave lands 18.5 s later, inside its
// 20 s. Heroic adds a second slot at 30 (2 s after the backwash has rolled
// back), so the combos come twice as often; a wall raised there stands on
// until that next wave lands (hydra_combo.ts landFrostlock), never melting
// before the wave it exists to break. The first combo waits for the
// first Tsunami: the fight opens with the three plain elements.
//
// Pressure: inside the combo window (comboHold seconds before a slot to the
// end of the bar) the heads start no Freezing Breath or Crushing Torrent, so
// a combo REPLACES about one plain breath or torrent a cycle, and each combo
// is priced at the attack it fuses: the Frostlocked Torrent is the Crushing
// Torrent's 90 to 110 with a 2 s freeze instead of the 8 yd shove; the Venom
// Current's sliding pools burn 30 a second (the venom's 20, swollen half
// again: radius 3.5 to 5.25); a Toxic Rime crystal bursts for 100 to 120 in
// 6 yd (between the spit's 60 to 75 and the breath's 110 to 130) after 4 s of
// warning. All of it is avoidable; a fumbled cycle costs about one more plain
// attack, so the fight's length and healing load stay where they were.
export const HYDRA_COMBO_TUNING = {
  comboAt: [16] as readonly number[],
  comboAtHeroic: [30, 16] as readonly number[],
  /** Seconds before a slot when the heads stop starting their plain bars. */
  comboHold: 2.5,
  /** A slot still unfired this close to the wave is skipped. */
  comboLatest: 6,
  comboCast: 2,
  // Frostlocked Torrent (ice + water): the torrent's lane, frozen.
  frostMin: 90,
  frostMax: 110,
  freezeSeconds: 2,
  /** The Ice Wall: it starts this far from the water head and runs the rest
   *  of the torrent's lane (26 yd), so it crosses the lagoon. */
  wallStart: 3,
  wallSeconds: 20,
  /** A body this far downstream of the wall (along the wave's roll) is in its
   *  lee: the wave breaks on the ice. Deeper than a column's 5 yd: the wall
   *  is a long shelter. */
  wallLeeDepth: 9,
  /** Heroic: the wall bursts into shards when the wave breaks it; anyone
   *  hugging it (this close to the ice) is cut. */
  shardReach: 2.5,
  shardMin: 60,
  shardMax: 75,
  // Venom Current (venom + water): the venom head seeds three pools as the bar
  // opens (the Venom Spit's own burst under three players), then every venom
  // pool swells and slides outward from the pool's middle.
  currentRadius: 5.25,
  currentSlide: 7,
  currentSlideSeconds: 3.5,
  /** It lingers this long at the end of its slide, then drains. */
  currentLinger: 2,
  currentPerSecond: 30,
  // Toxic Rime (ice + venom): seeded the same way; every venom pool freezes
  // into a crystal (walkable, it no longer burns), then bursts wider.
  rimeSeconds: 4,
  rimeRadius: 6,
  rimeMin: 100,
  rimeMax: 120,
} as const;

/** The heading (sim yaw) a Venom Current slides a pool at (x, z) on: straight
 *  out from the moon pool's middle (due south from the very middle). Pure: the
 *  renderer paints the same arrow. */
export function venomCurrentHeading(x: number, z: number): number {
  const dx = x - HYDRA_POOL.x;
  const dz = z - HYDRA_POOL.z;
  if (Math.hypot(dx, dz) < 0.5) return Math.PI;
  return Math.atan2(dx, dz);
}

/** Half the Ice Wall's thickness (the renderer draws it this thick). */
export const ICE_WALL_HALF_THICKNESS = 0.75;

/** An Ice Wall as the sim keeps it: its first end, the heading along it and
 *  its length (instance-local yards). */
export interface IceWallLine {
  x: number;
  z: number;
  yaw: number;
  length: number;
}

/** The wall a Frostlocked Torrent leaves from a water head at (hx, hz) aimed
 *  at `yaw` down its torrentLength lane. */
export function iceWallFrom(hx: number, hz: number, yaw: number): IceWallLine {
  const C = HYDRA_COMBO_TUNING;
  return {
    x: hx + Math.sin(yaw) * C.wallStart,
    z: hz + Math.cos(yaw) * C.wallStart,
    yaw,
    length: HYDRA_TUNING.torrentLength - C.wallStart,
  };
}

/** The wall's middle (where its object stands). */
export function iceWallMiddle(w: IceWallLine): { x: number; z: number } {
  return {
    x: w.x + Math.sin(w.yaw) * (w.length / 2),
    z: w.z + Math.cos(w.yaw) * (w.length / 2),
  };
}

/** The wall a mirrored Ice Wall object stands for (its middle, facing and
 *  scale): the renderer's read of the same line the sim tests. */
export function iceWallOfObject(mx: number, mz: number, yaw: number, length: number): IceWallLine {
  return {
    x: mx - Math.sin(yaw) * (length / 2),
    z: mz - Math.cos(yaw) * (length / 2),
    yaw,
    length,
  };
}

/** The distance from a spot to the wall's line segment. */
export function iceWallDistance(w: IceWallLine, x: number, z: number): number {
  const ax = Math.sin(w.yaw);
  const az = Math.cos(w.yaw);
  const t = Math.max(0, Math.min(w.length, (x - w.x) * ax + (z - w.z) * az));
  return Math.hypot(x - (w.x + ax * t), z - (w.z + az * t));
}

/** Does any of the wall stand in the half a wave from `side` rolls over (so
 *  the wave breaks on it)? */
export function iceWallInPath(w: IceWallLine, side: TsunamiSide): boolean {
  for (let k = 0; k <= 8; k++) {
    const t = (w.length * k) / 8;
    if (inTsunamiPath(side, w.x + Math.sin(w.yaw) * t, w.z + Math.cos(w.yaw) * t)) return true;
  }
  return false;
}

/** Is a spot in the Ice Wall's lee against a wave from `side`: looking back up
 *  the wave's roll from the spot, the wall stands within wallLeeDepth? */
export function inIceWallLee(w: IceWallLine, side: TsunamiSide, x: number, z: number): boolean {
  const h = tsunamiHeading(side);
  // Up the roll: back toward where the wave comes from.
  const rx = -Math.sin(h);
  const rz = -Math.cos(h);
  const ux = Math.sin(w.yaw) * w.length;
  const uz = Math.cos(w.yaw) * w.length;
  const denom = rx * uz - rz * ux;
  if (Math.abs(denom) < 1e-9) return false;
  const qx = w.x - x;
  const qz = w.z - z;
  const s = (qx * uz - qz * ux) / denom;
  const t = (qx * rz - qz * rx) / denom;
  // A body pressed into the ice (up to its half thickness) counts as behind it.
  return s >= -ICE_WALL_HALF_THICKNESS && s <= HYDRA_COMBO_TUNING.wallLeeDepth && t >= 0 && t <= 1;
}

// ---- The Tideglass Colossus: your own reflection fights you ----------------------------

export const COLOSSUS_TUNING = {
  flareAt: [0.75, 0.5, 0.25],
  flareCast: 2,
  /** A Reflection's health, as a share of the Colossus's maximum health. */
  reflectionShare: 0.08,
  /** Damage the Colossus shrugs off per living Reflection. */
  wardPerReflection: 0.1,
  wardCap: 0.5,
  lanceFirst: 8,
  lanceEvery: 12,
  lanceCast: 2,
  lanceLength: 30,
  lanceHalfWidth: 2,
  lanceMin: 90,
  lanceMax: 110,
  slamFirst: 12,
  slamEvery: 14,
  slamCast: 1.5,
  slamRadius: 12,
  slamMin: 70,
  slamMax: 90,
  slamKnockback: 8,
  // Heroic: Shattering Glass (a dying Reflection bursts) and Swapped Images.
  shatterRadius: 4,
  shatterDamage: 80,
  swapEvery: 8,
  /** The deed: every Reflection broken within this many seconds of appearing. */
  deedWindow: 15,
  // Tideglass Fracture: the terrace floor splits into eight prism slices
  // round its centre. A 1.5 s bar (the floor cracks), then three rounds: some
  // slices glow red, the rest run clear, and fractureWarn later the red ones
  // detonate (120 to 130 arcane to everyone standing on one, and on the hub
  // under the plinth). Each round's safe slices were red the round before, so
  // every round the group must move one slice over. He stands planted for the
  // whole channel (1.5 + 3 x 2.5 = 9 s), no Lance or Slam inside it. Priced
  // just above the Moonlight Lance (90 to 110): a round is readable for 2.5 s
  // and a move of one slice (about 8 yd at 10 yd out) takes about 1.1 s at
  // run speed. Standing still through all three costs about 375, the price of
  // a fumbled core (the Lance and the Slam together are about 190).
  fractureFirst: 20,
  fractureEvery: 32,
  fractureCast: 1.5,
  fractureWarn: 2.5,
  /** Heroic: the red slices detonate sooner. */
  fractureWarnHeroic: 2,
  fractureMin: 120,
  fractureMax: 130,
} as const;

export const TERRACE = PRISM_TERRACE;

/** The Tideglass Fracture's slices round the terrace centre (slice 0 is
 *  centred due +z; the index grows with the sim yaw, toward +x first). */
export const FRACTURE_SLICES = 8;
/** The hub under the plinth: part of no slice, it detonates every round. */
export const FRACTURE_HUB = 3;
/** How far out the fracture runs: the terrace floor and a hand past its rim
 *  (the glass the renderer draws is exactly this disc). */
export const FRACTURE_REACH = PRISM_TERRACE.r + 1.5;
/** Each round's SAFE slices before the cast's rotation. A round's safe
 *  slices are all red in the round before it: everyone moves. */
export const FRACTURE_SAFE_PATTERNS: readonly (readonly number[])[] = [
  [1, 3, 5, 7],
  [0, 2, 4, 6],
  [3, 7],
];
export const FRACTURE_ROUNDS = FRACTURE_SAFE_PATTERNS.length;

/** The middle heading (sim yaw, 0 toward +z) of slice `i`. */
export function fractureSliceYaw(i: number): number {
  return (i * Math.PI * 2) / FRACTURE_SLICES;
}

/**
 * The slice a spot (instance-local) stands on, or 'hub' under the plinth, or
 * null off the fracture entirely (beyond its reach). Slice i spans its middle
 * heading +-22.5 degrees; a spot exactly on a seam belongs to the lower index.
 */
export function fractureSliceAt(x: number, z: number): number | 'hub' | null {
  const dx = x - PRISM_TERRACE.x;
  const dz = z - PRISM_TERRACE.z;
  const d = Math.hypot(dx, dz);
  if (d > FRACTURE_REACH) return null;
  if (d < FRACTURE_HUB) return 'hub';
  const step = (Math.PI * 2) / FRACTURE_SLICES;
  let a = Math.atan2(dx, dz) + step / 2;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(FRACTURE_SLICES - 1, Math.floor(a / step));
}

/** The safe slices of round `round` (0 based) for a cast rotated `rot`. */
export function fractureSafeSlices(round: number, rot: number): number[] {
  const base = FRACTURE_SAFE_PATTERNS[round] ?? [];
  return base.map((i) => (((i + rot) % FRACTURE_SLICES) + FRACTURE_SLICES) % FRACTURE_SLICES);
}

/** Does a spot detonate in this round (a red slice, or the hub)? */
export function fractureHits(round: number, rot: number, x: number, z: number): boolean {
  const at = fractureSliceAt(x, z);
  if (at === null) return false;
  if (at === 'hub') return true;
  return !fractureSafeSlices(round, rot).includes(at);
}

// ---- Ysolei: run out of the undertow toward the dry half -------------------------------

export const YSOLEI_TUNING = {
  lunarFirst: 5,
  lunarEvery: 10,
  lunarCast: 1.5,
  lunarRadius: 15,
  lunarMin: 60,
  lunarMax: 80,
  undertowFirst: 15,
  undertowEvery: 25,
  undertowSeconds: 3,
  /** Yards per second every player is dragged toward her. */
  undertowPull: 3.5,
  /** The pull reaches everyone on the island and a little beyond. */
  undertowReach: 45,
  crashRadius: 14,
  crashMin: 250,
  crashMax: 300,
  /** The Rising Tide starts under this share of her health. */
  tideBelow: 0.66,
  /** Seconds a half stays flooded before the tide switches halves. */
  tideEvery: 30,
  /** The shimmer on the half about to flood, before it floods. */
  tideWarn: 10,
  floodPerSecond: 45,
  floodSlow: 0.5,
  // Heroic: Riptide puddles and the Drowned Moon.
  riptideSeconds: 10,
  riptideRadius: 3.5,
  riptidePerSecond: 40,
  drownedMoonEvery: 20,
  /** The roars that open her Moonspawn and her enrage. */
  callCast: 2.2,
  wrathCast: 2.5,
} as const;

// ---- Ysolei calls the moon (ysolei_moon.ts) ---------------------------------------------
//
// Moonlight Tears at 75 and 45 percent: a 3 s Beckoning Moon bar (never
// kicked; she will not open it inside the Undertow's last seconds, so the
// tears never land with a Tidal Crash), then three tears (heroic four) fall
// on the island rim at evenly spaced headings (the first hashed) and roll at
// her at 2.6 yd a second, 5 to 8 s from the rim to her coil. A body in a
// tear's way stops it: 70 to 85 arcane and a stack of Moonsear (20 s), and
// every Moonsear stack makes the next tear on that body hurt 150 percent more
// (75, then about 190, then about 300), so one player cannot stop them all
// and the group shares them. A tear that reaches her is a Moonswell stack for
// the fight: 10 percent more damage done and 2 percent of her health back.
// Three tears evenly spread always cross both halves of the island, so while
// the Rising Tide floods one, someone wades in to stop the tear rolling
// through it.
//
// The Full Moon at 20 percent (the climax): a 12 s Falling Moon bar (heroic
// 10 s) under a Plenilune Ward worth 6 percent of her health. Her Lunar Tide
// and Undertow wait while it runs (their clocks stand still), the flood keeps
// moving. Break the ward in time and the moon is eclipsed: the bar ends, she
// reels 5 s (stunned) and takes 25 percent more damage meanwhile. Fail and
// the moon falls: 300 to 340 arcane to everyone on the island and Moonborne
// Might, 20 percent more damage done for the rest of the fight.
//
// The pressure: the ward is 6 percent of 18,000 = 1,080, about 78 percent of
// the planning party's 115 DPS over the 12 s bar (heroic: 6 percent of about
// 29,700 = 1,780 over 10 s against 230 DPS, 77 percent), so breaking it asks
// for the whole group on her. Inside the bar she casts nothing else, which is
// worth about one Lunar Tide (70 a player) and pushes the next Undertow back
// by the bar; a broken ward pays back 5 s of her swings plus a quarter more
// damage. A fumbled ward costs about four Lunar Tides on everyone at once
// plus a fifth more on every hit. A stopped tear is about one Lunar Tide on
// one player; six tears over the two waves land about 460 damage on a group
// that shares them (under 2 percent of the fight's healing). A tear let
// through is permanent pressure (a tenth more on every hit), not a spike.
// The tears (75 and 45) sit clear of the Moonspawn (60 and 30) and the
// Rising Tide (66); the Full Moon (20) comes after the enrage (30): each
// waits for her roar, never on top of it.
export const YSOLEI_MOON_TUNING = {
  tearsAt: [0.75, 0.45] as readonly number[],
  callCast: 3,
  /** She will not open the call with the Undertow this close. */
  callUndertowGap: 4,
  tearCount: 3,
  tearCountHeroic: 4,
  tearSpeed: 2.6,
  /** A body this close to a tear stops it. */
  tearCatch: 1.6,
  /** How far in from the rim a tear lands. */
  tearRimInset: 1.5,
  tearMin: 70,
  tearMax: 85,
  moonsearSeconds: 20,
  /** Extra damage the next tear deals per Moonsear stack. */
  moonsearBonus: 1.5,
  moonswellDamage: 0.1,
  moonswellHeal: 0.02,
  // Heroic: a stopped tear leaves a pool of moonlight (no stopping two on one spot).
  glowSeconds: 8,
  glowRadius: 3,
  glowPerSecond: 30,
  // The Full Moon.
  pleniluneAt: 0.2,
  fallingCast: 12,
  fallingCastHeroic: 10,
  wardShare: 0.06,
  eclipseSeconds: 5,
  eclipseVuln: 0.25,
  fallMin: 300,
  fallMax: 340,
  mightShare: 0.2,
} as const;

/** Where each of `n` tears lands on the island rim (instance-local), the first
 *  at `base` radians round the island and the rest evenly spaced. Pure: the
 *  tests and the renderer read the same spots. */
export function tearLandingSpots(n: number, base: number): { x: number; z: number }[] {
  const r = MOON_ALTAR.r - YSOLEI_MOON_TUNING.tearRimInset;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = base + (i * Math.PI * 2) / n;
    out.push({ x: MOON_ALTAR.x + Math.sin(a) * r, z: MOON_ALTAR.z + Math.cos(a) * r });
  }
  return out;
}

/** A Moonlight Tear's damage on a body already wearing `stacks` Moonsear. */
export function tearDamage(base: number, stacks: number): number {
  return Math.round(base * (1 + YSOLEI_MOON_TUNING.moonsearBonus * Math.max(0, stacks)));
}

export const ALTAR = MOON_ALTAR;

export type TideHalf = 'north' | 'south';

/** Which half of the Moon Altar island a spot (instance-local) stands in. */
export function tideHalfAt(x: number, z: number): TideHalf {
  void x;
  return z >= MOON_ALTAR.z ? 'north' : 'south';
}

/** Is a spot on the island (or its rim) and inside the given half? */
export function inTideHalf(half: TideHalf, x: number, z: number): boolean {
  if (Math.hypot(x - MOON_ALTAR.x, z - MOON_ALTAR.z) > MOON_ALTAR.r + 1) return false;
  return tideHalfAt(x, z) === half;
}

/** The centre of each half (where its tide object stands). */
export const TIDE_HALF_SPOTS: Readonly<Record<TideHalf, { x: number; z: number }>> = {
  north: { x: MOON_ALTAR.x, z: MOON_ALTAR.z + MOON_ALTAR.r * 0.5 },
  south: { x: MOON_ALTAR.x, z: MOON_ALTAR.z - MOON_ALTAR.r * 0.5 },
};

export function otherHalf(h: TideHalf): TideHalf {
  return h === 'north' ? 'south' : 'north';
}
