// The Masterless Strength's leaf (docs/design/raid/smith_heart.md section
// 7.5, the owner's approved fight design of 28 Oct 2026): every id the final
// fight's sim, its renderer, its HUD, its dev helpers and its tests key on,
// the per-difficulty rules, the tuning, and the pure template-id helpers of
// its encounter objects. No SimContext, no rng.
//
// The boss fights on the Anvil of the World's four quarters
// (content/smith_heart_quarters.ts). The quarter it stands in is the strength
// it drinks: its kit is that quarter's (Heat, Quench, Breath, Hammer), and the
// four rules (the Overload bars, the shockwave on switching, Taking Root, the
// centre off-limits) push the tanks to drag it from quarter to quarter.
//
// The rework of 2026-11-18 (the team's review of 2026-11-17, the owner's
// design): each quarter also WAKES its guardian's star mechanic the first
// time the boss enters it, and a woken star stays awake for the rest of the
// fight (full pace in the quarter it stands in, FINAL_TUNING.reducedPace in
// the others; a Splinter that survives its call pours its quarter's star in
// at full pace for good):
//   Hammer   Wake the Stone: pillars burst out of the floor and STAY (a cap;
//            a volley that finds it met rings Stone Thrum on the raid).
//   Breath   Sky Strike: lightning on telegraphed spots under players.
//   Quench   Crossing Blade: a great sword of ice sweeps a line through a
//            marked player.
//   Heat     Fire Whirl: tall turning columns of fire (the Heat kit's whirls,
//            moved out of the kit and made bigger).
// They interact: a strike that falls by a pillar runs into it (Arcing Stone,
// a big ring round the pillar) and leaves it Storm-Charged (it pulses the
// whole raid while it stands); a blade shatters every pillar its line
// crosses. The rest of each quarter's kit still runs only while the boss
// stands in it; Weight of the Anvil is the boss's own (all fight, wherever
// it stands). Removed by the rework: the Quench's cold (Quenching Cold,
// Encased in Rime) and the Breath's wind (Bellows Wind, Pressed to the Rim).
//
// EVERY number here is a SKETCH, unmeasured: anchored to the guardians'
// (level 20 elite, ten players, a measured bot raid of about 400 to 460 damage
// a second, the level-20 cloth reference of about 1,135 to 1,345 health), so
// the final is the raid's hardest fight but fair. Every tunable lives in
// FINAL_TUNING and FINAL_DIFFICULTY, so a change is one number.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the fight's state: an aura on the boss (`value` the zone it stands in,
//     `value2` its base form, `value3` the switch mark's seconds left);
//   - the four Overload bars: one aura each on the boss (`value` the bar,
//     0 to 100, `value2` its trend: 1 filling, -1 draining, 0 still);
//   - Taking Root: a root aura on the boss, its clock in `remaining`;
//   - Heart Unbound: an aura on the boss, its stacks the ramp;
//   - every footprint: objects (a radius in `scale`, a heading in `facing`,
//     a state and its clock in the template);
//   - the marks: auras on players;
//   - the moments: `spellfx` cues (FINAL_CUES).
//
// Names: the Heat's fist and swells, Groaning Ice and Under the Ice, Leaping
// Bolt and Drawn Lightning are the guardians' own; the stars' Wake the Stone
// and Stone Thrum the council's, Sky Strike and Breaking Storm the Breath's,
// Crossing Blade the Quench's; Arcing Stone and Storm-Charged were IP-checked
// on 18 Nov 2026 (the compressed
// echo of each strength, already IP-checked). The new names were IP-checked
// on 28 Oct 2026 (design doc 7.5): none is another game's coined term, none
// is Kurog Grimtotem's.

import type { SmithHeartVein } from '../../content/smith_heart_layout';
import { HEART_QUARTER_ORDER, type HeartQuarterZone } from '../../content/smith_heart_quarters';

/** The boss (template id, frozen: the seal and the arrival read it). */
export const FINAL_BOSS = 'heart_masterless_strength';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The boss's bars. Basalt Fist reuses the Heat guardian's cast id (its
 *  name, its look and its body pose come with it). */
export const FINAL_CASTS = {
  /** Basalt Fist (the Heat quarter): planted, its facing on the spot. */
  fist: 'heart_heat_fist',
  /** Leaping Bolt (the Breath quarter): on its first target. */
  bolt: 'heart_final_leaping_bolt',
  /** Weight of the Anvil (the Hammer quarter): the soak's bar. */
  anvil: 'heart_final_anvil',
} as const;

/** The auras the fight puts on players and on the boss. */
export const FINAL_AURAS = {
  /** On the boss: the zone (`value`, FINAL_ZONE_CODES), the base form
   *  (`value2`), the switch mark's seconds left (`value3`, 0 none). */
  state: 'heart_final_state',
  /** On the boss: Taking Root (a root, its clock the remaining time). */
  root: 'heart_final_root',
  /** On the boss: Heart Unbound (stacks: the centre's ramp). */
  unbound: 'heart_final_unbound',
  /** On players (Heroic): Vein-Shaken, the switch's mark. */
  shaken: 'heart_final_shaken',
  /** On players: Under the Ice (fallen through a breaking crack). */
  underIce: 'heart_final_under_ice',
  /** On players (Mythic): Numbing Frost, the frontal's slow. */
  numbing: 'heart_final_numbing',
  /** On players (Heroic): Ember Mark, embers drop at their feet. */
  ember: 'heart_final_ember_mark',
  /** On players (Heroic): Drawn Lightning (keep 8 yd from everyone). */
  drawn: 'heart_final_drawn',
  /** On players (Heroic): Stone Shell (a heal absorb). */
  shell: 'heart_final_shell',
  /** On players (Heroic): Crushed (a soaker sits the next Anvil out). */
  crushed: 'heart_final_crushed',
  /** On players: Sky Strike, lightning falls where they stand (its alarm and
   *  arrow drawn for the marked player only). */
  skyMark: 'heart_final_sky_mark',
  /** On players: Crossing Blade, the line runs through them until it locks
   *  (`value` 1 while it aims, 2 once it has locked). */
  bladeMark: 'heart_final_blade_mark',
  /** On the player Weight of the Anvil follows through its bar (Jose's
   *  playtest of 2026-11-19): its circle rides with them, then plants. */
  anvilMark: 'heart_final_anvil_mark',
} as const;

/** One Overload bar's aura id on the boss (`value` 0 to 100). */
export function overloadAuraId(vein: SmithHeartVein): string {
  return `heart_final_overload_${vein}`;
}

/** The zone codes the state aura carries (`value`): the quarters in bearing
 *  order, then the ring. */
export const FINAL_ZONE_CODES: Readonly<Record<HeartQuarterZone, number>> = {
  breath: HEART_QUARTER_ORDER.indexOf('breath'),
  quench: HEART_QUARTER_ORDER.indexOf('quench'),
  hammer: HEART_QUARTER_ORDER.indexOf('hammer'),
  heat: HEART_QUARTER_ORDER.indexOf('heat'),
  ring: 4,
};

/** The zone a state aura's code names (an unknown code reads the ring). */
export function finalZoneOf(code: number | undefined): HeartQuarterZone {
  const i = Math.round(code ?? 4);
  return i >= 0 && i < 4 ? HEART_QUARTER_ORDER[i] : 'ring';
}

/** The fight's object templates (a radius rides `scale`). Basalt Fist's spot
 *  and its Molten Swells reuse the Heat guardian's objects (heat_ids.ts
 *  HEAT_OBJECTS), so they look the same. */
export const FINAL_OBJECTS = {
  /** A Fire Whirl: `<prefix><warn|live>`, moving; its radius in `scale`. */
  whirlPrefix: 'sh_final_whirl_',
  /** A Dust Devil (the Breath quarter's whirlwind): `<prefix><warn|live>`,
   *  wandering; its radius in `scale`. */
  devilPrefix: 'sh_final_devil_',
  /** A burning pool: `<prefix><ember|forge|trail>`; its radius in `scale`. */
  poolPrefix: 'sh_final_pool_',
  /** A Groaning Ice crack: `<prefix><tenths>` to its break. */
  crackPrefix: 'sh_final_crack_',
  /** A Storm Orb: `<prefix><tenths>` to its burst; its radius in `scale`. */
  orbPrefix: 'sh_final_orb_',
  /** A Tremor Crack: `<prefix><tenths>` to its eruption. */
  tremorPrefix: 'sh_final_tremor_',
  /** Weight of the Anvil's mark: `<prefix><tenths>` to its fall (it follows
   *  its player, or turns round the boss on Mythic); its radius in `scale`. */
  anvilPrefix: 'sh_final_anvil_',
  /** A standing pillar (Wake the Stone): `<prefix><plain|charged>`, a round
   *  combat wall (instances/combat_wall_state.ts). */
  pillarPrefix: 'sh_final_pillar_',
  /** Where a pillar will burst out: `<prefix><tenths>` of warning; its
   *  shove's reach in `scale`. */
  risePrefix: 'sh_final_rise_',
  /** A Sky Strike's spot: `<prefix><tenths>` of warning; its radius in
   *  `scale`. */
  strikePrefix: 'sh_final_strike_',
  /** Arcing Stone round a pillar a strike will fall by: `<prefix><tenths>`
   *  of warning (the strike's own); its radius in `scale`. */
  arcPrefix: 'sh_final_arc_',
  /** A Crossing Blade: `<prefix><aim|fly>`, its heading in `facing`. */
  bladePrefix: 'sh_final_blade_',
  /** A Crossing Blade's line: `<prefix><warn|lock|fly>_<length in tenths>`,
   *  the object at the line's MIDDLE (laneMiddle: the whole line within the
   *  room's players' reach online), its heading in `facing`. */
  lanePrefix: 'sh_final_lane_',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const FINAL_CUES = {
  /** An Overload pulse (spellfx 'nova' on the boss). */
  pulse: 'heart_final_overload_pulse',
  /** A bar bursts (spellfx 'nova' on the boss). */
  burst: 'heart_final_overload_burst',
  /** The boss crosses into another quarter (spellfxAt at the crossing). */
  shock: 'heart_final_vein_shock',
  /** It takes root (spellfx 'nova' on the boss). */
  root: 'heart_final_root',
  /** Heart Unbound pulses (spellfx 'nova' on the boss). */
  unbound: 'heart_final_unbound',
  /** A Fire Whirl strikes a player (spellfx 'nova', whirl to them). */
  whirl: 'heart_final_whirl',
  /** A Dust Devil throws a player (spellfx 'nova', devil to them). */
  devil: 'heart_final_devil',
  /** Embers fall at a marked player's feet (spellfxAt). */
  embers: 'heart_final_embers',
  /** The frontal leaves a pool (spellfxAt, Mythic). */
  forgeFire: 'heart_final_forge_fire',
  /** A crack breaks (spellfxAt). */
  iceBreak: 'heart_final_ice_break',
  /** A bolt's jump (spellfx 'beam', from the last struck to the next). */
  bolt: 'heart_final_bolt',
  /** Drawn Lightning arcs (spellfx 'beam', marked to struck). */
  arc: 'heart_final_arc',
  /** A Storm Orb is taken (spellfxAt) or bursts (spellfxAt, big radius). */
  orbTaken: 'heart_final_orb_taken',
  orbBurst: 'heart_final_orb_burst',
  /** A Tremor Crack erupts (spellfxAt). */
  tremor: 'heart_final_tremor',
  /** Weight of the Anvil falls (spellfxAt, its radius). */
  anvil: 'heart_final_anvil_fall',
  /** Stone Shell closes on a player (spellfx 'nova' on them). */
  shell: 'heart_final_shell',
  /** The fight is over (spellfx 'nova' on the boss). */
  settle: 'heart_final_settle',
  /** A quarter's star wakes for the rest of the fight (spellfxAt at the
   *  quarter's middle). */
  wake: 'heart_final_quarter_wakes',
  /** A pillar bursts out of the floor (spellfx 'nova' on the pillar). */
  rise: 'heart_final_pillar_rise',
  /** Stone Thrum: the cap is met, every pillar rings on the raid (spellfx
   *  'nova' on each pillar). */
  thrum: 'heart_final_stone_thrum',
  /** A pillar shatters (spellfxAt where it stood, its radius). */
  shatter: 'heart_final_pillar_shatter',
  /** A Sky Strike lands (spellfxAt, its radius). */
  strike: 'heart_final_sky_strike',
  /** Arcing Stone: the lightning runs into a pillar and out round it
   *  (spellfxAt at the pillar, the ring's radius). */
  arcingStone: 'heart_final_arcing_stone',
  /** A Storm-Charged pillar pulses the raid (spellfx 'nova' on it). */
  charged: 'heart_final_charged_pulse',
  /** That pulse strikes a player (spellfx 'nova', pillar to them: the hit's
   *  flash and crack on them). */
  chargedHit: 'heart_final_charged_hit',
  /** Its electric ground bites a player standing in it (spellfx 'nova',
   *  pillar to them). */
  chargedZone: 'heart_final_charged_zone',
  /** A Crossing Blade flies its line (spellfxAt at the line's middle, half
   *  its length). */
  blade: 'heart_final_crossing_blade',
} as const;

/** Dev-only presentation triggers (spellfx 'nova' on the boss, emitted only
 *  by a dev verb, never by the fight): the death's replay on a living body
 *  (`/dev heart final death`; the renderer's FinalFx plays the death scene,
 *  smith_heart_fx/final_death_core.ts, and claims the cue). */
export const FINAL_DEV_CUES = {
  deathReplay: 'heart_final_death_replay',
} as const;

/** The damage, aura and object names (combat log, floating text, the buff
 *  bar; re-localized by src/ui/sim_i18n.ts through the mechanic reverse map).
 *  The reused ones keep the guardians' keys. */
export const FINAL_NAMES = {
  state: 'The Masterless Strength',
  overload: 'Overload',
  pulse: 'Overload Pulse',
  burst: 'Overload Burst',
  shock: 'Vein Shock',
  shaken: 'Vein-Shaken',
  root: 'Taking Root',
  unbound: 'Heart Unbound',
  fist: 'Basalt Fist',
  swell: 'Molten Swell',
  whirl: 'Fire Whirl',
  devil: 'Dust Devil',
  ember: 'Ember Mark',
  embers: 'Smouldering Embers',
  forgeFire: 'Forge Fire',
  crack: 'Groaning Ice',
  underIce: 'Under the Ice',
  numbing: 'Numbing Frost',
  bolt: 'Leaping Bolt',
  drawn: 'Drawn Lightning',
  orb: 'Storm Orb',
  tremor: 'Tremor Crack',
  anvil: 'Weight of the Anvil',
  shell: 'Stone Shell',
  crushed: 'Crushed',
  wake: 'Wake the Stone',
  thrum: 'Stone Thrum',
  pillar: 'Pillar',
  sky: 'Sky Strike',
  strike: 'Breaking Storm',
  arc: 'Arcing Stone',
  charged: 'Storm-Charged',
  chargedZone: 'Charged Ground',
  blade: 'Crossing Blade',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty: one FINAL_DIFFICULTY row each (a new tier is a
 *  row, never a branch on a tier's name). */
export type FinalDifficulty = 'normal' | 'heroic' | 'mythic';

export interface FinalDifficultyRules {
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** A lethal punishment's damage factor, in place of damageMult (Weight of
   *  the Anvil, its miss, the Basalt Fist, the Splinters' Shearing Blow, Bursting Coal on the others): the
   *  parse-calibrated pass of 2026-11-16 raised the raid's damage and left
   *  these where they were (the tier's old damageMult). */
  punishMult: number;
  /** The boss's own swing (its weapon, so its swing cleave too) against the
   *  template's, set at the pull (tier_swing.ts). The template swing is one
   *  for every tier, so each tier's raise lives here (the pass of 2026-11-16). */
  swingMult: number;
  /** The boss's health pool against the template's, set at the pull
   *  (tier_health.ts). */
  healthMult: number;
  /** How a full Overload bar's burst reads on this tier (FINAL_OVERLOAD
   *  holds its numbers): survivable with healing, heavy, or lethal. */
  burstTier: 'survivable' | 'heavy' | 'lethal';
  /** A quarter change hits the raid and leaves Vein-Shaken. */
  switchShock: boolean;
  /** Heat: embers drop at ranged players' feet. */
  embers: boolean;
  /** Heat: the frontal (Forge Fist) leaves fire pools. */
  forgeFire: boolean;
  /** Quench: marked players' floor cracks. */
  breakingIce: boolean;
  /** Quench: the frontal slows by 75 percent. */
  numbingFrost: boolean;
  /** Breath: marked players arc to anyone within reach. */
  drawnLightning: boolean;
  /** Breath: Storm Orbs to step on alone. */
  stormOrbs: boolean;
  /** Hammer: Stone Shell's heal absorbs. */
  stoneShell: boolean;
  /** Hammer: the Anvil's soakers are Crushed for the next one. */
  crushed: boolean;
  /** Hammer: the Anvil's mark turns round the boss through its bar. */
  rotatingAnvil: boolean;
  /** Tremor Cracks laid at once. */
  tremors: number;
  /** An Overload pulse's rise at a full bar over FINAL_OVERLOAD's empty
   *  one (pulseScale). Normal's lower since the balance pass of 2026-11-12
   *  (a full bar's pulse: 80 to 91 rather than 105 to 120). */
  pulseRise: number;
  /** Weight of the Anvil with nobody under it: the whole raid takes this.
   *  Normal's stays under a fresh level-20 cloth pool (about 1,135). */
  anvilMissMin: number;
  anvilMissMax: number;
  /** Weight of the Anvil: the whole blow, split between everyone under it
   *  (anvilShare). Normal's 5,600 since the bot raid of 2026-11-12 (1 kill
   *  in 6 at 6,600: 560 a body with ten under it, 700 with eight). */
  anvilTotal: number;
  /** The Hammer's star: pillars raised a volley, and the most standing at
   *  once. */
  pillarCount: number;
  pillarCap: number;
  /** Stone Thrum: a volley that finds the cap met strikes the raid this hard
   *  (before damageMult). */
  thrumMin: number;
  thrumMax: number;
  /** Storm-Charged: each charged pillar's pulse on every player (summed over
   *  the charged pillars; before damageMult). Normal's lets one or two be
   *  healed through, four or more press (the owner's call of 2026-11-18). */
  chargedMin: number;
  chargedMax: number;
  /** The Breath's star: strikes under hashed players a volley, and strikes
   *  that seek the standing pillars. */
  skyMarks: number;
  skyPillarSpots: number;
  /** The Quench's star: Crossing Blades a round (one after another), and
   *  each line's aim (seconds from showing to flying). */
  bladeMarks: number;
  bladeAim: number;
  /** The Heat's star: Fire Whirls a volley. */
  whirlCount: number;
  /** The Breath quarter's Dust Devils a volley (Jose's playtest of
   *  2026-11-19: its whirlwinds were dressing; now they throw). */
  devilCount: number;
  /** Basalt Fist's bar (seconds): 3 on every tier until Jose's playtest of
   *  2026-11-19 asked for a faster cast; its 16 s cadence unchanged. */
  fistCast: number;
  /** Weight of the Anvil, its own all fight: seconds between two (the bot
   *  raid of 2026-11-18: every 30 s on Normal outran two healers). */
  anvilEvery: number;
}

export const FINAL_DIFFICULTY: Readonly<Record<FinalDifficulty, FinalDifficultyRules>> = {
  normal: {
    // The parse-calibrated pass of 2026-11-16: the raid's damage and the
    // swing +15 percent (was 1); the Anvil, its miss, the Basalt Fist and
    // Shearing Blow where they were (punishMult).
    damageMult: 1.15,
    punishMult: 1,
    swingMult: 1.15,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    healthMult: 1,
    burstTier: 'survivable',
    switchShock: false,
    embers: false,
    forgeFire: false,
    breakingIce: false,
    numbingFrost: false,
    drawnLightning: false,
    stormOrbs: false,
    stoneShell: false,
    crushed: false,
    rotatingAnvil: false,
    tremors: 3,
    pulseRise: 45,
    anvilMissMin: 1000,
    anvilMissMax: 1100,
    // 4,200 since Jose's playtest of 2026-11-19 brought it every 35 s (5,600
    // every 60 s before): the bot raid read the Anvil as its heaviest damage,
    // so its share a body (about 525 with eight under it) keeps the healing
    // it costs a minute close to what it was.
    anvilTotal: 4200,
    // One a volley on Normal (two until the bot raids of 2026-11-18: the
    // walls crowded the Hammer's soak).
    pillarCount: 1,
    pillarCap: 8,
    thrumMin: 330,
    thrumMax: 370,
    // 78 to 96 a pillar, 90 to 110 after Normal's x1.15 (Jose's playtest of
    // 2026-11-19: the old 26 to 30, every 4 s, went unnoticed on a pool of
    // 1,100; 34 to 40 until the bot raids of 2026-11-18), and no strike seeks
    // the stone on Normal: a pillar charges only when a marked player stands
    // by it.
    chargedMin: 78,
    chargedMax: 96,
    skyMarks: 1,
    skyPillarSpots: 0,
    bladeMarks: 1,
    bladeAim: 4,
    whirlCount: 2,
    devilCount: 2,
    fistCast: 1.9,
    // 35 s (60 until Jose's playtest of 2026-11-19: "it takes too long").
    anvilEvery: 35,
  },
  heroic: {
    // 1.2 until the Heroic pass of 2026-11-05: the bot raid in the previous
    // tier's best came out of the 70 percent call too low to outlast the
    // Overload pulses, Vein Shock and the Anvil on two healers. Unchanged
    // by the pass of 2026-11-16; its pool x2.1 to x2.28 (+30 percent with
    // the base's +20).
    damageMult: 1.1,
    punishMult: 1.1,
    swingMult: 1,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    // The owner's call of 2026-11-17: the biggest pool of the raid, about 15 percent over the next (its Mythic rebirth counted).
    healthMult: 1.525,
    burstTier: 'heavy',
    switchShock: true,
    embers: true,
    forgeFire: false,
    breakingIce: true,
    numbingFrost: false,
    drawnLightning: true,
    stormOrbs: false,
    stoneShell: true,
    crushed: true,
    rotatingAnvil: false,
    tremors: 4,
    pulseRise: 70,
    anvilMissMin: 1500,
    anvilMissMax: 1600,
    // 5,600 since it comes every 30 s (Jose's playtest of 2026-11-19; 6,600
    // every 45 s before).
    anvilTotal: 5600,
    // Two a volley (three until the Heroic bot raids of 2026-11-18: seven
    // standing at once outran the blades that break them).
    pillarCount: 2,
    pillarCap: 7,
    thrumMin: 520,
    thrumMax: 580,
    // 118 to 136 a pillar, 130 to 150 after Heroic's x1.1 (Jose's playtest of
    // 2026-11-19; 32 to 36 before it, 56 to 64 until the Heroic bot raids of
    // 2026-11-18).
    chargedMin: 118,
    chargedMax: 136,
    skyMarks: 3,
    // None seeks the stone on Heroic either (one until the same raids): a
    // pillar charges when a marked player brings the strike to it; Mythic's
    // lightning still seeks it.
    skyPillarSpots: 0,
    bladeMarks: 2,
    bladeAim: 3.5,
    // Two a volley (three until the same raids: tornadoes caught the raid on
    // its way to the Anvil once all four stars were awake).
    whirlCount: 2,
    devilCount: 3,
    fistCast: 1.7,
    // 30 s (Jose's playtest of 2026-11-19; 45 before it, 36 until the bot
    // raids of 2026-11-18).
    anvilEvery: 30,
  },
  mythic: {
    // Its pool Heroic's (x2.28 since 2026-11-16); its damage unchanged.
    damageMult: 1.3,
    punishMult: 1.3,
    swingMult: 1,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    // The owner's call of 2026-11-17: the biggest pool of the raid, about 15 percent over the next (its Mythic rebirth counted).
    healthMult: 1.8,
    burstTier: 'lethal',
    switchShock: true,
    embers: true,
    forgeFire: true,
    breakingIce: true,
    numbingFrost: true,
    drawnLightning: true,
    stormOrbs: true,
    stoneShell: true,
    crushed: true,
    rotatingAnvil: true,
    tremors: 4,
    pulseRise: 70,
    anvilMissMin: 1500,
    anvilMissMax: 1600,
    anvilTotal: 6600,
    pillarCount: 3,
    pillarCap: 6,
    thrumMin: 640,
    thrumMax: 700,
    // 120 to 138 a pillar, 156 to 180 after Mythic's x1.3 (66 to 74 until
    // Jose's playtest of 2026-11-19).
    chargedMin: 120,
    chargedMax: 138,
    skyMarks: 3,
    skyPillarSpots: 2,
    bladeMarks: 2,
    bladeAim: 3,
    whirlCount: 3,
    devilCount: 3,
    fistCast: 1.6,
    // 28 s (32 until Jose's playtest of 2026-11-19), still turning.
    anvilEvery: 28,
  },
};

// ---- the Overload bars: their one tuning table -----------------------------------------

/** Every number of the four Overload bars (Jose's playtest of 28 Oct 2026:
 *  the sketch's 40 s fill ran too fast; a full bar on Mythic must be a wipe).
 *
 *  The pace: empty to full in 60 s in its quarter, draining at a third of
 *  that (180 s from full) away from it. With the root (6 s since
 *  2026-11-19, 10 before) and a drag of a few seconds, a visit lasts 10 to
 *  15 s or more and fills a sixth to a quarter of the bar:
 *  bouncing between two quarters gains about a sixth of a bar every round
 *  trip and bursts within about two and a half minutes, while a rotation
 *  through all four never climbs past one visit's fill and a rotation
 *  through three (visits of up to 20 s) stays clear of full for a six-minute
 *  fight (pinned by tests/smith_heart_final.test.ts).
 *
 *  The burst, per difficulty (the level-20 cloth reference is about 1,135
 *  to 1,345 health): Normal 700 to 800, survivable with healing; Heroic
 *  1,050 to 1,200, heavy (top the raid up and use defensives); Mythic 4,500
 *  to 5,200, lethal (only a big personal defensive lives: effectively a
 *  wipe). These are the final numbers: the tier's damageMult is NOT
 *  applied on top (the body's own mechanic factor still is). */
export const FINAL_OVERLOAD = {
  /** Empty to full while the boss stands in its quarter. */
  fillSeconds: 60,
  /** Away, it drains at this share of its fill speed. */
  drainShare: 1 / 3,
  /** The active bar pulses the raid this often. */
  pulseEvery: 4,
  /** A pulse: this much at an empty bar, rising by the tier's `pulseRise`
   *  (FINAL_DIFFICULTY) at a full one (harder each pulse while it fills). */
  // 60 to 70 until the bot raid of 2026-11-04: even an empty bar's pulse on
  // all ten was as much as two level-20 healers put out, before any kit.
  // The rise was 300 until that raid (a bar two thirds full pulsed about 250
  // every 4 s on everyone), then 70 on every tier until 2026-11-12.
  pulseMin: 35,
  pulseMax: 40,
  /** The share of a bar at which its quarter's wall erupts in the world (the
   *  renderer's tell, render/smith_heart_fx/final_overload_core.ts) and the
   *  Overload panel turns hostile. */
  eruptAt: 0.75,
  /** The burst of a full bar, per difficulty (then it is empty again). */
  burst: {
    normal: { min: 700, max: 800 },
    heroic: { min: 1050, max: 1200 },
    mythic: { min: 4500, max: 5200 },
  },
} as const satisfies {
  burst: Readonly<Record<FinalDifficulty, { min: number; max: number }>>;
  [k: string]: unknown;
};

// ---- tuning ---------------------------------------------------------------------------

export const FINAL_TUNING = {
  // -- the rules (the Overload bars' numbers are FINAL_OVERLOAD's) --
  /** Heroic: the shockwave of a quarter change, and the mark it leaves. */
  shockMin: 180,
  shockMax: 220,
  shakenSeconds: 20,
  /** A change while marked hits this many times as hard. */
  shakenMult: 3,
  /** Taking Root: on entering a new quarter (the pull's too), it cannot
   *  move. 6 s since Jose's playtest of 2026-11-19 ("sometimes the boss
   *  stays rooted a long time, like 10 s, why?"); 10 s before it, down from
   *  the sketch's 15 on 28 Oct 2026 (the long root read as a boss that will
   *  not follow). */
  rootSeconds: 6,
  /** After the root lets go, no planted bar begins for this long: the
   *  tank's window to start the drag. */
  dragGrace: 3,
  /** A free boss whose tank stands in another zone closes on its tank to
   *  this far (yards), past its long melee reach: the drag always carries
   *  it over the ridge. */
  dragCloseR: 2,
  /** Heart Unbound: in the central ring above the final phase, a stack every
   *  second and a raid pulse of `unboundPerStack` a stack every second. */
  unboundEvery: 1,
  unboundPerStack: 45,
  unboundMax: 20,
  /** A quarter's kit begins this long after the boss enters it. */
  kitDelay: 3,

  // -- the woken stars (the rework of 2026-11-18) --
  /** An awake star whose quarter the boss is not standing in runs at this
   *  share of its full pace (its clock counts down this much slower). The
   *  quarter it stands in, and a quarter a Splinter poured in, run at 1. */
  reducedPace: 0.5,
  /** The final phase: all four stars at once, each at this share of its full
   *  pace (a climax, never four at their own quarter's pace). */
  finalPace: 0.75,
  /** The Hammer's star: Wake the Stone. */
  pillarFirst: 4,
  pillarEvery: 18,
  /** The warning on the floor before a pillar bursts out. */
  pillarWarn: 2,
  /** A pillar's footprint (its wall: a council risen pillar's). */
  pillarR: 2.2,
  /** Whoever stands within this of a rising pillar is thrown back and hit. */
  riseKnockR: 3,
  riseKnockback: 7,
  riseMin: 250,
  riseMax: 290,
  /** Two pillars stand at least this far apart (centre to centre). */
  pillarGap: 6,
  /** A pillar never rises this near the boss, the rim or the ring. */
  pillarClearOfBoss: 9,
  pillarRimPad: 4,
  pillarRingPad: 3,
  /** A Storm-Charged pillar pulses the raid this often (4 s until Jose's
   *  playtest of 2026-11-19, now fewer and harder: it must be felt). */
  chargedEvery: 5,
  /** Its electric ground (the same playtest): whoever stands within this of
   *  a charged pillar's centre takes chargedZoneMin to chargedZoneMax nature
   *  (times the tier's damageMult) every chargedZoneEvery, per pillar. */
  chargedZoneR: 5.5,
  chargedZoneEvery: 1,
  chargedZoneMin: 50,
  chargedZoneMax: 60,
  /** The Breath's star: Sky Strike. */
  skyFirst: 6,
  skyEvery: 13,
  skyWarn: 2.2,
  skyR: 3.5,
  skyMin: 300,
  skyMax: 340,
  /** A strike whose spot falls this near a standing pillar's centre runs
   *  into it: Arcing Stone round the pillar, the pillar Storm-Charged. */
  arcReach: 6.5,
  /** Arcing Stone's ring round the pillar (from its centre). */
  arcR: 9,
  arcMin: 380,
  arcMax: 420,
  /** The Quench's star: Crossing Blade. */
  bladeFirst: 5,
  bladeEvery: 15,
  /** The line locks this long before the blade flies (step off it then). */
  bladeLock: 0.8,
  bladeFly: 0.5,
  bladeGap: 0.6,
  /** The line's half width (a player this near it is struck; a pillar whose
   *  footprint comes this near shatters). */
  bladeHalf: 1.8,
  bladeMin: 300,
  bladeMax: 350,
  /** A blade rises on the rim to one side of its mark, at least this far
   *  from it. */
  bladeMinReach: 14,

  // -- the Heat quarter --
  fistFirst: 5,
  fistEvery: 16,
  fistR: 6,
  fistMin: 2200,
  fistMax: 2400,
  // The Molten Swells are the Heat guardian's own (HEAT_TUNING: their
  // lanes, speed, wall and damage), so they look and strike the same.
  // The Heat's star, Fire Whirl (out of the kit since the rework of
  // 2026-11-18, all fight once woken; bigger: a tall turning column; the
  // count a volley is each tier's whirlCount).
  whirlFirst: 7,
  whirlEvery: 15,
  whirlWarn: 2,
  whirlLife: 10,
  whirlR: 4,
  // 6.3 yd a second (4.5 until Jose's playtest of 2026-11-19: +40 percent,
  // still under a raider's 7 yd run, so a whirl is outrun sideways).
  whirlSpeed: 6.3,
  /** A whirl strikes one player at most this often. */
  whirlHitEvery: 1,
  whirlMin: 300,
  whirlMax: 340,
  emberFirst: 10,
  emberEvery: 22,
  emberMarks: 3,
  /** A ranged player stands at least this far from the boss. */
  emberRanged: 12,
  emberSeconds: 6,
  emberR: 5,
  emberLife: 30,
  poolTick: 1,
  emberMin: 150,
  emberMax: 170,
  /** Burning pools at once at most (the oldest goes out first). */
  poolCap: 10,
  forgeFireR: 4,
  forgeFireLife: 20,
  forgeFireMin: 140,
  forgeFireMax: 160,

  // -- the Quench quarter (its cold gone with the rework of 2026-11-18) --
  iceFirst: 7,
  iceEvery: 18,
  iceMarks: 2,
  iceWarn: 3,
  iceR: 4,
  iceMin: 600,
  iceMax: 680,
  underIceSeconds: 3,
  numbingSlow: 0.25,
  numbingSeconds: 6,

  // -- the Breath quarter (its wind gone with the rework of 2026-11-18) --
  // Leaping Bolt every 14 s (11 until the rework: the Sky Strike volleys now
  // share the quarter, so the bar comes less often).
  boltFirst: 8,
  boltEvery: 14,
  // The Breath's Dust Devils (Jose's playtest of 2026-11-19: the quarter's
  // whirlwinds were dressing that did nothing): while it stands in the Breath,
  // every devilEvery the tier's devilCount rise by hashed players (devilWarn
  // of warning), then wander the floor (a hashed turn every devilTurnEvery)
  // for devilLife; whoever one touches is thrown devilKnockback yd out of it
  // and takes devilMin to devilMax nature, at most once in devilHitEvery.
  devilFirst: 9,
  devilEvery: 20,
  devilWarn: 2,
  devilLife: 9,
  devilR: 3.5,
  devilSpeed: 5,
  devilTurnEvery: 3,
  devilHitEvery: 2,
  devilMin: 130,
  devilMax: 150,
  devilKnockback: 8,
  boltCast: 2,
  /** The bolt jumps to every player this near a struck one. */
  boltJump: 6,
  boltMin: 300,
  boltMax: 340,
  /** Each jump hits this much harder than the last. */
  boltGrowth: 0.5,
  boltMaxStruck: 10,
  drawnFirst: 12,
  drawnEvery: 22,
  drawnMarks: 2,
  drawnSeconds: 6,
  drawnReach: 8,
  drawnTick: 1,
  drawnMin: 200,
  drawnMax: 230,
  orbFirst: 15,
  orbEvery: 25,
  orbCount: 3,
  orbLife: 8,
  orbR: 2,
  orbMin: 250,
  orbMax: 280,
  orbBurstMin: 450,
  orbBurstMax: 500,

  // -- the Hammer quarter --
  // Tremor Cracks every 13 s (10 until the rework: the pillars' rises share
  // the quarter's floor now).
  tremorFirst: 6,
  tremorEvery: 13,
  tremorWarn: 2.5,
  tremorR: 4,
  tremorMin: 500,
  tremorMax: 560,
  // The boss's own since the rework of 2026-11-18: one clock all fight,
  // wherever it stands (each tier's anvilEvery; every 25 s in the Hammer only
  // until then).
  anvilFirst: 30,
  anvilCast: 6,
  anvilR: 6,
  /** Its circle follows its player until this long before it falls, then
   *  plants (Jose's playtest of 2026-11-19: the raid gathers on them). */
  anvilLock: 1,
  // Weight of the Anvil's whole blow is each tier's (FINAL_DIFFICULTY
  // anvilTotal): on Heroic and Mythic 660 a body with all ten under it, about
  // 55 percent of a fresh level-20 cloth pool (the raid's soak band: the
  // Cradle's full share is about 55, the council's rock about 35). 9,000
  // until the bot raid of 2026-11-11: 900 a body with the whole raid under it
  // (70 to 77 percent of cloth) killed the cloth wearers whenever one raider
  // was missing or a pulse landed with it.
  /** Fewer soakers than this: each takes half as much again. */
  anvilMinSoakers: 3,
  // Nobody under it: the whole raid takes its tier's anvilMissMin to
  // anvilMissMax (FINAL_DIFFICULTY).
  /** Heroic: a Crushed soaker under the next Anvil takes its share this many
   *  times over. */
  crushedSeconds: 30,
  crushedMult: 3,
  /** Mythic: the mark turns round the boss at this radius and speed. */
  anvilOrbitR: 11,
  anvilOrbitDegPerSec: 25,
  shellFirst: 8,
  shellEvery: 20,
  shellMarks: 3,
  shellAbsorb: 600,
  shellSeconds: 20,

  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
} as const;

// ---- pure helpers -------------------------------------------------------------------------

/** A small integer hash (no rng in a pick). */
export function finalHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2545f491) ^ Math.imul(b | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** An Overload pulse's damage before the roll's spread (`fill` 0 to 1),
 *  `rise` the tier's pulseRise. */
export function pulseScale(fill: number, rise: number): number {
  return 1 + (rise / FINAL_OVERLOAD.pulseMin) * Math.max(0, Math.min(1, fill));
}

/** One bar's step over `dt` seconds (0 to 1): filling while the boss stands
 *  in its quarter, else draining at FINAL_OVERLOAD's share of that. */
export function overloadStep(fill: number, active: boolean, dt: number): number {
  const rate = 1 / FINAL_OVERLOAD.fillSeconds;
  const next = active ? fill + rate * dt : fill - rate * FINAL_OVERLOAD.drainShare * dt;
  return Math.max(0, Math.min(1, next));
}

/** What each soaker of Weight of the Anvil takes (pure), before the roll:
 *  the whole split between them, half as much again when too few stand
 *  under it, a Crushed soaker's share `crushedMult` times over. */
export function anvilShare(soakers: number, crushed: boolean, total: number): number {
  const T = FINAL_TUNING;
  const n = Math.max(1, soakers);
  const base = total / n;
  const short = n < T.anvilMinSoakers ? 1.5 : 1;
  return Math.round(base * short * (crushed ? T.crushedMult : 1));
}

/** The pace a woken star runs at (pure): the final phase's share, else full
 *  where the boss stands or where a Splinter poured it in, else the reduced
 *  share. */
export function quarterPace(opts: { finalPhase: boolean; here: boolean; poured: boolean }): number {
  if (opts.finalPhase) return FINAL_TUNING.finalPace;
  if (opts.here || opts.poured) return 1;
  return FINAL_TUNING.reducedPace;
}

/** Storm-Charged: one pulse's damage range on each player (pure, before the
 *  tier's damageMult): each charged pillar adds its own. */
export function chargedPulse(charged: number, min: number, max: number): [number, number] {
  const n = Math.max(0, charged);
  return [min * n, max * n];
}

/** A woken quarter's star, by its quarter. */
export const FINAL_STARS: Readonly<
  Record<SmithHeartVein, 'pillars' | 'sky' | 'blades' | 'whirls'>
> = {
  hammer: 'pillars',
  breath: 'sky',
  quench: 'blades',
  heat: 'whirls',
};

/** Each star's full-pace clock (first after it wakes, then between two). */
export const FINAL_STAR_CLOCK: Readonly<Record<SmithHeartVein, { first: number; every: number }>> =
  {
    hammer: { first: FINAL_TUNING.pillarFirst, every: FINAL_TUNING.pillarEvery },
    breath: { first: FINAL_TUNING.skyFirst, every: FINAL_TUNING.skyEvery },
    quench: { first: FINAL_TUNING.bladeFirst, every: FINAL_TUNING.bladeEvery },
    heat: { first: FINAL_TUNING.whirlFirst, every: FINAL_TUNING.whirlEvery },
  };

/** Leaping Bolt's damage on its `k`-th struck body (0 the first). */
export function boltScale(k: number): number {
  return 1 + FINAL_TUNING.boltGrowth * Math.max(0, k);
}

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

/** A timed object's template (`<prefix><tenths>`). */
export function finalTimed(prefix: string, seconds: number): string {
  return `${prefix}${tenthsOf(seconds)}`;
}

/** A timed object's seconds, or null when the template is not one. */
export function finalTimedOf(prefix: string, templateId: string): number | null {
  if (!templateId.startsWith(prefix)) return null;
  const t = Number(templateId.slice(prefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** A Fire Whirl's template by its state. */
export function whirlTemplate(state: 'warn' | 'live'): string {
  return `${FINAL_OBJECTS.whirlPrefix}${state}`;
}

/** A Fire Whirl's state, or null when the template is not one. */
export function whirlOf(templateId: string): 'warn' | 'live' | null {
  if (!templateId.startsWith(FINAL_OBJECTS.whirlPrefix)) return null;
  const s = templateId.slice(FINAL_OBJECTS.whirlPrefix.length);
  return s === 'warn' || s === 'live' ? s : null;
}

/** A Dust Devil's template by its state. */
export function devilTemplate(state: 'warn' | 'live'): string {
  return `${FINAL_OBJECTS.devilPrefix}${state}`;
}

/** A Dust Devil's state, or null when the template is not one. */
export function devilOf(templateId: string): 'warn' | 'live' | null {
  if (!templateId.startsWith(FINAL_OBJECTS.devilPrefix)) return null;
  const s = templateId.slice(FINAL_OBJECTS.devilPrefix.length);
  return s === 'warn' || s === 'live' ? s : null;
}

/** A burning pool's kind: Ember Mark's, Forge Fire's, or the Heat
 *  Splinter's Cinder Trail (part 2). */
export type FinalPoolKind = 'ember' | 'forge' | 'trail';

/** A burning pool's template by its kind. */
export function poolTemplate(kind: FinalPoolKind): string {
  return `${FINAL_OBJECTS.poolPrefix}${kind}`;
}

/** A burning pool's kind, or null when the template is not one. */
export function poolOf(templateId: string): FinalPoolKind | null {
  if (!templateId.startsWith(FINAL_OBJECTS.poolPrefix)) return null;
  const s = templateId.slice(FINAL_OBJECTS.poolPrefix.length);
  return s === 'ember' || s === 'forge' || s === 'trail' ? s : null;
}

/** A pillar's state. */
export type FinalPillarState = 'plain' | 'charged';

/** A pillar's template by its state (both are combat walls). */
export function finalPillarTemplate(state: FinalPillarState): string {
  return `${FINAL_OBJECTS.pillarPrefix}${state}`;
}

/** A pillar's state, or null when the template is not one. */
export function finalPillarOf(templateId: string): FinalPillarState | null {
  if (!templateId.startsWith(FINAL_OBJECTS.pillarPrefix)) return null;
  const s = templateId.slice(FINAL_OBJECTS.pillarPrefix.length);
  return s === 'plain' || s === 'charged' ? s : null;
}

/** A Crossing Blade's state. */
export type FinalBladeState = 'aim' | 'fly';

/** A Crossing Blade's template by its state. */
export function finalBladeTemplate(state: FinalBladeState): string {
  return `${FINAL_OBJECTS.bladePrefix}${state}`;
}

/** A Crossing Blade's state, or null when the template is not one. */
export function finalBladeOf(templateId: string): FinalBladeState | null {
  if (!templateId.startsWith(FINAL_OBJECTS.bladePrefix)) return null;
  const s = templateId.slice(FINAL_OBJECTS.bladePrefix.length);
  return s === 'aim' || s === 'fly' ? s : null;
}

/** A Crossing Blade's line: aiming (it follows its mark), locked, flying. */
export type FinalLaneState = 'warn' | 'lock' | 'fly';

/** A line's template (`<prefix><state>_<length in tenths>`). */
export function finalLaneTemplate(state: FinalLaneState, length: number): string {
  return `${FINAL_OBJECTS.lanePrefix}${state}_${tenthsOf(length)}`;
}

/** A line's state and length, or null when the template is not one. */
export function finalLaneOf(templateId: string): { state: FinalLaneState; length: number } | null {
  if (!templateId.startsWith(FINAL_OBJECTS.lanePrefix)) return null;
  const [state, n] = templateId.slice(FINAL_OBJECTS.lanePrefix.length).split('_');
  const t = Number(n);
  if ((state !== 'warn' && state !== 'lock' && state !== 'fly') || !Number.isInteger(t) || t < 0)
    return null;
  return { state, length: t / 10 };
}
