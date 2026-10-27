// The Hammer Council's leaf (docs/design/raid/smith_heart.md section 7.1):
// every id the council's sim, its renderer, its HUD alert, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of the pillars. No SimContext, no rng.
//
// EVERY number here is a SKETCH, unmeasured (the design doc's 7.1 table says
// so too): anchored to the Hammer guardian's old kit (level 20 elite, ten
// players) and the level-20 cloth reference, to be calibrated with the meters
// harness before the raid ships.

/** The three stone beings of the council (template ids; the Guardian's is
 *  the shipped, frozen one, content/smith_heart.ts SMITH_HEART_GUARDIANS). A
 *  leaf: the content imports these, never the other way. */
export const COUNCIL_GUARDIAN = 'heart_hammer_guardian';
export const COUNCIL_SLABWRIGHT = 'heart_slabwright';
export const COUNCIL_SEAM_SINGER = 'heart_seam_singer';

/** A council member's role (its original job). */
export type CouncilRole = 'guardian' | 'slabwright' | 'singer';
/** The three council jobs: the Guardian's energy and Wrath, the
 *  Slabwright's pillars, the Seam Singer's Resonance. */
export type CouncilJob = 'wrath' | 'pillars' | 'resonance';

/** The roles in roster order (the council's own iteration order). */
export const COUNCIL_ROLES: readonly CouncilRole[] = ['guardian', 'slabwright', 'singer'];

export const COUNCIL_TEMPLATES: Readonly<Record<CouncilRole, string>> = {
  guardian: COUNCIL_GUARDIAN,
  slabwright: COUNCIL_SLABWRIGHT,
  singer: COUNCIL_SEAM_SINGER,
};

/** Every council template id (the gate, the seal and the tests wait on all). */
export const COUNCIL_TEMPLATE_IDS: readonly string[] = COUNCIL_ROLES.map(
  (r) => COUNCIL_TEMPLATES[r],
);

/** The role whose own job each is. */
export const JOB_OWNER: Readonly<Record<CouncilJob, CouncilRole>> = {
  wrath: 'guardian',
  pillars: 'slabwright',
  resonance: 'singer',
};

/** Who takes up a fallen member's job: the first survivor in this order. */
export const JOB_HEIRS: Readonly<Record<CouncilJob, readonly CouncilRole[]>> = {
  wrath: ['slabwright', 'singer'],
  pillars: ['guardian', 'singer'],
  resonance: ['guardian', 'slabwright'],
};

/** The role a template plays in the council, or null. Pure. */
export function councilRoleOf(templateId: string): CouncilRole | null {
  for (const r of COUNCIL_ROLES) if (COUNCIL_TEMPLATES[r] === templateId) return r;
  return null;
}

// ---- casts, auras, objects, cues --------------------------------------------------

/** The cast bars (and the damage names they carry). */
export const COUNCIL_CASTS = {
  /** The Guardian's (and its heir's) line-of-sight blast at full energy. The
   *  shipped id is kept. */
  wrath: 'heart_mountains_wrath',
  /** The tank buster. */
  weight: 'heart_hammers_weight',
  /** The Slabwright marks the players a pillar will rise under. */
  wake: 'heart_wake_the_stone',
  /** The Slabwright marks the player the rock falls on. */
  rock: 'heart_falling_rock',
  /** The Seam Singer's kickable bolt. */
  bolt: 'heart_seam_bolt',
  /** The Seam Singer's kickable song (Resonance on three, one if kicked). */
  song: 'heart_song_of_the_seam',
  /** The same song sung by an heir: no kick table lists it. */
  songUnbroken: 'heart_song_of_the_seam_unbroken',
  /** Mythic: the Guardian's soul in a pillar casts its own Wrath (the
   *  pillar's own bar, never kicked). */
  echo: 'heart_echo_of_wrath',
  /** Mythic: the Seam Singer's soul pillar's clock between two pulses of the
   *  Endless Song (the pillar's own bar, never kicked). */
  endlessSong: 'heart_endless_song',
} as const;

/** The interruptible ones (spread into mob/healer_channel.ts
 *  SCRIPTED_INTERRUPTIBLE_CHANNELS). Wrath, Weight, Wake, Rock and the heir's
 *  song are never kicked. */
export const COUNCIL_KICK_SCHOOLS: Readonly<Record<string, { school: 'nature' }>> = {
  [COUNCIL_CASTS.bolt]: { school: 'nature' },
  [COUNCIL_CASTS.song]: { school: 'nature' },
};

/** The auras the council puts on players and on itself. */
export const COUNCIL_AURAS = {
  /** +100 percent physical damage taken (the tank swap). */
  weight: 'heart_hammers_weight',
  /** A pillar rises under this player when it runs out (they choose where). */
  wakeMark: 'heart_wake_mark',
  /** The rock falls on this player when it runs out: share it. */
  rockMark: 'heart_falling_rock_mark',
  /** A pillar this player stands near for 3 s loses a piece. value = the
   *  share of those 3 s already stood (tenths), value2 = the pillar's id. */
  resonance: 'heart_resonance',
  /** On a council member: one stack per fallen member, more damage dealt. */
  memory: 'heart_memory_of_stone',
  /** Mythic: on the Seam Singer's soul pillar, one stack per pulse the
   *  Endless Song has sung (value = the next pulse's multiplier). The
   *  pillar is an object: the sim never ticks it, the council sets it. */
  endlessSong: 'heart_endless_song',
} as const;

/** The council's encounter object templates. Pillars carry their integrity
 *  (a carved column 2 then 1, a risen pillar 1: councilPillarFull) and stand as combat walls
 *  (instances/combat_wall_state.ts COMBAT_WALL_SHAPES). */
export const COUNCIL_PILLAR_PREFIX = 'sh_council_pillar_';
export const COUNCIL_RISEN_PREFIX = 'sh_council_risen_';
/** The rubble a fallen pillar leaves (scale = its radius). */
export const COUNCIL_RUBBLE = 'sh_council_rubble';
/** An heir's rising pillar: the 2 s spot locked under a random player
 *  (scale = the knockback radius). */
export const COUNCIL_RISE_SPOT = 'sh_council_rise_spot';

/** A rise spot's template for a warning of `seconds`: the plain id at the
 *  shipped 2 s (normal and heroic keep it), else `<id>_<tenths>` (mythic's
 *  1.5 s), so the client fills the warning to the very moment it rises. */
export function councilRiseSpotTemplate(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  return tenths === 20 ? COUNCIL_RISE_SPOT : `${COUNCIL_RISE_SPOT}_${tenths}`;
}

/** A rise spot template's warning in seconds, or null when it is none. */
export function councilRiseSpotSeconds(templateId: string): number | null {
  if (templateId === COUNCIL_RISE_SPOT) return 2;
  if (!templateId.startsWith(`${COUNCIL_RISE_SPOT}_`)) return null;
  const n = Number(templateId.slice(COUNCIL_RISE_SPOT.length + 1));
  return Number.isInteger(n) && n > 0 ? n / 10 : null;
}
/** Mythic: a pillar holding a fallen member's soul (Soul in the Stone):
 *  `sh_council_soul_<role>_<c|r>_<pips>` (c a carved column, r a risen
 *  pillar), a combat wall like the others. */
export const COUNCIL_SOUL_PREFIX = 'sh_council_soul_';

/** The spellfx ability ids of the council's moments (the renderer keys them). */
export const COUNCIL_CUES = {
  /** A pillar bursts out of the floor (spellfx 'nova' on the pillar). */
  rise: 'heart_council_pillar_rise',
  /** A pillar loses a piece (spellfx 'nova' on the pillar). */
  crack: 'heart_council_pillar_crack',
  /** A pillar falls (spellfxAt 'burst' where it stood, radius = its rubble). */
  collapse: 'heart_council_pillar_collapse',
  /** The rock lands (spellfxAt 'burst', radius = the soak). */
  rockImpact: 'heart_falling_rock_impact',
  /** The heroic pillars' pulse (spellfx 'nova' on each standing pillar). */
  pulse: 'heart_council_pillar_pulse',
  /** The stone remembers: light from the fallen to each survivor (spellfx
   *  'beam', source the fallen, target the survivor). */
  inherit: 'heart_council_inherit',
  /** The council settles after its fall: the risen pillars sink. */
  settle: 'heart_council_settle',
  /** Mythic: a fallen member's soul flows into its pillar (spellfx 'beam',
   *  source the fallen, target the pillar). */
  soulTake: 'heart_council_soul_take',
  /** Mythic: a soul pip is struck off (spellfx 'nova' on the pillar). */
  soulPip: 'heart_council_soul_pip',
  /** Mythic: a soul pillar bursts and its soul is gone (spellfxAt 'burst'
   *  where it stood, just before the pillar's own collapse). */
  soulBurst: 'heart_council_soul_burst',
  /** Mythic: the Echo of Wrath lands (spellfx 'nova' on the pillar). */
  echoBlast: 'heart_echo_of_wrath_blast',
  /** Mythic: the Endless Song pulses (spellfx 'nova' on the pillar). */
  songPulse: 'heart_endless_song_pulse',
  /** Mythic: the Walking Slab crushes a player under it (spellfx 'nova'
   *  from the pillar on the player). */
  slabCrush: 'heart_walking_slab_crush',
} as const;

/** The damage names (combat log and floating text; re-localized by
 *  src/ui/sim_i18n.ts through the mechanic reverse map). */
export const COUNCIL_NAMES = {
  wrath: "Mountain's Wrath",
  weight: "Hammer's Weight",
  wake: 'Wake the Stone',
  rock: 'Falling Rock',
  rockTremor: 'Rockfall Tremor',
  bolt: 'Seam Bolt',
  song: 'Song of the Seam',
  resonance: 'Resonance',
  memory: 'Memory of Stone',
  rubble: 'Crumbled Stone',
  pulse: 'Restless Stone',
  echo: 'Echo of Wrath',
  slab: 'Walking Slab',
  grind: 'Stone Drag',
  endlessSong: 'Endless Song',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The council's difficulty. Each tier is one COUNCIL_DIFFICULTY row (the
 *  mythic is a prototype behind a dev switch while the game has no mythic
 *  tier: council.ts setCouncilDevTier); nothing else switches on the tier by
 *  name. */
export type CouncilDifficulty = 'normal' | 'heroic' | 'mythic';

export interface CouncilDifficultyRules {
  /** How many players Wake the Stone marks (and the heir's random rise). */
  wakeMarks: number;
  /** The song waits for a Wrath to land and its Resonance runs out before
   *  the next one (normal); false: the song keeps its own clock and the two
   *  overlap (heroic). */
  songAfterWrath: boolean;
  /** Every standing pillar pulses on whoever stands close. */
  pillarPulse: boolean;
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** The heir's random rise: seconds of warning on its locked spot. */
  heirRiseWarn: number;
  /** The heir's unbroken song: how many players it rings on. */
  heirSongMarks: number;
  /** The Wrath's heir: seconds its energy takes to fill. */
  heirFillSeconds: number;
  /** A survivor keeps casting Falling Rock once the Slabwright has fallen
   *  (mythic: the rock and Resonance are the only things that break a soul
   *  pillar, so a living member always supplies both). */
  rockOutlivesSlabwright: boolean;
  /** Soul in the Stone: a fallen member's soul takes a pillar
   *  (council_soul.ts). */
  soulInTheStone: boolean;
}

export const COUNCIL_DIFFICULTY: Readonly<Record<CouncilDifficulty, CouncilDifficultyRules>> = {
  normal: {
    wakeMarks: 1,
    songAfterWrath: true,
    pillarPulse: false,
    damageMult: 1,
    heirRiseWarn: 2,
    heirSongMarks: 3,
    heirFillSeconds: 35,
    rockOutlivesSlabwright: false,
    soulInTheStone: false,
  },
  heroic: {
    wakeMarks: 2,
    songAfterWrath: false,
    pillarPulse: true,
    damageMult: 1.25,
    heirRiseWarn: 2,
    heirSongMarks: 3,
    heirFillSeconds: 35,
    rockOutlivesSlabwright: false,
    soulInTheStone: false,
  },
  // Everything heroic has, the inheritances stronger, and the souls.
  mythic: {
    wakeMarks: 2,
    songAfterWrath: false,
    pillarPulse: true,
    damageMult: 1.25,
    heirRiseWarn: 1.5,
    heirSongMarks: 4,
    heirFillSeconds: 30,
    rockOutlivesSlabwright: true,
    soulInTheStone: true,
  },
};

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const COUNCIL_TUNING = {
  // The pillars.
  pillarCap: 7,
  /** The most integrity any pillar template carries. */
  integrity: 3,
  /** A carved column takes two blows; a risen pillar is one use (Jose's
   *  playtest: risen cover is spent first, the columns saved for the end). */
  columnIntegrity: 2,
  risenIntegrity: 1,
  /** A carved column's radius and a risen pillar's (the combat wall rows). */
  columnR: 2.6,
  risenR: 2.2,
  /** Rubble: its radius past the pillar's, how long it lies, its bite. */
  rubblePad: 1.6,
  rubbleSeconds: 8,
  rubbleTick: 1,
  rubbleMin: 90,
  rubbleMax: 110,
  // The Guardian: energy and Mountain's Wrath.
  energyMax: 100,
  energyFillSeconds: 55,
  /** After this many Wraths the energy fills much faster (the soft enrage). */
  enrageAfterWraths: 4,
  enrageFillMult: 2.5,
  wrathCast: 4,
  wrathRadius: 45,
  wrathMin: 440,
  wrathMax: 520,
  /** The heir's shorter Wrath. */
  heirFillSeconds: 35,
  heirWrathCast: 3,
  heirWrathMin: 380,
  heirWrathMax: 450,
  // Hammer's Weight.
  weightFirst: 10,
  weightEvery: 18,
  weightCast: 1.5,
  weightMult: 2.2,
  weightSeconds: 25,
  /** Physical damage taken while it holds (+100 percent). */
  weightTaken: 1,
  // Wake the Stone.
  wakeFirst: 14,
  wakeEvery: 30,
  wakeCast: 1.2,
  wakeMarkSeconds: 5,
  /** The heir's rise: random players, the spot locked, this warning. */
  heirRiseWarn: 2,
  riseKnockRadius: 3,
  riseKnockback: 7,
  riseMin: 120,
  riseMax: 150,
  /** A rising pillar keeps this far (centre to centre) from another, from a
   *  council member, and inside the pit's floor. */
  riseGap: 6.5,
  riseClearOfBodies: 4.5,
  // Falling Rock.
  rockFirst: 9,
  rockEvery: 25,
  rockCast: 1.2,
  rockMarkSeconds: 5,
  rockRadius: 6,
  /** The whole blow, split between everyone under it. */
  rockTotal: 1350,
  /** Fewer soakers than this: each takes half as much again, and the whole
   *  raid takes the tremor. */
  rockMinSoakers: 3,
  rockPenaltyMult: 1.5,
  rockTremorMin: 140,
  rockTremorMax: 170,
  // Seam Bolt.
  boltFirst: 4,
  boltEvery: 8,
  boltCast: 2,
  boltRange: 40,
  boltMin: 300,
  boltMax: 340,
  /** Seconds the Singer stays silent after a kick. */
  kickQuiet: 2,
  // Song of the Seam and Resonance.
  songCast: 3,
  /** Normal: the song starts this long after a Wrath lands. */
  songAfterWrath: 1,
  /** Normal: an owed song this late after its moment is dropped. */
  songLateDrop: 4,
  /** Heroic: the song's own clock. */
  songFirst: 20,
  songEvery: 24,
  songMarks: 3,
  songKickedMarks: 1,
  resonanceSeconds: 15,
  /** A marked player within this of a pillar's face is cracking it. */
  resonanceReach: 3.5,
  resonanceCrackSeconds: 3,
  // The stone remembers.
  memoryPerFallen: 0.15,
  // Heroic: the pillars pulse.
  pulseEvery: 2,
  pulseReach: 3,
  pulseMin: 60,
  pulseMax: 75,
  /** Seconds of plain melee after a bar lands before the same body starts
   *  another (nothing chains bar into bar). */
  barGap: 1.2,
  // Mythic: Soul in the Stone (council_soul.ts).
  /** A soul pillar's pips. */
  soulPips: 3,
  /** A Falling Rock landing within this of its face strikes a pip off. */
  soulRockReach: 6,
  /** A Resonance-marked player this close to its face for this long strikes
   *  a pip off (the Seam Singer's soul: twice as fast). */
  soulResonanceReach: 3.5,
  soulResonanceSeconds: 3,
  singerSoulResonanceSeconds: 1.5,
  // The Guardian's soul: Echo of Wrath.
  echoFirst: 12,
  echoEvery: 20,
  echoCast: 3,
  echoRadius: 45,
  /** A share of Mountain's Wrath's own roll. */
  echoShare: 0.6,
  // The Slabwright's soul: the Walking Slab.
  slabSpeed: 1.5,
  /** Seconds between two picks of the largest group. */
  slabRetarget: 3,
  /** A player within this of another counts toward its group. */
  slabGroupR: 8,
  /** It stops this far (centre) from the spot it walks to. */
  slabArrive: 1,
  /** It keeps this far past its own face from a living council body. */
  slabClearOfBodies: 1.6,
  /** Under it (this far past its face): a heavy hit and a throw, once per
   *  player in this many seconds. */
  slabCrushReach: 1.5,
  slabCrushMin: 380,
  slabCrushMax: 440,
  slabCrushKnockback: 9,
  slabCrushEvery: 1.5,
  /** Near it (this far past its face): light damage each second. */
  slabGrindReach: 4,
  slabGrindMin: 70,
  slabGrindMax: 85,
  slabGrindEvery: 1,
  // The Seam Singer's soul: the Endless Song.
  songPulseFirst: 3,
  songPulseEvery: 3,
  songPulseMin: 45,
  songPulseMax: 55,
  /** Each pulse sings this much louder than the first, up to the cap. */
  songPulseGrowth: 0.12,
  songPulseCap: 4,
} as const;

// ---- pillar templates (pure) --------------------------------------------------------

/** A fresh pillar's integrity: a carved column's or a risen one's. */
export function councilPillarFull(risen: boolean): number {
  return risen ? COUNCIL_TUNING.risenIntegrity : COUNCIL_TUNING.columnIntegrity;
}

/** A pillar's template: carved column or risen, with its integrity left. */
export function councilPillarTemplate(integrity: number, risen: boolean): string {
  const n = Math.max(1, Math.min(COUNCIL_TUNING.integrity, Math.round(integrity)));
  return `${risen ? COUNCIL_RISEN_PREFIX : COUNCIL_PILLAR_PREFIX}${n}`;
}

/** A pillar template's integrity and kind, or null when `templateId` is no
 *  pillar. Pure (the renderer reads the mirrored entity through it). */
export function councilPillarOf(templateId: string): { integrity: number; risen: boolean } | null {
  const risen = templateId.startsWith(COUNCIL_RISEN_PREFIX);
  if (!risen && !templateId.startsWith(COUNCIL_PILLAR_PREFIX)) return null;
  const n = Number(templateId.slice((risen ? COUNCIL_RISEN_PREFIX : COUNCIL_PILLAR_PREFIX).length));
  if (!Number.isInteger(n) || n < 1 || n > COUNCIL_TUNING.integrity) return null;
  return { integrity: n, risen };
}

/** A pillar's footprint radius by kind. */
export function councilPillarRadius(risen: boolean): number {
  return risen ? COUNCIL_TUNING.risenR : COUNCIL_TUNING.columnR;
}

/** Seconds the Wrath's energy takes to fill, by holder and Wraths landed
 *  (`heirSeconds`: the difficulty's heir fill, COUNCIL_DIFFICULTY). */
export function councilFillSeconds(
  heir: boolean,
  wraths: number,
  heirSeconds: number = COUNCIL_TUNING.heirFillSeconds,
): number {
  const base = heir ? heirSeconds : COUNCIL_TUNING.energyFillSeconds;
  return wraths >= COUNCIL_TUNING.enrageAfterWraths ? base / COUNCIL_TUNING.enrageFillMult : base;
}

/** How each soaker of a Falling Rock fares (pure): the share each takes and
 *  whether the tremor rolls over the raid. */
export function fallingRockShare(
  soakers: number,
  total: number,
): { each: number; tremor: boolean } {
  const n = Math.max(1, soakers);
  const short = n < COUNCIL_TUNING.rockMinSoakers;
  return {
    each: Math.round((total / n) * (short ? COUNCIL_TUNING.rockPenaltyMult : 1)),
    tremor: short,
  };
}

// ---- soul pillars (pure) -------------------------------------------------------------

/** A soul pillar's template: whose soul, carved column or risen, pips left. */
export function councilSoulTemplate(role: CouncilRole, risen: boolean, pips: number): string {
  const n = Math.max(1, Math.min(COUNCIL_TUNING.soulPips, Math.round(pips)));
  return `${COUNCIL_SOUL_PREFIX}${role}_${risen ? 'r' : 'c'}_${n}`;
}

/** A soul pillar template's soul, kind and pips, or null when `templateId`
 *  is no soul pillar. Pure (the renderer reads the mirrored entity). */
export function councilSoulOf(
  templateId: string,
): { role: CouncilRole; risen: boolean; pips: number } | null {
  if (!templateId.startsWith(COUNCIL_SOUL_PREFIX)) return null;
  const [role, kind, n] = templateId.slice(COUNCIL_SOUL_PREFIX.length).split('_');
  if (!COUNCIL_ROLES.includes(role as CouncilRole) || (kind !== 'c' && kind !== 'r')) return null;
  const pips = Number(n);
  if (!Number.isInteger(pips) || pips < 1 || pips > COUNCIL_TUNING.soulPips) return null;
  return { role: role as CouncilRole, risen: kind === 'r', pips };
}

/** Every soul pillar template (the combat wall rows, the client's mirror). */
export const COUNCIL_SOUL_TEMPLATES: readonly string[] = COUNCIL_ROLES.flatMap((role) =>
  [false, true].flatMap((risen) =>
    Array.from({ length: COUNCIL_TUNING.soulPips }, (_, i) =>
      councilSoulTemplate(role, risen, i + 1),
    ),
  ),
);

/** The Endless Song's multiplier on its `pulse`-th pulse (0 the first). */
export function endlessSongMult(pulse: number): number {
  return Math.min(
    COUNCIL_TUNING.songPulseCap,
    1 + COUNCIL_TUNING.songPulseGrowth * Math.max(0, pulse),
  );
}
