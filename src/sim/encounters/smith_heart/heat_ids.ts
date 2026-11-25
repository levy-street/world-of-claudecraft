// The Guardian of the Heat's leaf (docs/design/raid/smith_heart.md section
// 7.4): every id the fight's sim, its renderer, its HUD, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of its encounter objects. No SimContext, no rng.
//
// "The well of the first flame": the guardian stands half sunk in the
// wellspring in the Hearth and the raid fights on the shore all the way round
// it (inspired by Ragnaros in Firelands as a CONCEPT only: every
// name here is our own and was IP-checked, design doc 7.4).
//
// EVERY number here is a SKETCH, unmeasured (the design doc's 7.4 table says
// so too): anchored to the other guardians' (level 20 elite, ten players, a
// measured bot raid of about 400 to 460 damage a second) and the level-20
// cloth reference (about 1,135 to 1,345 health), to be calibrated with the
// meters harness before the raid ships. Every tunable lives in HEAT_TUNING
// and HEAT_DIFFICULTY, so a change is one number.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the guardian's phase and stage: an aura on it (`value` the phase,
//     `value2` the stage, its `remaining` and `duration` the stage's clock),
//     its bar (the cast id below);
//   - the wellspring: a claim object whose template carries its state;
//   - every footprint (the fist's spot, the swell lanes and their waves, the
//     overflow's rings of lava and their corridors, the seeds, the zones, a
//     cinder's fall and scorch,
//     the trails): objects, a radius or
//     a half width in `scale`, a direction in `facing`, a state and its
//     length in the template;
//   - the adds (the Wellspawn, the Wellkeepers, the Seedflames, the Rolling
//     Cinders): mobs, and the marks and hunts they lay as auras;
//   - the moments as `spellfx` cues (HEAT_CUES).

/** The guardian (template id, frozen: its death lights the Heat vein). */
export const HEAT_GUARDIAN = 'heart_heat_guardian';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The guardian's bars. */
export const HEAT_CASTS = {
  /** Basalt Fist: the crystal-and-basalt fist rises over a spot on the shore
   *  and slams it (planted, its facing locked on the spot). */
  fist: 'heart_heat_fist',
} as const;

/** The auras the fight puts on players, adds and the guardian. */
export const HEAT_AURAS = {
  /** On the guardian: its phase (`value` 1 to 3) and stage (`value2`, see
   *  HEAT_STAGES), the stage's clock in `remaining` and `duration`. */
  state: 'heart_heat_state',
  /** Hearth Flare's mark: more Fire (and other magic) damage taken. */
  scorched: 'heart_heat_scorched',
  /** Cinder Grip: the template's stacking burn on the tank (mob_swing.ts
   *  `stackPoison`; its aura id is the seam's own). */
  grip: 'stackpoison_heart_heat_guardian',
  /** A Wellkeeper's Kindling Mark: in 5 s this player trails fire. */
  kindling: 'heart_heat_kindling',
  /** The mark has caught: this player leaves a Cinder Trail. */
  trail: 'heart_heat_trailing',
  /** A Rolling Cinder or a Seedflame hunts this player. */
  hunted: 'heart_heat_hunted',
  /** On a Rolling Cinder: struck back, no knockback moves it for a while. */
  crust: 'heart_heat_crust',
  /** On the guardian until its entrance has played (heat_intro.ts): `value`
   *  heat_intro_plan.ts HEAT_INTRO_STAGES (cold, or waking with the scene's
   *  clock in `remaining` and `duration`). */
  intro: 'heart_heat_intro',
  /** Heroic and Mythic: a Live Coal (heat_coal.ts). One aura carries it all:
   *  a `heal_absorb` (combat/heal.ts consumeHealAbsorb), the absorb left in
   *  `value`, its whole in `value2`, the fuse in `remaining` and `duration`. */
  coal: 'heart_heat_live_coal',
} as const;

/** The guardian's stages (its state aura's `value2`). */
export const HEAT_STAGES = {
  fight: 0,
  sinking: 1,
  under: 2,
  rising: 3,
} as const;
export type HeatStage = keyof typeof HEAT_STAGES;

/** The fight's object templates (a radius or a half width rides `scale`). */
export const HEAT_OBJECTS = {
  /** The first wellspring, a claim object: `<prefix><calm|over>`. */
  wellPrefix: 'sh_heat_well_',
  /** Basalt Fist's spot: `<prefix><tenths>` of warning. */
  fistPrefix: 'sh_heat_fist_',
  /** A Molten Swell's lane from the fist's spot: `<prefix><warn|roll>_<tenths>`,
   *  along `facing`, its half width in `scale`, HEAT_TUNING.laneLength long. */
  lanePrefix: 'sh_heat_lane_',
  /** A Molten Swell's wave rolling down its lane (it moves; along `facing`,
   *  its half width in `scale`). */
  wave: 'sh_heat_wave',
  /** An overflow's ring of lava rolling out of the wellspring (heat_waves.ts):
   *  `<prefix><gap>_<gap>` (each corridor's bearing in whole degrees, sim
   *  facing), on its first corridor's line `front` yards out (it moves), its
   *  corridors' half width in `scale`. */
  ringPrefix: 'sh_heat_ring_',
  /** The next ring's corridor, glowing ahead of it: `<prefix><tenths>` to
   *  its launch, at the wellspring, its line in `facing`, its half width in
   *  `scale`. */
  gapPrefix: 'sh_heat_gap_',
  /** A Hearthseed: `<prefix><tenths>` to its burst, its burst reach in `scale`. */
  seedPrefix: 'sh_heat_seed_',
  /** Wakefire: `<prefix><band>_<warn|burn>_<tenths>` (bands round the well). */
  zonePrefix: 'sh_heat_zone_',
  /** A slice of the Wheel of the Hearth (wheelTemplate). */
  wheelPrefix: 'sh_heat_wheel_',
  /** Where a Rolling Cinder will land: `<prefix><tenths>`. */
  fallPrefix: 'sh_heat_fall_',
  /** A cinder's burning landing spot: `<prefix><tenths>` of its life. */
  scorchPrefix: 'sh_heat_scorch_',
  /** A Cinder Trail patch: `<prefix><tenths>` of its life. */
  trailPrefix: 'sh_heat_trail_',
} as const;

/** Dev-only presentation triggers (spellfx 'nova' on the guardian, emitted
 *  only by a dev verb, never by the fight): its death replayed on its living
 *  body (`/dev heart heat death`; the renderer's HeatDeathFx plays the scene,
 *  smith_heart_fx/heat_death_core.ts, and claims the cue). */
export const HEAT_DEV_CUES = {
  deathReplay: 'heart_heat_death_replay',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const HEAT_CUES = {
  /** Basalt Fist lands (spellfxAt 'burst' at its spot). */
  fist: 'heart_heat_fist_land',
  /** A Molten Swell starts to roll (spellfxAt at its lane's start). */
  swell: 'heart_heat_swell',
  /** Hearth Flare strikes a far player (spellfx 'beam', guardian to them). */
  flare: 'heart_heat_flare',
  /** The guardian sinks into the wellspring (spellfx 'nova' on it). */
  sink: 'heart_heat_sink',
  /** It rises again (spellfx 'nova' on it). */
  rise: 'heart_heat_rise',
  /** An overflow's ring of lava leaves the wellspring's lip (spellfxAt at
   *  the wellspring, the lip as the radius). */
  ring: 'heart_heat_ring',
  /** A Falling Cinder strikes a player (spellfx 'burst' on them). */
  bolt: 'heart_heat_bolt',
  /** A Wellspawn climbs out at the room's edge (spellfxAt). */
  spawn: 'heart_heat_spawn',
  /** A Wellspawn reaches the wellspring and feeds it (spellfxAt). */
  feed: 'heart_heat_feed',
  /** A Wellkeeper marks a player (spellfx 'beam', keeper to them). */
  kindling: 'heart_heat_kindling',
  /** The guardian heaves the Hearthseeds out of the wellspring (spellfx
   *  'nova' on it): the throw's gesture and its meteors leave its hands. */
  seedThrow: 'heart_heat_seed_throw',
  /** A Hearthseed lands, HEAT_TUNING.seedFlight after the throw (spellfxAt). */
  seed: 'heart_heat_seed',
  /** A Hearthseed bursts (spellfxAt, its reach as the radius). */
  seedBurst: 'heart_heat_seed_burst',
  /** A Seedflame hatches from a burst (spellfxAt). */
  hatch: 'heart_heat_hatch',
  /** A Wakefire band ignites (spellfx 'nova' on the guardian). */
  ignite: 'heart_heat_ignite',
  /** A Rolling Cinder lands (spellfxAt). */
  cinderLand: 'heart_heat_cinder_land',
  /** A Rolling Cinder is struck back (spellfx 'burst' on it). */
  cinderKnock: 'heart_heat_cinder_knock',
  /** A Rolling Cinder reaches its quarry and bursts (spellfxAt). */
  cinderBurst: 'heart_heat_cinder_burst',
  /** A Live Coal is set on a player (spellfx 'beam', guardian to them). */
  coal: 'heart_heat_coal',
  /** A Live Coal leaps to a player who came too close (spellfx 'beam', the
   *  old bearer to the new one). */
  coalLeap: 'heart_heat_coal_leap',
  /** A Live Coal is healed through and goes out (spellfx 'nova' on them). */
  coalOut: 'heart_heat_coal_out',
  /** A Live Coal's fuse runs out and it bursts (spellfxAt, the burst's
   *  reach as the radius). */
  coalBurst: 'heart_heat_coal_burst',
  /** The fight is over: the wellspring settles (spellfx 'nova'). */
  settle: 'heart_heat_settle',
} as const;

/** The fight's own mob templates (content/smith_heart.ts). */
export const HEAT_MOBS = {
  /** Heroic's children of the flame: they walk to the wellspring. */
  spawn: 'heart_heat_wellspawn',
  /** Heroic's second overflow: tanked, they mark a player who trails fire. */
  keeper: 'heart_heat_wellkeeper',
  /** Heroic: hatched from a Hearthseed's burst, fixed on one player. */
  seedflame: 'heart_heat_seedflame',
  /** Phase 3: the great living fireball that hunts a player. */
  cinder: 'heart_heat_rolling_cinder',
} as const;

/** The mobs the encounter walks itself (the mob AI leaves them be: hostile,
 *  in combat, never moved, aggroed or swung by it; mob/locomotion.ts). */
export const HEAT_WALKERS: ReadonlySet<string> = new Set([HEAT_MOBS.spawn, HEAT_MOBS.cinder]);

/** The damage, aura and object names (combat log, floating text, the buff
 *  bar; re-localized by src/ui/sim_i18n.ts through the mechanic reverse
 *  map). Every coined one was IP-checked (design doc 7.4). */
export const HEAT_NAMES = {
  well: 'The First Wellspring',
  wellFire: 'Wellspring Fire',
  state: 'The First Flame',
  fist: 'Basalt Fist',
  swell: 'Molten Swell',
  flare: 'Hearth Flare',
  scorched: 'Flare-Scorched',
  grip: 'Cinder Grip',
  overflow: 'Wellspring Overflow',
  bolt: 'Falling Cinder',
  feed: 'Fed Flame',
  kindling: 'Kindling Mark',
  trail: 'Cinder Trail',
  seed: 'Hearthseed',
  zone: 'Wakefire',
  wheel: 'Wheel of the Hearth',
  cinder: 'Rolling Cinder',
  cinderLand: 'Cinder Scorch',
  hunted: 'Hunted',
  crust: 'Cooling Crust',
  coal: 'Live Coal',
  coalBurst: 'Coal Burst',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty. Each tier is one HEAT_DIFFICULTY row; mythic is a
 *  dev-switched prototype (heat.ts setHeatDevTier) and, for now, the heroic
 *  row with a harder Wheel (its `wheel` field), never a branch on a tier's
 *  name. */
export type HeatDifficulty = 'normal' | 'heroic' | 'mythic';

export interface HeatDifficultyRules {
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** Players each Basalt Fist marks (heat_fist.ts): Normal one; Heroic and
   *  Mythic two since Jose's call of 2026-11-25, each slamming its own spot
   *  and rolling its own swells, the two spots kept apart. */
  fistMarks: number;
  /** A lethal punishment's damage factor, in place of damageMult (Basalt
   *  Fist, Wakefire's and the Wheel's ignite; a Rolling Cinder's catch kills
   *  on its own): the parse-calibrated
   *  pass of 2026-11-16 raised the raid's damage and left these where they
   *  were (the tier's old damageMult). */
  punishMult: number;
  /** The boss's own swing (its weapon, so its swing cleave too) against the
   *  template's, set at the pull (tier_swing.ts). The template swing is one
   *  for every tier, so each tier's raise lives here (the pass of 2026-11-16). */
  swingMult: number;
  /** The boss's health pool against the template's, set at the pull
   *  (tier_health.ts). */
  healthMult: number;
  /** The overflows bring the Wellspawn (and the second, two Wellkeepers). */
  overflowAdds: boolean;
  /** A Hearthseed's burst hatches a Seedflame. */
  seedHatch: boolean;
  /** Live Coals (heat_coal.ts) through every fighting phase. */
  liveCoal: boolean;
  /** Players a Falling Cinder volley strikes. */
  bolts: number;
  /** A Rolling Cinder's speed (yards a second; a player runs 7). */
  cinderSpeed: number;
  /** The Wheel of the Hearth (heat_wheel.ts), every tier since the rework of
   *  2026-11-18 (Duallam's playtest: on Normal nobody had to move): its
   *  first run into a phase, the gap between runs, a round's warning and how
   *  many rounds a run turns. */
  wheel: HeatWheelRules;
  /** The fight's soft enrage (heat_cinders.ts cinderInterval): this long
   *  into phase 3 (seconds on the fight clock), the Rolling Cinders fall
   *  every `cinderLateEvery` instead of HEAT_TUNING.cinderEvery (the cap
   *  stands). */
  cinderLateAfter: number;
  cinderLateEvery: number;
  /** The overflows' lava waves (heat_waves.ts): the first (70 percent), then
   *  the second (40 percent, quicker and narrower). */
  waves: readonly [HeatWaveRule, HeatWaveRule];
}

/** One overflow's lava waves (seconds, yards; heat_waves.ts). */
export interface HeatWaveRule {
  /** Rings in the overflow. */
  count: number;
  /** The first ring leaves the lip this long after the guardian is under
   *  (its corridors glow all the while), each next one `every` after the last. */
  lead: number;
  every: number;
  /** Yards a second a ring rolls out (a player runs 7). */
  speed: number;
  /** Corridors in each ring. */
  gaps: number;
  /** Degrees between neighbouring corridors. 90 since Jose's playtest of
   *  2026-11-24: two corridors straight across the wellspring left the raid
   *  only one within reach while it chased the Wellspawn, so both now sit a
   *  quarter turn apart, either a short walk from the other. */
  gapSpread: number;
  /** A corridor's half width. */
  gapHalf: number;
}

/** One tier's Wheel of the Hearth (seconds; heat_wheel.ts). */
export interface HeatWheelRules {
  first: number;
  every: number;
  warn: number;
  rounds: number;
  /** The eruption's and the burn's share of their tuned blow (Normal a
   *  heavy hit, never a death on its own; Heroic and Mythic the full one). */
  hit: number;
}

/** Heroic's lava waves: quicker rings, narrower corridors, the Wellspawn
 *  walking all the while. The second (40 percent) noticeably faster since
 *  Jose's call of 2026-11-25 (10.5 to 11.5), its spacing kept (the walk to
 *  the next corridor still fits: tests/smith_heart_heat_waves.test.ts). */
const HEROIC_WAVES: HeatDifficultyRules['waves'] = [
  { count: 5, lead: 3, every: 4, speed: 9.5, gaps: 2, gapSpread: 90, gapHalf: 3.5 },
  { count: 6, lead: 3, every: 3.4, speed: 11.5, gaps: 2, gapSpread: 90, gapHalf: 3 },
];

/** Mythic's own lava waves (Jose's call of 2026-11-25: no longer Heroic's):
 *  a quicker first overflow and the fastest second (the walk to a corridor
 *  still fits, pinned). */
const MYTHIC_WAVES: HeatDifficultyRules['waves'] = [
  { count: 5, lead: 3, every: 4, speed: 9.75, gaps: 2, gapSpread: 90, gapHalf: 3.5 },
  { count: 6, lead: 3, every: 3.4, speed: 12, gaps: 2, gapSpread: 90, gapHalf: 3 },
];

export const HEAT_DIFFICULTY: Readonly<Record<HeatDifficulty, HeatDifficultyRules>> = {
  normal: {
    fistMarks: 1,
    // The parse-calibrated pass of 2026-11-16: the raid's damage and the
    // swing +15 percent (was 1), the Basalt Fist where it was. The team's
    // playtest of 2026-11-25 ("Normal hits too soft, the tanks most of all"):
    // the raid's damage 1.15 to 1.3 and the swing 1.15 to 1.5 (+30 percent),
    // the lethal punishments where they were.
    damageMult: 1.3,
    punishMult: 1,
    swingMult: 1.5,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    healthMult: 1,
    overflowAdds: false,
    seedHatch: false,
    liveCoal: false,
    bolts: 2,
    cinderSpeed: 3.2,
    // Slower, with the longest warning: three rounds of 5 s.
    wheel: { first: 12, every: 34, warn: 5, rounds: 3, hit: 0.55 },
    // Three minutes into phase 3 (the balance pass of 2026-11-12): only a
    // raid running well past the 4 to 5 minute target feels it.
    cinderLateAfter: 180,
    cinderLateEvery: 20,
    // The rework of 2026-11-18: slow rings, wide corridors, the longest
    // warning; the second overflow a little quicker and narrower.
    waves: [
      { count: 4, lead: 3.5, every: 4.5, speed: 8, gaps: 2, gapSpread: 90, gapHalf: 4.5 },
      // The second noticeably faster since Jose's call of 2026-11-25 (was 9);
      // its spacing kept (the walk to the corridor still fits, pinned).
      { count: 5, lead: 3.5, every: 4, speed: 10, gaps: 2, gapSpread: 90, gapHalf: 3.75 },
    ],
  },
  heroic: {
    fistMarks: 2,
    // The pass of 2026-11-16 (no Heroic parse yet: Normal's call): the
    // raid's damage and the swing +15 percent (1.25 to 1.4375), the Basalt
    // Fist where it was; its pool x1.2 to x1.3.
    damageMult: 1.4375,
    punishMult: 1.25,
    // 1.15 to 1.5 with the team's playtest of 2026-11-25 (the tanks' hit +30
    // percent on every tier).
    swingMult: 1.5,
    // 1.45 to 1.2 with the base raised to 77,000 (2026-11-12): the Heroic
    // pool stays about where it was (92,800 to 92,400 base).
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    // The owner's call of 2026-11-17: the Council's and the Quench's pool.
    healthMult: 1.47,
    overflowAdds: true,
    seedHatch: true,
    liveCoal: true,
    bolts: 3,
    cinderSpeed: 4.4,
    wheel: { first: 10, every: 30, warn: 3.5, rounds: 3, hit: 1 },
    cinderLateAfter: 240,
    cinderLateEvery: 20,
    waves: HEROIC_WAVES,
  },
  // Heroic whole, its Wheel quicker and a round longer.
  mythic: {
    fistMarks: 2,
    // Heroic's numbers of 2026-11-16 (the heroic row whole; its swing 1.5
    // since 2026-11-25).
    damageMult: 1.4375,
    punishMult: 1.25,
    swingMult: 1.5,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    // The owner's call of 2026-11-17: the Council's and the Quench's pool.
    healthMult: 2.06,
    overflowAdds: true,
    seedHatch: true,
    liveCoal: true,
    bolts: 3,
    cinderSpeed: 4.4,
    // Mythic's extra: a fourth round, each one quicker.
    wheel: { first: 10, every: 28, warn: 3, rounds: 4, hit: 1 },
    cinderLateAfter: 240,
    cinderLateEvery: 20,
    waves: MYTHIC_WAVES,
  },
};

/** The phases (1 to 3, on every difficulty: the guardian never leaves the
 *  wellspring) and which of the fight's mechanics run in each. */
export type HeatPhase = 1 | 2 | 3;

export interface HeatPhaseKit {
  fist: boolean;
  flare: boolean;
  seeds: boolean;
  zones: boolean;
  /** The Wheel of the Hearth: in every fighting phase, so no phase is a
   *  stand-still (the rework of 2026-11-18). */
  wheel: boolean;
  cinders: boolean;
}

export const HEAT_PHASE_KIT: Readonly<Record<HeatPhase, HeatPhaseKit>> = {
  1: { fist: true, flare: true, seeds: false, zones: false, wheel: true, cinders: false },
  2: { fist: true, flare: false, seeds: true, zones: true, wheel: true, cinders: false },
  3: { fist: true, flare: false, seeds: false, zones: true, wheel: true, cinders: true },
};

// ---- the wellspring's size -------------------------------------------------------------

/** The first wellspring's burning lip (yards from its middle): the guardian's
 *  body radius too, so melee strikes it from the shore round the lip. The
 *  layout's HEARTH_WELL takes its radius from here, and every reach measured
 *  from the well's middle (Hearth Flare's, Wakefire's bands, a Wellspawn's
 *  feeding) is this plus its own margin, so the fight keeps its shape when the
 *  well grows (pass 4 of 2026-11-06: 8 to 10.5 with the guardian's body). */
export const HEAT_WELL_R = 10.5;

/** The low wall of basalt stumps round the wellspring's lip (Jose's playtest
 *  of 2026-11-24: players walked into the stumps and the fire behind them).
 *  It is solid from the lip (`inner`) to its outer face (`outer`, yards from
 *  the well's middle): the layout's round wall (smith_heart_layout.ts
 *  HEARTH_LIP_RING, one circle collider since 2026-11-25 so a body slides
 *  along it smoothly) keeps every body out of it and the fire, the renderer
 *  draws its stumps over the same band and clips every floor mark at its
 *  outer face (nothing a player can stand on lies inside it). `height` its
 *  top over the floor: under a player's eye line, and its collider is
 *  sight-clear, so it never hides the guardian. */
export const HEAT_LIP_WALL = { inner: HEAT_WELL_R, outer: HEAT_WELL_R + 2, height: 1.4 } as const;

/** The guardian's body radius (its template's bodyRadius): the lip wall's
 *  outer face plus a yard, so a player's melee (BODY_EDGE_MELEE_REACH past
 *  the body) reaches it from the wall out to four yards beyond it (the same
 *  playtest: "melee must hit it from farther"). Every reach measured from
 *  the well's middle (Hearth Flare's, Wakefire's bands) keeps its own number. */
export const HEAT_BODY_R = HEAT_LIP_WALL.outer + 1;

/** The guardian's facing at rest (sim convention, 0 runs +z): toward the
 *  Hearth's door in the east, where the raid comes in. Its spawn takes it, and
 *  a wipe's reset turns it back to it. */
export const HEAT_HOME_FACING = Math.PI / 2;

/** The guardian's template scale (its drawn size; the renderer's fire
 *  reckons in it): grown with the well in pass 4, 3 to 4. Its own swing's
 *  reach follows its body radius (mob_combat.ts), never this alone. */
export const HEAT_GUARDIAN_SCALE = 4;

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const HEAT_TUNING = {
  // The phases (fractions of its health).
  overflowOneAt: 0.7,
  overflowTwoAt: 0.4,
  // The overflows.
  sinkSeconds: 2.5,
  riseSeconds: 3,
  // The wellspring: whoever stands in it burns.
  wellTick: 0.5,
  wellMin: 120,
  wellMax: 140,
  // Basalt Fist and its Molten Swells.
  fistFirst: 8,
  fistEvery: 22,
  fistCast: 3,
  fistR: 6,
  fistMin: 2500,
  fistMax: 2700,
  /** Three lanes from the spot: away from the wellspring and to either side.
   *  Pass 5 (2026-11-06, the owner's call): 11 yd wide (2.5 either side
   *  before), a wall a raid reads as a wave; from the lane's middle a player
   *  runs out of it in under a second, the warning is 3.6 s before it rolls. */
  laneLength: 32,
  laneHalf: 5.5,
  /** The waves start rolling this long after the fist lands. */
  waveDelay: 0.6,
  waveSpeed: 10,
  /** A wave's wall is this deep along its lane (2.5 before pass 5). */
  waveDepth: 5,
  waveMin: 380,
  waveMax: 440,
  // Hearth Flare (phase 1): everyone farther than flareReach from the
  // wellspring's middle (12 yd past its lip, the giant's reach) is struck.
  flareEvery: 4,
  flareReach: HEAT_WELL_R + 12,
  flareMin: 260,
  flareMax: 300,
  scorchedPct: 0.25,
  scorchedSeconds: 8,
  // Cinder Grip (the template's stackPoison): per stack a second.
  // 18 until the bot raid of 2026-11-04: swapped at 5 stacks, both tanks still
  // burned 90 a second each for 15 s, more than two level-20 healers keep up.
  // 9 until the team's playtest of 2026-11-25 ("the tank buster and its melee
  // hit too soft"): 12, a third more, 60 a second at the swap's 5 stacks.
  gripPerTick: 12,
  gripSeconds: 15,
  gripMaxStacks: 10,
  /** The tanks swap at this many Cinder Grip stacks, every tier (the bot
   *  raid of 2026-11-04; the HUD's tank swap alert reads it, tank_swap_ids.ts). */
  gripSwap: 5,
  // The overflows' lava waves (heat_waves.ts; their pace per tier,
  // HEAT_DIFFICULTY `waves`): a ring leaves the wellspring's lip and rolls
  // out past the Hearth's farthest wall (the floor reaches about 52 yd from
  // the well's middle), its wall `ringDepth` deep; one strike to whoever it
  // rolls over outside a corridor (about 40 percent of a cloth wearer's
  // health on Normal, 55 on Heroic).
  ringStart: HEAT_WELL_R,
  ringEnd: 54,
  ringDepth: 2.5,
  ringMin: 420,
  ringMax: 460,
  // The overflows' Falling Cinders.
  boltEvery: 3,
  boltFirst: 2,
  boltMin: 140,
  boltMax: 170,
  // Heroic: the Wellspawn.
  // 3 until the rework of 2026-11-18: the overflow no longer waits for them
  // (it lasts as long as its lava waves), and the raid walks the corridors
  // while it burns them, so they walk a little slower.
  spawnSpeed: 2.4,
  /** Their speed factor at full health, falling to spawnMinFactor at
   *  spawnSlowAt of their health and below ("fully slowed"). */
  spawnMinFactor: 0.15,
  spawnSlowAt: 0.5,
  /** One reaching this far from the wellspring's middle feeds it (a yard and
   *  a half past the lip wall's outer face: the wall stops its walk there,
   *  2026-11-24; a yard and a half past the bare lip before). */
  spawnReach: HEAT_LIP_WALL.outer + 1.5,
  feedHealPct: 0.03,
  feedMin: 380,
  feedMax: 420,
  // Heroic's second overflow: the Wellkeepers and their Kindling Mark.
  markFirst: 4,
  markEvery: 10,
  markSeconds: 5,
  trailSeconds: 8,
  trailEvery: 0.6,
  trailR: 2.5,
  trailLife: 15,
  trailCap: 40,
  trailTick: 1,
  trailMin: 80,
  trailMax: 95,
  /** A Wellspawn standing in a trail heals this share of its health a
   *  second. */
  trailHealPct: 0.08,
  // Phase 2: Hearthseeds.
  seedFirst: 6,
  seedEvery: 30,
  seedLife: 10,
  seedCap: 10,
  /** A burst's reach and its damage at the seed (falling off with the
   *  square of the distance to nothing at the reach). */
  seedReach: 22,
  seedMax: 520,
  /** A seed is thrown: the guardian heaves it out of the wellspring as it
   *  falls (the seed's object and footprint show at once), and it strikes the
   *  floor this long after (its landing cue). Its fuse (seedLife) still runs
   *  from the throw, so the burst keeps its time. */
  seedFlight: 2.2,
  // Wakefire (phases 2 and 3).
  zoneFirst: 16,
  zoneEvery: 34,
  // The Wheel of the Hearth (every tier; its clock and warning per tier,
  // HEAT_DIFFICULTY `wheel`): its burn and bite (the same order as
  // Wakefire's), how far out its slices reach.
  wheelBurn: 1.5,
  /** At an eruption the way to the next round's safe slice (that slice and
   *  the one crossed to reach it) only flares this long, under one burn tick,
   *  then goes out: the raid crosses at once with the tier's whole warning
   *  (Jose's playtest of 2026-11-24: the next safe slice burned on for the
   *  whole wheelBurn, leaving Heroic 2 s to cross round the new lip wall). */
  wheelDouse: 0.2,
  wheelTick: 0.5,
  wheelMin: 900,
  wheelMax: 1000,
  wheelBurnMin: 220,
  wheelBurnMax: 260,
  wheelOuter: 70,
  zoneWarn: 4,
  /** The next band begins its warning this long after the last began. */
  zoneStep: 2.5,
  zoneBurn: 2,
  zoneTick: 0.5,
  zoneMin: 900,
  zoneMax: 1000,
  zoneBurnMin: 220,
  zoneBurnMax: 260,
  // Phase 3: the Rolling Cinders.
  cinderFirst: 8,
  cinderEvery: 45,
  cinderFallWarn: 2,
  cinderLandR: 4,
  cinderLandMin: 300,
  cinderLandMax: 340,
  scorchLife: 8,
  /** Burning landings at once at most (the oldest goes out first). */
  scorchCap: 6,
  scorchTick: 0.5,
  scorchMin: 110,
  scorchMax: 130,
  /** It reaches its quarry this near: the quarry dies, those close burn. */
  cinderContact: 2.2,
  cinderKill: 99999,
  cinderSplashR: 3,
  cinderSplashMin: 600,
  cinderSplashMax: 700,
  /** A hit pushes it this far back, then Cooling Crust holds it. */
  cinderKnock: 6,
  crustSeconds: 5,
  cinderCap: 6,
  /** Its quarry gone, it picks another after this pause. */
  cinderRetarget: 1.5,
  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
  // Heroic and Mythic: Live Coals (heat_coal.ts; the owner's design of
  // 2026-11-24). Every `coalEvery` s of fighting (its clock stands still
  // through an overflow) two non-tanks each carry one: a heal absorb of
  // coalAbsorb (x the tier's damageMult: about 600 on Heroic) and a burn
  // while it lasts; healed through, it goes out. Within coalLeapR of another
  // player it leaps to them with the absorb it has left (and a hit); just set
  // and after a leap it rests coalGrace s, and never goes straight back to the one it
  // left within coalBackGrace s. Not out in coalSeconds: it bursts on
  // everyone within coalBurstR (x the tier's punishMult: 800 to 875 on
  // Heroic, under a level-20 cloth wearer's whole health).
  coalFirst: 20,
  coalEvery: 50,
  coalTargets: 2,
  coalAbsorb: 420,
  coalSeconds: 12,
  coalTick: 1,
  coalBurnMin: 38,
  coalBurnMax: 44,
  coalLeapR: 2,
  coalGrace: 1.5,
  coalBackGrace: 4,
  coalLeapMin: 140,
  coalLeapMax: 160,
  coalBurstR: 7,
  coalBurstMin: 640,
  coalBurstMax: 700,
  /** A coal is never set this near a Wheel of the Hearth's start (a run on
   *  the floor, or one due this soon), and a Wheel waits this long after one. */
  coalWheelGap: 3,
} as const;

// ---- pure helpers ---------------------------------------------------------------------

/** A small integer hash (no rng in a pick). */
export function heatHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2545f491) ^ Math.imul(b | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The health share the guardian cannot be pushed past in `phase` (the next
 *  threshold, so an overflow is never skipped), or null when none. */
export function phaseFloor(phase: HeatPhase): number | null {
  const T = HEAT_TUNING;
  if (phase === 1) return T.overflowOneAt;
  if (phase === 2) return T.overflowTwoAt;
  return null;
}

/** A Wellspawn's speed factor at `hpFrac` of its health: whole at full,
 *  falling to the floor at spawnSlowAt and below. */
export function spawnPace(hpFrac: number): number {
  const T = HEAT_TUNING;
  const k = Math.max(0, Math.min(1, (hpFrac - T.spawnSlowAt) / (1 - T.spawnSlowAt)));
  return T.spawnMinFactor + (1 - T.spawnMinFactor) * k;
}

/** A Hearthseed's burst at `d` yards (before the roll and the multiplier). */
export function seedFalloff(d: number): number {
  const T = HEAT_TUNING;
  if (d >= T.seedReach) return 0;
  const k = 1 - Math.max(0, d) / T.seedReach;
  return T.seedMax * k * k;
}

/** Wakefire's three bands round the wellspring's middle: [inner, outer)
 *  yards. 0 near the guardian, 1 the middle, 2 the back. */
export const ZONE_BANDS: readonly (readonly [number, number])[] = [
  [HEAT_WELL_R, HEAT_WELL_R + 11],
  [HEAT_WELL_R + 11, HEAT_WELL_R + 23],
  [HEAT_WELL_R + 23, 70],
];

/** The Wheel of the Hearth: how many slices in all, and on each side (its
 *  rounds per run are the tier's, HEAT_DIFFICULTY `wheel.rounds`). Jose's call
 *  of 2026-11-25: four 45 degree wedges over the shore IN FRONT of the guardian
 *  (toward the door, as before the even quarters of the same day), and the
 *  same four mirrored BEHIND it, one safe on each side, picked apart (melee
 *  behind and ranged in front each read their own side). */
export const WHEEL_SIDE = 4;
export const WHEEL_SLICES = WHEEL_SIDE * 2;

/** A slice's bearings round the wellspring (sim facing, degrees, 0 north and
 *  90 east toward the door; the range runs -90 to 270): slices 0 to 3 the
 *  front wedges from north round to south, 4 to 7 each one's mirror behind
 *  (slice 4 + i mirrors slice i across the north-south line). */
export const WHEEL_ARCS_DEG: readonly (readonly [number, number])[] = [
  [0, 45],
  [45, 90],
  [90, 135],
  [135, 180],
  [-45, 0],
  [-90, -45],
  [225, 270],
  [180, 225],
];

/** Which side slice `slice` lies on: 0 in front, 1 behind. Pure. */
export function wheelSide(slice: number): 0 | 1 {
  return slice >= WHEEL_SIDE ? 1 : 0;
}

export type HeatWheelState = 'warn' | 'burn' | 'safe';

/** A Wheel slice's template: which, its state, its seconds. */
export function wheelTemplate(slice: number, state: HeatWheelState, seconds: number): string {
  return `${HEAT_OBJECTS.wheelPrefix}${slice}_${state}_${Math.round(seconds * 10)}`;
}

export function wheelOf(
  templateId: string,
): { slice: number; state: HeatWheelState; seconds: number } | null {
  if (!templateId.startsWith(HEAT_OBJECTS.wheelPrefix)) return null;
  const [a, state, t] = templateId.slice(HEAT_OBJECTS.wheelPrefix.length).split('_');
  const slice = Number(a);
  const n = Number(t);
  if (!Number.isInteger(slice) || slice < 0 || slice >= WHEEL_SLICES) return null;
  if (state !== 'warn' && state !== 'burn' && state !== 'safe') return null;
  return Number.isInteger(n) && n >= 0 ? { slice, state, seconds: n / 10 } : null;
}

// ---- object templates (pure) ----------------------------------------------------------

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

/** A timed object's template (`<prefix><tenths>`). */
export function heatTimed(prefix: string, seconds: number): string {
  return `${prefix}${tenthsOf(seconds)}`;
}

/** A timed object's seconds, or null when the template is not one. */
export function heatTimedOf(prefix: string, templateId: string): number | null {
  if (!templateId.startsWith(prefix)) return null;
  const t = Number(templateId.slice(prefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}

/** The wellspring's states: calm (the guardian in it), overflowing (an
 *  overflow). */
export type HeatWellState = 'calm' | 'over';
export function wellTemplate(state: HeatWellState): string {
  return `${HEAT_OBJECTS.wellPrefix}${state}`;
}
export function wellOf(templateId: string): HeatWellState | null {
  if (!templateId.startsWith(HEAT_OBJECTS.wellPrefix)) return null;
  const s = templateId.slice(HEAT_OBJECTS.wellPrefix.length);
  return s === 'calm' || s === 'over' ? s : null;
}

/** A two-state timed object (`<prefix><state>_<tenths>`). */
function stateTemplate(prefix: string, state: string, seconds: number): string {
  return `${prefix}${state}_${tenthsOf(seconds)}`;
}
function stateOf<S extends string>(
  prefix: string,
  states: readonly S[],
  templateId: string,
): { state: S; seconds: number } | null {
  if (!templateId.startsWith(prefix)) return null;
  const [state, t] = templateId.slice(prefix.length).split('_');
  if (!(states as readonly string[]).includes(state)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? { state: state as S, seconds: n / 10 } : null;
}

export type HeatLaneState = 'warn' | 'roll';
export function swellLaneTemplate(state: HeatLaneState, seconds: number): string {
  return stateTemplate(HEAT_OBJECTS.lanePrefix, state, seconds);
}
export function swellLaneOf(templateId: string): { state: HeatLaneState; seconds: number } | null {
  return stateOf(HEAT_OBJECTS.lanePrefix, ['warn', 'roll'] as const, templateId);
}

/** A ring's template: its corridors' bearings (radians) in whole degrees. */
export function ringTemplate(gaps: readonly number[]): string {
  const deg = gaps.map((g) => {
    const d = Math.round((g * 180) / Math.PI) % 360;
    return d < 0 ? d + 360 : d;
  });
  return `${HEAT_OBJECTS.ringPrefix}${deg.join('_')}`;
}
/** A ring's corridors' bearings (radians), or null when the template is not one. */
export function ringOf(templateId: string): { gaps: number[] } | null {
  if (!templateId.startsWith(HEAT_OBJECTS.ringPrefix)) return null;
  const parts = templateId.slice(HEAT_OBJECTS.ringPrefix.length).split('_');
  const gaps: number[] = [];
  for (const p of parts) {
    const d = Number(p);
    if (p === '' || !Number.isInteger(d) || d < 0 || d >= 360) return null;
    gaps.push((d * Math.PI) / 180);
  }
  return gaps.length > 0 ? { gaps } : null;
}
/** A corridor warning's template: its seconds to the launch. */
export function gapTemplate(seconds: number): string {
  return heatTimed(HEAT_OBJECTS.gapPrefix, seconds);
}
export function gapOf(templateId: string): number | null {
  return heatTimedOf(HEAT_OBJECTS.gapPrefix, templateId);
}

export type HeatZoneState = 'warn' | 'burn';
export function zoneTemplate(band: number, state: HeatZoneState, seconds: number): string {
  return `${HEAT_OBJECTS.zonePrefix}${band}_${state}_${tenthsOf(seconds)}`;
}
export function zoneOf(
  templateId: string,
): { band: number; state: HeatZoneState; seconds: number } | null {
  if (!templateId.startsWith(HEAT_OBJECTS.zonePrefix)) return null;
  const [b, state, t] = templateId.slice(HEAT_OBJECTS.zonePrefix.length).split('_');
  const band = Number(b);
  const n = Number(t);
  if (!Number.isInteger(band) || band < 0 || band >= ZONE_BANDS.length) return null;
  if (state !== 'warn' && state !== 'burn') return null;
  return Number.isInteger(n) && n >= 0 ? { band, state, seconds: n / 10 } : null;
}
