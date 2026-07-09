// The Gauntlet, a time-limited survival event (see docs in types.ts
// GauntletDef). Data-as-code only: every numeric knob the gauntlet modules use
// lives HERE, never inline in module logic, so balancing is a one-file edit.
// Trials land one per release phase; `trials` below is the currently shipped
// sequence and grows as later trials are implemented.

import type { GauntletDef, NpcDef, PlayerClass } from '../types';

export const GAUNTLET_RECRUITER_NPC_ID = 'gauntlet_recruiter';
export const GAUNTLET_WATCHER_NPC_ID = 'gauntlet_watcher';
export const GAUNTLET_CONTESTANT_NPC_ID = 'gauntlet_contestant';

// Maro's RESERVED entity id. He now stands permanently in the Proving Grounds
// hub (see data.ts MINIGAME_HUB), not a dynamic event-time spawn, so he is
// spawned at world init OUTSIDE the nextId sequence with zero rng, exactly like
// HC_HERALD_ID, and the parity goldens never see him. Spawned by
// gauntlet/runs.ts spawnGauntletRecruiter; the event window still gates the
// join, only his presence no longer signals it.
export const GAUNTLET_RECRUITER_ID = 1_000_000_200;

// The contestant field wears real adventurer kits (the Hodric's Castle bot
// idiom): each NPC contestant rolls one of the nine classes and a skin, so
// the roster reads as a crowd of varied challengers rather than identical
// villagers. One dynamic NPC def per class (appended to GAUNTLET_NPCS below);
// the renderer maps each id to the matching class model.
export const GAUNTLET_CONTESTANT_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'mage',
  'warlock',
  'shaman',
  'druid',
];

export function gauntletContestantNpcId(cls: PlayerClass): string {
  return `${GAUNTLET_CONTESTANT_NPC_ID}_${cls}`;
}

// All three are `dynamic`: registered in NPCS (so the online client can resolve
// their defs) but never surface-placed by the world-init NPC loop. The recruiter
// is spawned at a reserved id in the Proving Grounds hub (spawnGauntletRecruiter),
// and the watcher/contestants per run inside the instance slot; the `pos` on the
// recruiter def below is vestigial (the hub anchor in data.ts is authoritative).
export const GAUNTLET_NPCS: Record<string, NpcDef> = {
  [GAUNTLET_RECRUITER_NPC_ID]: {
    id: GAUNTLET_RECRUITER_NPC_ID,
    name: 'Maro Half-Mask',
    // The nameplate subtitle is the game name (the Proving Grounds heralds show
    // the event they recruit for), not a personal role title.
    title: 'The Gauntlet',
    // Vestigial: the recruiter now stands at MINIGAME_HUB + MINIGAME_HUB_MARO.
    pos: { x: 14, z: 4 },
    facing: -Math.PI / 2,
    color: 0x9b59b6,
    questIds: [],
    dynamic: true,
    greeting:
      'Step onto the sand with the rest of them, $C. Outlast every trial and the podium is yours.',
  },
  [GAUNTLET_WATCHER_NPC_ID]: {
    id: GAUNTLET_WATCHER_NPC_ID,
    name: 'The Stone Warden',
    title: 'Keeper of the Crossing',
    // per-run spawn position is instance-local (see GAUNTLET_LAYOUT); this
    // surface pos is never used but the record shape requires one.
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0x8d99ae,
    questIds: [],
    dynamic: true,
    greeting: 'The Warden does not blink.',
  },
  [GAUNTLET_CONTESTANT_NPC_ID]: {
    id: GAUNTLET_CONTESTANT_NPC_ID,
    // per-entity display names are rolled from the name tables below; this
    // fallback only shows if a contestant spawns without one.
    name: 'Gauntlet Contestant',
    title: 'Contestant',
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0xc0796a,
    questIds: [],
    dynamic: true,
    greeting: 'Eyes forward. The Warden is watching.',
  },
};

// One class-kitted contestant def per class, sharing the base def's text (the
// nameplate shows each contestant's rolled proper-noun name, never this).
for (const cls of GAUNTLET_CONTESTANT_CLASSES) {
  GAUNTLET_NPCS[gauntletContestantNpcId(cls)] = {
    ...GAUNTLET_NPCS[GAUNTLET_CONTESTANT_NPC_ID],
    id: gauntletContestantNpcId(cls),
  };
}

// Contestant display names are `first + ' ' + last`, rolled from the per-run
// stream. Proper nouns: like player character names they are not translated.
export const GAUNTLET_CONTESTANT_FIRST_NAMES = [
  'Bram',
  'Odessa',
  'Finn',
  'Petra',
  'Cole',
  'Isolde',
  'Garrick',
  'Mabel',
  'Tobin',
  'Sable',
  'Edric',
  'Wren',
  'Halvar',
  'Nessa',
  'Orin',
  'Tilda',
  'Rufus',
  'Greta',
  'Silas',
  'Yara',
  'Dorn',
  'Elba',
  'Kestrel',
  'Pip',
] as const;

export const GAUNTLET_CONTESTANT_LAST_NAMES = [
  'Thistledown',
  'Marshlight',
  'Coppervein',
  'Bramblewood',
  'Ashgrove',
  'Fenwick',
  'Stonebrook',
  'Larkspur',
  'Duskwater',
  'Hollowell',
  'Pinch',
  'Gallowglass',
  'Reedmore',
  'Cinderfall',
  'Quickstep',
  'Mossbank',
  'Tatterhem',
  'Windrow',
  'Saltmarsh',
  'Underbough',
] as const;

// Instance-local layout anchors (yards, origin = gauntletOrigin(slot)). The
// sentinel field runs from the start line at z=0 to the finish line at
// z=sentinel.fieldLength; contestants gather south of the start line.
export const GAUNTLET_LAYOUT = {
  stagingZ: -10, // contestants line up here before a trial opens
  stagingHalfWidth: 14, // lateral spread of the staging line-up
  spectatorX: 26, // knocked-out players park here, beside the field
  spectatorZ: 40,
  watcherMargin: 6, // the watcher stands this far past the finish line
  // The podium ceremony (gauntlet/podium.ts): the three-step winners' stand
  // behind the staging plaza. `z` is the slab centre (instance-local), `baseH`
  // the base slab height, and each step's `x` its lateral offset with `h` its
  // box height, so the stand-on height above the venue floor is baseH + step.h.
  // The renderer builds the steps and venue_physics blocks the block from these
  // same numbers, so a champion stands exactly on the step you see.
  podium: {
    z: -20,
    baseH: 0.5,
    steps: [
      { x: 0, h: 1.5 }, // 1st: the gold centre step
      { x: -3.6, h: 1.0 }, // 2nd: silver
      { x: 3.6, h: 0.7 }, // 3rd: bronze
    ],
  },
} as const;

// The six trial arenas of the venue complex, one anchor per trials[] entry
// (instance-local yards). Trial 1 plays on the sentinel field itself; the
// other five are DRESSED but sealed until their trials ship (one per release
// phase), and each future trial's gameplay lands AT its anchor so the map
// and the mechanics never drift apart. The renderer builds the whole complex
// from these (src/render/gauntlet_venue.ts); keep every position here, never
// inline in render code.
export const GAUNTLET_VENUE = {
  // Trial 2, Sugarglass Sigils: a circular etching pavilion. The slab block is
  // the etched lectern at the pavilion center (the trial's input surface):
  // sized/tilted here so the venue mesh, the world-aim interaction rect, and
  // the trace input mapping share one source of truth. The face tilts toward
  // +x (the approach from the crossing field); the etching is a centered
  // square of half-extent etchHalf on the face, and the outline is inset by
  // padFrac within it (gauntlet_trace_core maps input through the same inset).
  sigils: {
    x: -62,
    z: 6,
    radius: 10,
    // The cosmetic lectern ring around the interactive one: the NPC field
    // mans these stations during the trial (one etcher per lectern, extras
    // ranked behind). Venue geometry and sim placement share these numbers
    // plus sigilRingAngle below.
    ring: { count: 12, radius: 6.5 },
    slab: {
      faceAcross: 2.2, // face width, the etching's x axis (yards)
      faceSlope: 1.6, // face run up the tilt, the etching's y axis
      thick: 0.12,
      tiltRad: Math.PI / 6, // 30 deg toward the approach side (+x)
      centerY: 1.15, // slab center height (instance-local)
      etchHalf: 0.7, // interaction square half-extent on the face
      padFrac: 0.1, // outline inset within the square (was the 2D canvas frame pad)
    },
  },
  // Trial 3, The Great Pull: a flat rope lane with a central mud pit. Both
  // teams grip the rope single file (players take the grips nearest the pit,
  // NPC teammates fill in behind), and the WHOLE line slides with the rope as
  // the marker moves: sim placement and venue geometry share these numbers so
  // hands stay on the rope.
  pull: {
    x: -62,
    z: 52,
    length: 24, // rope length (the lane runs along x)
    width: 9, // lane dressing extent across the rope
    ropeY: 1.05, // hand height
    pitHalfX: 3, // the central pit the losing line is dragged toward
    pitHalfZ: 2.2,
    gripStart: 4.5, // first grip's distance from the rope center
    gripSpacing: 1.7, // spacing between grips along the rope
    knotTravel: 10, // rope translation at the win threshold (yards)
  },
  // Trial 4, the Keeper's Echo: a walled courtyard of rune-stone desks, one per
  // contestant (see echoStation). The footprint holds the whole 4x3 desk grid.
  echo: { x: -62, z: 104, size: 18 },
  // Trial 5, The Brittle Span: the twin-track glass crossing over a dark pit.
  // `length` tracks steps * panelLength (GAUNTLET.span): the crossing itself.
  span: { x: -105, z: 30, length: 56 },
  // Trial 6, The Final Court: the champions' ring, a circular melee arena. The
  // radius here is the DRESSED floor; the fighters are clamped a hair inside it
  // (GAUNTLET.court.arenaRadius), so the wall reads as a real boundary.
  court: { x: -105, z: 95, radius: 13 },
  // Grandstands flank the sentinel field on both sides.
  standX: 27, // inner edge of each grandstand (mirrored at -standX)
  standZMin: 14,
  standZMax: 76,
  // The colosseum shell: a low-poly elliptical stadium wall enclosing the
  // whole complex (yards, instance-local center + radii). The renderer builds
  // the tiered ring from these numbers and venue_physics derives one wall
  // collider per segment, so the shell is solid where it is visible. Radii
  // sized to clear every arena and stay inside the ground apron.
  colosseum: { x: -35, z: 45, rx: 118, rz: 108, segments: 30, wallDepth: 2.8 },
  // The venue ground apron: the flat dressed footprint around everything,
  // wide enough that every arena sits clear of its neighbors (playtest: the
  // packed first layout read as one overlapping jumble) and that the
  // colosseum shell ring fits inside it. Bounded by the gauntlet band
  // (x 13000..13800) and the 400yd slot pitch.
  groundHalfWidth: 160,
  groundZMin: -70,
  groundZMax: 165,
  // Camera focus poses for the desk-style trials, instance-local (the hud glue
  // adds the run origin and hands the pose to renderer.setCameraFocus).
  // Authored clear of geometry: over the open pavilion, above head height, so
  // holding the pose without camera collision is safe. Movement trials
  // (sentinel, span, court) keep the chase cam and have no pose here; the
  // pull also keeps the chase cam (locked third person on the rope, with the
  // screen-space circle overlay as its input).
  focus: {
    sigils: {
      // Close over the slab so the etched shape fills the view for tracing; the
      // character is hidden while this pose is held (see the renderer self-hide),
      // so nothing blocks it.
      pos: { x: -59.6, y: 4.2, z: 6 },
      lookAt: { x: -62, y: 1.25, z: 6 },
    },
    // Over the echo table from behind the viewer's west mat: all four rune
    // stones in frame.
    echo: {
      pos: { x: -69.5, y: 4.6, z: 104 },
      lookAt: { x: -62, y: 1, z: 104 },
    },
  },
} as const;

// The i-th ring lectern's angle (the venue's sin/cos convention: position =
// anchor + (sin a, cos a) * radius). The ring spreads evenly around the dais
// but skips a wedge at a = PI/2 (+x), keeping the player's approach corridor
// to the interactive lectern clear. Pure and shared: the venue builds the
// lecterns and the sim seats the NPC etchers from the same angles.
export function sigilRingAngle(i: number, count: number): number {
  const gap = 0.9; // the approach wedge (radians)
  return Math.PI / 2 + gap / 2 + ((2 * Math.PI - gap) * (i + 0.5)) / count;
}

// The Keeper's Echo seats every contestant at their OWN rune-stone desk: a
// grid of ECHO_STATION_COLS x ECHO_STATION_ROWS stations centred on the echo
// courtyard anchor. echoStation is the single source both hosts read, so a
// contestant and their desk always share a spot: the sim seats contestant i at
// station i's mat (contestants.ts seatAllContestantsAt), and the venue builds a
// desk at every station + anchors the live rig to the viewer's own. The desks
// face +x; each contestant stands one ECHO_MAT_GAP west and looks east across
// the stones. Grid indexing is FIXED (never derived from the live count) so the
// centring never shifts as contestants fall.
export const ECHO_STATION_COLS = 4;
export const ECHO_STATION_ROWS = 3;
export const ECHO_STATIONS = ECHO_STATION_COLS * ECHO_STATION_ROWS;
export const ECHO_MAT_GAP = 3.2;
const ECHO_ROW_PITCH = 5; // desk-to-desk spacing along x (depth)
const ECHO_COL_PITCH = 3.8; // desk-to-desk spacing along z (lateral)

// Station i's desk root and the mat a contestant stands on, both instance-local
// (add run.origin). Columns run along z, rows recede along x; index wraps past
// the grid so an over-full field never throws (real runs reach the echo with at
// most maxRealPlayers + a culled NPC remnant, well inside the grid).
export function echoStation(i: number): {
  deskX: number;
  deskZ: number;
  matX: number;
  matZ: number;
  facing: number;
} {
  const { x, z } = GAUNTLET_VENUE.echo;
  const c = i % ECHO_STATION_COLS;
  const r = Math.floor(i / ECHO_STATION_COLS);
  const deskX = x + (r - (ECHO_STATION_ROWS - 1) / 2) * ECHO_ROW_PITCH;
  const deskZ = z + (c - (ECHO_STATION_COLS - 1) / 2) * ECHO_COL_PITCH;
  return { deskX, deskZ, matX: deskX - ECHO_MAT_GAP, matZ: deskZ, facing: Math.PI / 2 };
}

export const GAUNTLET: GauntletDef = {
  fieldSize: 30,
  vitalityMax: 100,
  lobbyFillS: 60,
  // A queue-formed lobby uses a short countdown so games roll back to back
  // ("when one ends the next starts"); the field backfills with NPCs at start.
  queueCountdownS: 12,
  maxRealPlayers: 8,
  joinRadius: 12,
  emptyTimeoutS: 30,
  stagingS: 8,
  interludeS: 10,
  podiumS: 20,
  // Prize pool is pure theater in v1 (no payout): the advertised baseline plus
  // growth per knockout, in copper, shown on the HUD counter.
  prizeBase: 10000,
  prizePerElimination: 2500,
  // NPC attrition schedule, one entry per trials[i]: after that trial the NPC
  // field is culled toward this many survivors (players are never culled by
  // targets; they live and die by their own vitality). The tail keeps ~4 into
  // the Final Court so the finale is a real melee, not a forced 1v1; the court
  // itself crowns exactly one (last fighter standing).
  targetSurvivorsPerTrial: [14, 8, 6, 5, 4, 1],
  npcSkillMin: 0.25,
  npcSkillMax: 0.95,
  trials: ['sentinel', 'sigils', 'pull', 'echo', 'span', 'court'],
  sentinel: {
    // Playtest verdict (twice): the clock must BITE. 45s on a 90yd field
    // means roughly 25s of green time at the ~55 percent duty cycle, so a
    // clean run needs near-constant motion and the shrinking windows matter.
    durationS: 45,
    fieldLength: 90,
    fieldHalfWidth: 18,
    greenMinS: 3.0,
    greenMaxS: 6.5,
    redMinS: 2.0,
    redMaxS: 4.0,
    accelPerCycle: 0.88,
    greenFloorS: 1.4,
    telegraphS: 0.8,
    graceS: 0.35,
    redMoveEps: 0.06,
    hardFailDamage: 14,
    stunS: 1.5,
    pushbackYards: 6,
    momentumDecay: 0.82,
    momentumStopEps: 0.02,
    // End-of-trial toll at score 0 = the full vitality pool, so failing to
    // cross (an idle player scores 0) is fatal from full health; any real
    // progress scales the toll down (crossing clears >= 1 and takes nothing).
    damageMax: 100,
    // The scripted survivors' invisible attrition tithe. Its own small knob,
    // NOT derived from damageMax: making player failure lethal must never shift
    // the NPC field's standings.
    npcTithe: 6,
    finishBonusMax: 0.25,
    npcSpeedMin: 5.2,
    npcSpeedMax: 7.2,
    npcSpeedJitter: 0.18,
    npcReactMinS: 0.15,
    npcReactMaxS: 0.75,
    npcStopLagMaxS: 0.3,
    npcHesitateChance: 0.3,
    npcHesitateMinS: 0.3,
    npcHesitateMaxS: 0.9,
    // Human feel: a gentle running weave, an overshoot past the line, and an
    // end-zone mill so the field reads as a crowd of people rather than a
    // conveyor belt that halts on the mark.
    npcWeaveAmp: 1.1,
    npcWeaveFreq: 2.4,
    npcOvershootMin: 2.5,
    npcOvershootMax: 7.0,
    npcMillAmp: 0.9,
  },
  sigils: {
    // Difficulty pass 4 (still read too soft): the trace is now a CONTINUOUS
    // trace, not order-free freedraw. Coverage only extends contiguously from the
    // stroke's live frontier (start anywhere, either direction), so you must walk
    // the whole loop in one connected pass; dabbing disconnected pieces carves
    // nothing. The accept band is tightened to 0.02 (hug the line), the off-band
    // crack rate is raised (straying fails fast), and the finish threshold is
    // near-total. The five shapes are flat SVGs (triangle, circle, star,
    // rectangle, hexagon); the roll picks any of them (trial_sigils startSigils).
    durationS: 80,
    outlinePoints: 96,
    tolerance: 0.02, // shape-local units (the outline lives in a unit square)
    // ~0.02 of the loop (about 2 of the 96 vertices) per on-band point: the carve
    // window that a single on-band point lights around its own arc position.
    carveArcFrac: 0.02,
    // The largest arc gap (fraction of the loop) a point may sit from the covered
    // frontier and still count as CONTINUING the trace (gap is filled in). A hit
    // further out than this is a jump across the shape and carves nothing, so
    // scattered dabs never stitch the loop together.
    contiguityArcFrac: 0.05,
    // Anti-teleport rate cap only: contiguity is the real gate now, so this sits
    // well above an honest continuous drag (~45 vertices/s) and just stops a
    // single fat batch from carving the whole (index-ordered) outline at once.
    coverageCapPerS: 45,
    crackMax: 100,
    crackOffPath: 30,
    thinSectionMult: 1.7,
    shatterDamage: 20,
    // Full-pool toll at zero coverage: never tracing the etching is fatal from
    // full health; the score curve scales it down with how much you carved.
    damageMax: 100,
  },
  pull: {
    durationS: 75,
    leadInS: 2,
    // A good player's cycle is spawn gap + the shrink down to the target
    // (~0.6 of shrinkS), so clicks land roughly every 2s; pullForceMax is
    // sized so clean timing out-pulls the NPC drift by a wide margin.
    circleSpawnMinS: 0.4,
    circleSpawnMaxS: 1.4,
    circleShrinkMinS: 1.3,
    circleShrinkMaxS: 2.8,
    // Ramp to 45% by the end: late-trial circles spawn about twice as often and
    // shrink about twice as fast, so the pull tightens the longer it runs.
    circleRampMin: 0.45,
    circleStartSize: 200,
    circleTargetSize: 75,
    pullForceMax: 2.2,
    gradePower: 1.5,
    npcHeavePeriodS: 1.1,
    npcForceMin: 0.7,
    npcForceMax: 1.05,
    winThreshold: 12,
    // The end-of-pull toll at ZERO contribution = the full vitality pool. The
    // toll scales down with how hard a player pulled (their accumulated force
    // vs winThreshold), so an idle contestant is knocked out even if their side
    // won on the NPC drift, while a hard puller who lost is only wounded.
    lossDamage: 100,
  },
  echo: {
    durationS: 100,
    stones: 4,
    rounds: 5,
    baseLen: 3, // sequences run 3..7 flashes across the five rounds
    stepS: 0.7,
    inputS: 10,
    missDamage: 10,
    // Full-pool toll at zero rounds cleared: never answering the stones is
    // fatal from full health (on top of the per-timeout missDamage); clearing
    // rounds scales it down.
    damageMax: 100,
  },
  span: {
    durationS: 100,
    steps: 14,
    // Playtest: the 2.6yd panes read as stepping stones, not platforms. A
    // 4yd pane is a real floor tile you stand on and survey from; the venue
    // length (GAUNTLET_VENUE.span.length) tracks steps * panelLength.
    panelLength: 4,
    panelWidth: 4,
    panelGap: 1.4,
    fallDamage: 17,
    npcAheadCount: 3,
    npcHopS: 0.7, // a crosser bounds one panel every 0.7s (a brisk run-and-jump)
    npcJumpHeight: 0.9,
    npcPlungeS: 0.7,
    npcPlungeDrop: 3.5,
    npcStumbleChance: 0.55, // scouts are human: better than half the time one panel trips them
    // Full-pool toll at zero progress: never stepping onto the span is fatal
    // from full health; each proven panel scales the toll down.
    damageMax: 100,
  },
  court: {
    // A standard-combat brawl on a normalized hp pool: every fighter is set to
    // maxHp and trades plain auto-attack swings (real `damage` events on real
    // hp, no class/gear/level in play). The pool is vitalityMax (100), so the hp
    // fraction the standings board + health frame show, and the damage floaties,
    // land on one 0..100 scale (matching every other trial). ~12 swings to drop
    // a foe 1v1, faster under focus-fire; the 90s clock is a comfortable ceiling.
    durationS: 90,
    arenaRadius: 11,
    maxHp: 100, // = vitalityMax: the shared hp pool every fighter is normalized to
    npcMoveSpeed: 7, // = RUN_SPEED: NPCs move exactly as fast as a player
    strikeDamage: 8, // authored auto-attack hit (bypasses armor, so it is equal for all)
    strikeIntervalS: 1.6, // seconds between swings
    strikeRange: 4, // melee reach (a touch under MELEE_RANGE)
    // NPC melee AI, all rolled from the per-run stream (skill-scaled 0..1):
    npcReactMinS: 0.15, // target-decision latency at skill 1
    npcReactMaxS: 0.75, // decision latency at skill 0
    npcRetargetS: 3, // how often an NPC re-picks its foe
  },
};
