// The Gauntlet, a time-limited survival event (see docs in types.ts
// GauntletDef). Data-as-code only: every numeric knob the gauntlet modules use
// lives HERE, never inline in module logic, so balancing is a one-file edit.
// Trials land one per release phase; `trials` below is the currently shipped
// sequence and grows as later trials are implemented.

import type { GauntletDef, NpcDef } from '../types';

export const GAUNTLET_RECRUITER_NPC_ID = 'gauntlet_recruiter';
export const GAUNTLET_WATCHER_NPC_ID = 'gauntlet_watcher';
export const GAUNTLET_CONTESTANT_NPC_ID = 'gauntlet_contestant';

// All three are `dynamic`: registered in NPCS (so the online client can resolve
// their defs) but never surface-placed at world init. The gauntlet module spawns
// the recruiter while the event window is open and the watcher/contestants per
// run inside the instance slot.
export const GAUNTLET_NPCS: Record<string, NpcDef> = {
  [GAUNTLET_RECRUITER_NPC_ID]: {
    id: GAUNTLET_RECRUITER_NPC_ID,
    name: 'Maro Half-Mask',
    title: 'Herald of the Gauntlet',
    // east edge of the town square, facing the well
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
  podiumZ: -16, // the podium ceremony anchor, behind the staging area
} as const;

// The six trial arenas of the venue complex, one anchor per trials[] entry
// (instance-local yards). Trial 1 plays on the sentinel field itself; the
// other five are DRESSED but sealed until their trials ship (one per release
// phase), and each future trial's gameplay lands AT its anchor so the map
// and the mechanics never drift apart. The renderer builds the whole complex
// from these (src/render/gauntlet_venue.ts); keep every position here, never
// inline in render code.
export const GAUNTLET_VENUE = {
  // Trial 2, Sugarglass Sigils: a circular etching pavilion.
  sigils: { x: -44, z: 10, radius: 10 },
  // Trial 3, The Great Pull: a sunken rope trench.
  pull: { x: -44, z: 44, length: 24, width: 9 },
  // Trial 4, Keeper's Wager: a walled dueling courtyard.
  wager: { x: -44, z: 78, size: 15 },
  // Trial 5, The Brittle Span: a raised twin-track bridge over a dark pit.
  span: { x: -76, z: 44, length: 34, deckY: 5 },
  // Trial 6, The Final Court: the champions' ring.
  court: { x: -76, z: 86, radius: 9 },
  // Grandstands flank the sentinel field on both sides.
  standX: 27, // inner edge of each grandstand (mirrored at -standX)
  standZMin: 14,
  standZMax: 76,
  // The venue ground apron: the flat dressed footprint around everything.
  groundHalfWidth: 110,
  groundZMin: -46,
  groundZMax: 130,
} as const;

export const GAUNTLET: GauntletDef = {
  fieldSize: 30,
  vitalityMax: 100,
  lobbyFillS: 60,
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
  // After the sentinel trial the NPC field is culled toward 12 survivors. One
  // entry per trials[i]; later trials append their targets here.
  targetSurvivorsPerTrial: [12],
  npcSkillMin: 0.25,
  npcSkillMax: 0.95,
  trials: ['sentinel'],
  sentinel: {
    durationS: 300,
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
    hardFailDamage: 22,
    stunS: 1.5,
    pushbackYards: 6,
    momentumDecay: 0.82,
    momentumStopEps: 0.02,
    damageMax: 45,
    finishBonusMax: 0.25,
  },
};
