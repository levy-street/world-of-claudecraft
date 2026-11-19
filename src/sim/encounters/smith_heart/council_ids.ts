// The Hammer Council's leaf (docs/design/raid/smith_heart.md section 7.1):
// every id the council's sim, its renderer, its sounds, its dev helpers and
// its tests key on, the per-difficulty rules, the tuning, and the pure
// template-id helpers of the pillars. No SimContext, no rng.
//
// EVERY number here is a SKETCH, unmeasured (the design doc's 7.1 table says
// so too): anchored to the Hammer guardian's old kit (level 20 elite, ten
// players) and the level-20 cloth reference, to be calibrated with the meters
// harness before the raid ships.

/** The two stone beings of the council (template ids; the Guardian's is
 *  the shipped, frozen one, content/smith_heart.ts SMITH_HEART_GUARDIANS). A
 *  leaf: the content imports these, never the other way. (The prototype's
 *  third member, the Slabwright, left the encounter in the two-boss rework:
 *  its pillars and its rock went to the Seam Singer.) */
export const COUNCIL_GUARDIAN = 'heart_hammer_guardian';
export const COUNCIL_SEAM_SINGER = 'heart_seam_singer';

/** A council member's role (its original job): the Guardian the melee tank
 *  boss, the Seam Singer the caster. */
export type CouncilRole = 'guardian' | 'singer';
/** The council's inheritable jobs (Grieving Fury, council_fury.ts: the
 *  survivor takes them up at FULL strength once the fallen one's soul reaches
 *  it): the Guardian's energy and Wrath, the Seam Singer's pillars (Wake the
 *  Stone) and her song, and on Heroic and Mythic (`inheritSecond`) a second
 *  each: the Guardian's Hammer's Weight, the Singer's Seam Bolt. Mountain's
 *  Rush never passes on; the rock only on mythic (`rockOutlivesSinger`). */
export type CouncilJob = 'wrath' | 'pillars' | 'song' | 'weight' | 'bolt';

/** The jobs a survivor inherits only on a tier with `inheritSecond`. */
export const COUNCIL_SECOND_JOBS: ReadonlySet<CouncilJob> = new Set<CouncilJob>(['weight', 'bolt']);

/** The roles in roster order (the council's own iteration order). */
export const COUNCIL_ROLES: readonly CouncilRole[] = ['guardian', 'singer'];

export const COUNCIL_TEMPLATES: Readonly<Record<CouncilRole, string>> = {
  guardian: COUNCIL_GUARDIAN,
  singer: COUNCIL_SEAM_SINGER,
};

/** Every council template id (the gate, the seal and the tests wait on all). */
export const COUNCIL_TEMPLATE_IDS: readonly string[] = COUNCIL_ROLES.map(
  (r) => COUNCIL_TEMPLATES[r],
);

/** Dev-only presentation triggers (spellfx 'nova' on a member, emitted only
 *  by a dev verb, never by the fight): a member's death replayed on its
 *  living body (`/dev heart council death [guardian|singer]`; the renderer's
 *  CouncilDeathFx plays the scene, smith_heart_fx/council_death_core.ts, and
 *  claims the cue). */
export const COUNCIL_DEV_CUES = {
  deathReplay: 'heart_council_death_replay',
} as const;

/** The role whose own job each is. */
export const JOB_OWNER: Readonly<Record<CouncilJob, CouncilRole>> = {
  wrath: 'guardian',
  pillars: 'singer',
  song: 'singer',
  weight: 'guardian',
  bolt: 'singer',
};

/** Who takes up a fallen member's job, at full strength (the same bars, the
 *  same numbers, hastened by Grieving Fury): the other member. */
export const JOB_HEIRS: Readonly<Record<CouncilJob, readonly CouncilRole[]>> = {
  wrath: ['singer'],
  pillars: ['guardian'],
  song: ['guardian'],
  weight: ['singer'],
  bolt: ['guardian'],
};

/** Grieving Fury's colour code on its aura (value2): the fallen one's role. */
export function furyRoleCode(role: CouncilRole): number {
  return role === 'guardian' ? 0 : 1;
}

/** The fallen role a Grieving Fury aura's value2 names. Pure (the client's
 *  look reads it). */
export function furyFallenOf(value2: number | undefined): CouncilRole {
  return value2 === 1 ? 'singer' : 'guardian';
}

/** The role a template plays in the council, or null. Pure. */
export function councilRoleOf(templateId: string): CouncilRole | null {
  for (const r of COUNCIL_ROLES) if (COUNCIL_TEMPLATES[r] === templateId) return r;
  return null;
}

// ---- casts, auras, objects, cues --------------------------------------------------

/** The cast bars (and the damage names they carry). */
export const COUNCIL_CASTS = {
  /** The Guardian's (and, after him, the Singer's) blast at full energy. The
   *  shipped id is kept. */
  wrath: 'heart_mountains_wrath',
  /** The tank buster. */
  weight: 'heart_hammers_weight',
  /** The Guardian marks a player and charges the line to them (its bar's
   *  target is the marked player: the client draws the lane from it). */
  rush: 'heart_mountains_rush',
  /** The Seam Singer marks the players a pillar will rise under. Kickable:
   *  a kick raises nothing (the trap). */
  wake: 'heart_wake_the_stone',
  /** The Seam Singer marks the player the rock falls on. */
  rock: 'heart_falling_rock',
  /** The Seam Singer's kickable bolt. */
  bolt: 'heart_seam_bolt',
  /** The Seam Singer's kickable song (Resonance on three, one if kicked). */
  song: 'heart_song_of_the_seam',
  /** Mythic: the Guardian's soul in a pillar casts its own Wrath (the
   *  pillar's own bar, never kicked). */
  echo: 'heart_echo_of_wrath',
  /** Mythic: the Seam Singer's soul pillar's clock between two pulses of the
   *  Endless Song (the pillar's own bar, never kicked). */
  endlessSong: 'heart_endless_song',
} as const;

/** The interruptible ones (spread into mob/healer_channel.ts
 *  SCRIPTED_INTERRUPTIBLE_CHANNELS): the Singer's three. Kicking the bolt or
 *  the song is the play; Wake the Stone is a choice (a kick raises nothing,
 *  and every risen pillar left standing rings Stone Thrum on the raid: let
 *  through the one Wake the next Wrath needs, kick the rest). Wrath, Weight,
 *  the Rush and the rock are never kicked. */
export const COUNCIL_KICK_SCHOOLS: Readonly<Record<string, { school: 'nature' }>> = {
  [COUNCIL_CASTS.bolt]: { school: 'nature' },
  [COUNCIL_CASTS.song]: { school: 'nature' },
  [COUNCIL_CASTS.wake]: { school: 'nature' },
};

/** The auras the council puts on players and on itself. */
export const COUNCIL_AURAS = {
  /** +100 percent physical damage taken (the tank swap). */
  weight: 'heart_hammers_weight',
  /** A pillar rises under this player when it runs out (they choose where). */
  wakeMark: 'heart_wake_mark',
  /** The rock falls on this player when it runs out: share it. */
  rockMark: 'heart_falling_rock_mark',
  /** The Guardian charges at this player when it runs out: put a pillar on
   *  the line (value2 = the lane's half width). */
  rushMark: 'heart_mountains_rush_mark',
  /** Resonance: every second this player rings, hurting each ally within
   *  the ring (value2 = its radius): spread out. */
  resonance: 'heart_resonance',
  /** On the survivor once the fallen one's soul reaches it (council_fury.ts):
   *  more damage dealt (value, the tier's `furyDamage`). */
  memory: 'heart_memory_of_stone',
  /** Grieving Fury, on the survivor beside Memory of Stone: it swings, casts
   *  and runs its clocks faster (a buff_haste: value = 1 + the tier's
   *  `furyHaste`; value2 = the fallen one's role, 0 the Guardian, 1 the
   *  Singer, the colour the client lights it in). */
  fury: 'heart_grieving_fury',
  /** Heroic and Mythic: on the Wrath's caster through its bar: value2 = how
   *  many players one pillar can shield (what the client's runes read). */
  pillarLimit: 'heart_narrow_shelter',
  /** Bond of the Stone: on both members while they stand within reach of
   *  each other, far less damage taken (stacks = the raid pulses it has
   *  sung, value2 = the next pulse's multiplier in tenths). */
  bond: 'heart_bond_of_the_stone',
  /** Mountain's Rush broke the cursed pillar: the Guardian reels (a stun)
   *  and takes more damage for a while. */
  rushStunned: 'heart_rush_shattered',
  rushExposed: 'heart_rush_exposed',
  /** Mythic: the Quarry is collapsing (a Rush missed every pillar): a
   *  stacking raid-wide blow until the cursed pillar breaks (stacks). */
  collapse: 'heart_quarry_collapse',
  /** Mythic: on the Seam Singer's soul pillar, one stack per pulse the
   *  Endless Song has sung (value = the next pulse's multiplier). The
   *  pillar is an object: the sim never ticks it, the council sets it. */
  endlessSong: 'heart_endless_song',
  /** On both members until the entrance has played (council_intro.ts):
   *  `value` council_intro_plan.ts COUNCIL_INTRO_STAGES (dormant in the rock
   *  and the crystal, or waking with the scene's clock in `remaining` and
   *  `duration`). */
  intro: 'heart_council_intro',
} as const;

/** The council's encounter object templates. Pillars carry their integrity
 *  (a carved column 2 then 1, a risen pillar 1: councilPillarFull) and stand as combat walls
 *  (instances/combat_wall_state.ts COMBAT_WALL_SHAPES). */
export const COUNCIL_PILLAR_PREFIX = 'sh_council_pillar_';
export const COUNCIL_RISEN_PREFIX = 'sh_council_risen_';
/** The cursed pillar the Guardian raises with each Mountain's Rush (one at
 *  a time): it pulses on the whole raid while it stands, shelters nobody, and
 *  only the Rush (or a Wrath) breaks it. A round combat wall. */
export const COUNCIL_CURSED = 'sh_council_cursed';
/** The rubble a fallen pillar leaves (scale = its radius). */
export const COUNCIL_RUBBLE = 'sh_council_rubble';
/** A locked rising pillar's spot (scale = the knockback radius): the old
 *  weaker inheritance's random rise, which no tier raises since Grieving Fury
 *  (2026-11-18: the survivor casts the real Wake the Stone); the ids stay for
 *  the client's reader and the bots. */
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
  /** Stone Thrum: each pillar Wake the Stone raised rings on the whole raid
   *  (spellfx 'nova' on each risen pillar that rang; council_risen_pulse.ts). */
  risenPulse: 'heart_council_stone_thrum',
  /** The stone remembers: the fallen one's soul flies to the survivor
   *  (spellfx 'beam', source the fallen, target the survivor); it lands
   *  COUNCIL_TUNING.furyArrive later. */
  inherit: 'heart_council_inherit',
  /** Grieving Fury wakes on the survivor as the soul lands (spellfx 'nova' on
   *  the survivor). */
  furyWake: 'heart_grieving_fury_wake',
  /** Grieving Fury mends the survivor, once a second while it heals (spellfx
   *  'nova' on the survivor). */
  furyMend: 'heart_grieving_fury_mend',
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
  /** Mountain's Rush's line is fixed and the Guardian plants for its
   *  wind-up (spellfxAt 'burst' at the Guardian's feet, sourceId the
   *  Guardian, radius = the lane's half width, dirX/dirZ the line's heading,
   *  speed the run's and duration its seconds: the stop is
   *  from + dir * speed * duration; the run starts COUNCIL_TUNING.rushWindup
   *  after it). */
  rushWindup: 'heart_mountains_rush_windup',
  /** Mountain's Rush ends (spellfxAt 'burst' where the Guardian stops,
   *  radius = the lane's half width). */
  rushImpact: 'heart_mountains_rush_impact',
  /** The cursed pillar rises, pulses, breaks (spellfx 'nova' on it;
   *  spellfxAt 'burst' as it breaks). */
  cursedRise: 'heart_cursed_pillar_rise',
  cursedPulse: 'heart_cursed_pillar_pulse',
  cursedBreak: 'heart_cursed_pillar_break',
  /** Bond of the Stone pulses (spellfx 'beam' from one member to the other). */
  bondPulse: 'heart_bond_of_the_stone_pulse',
  /** Resonance rings on its player (spellfx 'nova' on them). */
  resonancePulse: 'heart_resonance_pulse',
  /** Mythic: the Quarry's ceiling sheds a blow (spellfxAt 'burst' on each
   *  player). */
  quarryCollapse: 'heart_quarry_collapse',
} as const;

/** The damage names (combat log and floating text; re-localized by
 *  src/ui/sim_i18n.ts through the mechanic reverse map). */
export const COUNCIL_NAMES = {
  wrath: "Mountain's Wrath",
  weight: "Hammer's Weight",
  wake: 'Wake the Stone',
  rock: 'Falling Rock',
  rockTremor: 'Rockfall Tremor',
  rush: "Mountain's Rush",
  cursed: 'Cursed Pillar',
  rushStunned: 'Shattered Charge',
  bond: 'Bond of the Stone',
  collapse: 'Quarry Collapse',
  bolt: 'Seam Bolt',
  song: 'Song of the Seam',
  resonance: 'Resonance',
  memory: 'Memory of Stone',
  fury: 'Grieving Fury',
  pillarLimit: 'Narrow Shelter',
  rubble: 'Crumbled Stone',
  pulse: 'Restless Stone',
  risenPulse: 'Stone Thrum',
  echo: 'Echo of Wrath',
  endlessSong: 'Endless Song',
  /** The entrance's marker (the Hammer Vein Warder's sleep shares the name
   *  and its catalog row). */
  intro: 'Dormant',
} as const;

// ---- difficulty -----------------------------------------------------------------------

/** The council's difficulty. Each tier is one COUNCIL_DIFFICULTY row (the
 *  mythic is a prototype behind a dev switch while the game has no mythic
 *  tier: council.ts setCouncilDevTier); nothing else switches on the tier by
 *  name. */
export type CouncilDifficulty = 'normal' | 'heroic' | 'mythic';

export interface CouncilDifficultyRules {
  /** How many players Wake the Stone marks (whoever casts it). */
  wakeMarks: number;
  /** Wake the Stone's marks and Mountain's Rush never run into a Wrath (they
   *  wait until it lands); false: they may (heroic). */
  floorAvoidsWrath: boolean;
  /** The song waits for a Wrath to land and its Resonance runs out before
   *  the next one (normal); false: the song keeps its own clock and the two
   *  overlap (heroic). */
  songAfterWrath: boolean;
  /** Every standing pillar pulses on whoever stands close. */
  pillarPulse: boolean;
  /** Every mechanic's damage, on top of the claim's own multiplier. */
  damageMult: number;
  /** A lethal punishment's damage factor, in place of damageMult (Mountain's
   *  Wrath, whoever casts it, Falling Rock and its tremor): the parse-calibrated
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
  /** Mountain's Wrath's hit on whoever no pillar hides (and the crowded
   *  shelter's share of it), on top of damageMult. Heroic and Mythic (the
   *  review of 2026-11-09): 3,465 to 4,095, past every body in the raid,
   *  a Heroic-geared plate tank (about 2,700 health, in Defensive Stance)
   *  included; a tank under a 40 to 50 percent cut lives on a sliver (with
   *  Memory of Stone too), and an immunity takes none of it. */
  wrathMult: number;
  /** Narrow Shelter: the share of the Wrath each player behind a crowded
   *  pillar takes. Heroic and Mythic: about 50 to 65 percent of a
   *  Heroic-geared cloth body, hurting but never a wipe by itself. */
  crowdShare: number;
  /** Stone Thrum (council_risen_pulse.ts): every pillar Wake the Stone (or
   *  the Guardian after her) raised that still stands rings on the whole
   *  raid every T.risenPulseEvery seconds, this much per pillar (before
   *  damageMult). The carved columns never ring. */
  risenPulseMin: number;
  risenPulseMax: number;
  /** The soft enrage: after this many Wraths the energy fills much faster
   *  (enrageFillMult). Heroic's Wrath kills the unhidden, so its enrage
   *  comes late enough for a decent raid's 6 to 7 minute kill. */
  enrageAfterWraths: number;
  /** Grieving Fury (council_fury.ts, the owner's option B of 2026-11-18):
   *  once the fallen one's soul reaches the survivor (COUNCIL_TUNING
   *  .furyArrive after the fall) it mends this share of its maximum health
   *  over `furyHealSeconds`, deals `furyDamage` more damage (Memory of
   *  Stone), swings, casts and runs every clock `furyHaste` faster, and takes
   *  up the fallen one's jobs at full strength. A second fall before the soul
   *  lands costs the raid nothing, one before the mend ends only part of it:
   *  the fight asks for the two to fall together. */
  furyHealPct: number;
  furyHealSeconds: number;
  furyDamage: number;
  furyHaste: number;
  /** The survivor also takes the fallen one's second job (the Singer the
   *  Guardian's Hammer's Weight, the Guardian her Seam Bolt). */
  inheritSecond: boolean;
  /** The Guardian keeps casting Falling Rock once the Seam Singer has fallen
   *  (mythic: the rock and Resonance are the only things that break a soul
   *  pillar, so a living member always supplies one of them). */
  rockOutlivesSinger: boolean;
  /** Soul in the Stone: a fallen member's soul takes a pillar
   *  (council_soul.ts). */
  soulInTheStone: boolean;
  /** Narrow Shelter: how many players one pillar shields from the Wrath, or
   *  null for no limit (council_wrath.ts landWrath). */
  pillarLimit: number | null;
  /** The cursed pillar's raid pulse (before damageMult): low on normal (a
   *  reminder), the real pressure on heroic and mythic. */
  cursedPulseMin: number;
  cursedPulseMax: number;
  /** A Rush that hits no pillar sets the Quarry collapsing (mythic) until
   *  the cursed pillar breaks. */
  missCollapse: boolean;
}

export const COUNCIL_DIFFICULTY: Readonly<Record<CouncilDifficulty, CouncilDifficultyRules>> = {
  normal: {
    wakeMarks: 2,
    floorAvoidsWrath: true,
    songAfterWrath: true,
    pillarPulse: false,
    // The parse-calibrated pass of 2026-11-16: the raid's damage and the
    // swing +15 percent (was 1), the Wrath and the rock where they were.
    damageMult: 1.15,
    punishMult: 1,
    swingMult: 1.15,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    healthMult: 1,
    wrathMult: 1,
    crowdShare: 0.5,
    risenPulseMin: 14,
    risenPulseMax: 16,
    // The sixth Wrath (about 5:55) since the parse-calibrated pass of
    // 2026-11-16: its +20 percent pools carried the bot raid past the fifth
    // (4:55, the balance pass of 2026-11-12; the fourth, 3:56, before it).
    enrageAfterWraths: 6,
    // Grieving Fury, Normal's gentle one.
    furyHealPct: 0.1,
    furyHealSeconds: 8,
    furyDamage: 0.2,
    furyHaste: 0.15,
    inheritSecond: false,
    rockOutlivesSinger: false,
    soulInTheStone: false,
    pillarLimit: 5,
    cursedPulseMin: 7,
    cursedPulseMax: 9,
    missCollapse: false,
  },
  heroic: {
    wakeMarks: 3,
    floorAvoidsWrath: false,
    songAfterWrath: false,
    pillarPulse: true,
    // Unchanged by the pass of 2026-11-16 (its damage already the raid's
    // hardest); its pool x1.85 to x2.0 (+30 percent with the base's +20).
    damageMult: 1.25,
    punishMult: 1.25,
    swingMult: 1,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    healthMult: 1.18,
    wrathMult: 6.3,
    crowdShare: 0.2,
    // Normal's Stone Thrum before the tier's 1.25 (was 19 to 21, which rode
    // 68% over Normal: the balance pass of 2026-11-12), less a tenth since
    // the pass of 2026-11-16 (the bot raid on the +30 percent pools wiped
    // short of half the Guardian: 14 to 16 before).
    risenPulseMin: 12.6,
    risenPulseMax: 14.4,
    enrageAfterWraths: 8,
    // Grieving Fury: a quarter of its health back in 6 s, and hard.
    furyHealPct: 0.25,
    furyHealSeconds: 6,
    furyDamage: 0.35,
    furyHaste: 0.3,
    inheritSecond: true,
    rockOutlivesSinger: false,
    soulInTheStone: false,
    pillarLimit: 4,
    // A tenth off on 2026-11-16 too (40 to 48 before).
    cursedPulseMin: 36,
    cursedPulseMax: 43.2,
    missCollapse: false,
  },
  // Everything heroic has, the inheritances stronger, and the souls.
  mythic: {
    wakeMarks: 3,
    floorAvoidsWrath: false,
    songAfterWrath: false,
    pillarPulse: true,
    damageMult: 1.25,
    punishMult: 1.25,
    swingMult: 1,
    // The pools of 2026-11-17 (real parses: a human raid of ten deals about
    // 1,400 DPS; Normal about 4 to 4.5 minutes of uptime, Heroic about 5,
    // Mythic about 7, the fight's own downtime counted; smith_heart.md).
    healthMult: 1.65,
    wrathMult: 6.3,
    crowdShare: 0.2,
    risenPulseMin: 14,
    risenPulseMax: 16,
    // The sixth Wrath (about 5:55): Heroic's health asks no more than a
    // tier of gear (was the fourth, 2026-11-12).
    enrageAfterWraths: 6,
    furyHealPct: 0.3,
    furyHealSeconds: 6,
    furyDamage: 0.4,
    furyHaste: 0.3,
    inheritSecond: true,
    rockOutlivesSinger: true,
    soulInTheStone: true,
    pillarLimit: 3,
    cursedPulseMin: 48,
    cursedPulseMax: 56,
    missCollapse: true,
  },
};

// ---- tuning (SKETCH, unmeasured) ------------------------------------------------------

export const COUNCIL_TUNING = {
  // The pillars (Narrow Shelter's share is each tier's, COUNCIL_DIFFICULTY).
  pillarCap: 7,
  /** The most integrity any pillar template carries. */
  integrity: 3,
  /** A carved column takes two blows (the rock, Resonance); a risen pillar
   *  one. Mountain's Wrath and Mountain's Rush take a pillar whole. */
  columnIntegrity: 2,
  risenIntegrity: 1,
  /** A carved column's radius and a risen pillar's (the combat wall rows). */
  columnR: 2.6,
  risenR: 2.2,
  /** Mountain's Wrath's shelter (the team's review of 2026-11-17): a FIXED
   *  ring this far past a pillar's face, whatever the caster's spot, so a
   *  player reads the safe floor round a pillar without tracking the boss.
   *  Two rings that overlap shelter (and count) a player in both. */
  shelterReach: 4,
  /** Rubble: its radius past the pillar's, how long it lies, its bite. */
  rubblePad: 1.6,
  rubbleSeconds: 8,
  rubbleTick: 1,
  rubbleMin: 90,
  rubbleMax: 110,
  // The Guardian: energy and Mountain's Wrath.
  energyMax: 100,
  energyFillSeconds: 55,
  /** After this many Wraths the energy fills much faster (the soft enrage;
   *  the default, each tier's own is COUNCIL_DIFFICULTY's). */
  enrageAfterWraths: 5,
  enrageFillMult: 2.5,
  wrathCast: 4,
  wrathRadius: 45,
  wrathMin: 440,
  wrathMax: 520,
  // Hammer's Weight.
  weightFirst: 10,
  weightEvery: 18,
  weightCast: 1.5,
  weightMult: 2.2,
  weightSeconds: 25,
  /** Physical damage taken while it holds (+100 percent). */
  weightTaken: 1,
  // Mountain's Rush (the Guardian's charge): its first bar, the time between
  // two, the bar (the mark's warning), the lane's half width, the wind-up
  // (the line is fixed when the bar lands; the Guardian plants and braces
  // this long before it moves), the dash's speed (yards a second: a heavy
  // run, a 15 yd lane takes under a second, the Quarry's width about four),
  // the blow and the throw on everyone it runs through.
  rushFirst: 16,
  rushEvery: 24,
  /** The mark's bar, the marked player's time to put a pillar between them and the
   *  Guardian: 5 s on every tier (3 until the owner's playtest of 2026-11-12). */
  rushCast: 5,
  rushHalfWidth: 2,
  /** A body is struck within the half width plus this (its own girth): the
   *  lane on the floor is drawn to the two together. */
  rushBody: 0.5,
  rushWindup: 0.8,
  rushSpeed: 22,
  rushMin: 480,
  rushMax: 560,
  rushKnockback: 10,
  /** The cursed pillar: how far from the Quarry's middle it rises, its
   *  radius, its pulse's clock. */
  cursedRing: 15,
  cursedR: 2.2,
  cursedPulseEvery: 2,
  /** The Rush broken on the cursed pillar: the Guardian's stun, and the
   *  extra damage it takes for a while. */
  rushStunSeconds: 5,
  rushExposedSeconds: 12,
  rushExposed: 0.5,
  /** Mythic: the Quarry collapsing after a miss: every 2 s a blow on every
   *  player, one more stack each time (the blow is per stack), capped. */
  collapseEvery: 2,
  collapseMin: 30,
  collapseMax: 36,
  collapseCap: 10,
  /** Normal: a Wake's marks or a Rush must be over this long before the
   *  Wrath's bar begins (floorAvoidsWrath). */
  wrathGuardPad: 2,
  // Bond of the Stone: within this of each other (body to body) both take
  // this much less, and every few seconds a raid-wide pulse that grows each
  // time while they stay together (capped); a raid warning at most this often.
  bondReach: 20,
  bondWard: 0.8,
  bondPulseEvery: 3,
  bondPulseMin: 40,
  bondPulseMax: 48,
  bondPulseGrowth: 0.25,
  bondPulseCap: 6,
  // Wake the Stone (the Seam Singer's, kickable: a kick raises nothing).
  wakeFirst: 20,
  wakeEvery: 30,
  /** Each Wrath landing brings the next Wake due this soon after it (never
   *  later than its own clock): every Wrath cycle has its Wake. */
  wakeAfterWrath: 6,
  wakeCast: 2.5,
  wakeMarkSeconds: 5,
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
  /** Resonance: a spread. Its seconds, its ring (yards round the carrier),
   *  its pulse's clock and its blow on each ally inside (never the carrier). */
  resonanceSeconds: 6,
  resonanceRadius: 7,
  resonanceEvery: 1,
  resonanceMin: 150,
  resonanceMax: 180,
  // Grieving Fury (each tier's numbers are its COUNCIL_DIFFICULTY row): the
  // seconds the fallen one's soul takes to reach the survivor (the client's
  // stream flies this long), and the mend's beat.
  furyArrive: 3,
  furyMendEvery: 1,
  /** How much the survivor's body swells under the fury (the client's look). */
  furySwell: 1.15,
  // Heroic: the pillars pulse.
  pulseEvery: 2,
  pulseReach: 3,
  pulseMin: 60,
  pulseMax: 75,
  /** Stone Thrum: its clock (every tier's amount is its row's). The first
   *  ring a second into the pull, so it never rings on Restless Stone's beat
   *  (the healers' load and the floor's rings spread). */
  risenPulseFirst: 1,
  risenPulseEvery: 2,
  /** Seconds of plain melee after a bar lands before the same body starts
   *  another (nothing chains bar into bar). */
  barGap: 1.2,
  /** Seconds between the starts of two FLOOR mechanics (the Wrath, the Echo,
   *  Wake the Stone, Mountain's Rush, Falling Rock): one due sooner waits
   *  (council_floor_gap.ts). */
  floorGap: 4,
  // Mythic: Soul in the Stone (council_soul.ts).
  /** A soul pillar's pips. */
  soulPips: 3,
  /** A Falling Rock landing within this of its face strikes a pip off. */
  soulRockReach: 6,
  // The Guardian's soul: Echo of Wrath.
  echoFirst: 12,
  echoEvery: 20,
  echoCast: 3,
  echoRadius: 45,
  /** A share of Mountain's Wrath's own roll. */
  echoShare: 0.6,
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

/** The fixed shelter's reach from a pillar's centre (its footprint plus
 *  `shelterReach`). */
export function councilShelterRadius(r: number): number {
  return r + COUNCIL_TUNING.shelterReach;
}

/** Does a pillar centred at (px, pz) with footprint `r` shelter a body at
 *  (x, z) from Mountain's Wrath? Pure: the sim's rule and the client's
 *  gems read the same test. */
export function inCouncilShelter(px: number, pz: number, r: number, x: number, z: number): boolean {
  return Math.hypot(x - px, z - pz) <= councilShelterRadius(r) + 1e-6;
}

/** Seconds the Wrath's energy takes to fill by Wraths landed (`enrageAfter`:
 *  the difficulty's soft enrage, COUNCIL_DIFFICULTY), before Grieving Fury's
 *  haste (`haste`, 1 without it). Whoever holds it, the same full fill. */
export function councilFillSeconds(
  wraths: number,
  enrageAfter: number = COUNCIL_TUNING.enrageAfterWraths,
  haste = 1,
): number {
  const base = COUNCIL_TUNING.energyFillSeconds / Math.max(1, haste);
  return wraths >= enrageAfter ? base / COUNCIL_TUNING.enrageFillMult : base;
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

/** Bond of the Stone's multiplier on its `pulse`-th pulse (0 the first). */
export function bondPulseMult(pulse: number): number {
  return Math.min(
    COUNCIL_TUNING.bondPulseCap,
    1 + COUNCIL_TUNING.bondPulseGrowth * Math.max(0, pulse),
  );
}

/** The Endless Song's multiplier on its `pulse`-th pulse (0 the first). */
export function endlessSongMult(pulse: number): number {
  return Math.min(
    COUNCIL_TUNING.songPulseCap,
    1 + COUNCIL_TUNING.songPulseGrowth * Math.max(0, pulse),
  );
}
