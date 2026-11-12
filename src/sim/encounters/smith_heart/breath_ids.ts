// The Guardian of the Breath's leaf (docs/design/raid/smith_heart.md section
// 7.2): every id the fight's sim, its renderer, its HUD, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of its encounter objects. No SimContext, no rng.
//
// EVERY number here is a SKETCH, unmeasured (the design doc's 7.2 table says
// so too): anchored to the Hammer Council's (level 20 elite, ten players, a
// measured bot raid of about 400 to 460 damage a second) and the level-20
// cloth reference (about 1,135 to 1,345 health), to be calibrated with the
// meters harness before the raid ships.
//
// What every client reads (no wire or IWorld change; all of it rides
// existing entity fields):
//   - the wind's state: ONE object at the Cornice's middle whose template id
//     carries the phase, the bearing it blows toward and the phase's length
//     (`breathWindTemplate`); each player in it wears the kernel's wind aura
//     (src/sim/wind_drift.ts), so both hosts step the same push;
//   - Captain Thessaly (an NPC, `BREATH_THESSALY_NPC`) and her circle of calm
//     (an object: landing, holding, spent), the anchored and the spent
//     players (auras);
//   - the vortex, the loose gales, the strikes' spots, the charged ground and
//     the Thunder's Cradle (objects, their radius in `scale`), the lifted
//     player (carried in the air: carried_body.ts), the marked conductor
//     (an aura), the pinned (an aura);
//   - mythic's Knotted Gale: the balls and portals (objects, the fuse in the
//     ball's template), the marked and the carrier (auras);
//   - the guardian's bars (cast ids below) and its storm body and the
//     storm's swell (auras on it), the moments as `spellfx` cues.

/** The guardian (template id, frozen: its death lights the Breath vein). */
export const BREATH_GUARDIAN = 'heart_breath_guardian';
/** Its body's radius (yards; the template's bodyRadius): the column of wind
 *  its chest, waist and tail plates float in, about eighteen yards tall since
 *  its own model (render/smith_heart_fx/breath_body_core.ts). Melee strikes it
 *  from this far out plus a melee reach, and its own swing settles there. */
export const BREATH_BODY_RADIUS = 3.5;
/** Captain Thessaly at the head of the Cornice climb (an NPC def with no
 *  quests: the Highwatch captain's name, look and voice). */
export const BREATH_THESSALY_NPC = 'heart_captain_thessaly';

// ---- casts, auras, objects, cues --------------------------------------------------

/** The guardian's bars (and the damage names they carry). Storm Lance stays
 *  the trash kit's own cast (content/smith_heart.ts), never started here. */
export const BREATH_CASTS = {
  /** The indrawn breath: the wind turns and pulls everyone in (planted). */
  inhale: 'heart_breath_inhale',
  /** The exhale: the old Bellows Gust (its id kept), now the blast that
   *  throws everyone outward after the indrawn breath. */
  gust: 'heart_bellows_gust',
  /** Storm Lance (the trash kit's line, read by the renderer). */
  lance: 'heart_storm_lance',
  /** At half health: the guardian draws the wind in and tears open. */
  storm: 'heart_breath_storm_break',
  /** Phase 2: a bolt that forks from player to player. */
  fork: 'heart_breath_forking_bolt',
  /** Phase 2: a player lifted into the storm (the raid gathers under them). */
  cradle: 'heart_breath_thunders_cradle',
  /** The guardian's channel that holds the lifted up (nothing else is cast
   *  while it runs). */
  cradleHold: 'heart_breath_cradle_channel',
  /** Phase 2: a player marked to draw the lightning to their feet. */
  drawn: 'heart_breath_drawn_lightning',
} as const;

/** The auras the fight puts on players and on the guardian. The kernel's
 *  wind and pull auras are wind_drift.ts's (WIND_DRIFT_AURA, WIND_PULL_AURA). */
export const BREATH_AURAS = {
  /** Thessaly's anchor: no wind, pull, blast or throw moves this player. */
  anchor: 'heart_breath_anchor',
  /** Heroic: an anchor ran out; no circle takes this player again yet. */
  spent: 'heart_breath_calm_spent',
  /** Pressed against the rim's wall by the wind (it hurts each second). */
  pinned: 'heart_breath_pinned',
  /** The marked conductor: a strike falls at their feet every 2 s. */
  drawn: 'heart_breath_drawn_lightning',
  /** Lifted into the storm (an unbreakable stun while it holds them). */
  cradled: 'heart_breath_cradled',
  /** On the guardian through phase 2: its body of lightning. */
  stormForm: 'heart_breath_storm_unbound',
  /** On the guardian: one stack per pulse of the swelling storm. */
  swell: 'heart_breath_swelling_storm',
  /** Mythic, the Knotted Gale: the player whose feet open Portal A or B
   *  (the first pair, every round) or Portal C or D (the second pair, phase
   *  2's two-ball round only). */
  portalA: 'heart_breath_portal_a',
  portalB: 'heart_breath_portal_b',
  portalC: 'heart_breath_portal_c',
  portalD: 'heart_breath_portal_d',
  /** Mythic: carrying a Knotted Gale (value: the walk's factor; its life is
   *  the fuse). No wind, pull, blast or throw moves this body either. */
  laden: 'heart_breath_laden',
  /** Thrown by the Summit Roar: an unbreakable root while the throw slides
   *  (breath_roar.ts), so the online client draws the server's slide
   *  instead of predicting steps the player cannot take. */
  thrown: 'heart_breath_roar_thrown',
  /** Tossed by a loose gale: the same unbreakable root while the shove
   *  slides (breath_shove.ts; Jose's playtest of 2026-11-04 read the old
   *  one-tick toss as a sideways teleport). */
  tossed: 'heart_breath_gale_tossed',
  /** On the guardian until its entrance has played (breath_intro.ts):
   *  `value` breath_intro_plan.ts BREATH_INTRO_STAGES (gathered into the
   *  still air, or waking with the scene's clock in `remaining` and
   *  `duration`). */
  intro: 'heart_breath_intro',
} as const;

/** The fight's object templates (their radius rides `scale`). */
export const BREATH_OBJECTS = {
  /** The wind's state, at the Cornice's middle (breathWindTemplate). */
  windPrefix: 'sh_breath_wind_',
  /** Thessaly's circle: `<prefix><state>_<tenths>` (calmTemplate). */
  calmPrefix: 'sh_breath_calm_',
  /** The vortex before the guardian's mouth while it draws breath. */
  vortex: 'sh_breath_vortex',
  /** Heroic: a loose gale wandering the Cornice. */
  gale: 'sh_breath_loose_gale',
  /** A lightning strike's spot, `<prefix><tenths>` of warning. */
  strikePrefix: 'sh_breath_strike_',
  /** Charged ground left by a conductor's strike, `<prefix><tenths>`. */
  chargedPrefix: 'sh_breath_charged_',
  /** The Thunder's Cradle's gather circle under the lifted player
   *  (`<prefix><tenths>` of hold); it also carries them. */
  cradlePrefix: 'sh_breath_cradle_',
  /** Heroic and Mythic: a Knotted Gale,
   *  `<prefix><free|held>_<tenths of fuse left>_<tenths of its whole fuse>`
   *  (knotTemplate: the whole fuse is the tier's, so a client that first sees
   *  the ball mid-fuse still draws its age), its radius (the pick-up's) in
   *  `scale`. */
  knotPrefix: 'sh_breath_knot_',
  /** Mythic: the wind portals, their radius in `scale`: A links to B only,
   *  C to D only (C and D open in phase 2's two-ball round alone). */
  portalA: 'sh_breath_portal_a',
  portalB: 'sh_breath_portal_b',
  portalC: 'sh_breath_portal_c',
  portalD: 'sh_breath_portal_d',
} as const;

/** The spellfx ability ids of the fight's moments. */
export const BREATH_CUES = {
  /** The exhale lands (spellfx 'nova' on the guardian): the Summit Roar's
   *  wave leaves its maw, racing out at BREATH_TUNING.roarSpeed. */
  gust: 'heart_bellows_gust',
  /** The Summit Roar's wave reaches a player (spellfx 'nova' from the
   *  guardian on them): the blow lands, the throw begins. */
  roarHit: 'heart_breath_roar_hit',
  /** A strike lands (spellfxAt 'burst', radius = the strike). */
  strike: 'heart_breath_strike',
  /** A leaping bolt jumps (spellfx 'beam', from the last struck to the next;
   *  the first leg from the guardian). */
  fork: 'heart_breath_fork',
  /** The cradle discharges (spellfxAt 'burst', radius = the gather circle). */
  discharge: 'heart_breath_cradle_discharge',
  /** The guardian tears open into its storm body (spellfx 'nova'). */
  tear: 'heart_breath_tear',
  /** The swelling storm pulses (spellfx 'nova' on the guardian). */
  swell: 'heart_breath_swell',
  /** A loose gale tosses a player (spellfx 'nova' from the gale on them). */
  toss: 'heart_breath_toss',
  /** Thessaly's circle lands (spellfxAt 'burst', radius = the circle). */
  calmLand: 'heart_breath_calm_land',
  /** A player is anchored (spellfx 'beam' from Thessaly to them). */
  anchor: 'heart_breath_anchor',
  /** A player goes over the lip of a gap (spellfxAt 'burst' where they
   *  left the floor). */
  fall: 'heart_breath_fall',
  /** A Knotted Gale drops (spellfxAt 'burst', radius = its pick-up). */
  knotLand: 'heart_breath_knot_land',
  /** A portal opens (spellfxAt 'burst', radius = the portal): the first
   *  pair's (A or B), and the second pair's (C or D), so each paints in its
   *  own pair's colours. */
  portalOpen: 'heart_breath_portal_open',
  portalOpenPair2: 'heart_breath_portal_open_2',
  /** A player takes a Knotted Gale up (spellfxAt 'burst'). */
  knotTake: 'heart_breath_knot_take',
  /** A body crosses from a portal to its partner (spellfx 'nova' on them,
   *  after the move: the landing): through A and B, and through C and D. */
  portalHop: 'heart_breath_portal_hop',
  portalHopPair2: 'heart_breath_portal_hop_2',
  /** A Knotted Gale goes into the void (spellfxAt 'burst' at the lip). */
  knotThrow: 'heart_breath_knot_throw',
  /** A Knotted Gale bursts (spellfxAt 'nova', radius = the Cornice). */
  knotBurst: 'heart_breath_knot_burst',
} as const;

/** The damage and aura names (combat log, floating text, the buff bar;
 *  re-localized by src/ui/sim_i18n.ts through the mechanic reverse map). */
export const BREATH_NAMES = {
  wind: 'Bellows Wind',
  pull: 'Indrawn Breath',
  pinned: 'Pressed to the Rim',
  vortex: 'Breath Vortex',
  gust: 'Summit Roar',
  anchor: 'Anchored in Calm',
  spent: 'Calm Spent',
  gale: 'Loose Gale',
  storm: 'The Storm Breaks',
  strike: 'Breaking Storm',
  fork: 'Leaping Bolt',
  cradle: "Thunder's Cradle",
  backlash: 'Cradle Backlash',
  drawn: 'Drawn Lightning',
  charged: 'Charged Ground',
  stormForm: 'Storm Unbound',
  swell: 'Swelling Storm',
  calm: 'Circle of Calm',
  knot: 'Knotted Gale',
  laden: 'Gale-Laden',
  portalA: 'Portal A',
  portalB: 'Portal B',
  portalC: 'Portal C',
  portalD: 'Portal D',
  /** The entrance's marker (the Hammer Vein Warder's sleep and the council's
   *  share the name and its catalog row). */
  intro: 'Dormant',
} as const;

/** The English line the carrier reads crossing the portals (re-localized by
 *  src/ui/sim_i18n.ts, EXACT matcher). */
export const KNOT_HOP_TEXT = 'The portal tears you across the Cornice, gale and all.';
/** The error a throw away from any gap reads (same matcher). */
export const KNOT_NOT_AT_LIP_ERROR =
  'You must stand at the edge of the Cornice to throw the Knotted Gale.';

// ---- difficulty -----------------------------------------------------------------------

/** The fight's difficulty. Each tier is one BREATH_DIFFICULTY row (its
 *  Knotted Gale one BREATH_KNOT row, Heroic and Mythic); mythic is
 *  a dev-switched prototype (breath.ts setBreathDevTier) and, for now, the
 *  heroic row whole: a later mythic-only mechanic is one more field here and
 *  its own module, never a branch on a tier's name. */
export type BreathDifficulty = 'normal' | 'heroic' | 'mythic';

export interface BreathDifficultyRules {
  /** The blow's speed (yards a second; a run is 7, so a walker against it
   *  still makes headway). Heroic's wind is the harder one (Jose's playtest:
   *  normal stays as it was, heroic and mythic push noticeably harder). */
  windSpeed: number;
  /** The exhale (Bellows Gust) throws everyone this far outward (yards). */
  gustThrow: number;
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** The boss's health pool against the template's, set at the pull
   *  (tier_health.ts). */
  healthMult: number;
  /** An anchor that ran out leaves its player spent (no circle for a while). */
  calmSpent: boolean;
  /** Loose gales wander the Cornice after each indrawn breath. */
  looseGales: boolean;
  /** Short gusts return in phase 2. */
  stormGusts: boolean;
  /** The Thunder's Cradle: how many players it traps at once (the
   *  marked one, then the rest: the raid splits to share each), how many
   *  each circle wants under it, and each one's discharge. */
  cradleCount: number;
  cradleSoakers: number;
  cradleTotal: number;
  /** The swelling storm (phase 2's soft enrage): each pulse this much
   *  louder than the first, without end. Half as steep on Heroic and Mythic
   *  (the balance pass of 2026-11-12), so it kills past the 6 to 7 minute
   *  target, not before it. */
  swellGrowth: number;
  /** The Islands of the Wind (breath_isles.ts): the health fractions the
   *  guardian raises its Gale Bulwark at, how many isles each round wakes. */
  isleAt: readonly number[];
  isleCount: number;
  /** Windworn: a body that rode home may not ride again for this long (0:
   *  never worn: the same group may go again). */
  windwornSeconds: number;
  /** The Knotted Gale (breath_heart.ts): its balls, portals and carriers, or
   *  null for a tier without it (Normal). */
  stormHeart: BreathKnotRules | null;
}

/** One tier's Knotted Gale (Jose's calls of 2026-11-07 and 2026-11-08). No
 *  rule gates the throw on a portal: a carrier may walk the ball to any lip,
 *  the portals are the shortcut. */
export interface BreathKnotRules {
  /** A ball's fuse (seconds); the portals open `BREATH_TUNING.heartMark`
   *  into it on every tier. */
  fuse: number;
  /** The carrier's walk against a run, and with the wind at their back
   *  (`BREATH_TUNING.heartTailCone`): above the walk, never below it. */
  walkMult: number;
  tailMult: number;
  /** Phase 1: at most this many balls, one at a time, about every
   *  `BREATH_TUNING.heartEvery` seconds. */
  windRuns: number;
  /** Phase 2: the balls of each round, each with its own pair of portals
   *  (two: A and B, then C and D). */
  stormBalls: 1 | 2;
}

/** The Knotted Gale's numbers, one row per tier that has it (Normal has none).
 *  The tail walk sits 0.15 above the walk on both, as Mythic's always has. */
export const BREATH_KNOT: Readonly<Record<'heroic' | 'mythic', BreathKnotRules>> = {
  // Softer than Mythic's (Jose's call of 2026-11-08): a longer fuse, a quicker
  // carrier, two balls in phase 1, one ball and one pair of portals in phase 2.
  heroic: { fuse: 15, walkMult: 0.7, tailMult: 0.85, windRuns: 2, stormBalls: 1 },
  // Jose's call of 2026-11-07: half a run and a 10 s fuse (a tenth of a run
  // read as standing still); three balls in phase 1, two at once in phase 2.
  mythic: { fuse: 10, walkMult: 0.5, tailMult: 0.65, windRuns: 3, stormBalls: 2 },
};

export const BREATH_DIFFICULTY: Readonly<Record<BreathDifficulty, BreathDifficultyRules>> = {
  normal: {
    windSpeed: 3.2,
    gustThrow: 26,
    damageMult: 1,
    healthMult: 1,
    calmSpent: false,
    looseGales: false,
    stormGusts: false,
    cradleCount: 1,
    cradleSoakers: 4,
    cradleTotal: 2600,
    swellGrowth: 0.08,
    isleAt: [0.7],
    isleCount: 1,
    windwornSeconds: 0,
    stormHeart: null,
  },
  heroic: {
    windSpeed: 4.4,
    gustThrow: 30,
    damageMult: 1.25,
    healthMult: 1.65,
    calmSpent: true,
    looseGales: true,
    stormGusts: true,
    cradleCount: 3,
    cradleSoakers: 3,
    cradleTotal: 1900,
    swellGrowth: 0.04,
    isleAt: [0.8, 0.6],
    isleCount: 2,
    windwornSeconds: 0,
    stormHeart: BREATH_KNOT.heroic,
  },
  // Heroic whole (the circle rule included), with its own harder Knotted
  // Gale and Windworn (one ride per player per round of isles: two groups).
  mythic: {
    windSpeed: 4.4,
    gustThrow: 30,
    damageMult: 1.25,
    healthMult: 1.65,
    calmSpent: true,
    looseGales: true,
    stormGusts: true,
    cradleCount: 3,
    cradleSoakers: 3,
    cradleTotal: 1900,
    swellGrowth: 0.04,
    isleAt: [0.8, 0.6],
    isleCount: 2,
    windwornSeconds: 150,
    stormHeart: BREATH_KNOT.mythic,
  },
};

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const BREATH_TUNING = {
  // The wind (phase 1).
  /** Seconds from the pull to the first blow's telegraph. */
  firstGather: 3,
  /** The telegraph before each blow: the coming wind drawn on the floor. */
  gatherSeconds: 2.5,
  blowSeconds: 10,
  /** The calm after a blow (its telegraph included): 5 s at full health,
   *  shortening to 3 s at half (calmSeconds). */
  calmMax: 5,
  calmMin: 3,
  /** Pressed against the rim's wall: a hit each second. */
  pinTick: 1,
  pinMin: 90,
  pinMax: 110,
  /** How far downwind of a body the wall must stand to pin it (yards). */
  pinReach: 1.3,
  // Captain Thessaly's circle of calm (phase 1 only).
  circleFirst: 9,
  circleEvery: 20,
  /** Its telegraph (where it will land), then how long it holds. */
  circleLand: 2,
  circleHold: 6,
  circleR: 3.5,
  /** At most this many take its anchor. */
  circleSeats: 3,
  /** How far upwind of the guardian it lands when no hashed spot fits (yards). */
  circleReach: 12,
  /** The hashed spots: these reaches upwind, these offsets sideways (yards),
   *  each circle at least `circleApart` from the one before (Jose's playtest:
   *  one fixed reach put every circle in the same place). */
  circleReaches: [8, 14, 20, 26] as readonly number[],
  circleSides: [-14, -7, 0, 7, 14] as readonly number[],
  circleApart: 12,
  anchorSeconds: 15,
  /** Heroic: no circle anchors the same player again for this long. */
  spentSeconds: 60,
  // The indrawn breath and the exhale (Bellows Gust).
  inhaleFirst: 38,
  inhaleEvery: 45,
  inhaleCast: 5,
  /** The pull toward the guardian (a run is 7: walking away barely holds). */
  pullSpeed: 5.5,
  /** The vortex: this far before the mouth, this wide, this often. */
  vortexAhead: 7,
  vortexR: 4.5,
  vortexTick: 0.5,
  vortexMin: 90,
  vortexMax: 110,
  gustCast: 1.5,
  gustMin: 160,
  gustMax: 200,
  /** The Summit Roar's wave: how fast its front races out over the Cornice
   *  (yards a second; the whole Cornice in about three seconds, so every
   *  client sees it travel and reach each body in turn), and how long a
   *  struck body takes to slide its throw (seconds: seen flying, never a
   *  blink; eased like a blow, breath_shove.ts 'knock': 0.8 s linear until
   *  2026-11-07, 1 s now so the settle reads). */
  roarSpeed: 30,
  roarSlide: 1,
  // Heroic: the loose gales after each indrawn breath.
  galeCount: 3,
  galeSeconds: 20,
  galeR: 2.2,
  galeMin: 120,
  galeMax: 150,
  galeThrow: 11,
  /** How long a toss slides its throw (seconds, eased out: a shove that
   *  starts fast and settles, never a blink). */
  galeSlide: 0.6,
  /** One toss per player per gale in this many seconds. */
  galeEvery: 2,
  // At half health: the storm breaks.
  stormAt: 0.5,
  stormCast: 4,
  /** The barrage of strikes after it tears open. */
  barrageSeconds: 10,
  barrageEvery: 0.8,
  barrageSpots: 2,
  strikeWarn: 1.6,
  strikeR: 3.5,
  strikeMin: 320,
  strikeMax: 380,
  // Phase 2: the Leaping Bolt.
  forkFirst: 6,
  forkEvery: 22,
  forkCast: 2.5,
  /** It jumps to the nearest player within this (yards), again and again. */
  forkJump: 8,
  forkMaxHops: 9,
  forkMin: 240,
  forkMax: 280,
  // Phase 2: the Thunder's Cradle.
  cradleFirst: 16,
  cradleEvery: 40,
  cradleCast: 1.5,
  /** The lifted players hang this long (the guardian CHANNELS it: nothing
   *  else is cast meanwhile), this high, over gather circles of this radius;
   *  then each discharge splits between everyone under it (each tier's
   *  whole: BREATH_DIFFICULTY cradleTotal). */
  cradleHold: 6,
  cradleLift: 5,
  cradleR: 6,
  /** Short of the difficulty's soakers: each share this much heavier, and
   *  the whole Cornice takes the backlash. */
  cradlePenaltyMult: 1.6,
  backlashMin: 180,
  backlashMax: 220,
  // Phase 2: Drawn Lightning (the marked conductor).
  drawnFirst: 26,
  drawnEvery: 30,
  drawnCast: 1,
  drawnSeconds: 10,
  /** A strike at the conductor's feet every this often, on this warning. */
  drawnStrikeEvery: 2,
  drawnWarn: 1.2,
  drawnR: 3,
  drawnMin: 280,
  drawnMax: 320,
  /** The charged ground each strike leaves. */
  chargedSeconds: 18,
  chargedR: 3,
  chargedTick: 1,
  chargedMin: 60,
  chargedMax: 75,
  // Phase 2: the swelling storm (the soft enrage).
  swellEvery: 5,
  swellMin: 35,
  swellMax: 42,
  // Each pulse's growth is its difficulty row's (swellGrowth).
  // Heroic phase 2: the short gusts.
  gustFirst: 12,
  gustEvery: 24,
  gustGather: 2,
  gustSeconds: 3.5,
  /** Seconds of plain melee after a bar lands before the next begins. */
  barGap: 1.2,
  /** How far below the Cornice a fallen body is dead for sure (yards). */
  voidDepth: 25,
  // Heroic and Mythic: the Knotted Gale (breath_heart.ts). The numbers that
  // differ by tier (the fuse, the walk, how many balls) are the tier row's
  // (BreathDifficultyRules.stormHeart); these are shared.
  /** How long the marks run before their portals open. */
  heartMark: 5,
  /** Phase 1: the first ball, then this often; a start waits out the indrawn
   *  breath and any time too short for a whole fuse before it. */
  heartFirst: 12,
  heartEvery: 45,
  /** Phase 2: seconds after the barrage, then this often. */
  heartStormFirst: 15,
  heartStormEvery: 60,
  /** How near a ball a player takes it up, and a portal's mouth (yards). */
  heartPickR: 2.5,
  heartPortalR: 2.5,
  /** How far from a gap's edge the lip still counts for the throw, and for a
   *  carrier going over it to count as thrown (yards). Jose's playtest: 4 let
   *  the throw land from well back on the floor; the carrier must stand right
   *  at the lip. */
  heartLipReach: 2,
  /** A ball drops at least this far from every gap, and this far from the
   *  round's other ball, the last round's balls and Thessaly's circle, both
   *  relaxed step by step if the floor cannot give it. 26 left one patch, by
   *  Thessaly's post, so every ball fell there (Jose's playtest); 16 opens the
   *  middle of the Cornice too and still asks a 12 yd crawl. */
  heartFar: 16,
  heartApart: 20,
  /** The cone (degrees) round the wind's bearing a carrier faces to walk at
   *  the tier's `tailMult`: the load rides the wind a little. */
  heartTailCone: 60,
} as const;

// ---- pure helpers ---------------------------------------------------------------------

/** The calm after a blow at `hpFrac` health (5 s at full, 3 s at half). */
export function calmSeconds(hpFrac: number): number {
  const T = BREATH_TUNING;
  const k = Math.max(0, Math.min(1, (hpFrac - T.stormAt) / (1 - T.stormAt)));
  return T.calmMin + (T.calmMax - T.calmMin) * k;
}

/** The bearings the blows aim at, in the order they turn (compass degrees,
 *  clockwise from north: where the wind blows TOWARD). Each pair a wide turn
 *  apart; four point at a gap's throat, two at a walled stretch. */
export const BLOW_BEARINGS: readonly number[] = [182, 22, 300, 128, 332, 75];

/** The `k`-th blow's bearing of a pull that began on `start`. Pure. */
export function blowBearing(start: number, k: number): number {
  const n = BLOW_BEARINGS.length;
  return BLOW_BEARINGS[(((start + k) % n) + n) % n];
}

/** The swelling storm's multiplier on its `pulse`-th pulse (0 the first),
 *  each pulse `growth` (the tier's swellGrowth) louder than the first. */
export function swellMult(pulse: number, growth: number): number {
  return 1 + growth * Math.max(0, pulse);
}

/** How each soaker of the Thunder's Cradle fares: the share each takes and
 *  whether the backlash rolls over the Cornice. */
export function cradleShare(
  soakers: number,
  need: number,
  total: number = BREATH_DIFFICULTY.normal.cradleTotal,
): { each: number; backlash: boolean } {
  const n = Math.max(1, soakers);
  const short = n < need;
  return {
    each: Math.round((total / n) * (short ? BREATH_TUNING.cradlePenaltyMult : 1)),
    backlash: short,
  };
}

/** The leaping bolt's path: from the first struck, each next the nearest
 *  player not yet struck within `jump` of the last (ties: the lower id), up
 *  to `maxHops` jumps. Pure over positions. */
export function forkPath<P extends { id: number; pos: { x: number; z: number } }>(
  first: P,
  players: readonly P[],
  jump: number = BREATH_TUNING.forkJump,
  maxHops: number = BREATH_TUNING.forkMaxHops,
): P[] {
  const out: P[] = [first];
  const hit = new Set<number>([first.id]);
  let at = first;
  for (let hop = 0; hop < maxHops; hop++) {
    let best: P | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of players) {
      if (hit.has(p.id)) continue;
      const d = Math.hypot(p.pos.x - at.pos.x, p.pos.z - at.pos.z);
      if (d > jump + 1e-9) continue;
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && best !== null && p.id < best.id)) {
        best = p;
        bestD = d;
      }
    }
    if (!best) break;
    out.push(best);
    hit.add(best.id);
    at = best;
  }
  return out;
}

// ---- object templates (pure) ----------------------------------------------------------

/** The wind's phases as the object carries them. */
export type BreathWindPhase =
  | 'still'
  | 'gather'
  | 'blow'
  | 'calm'
  | 'inhale'
  | 'exhale'
  | 'break'
  | 'storm'
  | 'gustgather'
  | 'gust';

const WIND_PHASES: readonly BreathWindPhase[] = [
  'still',
  'gather',
  'blow',
  'calm',
  'inhale',
  'exhale',
  'break',
  'storm',
  'gustgather',
  'gust',
];

const tenthsOf = (seconds: number): number => Math.max(0, Math.round(seconds * 10));

/** The wind object's template: its phase, the bearing it blows toward
 *  (whole degrees, 0 to 359) and the phase's length (so every client fills
 *  its telegraph to the very tick it turns). */
export function breathWindTemplate(
  phase: BreathWindPhase,
  bearingDeg: number,
  seconds: number,
): string {
  const deg = ((Math.round(bearingDeg) % 360) + 360) % 360;
  return `${BREATH_OBJECTS.windPrefix}${phase}_${deg}_${tenthsOf(seconds)}`;
}

/** The wind object template's phase, bearing and length, or null. */
export function breathWindOf(
  templateId: string,
): { phase: BreathWindPhase; bearingDeg: number; seconds: number } | null {
  if (!templateId.startsWith(BREATH_OBJECTS.windPrefix)) return null;
  const [phase, deg, tenths] = templateId.slice(BREATH_OBJECTS.windPrefix.length).split('_');
  if (!WIND_PHASES.includes(phase as BreathWindPhase)) return null;
  const d = Number(deg);
  const t = Number(tenths);
  if (!Number.isInteger(d) || d < 0 || d > 359 || !Number.isInteger(t) || t < 0) return null;
  return { phase: phase as BreathWindPhase, bearingDeg: d, seconds: t / 10 };
}

/** Thessaly's circle's states: landing (its telegraph), holding (anchors
 *  free), spent (every seat taken, or its hold run out). */
export type BreathCalmState = 'land' | 'hold' | 'spent';

/** The circle's template: its state and that state's length. */
export function calmTemplate(state: BreathCalmState, seconds: number): string {
  return `${BREATH_OBJECTS.calmPrefix}${state}_${tenthsOf(seconds)}`;
}

/** The circle template's state and length, or null. */
export function calmOf(templateId: string): { state: BreathCalmState; seconds: number } | null {
  if (!templateId.startsWith(BREATH_OBJECTS.calmPrefix)) return null;
  const [state, tenths] = templateId.slice(BREATH_OBJECTS.calmPrefix.length).split('_');
  if (state !== 'land' && state !== 'hold' && state !== 'spent') return null;
  const t = Number(tenths);
  return Number.isInteger(t) && t >= 0 ? { state, seconds: t / 10 } : null;
}

/** A Knotted Gale's template: on the floor or carried, and its fuse left. */
export function knotTemplate(state: 'free' | 'held', fuse: number, full: number): string {
  return `${BREATH_OBJECTS.knotPrefix}${state}_${tenthsOf(fuse)}_${tenthsOf(full)}`;
}

/** A Knotted Gale template's state, fuse left and whole fuse, or null. */
export function knotOf(
  templateId: string,
): { state: 'free' | 'held'; fuse: number; full: number } | null {
  if (!templateId.startsWith(BREATH_OBJECTS.knotPrefix)) return null;
  const [state, tenths, whole] = templateId.slice(BREATH_OBJECTS.knotPrefix.length).split('_');
  if (state !== 'free' && state !== 'held') return null;
  const t = Number(tenths);
  const w = Number(whole);
  if (!Number.isInteger(t) || t < 0 || !Number.isInteger(w) || w <= 0) return null;
  return { state, fuse: t / 10, full: w / 10 };
}

/** A timed spot's template (a strike's warning, charged ground's life, the
 *  cradle's hold): `<prefix><tenths>`. */
export function timedTemplate(prefix: string, seconds: number): string {
  return `${prefix}${tenthsOf(seconds)}`;
}

/** A timed spot template's seconds, or null when it is not of `prefix`. */
export function timedOf(prefix: string, templateId: string): number | null {
  if (!templateId.startsWith(prefix)) return null;
  const t = Number(templateId.slice(prefix.length));
  return Number.isInteger(t) && t >= 0 ? t / 10 : null;
}
