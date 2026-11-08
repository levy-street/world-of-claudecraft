// The Guardian of the Breath's fight state (encounters/smith_heart/breath.ts),
// as Entity.smithHeartBreath on the guardian. A type-only leaf so
// src/sim/types.ts can name it. Sim authority only: the client reads the
// fight from the wind object's template, the guardian's bars and auras, the
// players' auras and the fight's objects (breath_ids.ts says which).

import type { BreathDifficulty, BreathWindPhase } from './breath_ids';
import type { BreathShove } from './breath_shove';
import type { SlainWatch } from './voice_slain';

/** The wind's clock (phase 1, and the heroic gusts of phase 2). */
export interface BreathWind {
  phase: BreathWindPhase;
  /** Seconds left in the phase, and its whole length. */
  remaining: number;
  total: number;
  /** Where it blows (or will blow) toward: compass degrees. */
  bearing: number;
  /** Blows begun this pull (the next bearing's index). */
  blows: number;
}

/** A bar the guardian runs for the fight. */
export interface BreathBar {
  castId: string;
  /** Where its feet were planted (world). */
  at: { x: number; y: number; z: number };
  targetId: number | null;
}

/** Captain Thessaly's circle of calm (instance-local centre). */
export interface BreathCalm {
  objectId: number;
  x: number;
  z: number;
  state: 'land' | 'hold' | 'spent';
  remaining: number;
  /** The players it anchored, in the order they stepped in. */
  seated: number[];
}

/** A timed spot on the floor: a strike's warning, charged ground's life. */
export interface BreathSpot {
  objectId: number;
  x: number;
  z: number;
  r: number;
  remaining: number;
  /** A strike: what it deals on landing (and whether it leaves charged
   *  ground: a conductor's). Charged ground: its bite's clock. */
  kind: 'barrage' | 'drawn' | 'charged';
  tick: number;
}

/** Heroic: a loose gale and who it tossed when (player id to fight clock). */
export interface BreathGale {
  objectId: number;
  k: number;
  t: number;
  tossed: Record<number, number>;
}

/** Phase 2: one of the Thunder's Cradle's lifted players (the guardian
 *  channels them all at once). */
export interface BreathCradle {
  playerId: number;
  objectId: number;
  x: number;
  z: number;
  remaining: number;
}

/** Phase 2: the marked conductor. */
export interface BreathDrawn {
  playerId: number;
  remaining: number;
  /** Seconds to the next strike at their feet. */
  next: number;
}

/** A body riding the gale to an isle or home (breath_isles.ts): its
 *  carrier object, the arc's ends (instance-local, y the floor heights) and
 *  its clock. */
export interface BreathRide {
  playerId: number;
  objectId: number;
  isle: number;
  dir: 'out' | 'home';
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  t: number;
  total: number;
}

/** One add of the isles' round. */
export interface BreathIsleAdd {
  id: number;
  isle: number;
  role: 'sentinel' | 'mender';
  /** The Mender's next channel (seconds), and its channel's planted spot. */
  next: number;
  at: { x: number; y: number; z: number } | null;
  /** Its last spot on its isle's floor (breath_isle_hold.ts): a step off
   *  the rim is undone to it. */
  floor?: { x: number; y: number; z: number };
}

/** The Islands of the Wind (breath_isles.ts). */
export interface BreathIsles {
  /** The next threshold (an index into the tier's `isleAt`). */
  next: number;
  /** The round in flight: the Bulwark up, the woken isles, its clock. */
  round: {
    isles: number[];
    whole: number;
    elapsed: number;
    at: { x: number; y: number; z: number };
  } | null;
  adds: BreathIsleAdd[];
  /** The Gale Paths on the Cornice and the Homeward Gales on the isles. */
  paths: { isle: number; objectId: number }[];
  homes: { isle: number; objectId: number }[];
  rides: BreathRide[];
  /** Bodies a ride set down, to the fight clock their grace ends at. */
  grace: Record<number, number>;
}

/** Heroic and Mythic: one Knotted Gale (instance-local place; held, the carrier's). */
export interface BreathKnot {
  objectId: number;
  x: number;
  z: number;
  fuse: number;
  carrierId: number | null;
}

/** Heroic and Mythic: one open portal of the Knotted Gale (instance-local place). */
export interface BreathPortal {
  objectId: number;
  x: number;
  z: number;
}

/** Heroic and Mythic: one round of the Knotted Gale (breath_heart.ts). */
export interface BreathHeart {
  knots: BreathKnot[];
  /** How many pairs of portals this round opens: 1 (A and B, phase 1's one
   *  ball) or 2 (A and B, C and D, phase 2's two balls). */
  pairs: 1 | 2;
  /** Seconds left on the portal marks (0: they have ended). */
  mark: number;
  /** Who wears each mark (null: none, or a dev force opened it). */
  markA: number | null;
  markB: number | null;
  markC: number | null;
  markD: number | null;
  /** Who may not take a ball this round (the marks' players). */
  bearers: number[];
  /** The portals: A links to B only, C to D only. */
  portalA: BreathPortal | null;
  portalB: BreathPortal | null;
  portalC: BreathPortal | null;
  portalD: BreathPortal | null;
  /** The last spot on the floor of each marked player and carrier: where a
   *  portal opens or a ball drops when its body has left the floor. */
  floorSpots: Record<number, { x: number; z: number }>;
  /** Bodies standing in a portal they did not walk into (they just crossed, or it
   *  opened under them): no crossing until they step clear. */
  crossed: number[];
  /** Throw presses since the last tick (the interact command). */
  presses: number[];
}

/** The Summit Roar's wave (breath_roar.ts): where it left the maw (world
 *  yards), its front's radius, how far it runs, who it has struck, and the
 *  throws still sliding. */
export interface BreathRoar {
  x: number;
  z: number;
  r: number;
  reach: number;
  struck: number[];
  slides: BreathShove[];
}

export interface BreathFightState {
  kind: 'breath';
  difficulty: BreathDifficulty;
  /** The boss's pool before its tier's (tier_health.ts), given back at a reset. */
  basePool?: number;
  /** The guardian has fallen and the end was resolved. */
  finished: boolean;
  /** Seconds since the pull. */
  clock: number;
  /** The fight's half: the Wind, the storm breaking, the Storm. */
  half: 'wind' | 'break' | 'storm';
  /** The hashed start of the blows' bearing order (breath_ids.ts blowBearing). */
  start: number;
  wind: BreathWind;
  bar: BreathBar | null;
  /** Breath after a bar before the next begins. */
  gap: number;
  inhaleTimer: number;
  /** Phase 1: the next circle of calm. */
  circleTimer: number;
  calm: BreathCalm | null;
  /** Where the last circle stood (the next lands elsewhere), and the last
   *  round's balls (the next round's drop elsewhere): instance-local. */
  lastCalm: { x: number; z: number } | null;
  lastKnots: { x: number; z: number }[];
  /** Seconds each pinned player has been pressed since its last hit. */
  pinned: Record<number, number>;
  /** Players gone over an open lip this pull (each said once). */
  overLip: number[];
  /** The guardian's last spot on the Cornice's floor (world yards): a step
   *  the mob AI takes off it is undone to here (breath_void.ts). */
  floorSpot: { x: number; y: number; z: number } | null;
  /** Players Thessaly's calm anchors now (an anchor run out, heroic leaves
   *  them spent). */
  anchors: number[];
  /** The vortex object while the guardian draws breath, and its clock. */
  vortex: { objectId: number; x: number; z: number; tick: number } | null;
  gales: BreathGale[];
  /** The loose gales' tosses still sliding (breath_shove.ts). */
  galeShoves: BreathShove[];
  /** The Summit Roar's wave in flight (breath_roar.ts), or null. */
  roar: BreathRoar | null;
  /** The storm breaking: the barrage's clock (seconds left, next volley). */
  barrage: { remaining: number; next: number; volleys: number } | null;
  spots: BreathSpot[];
  forkTimer: number;
  cradleTimer: number;
  drawnTimer: number;
  swellTimer: number;
  swellPulses: number;
  gustTimer: number;
  /** The Thunder's Cradle's lifted (all held by one channel). */
  cradles: BreathCradle[];
  isles: BreathIsles;
  drawn: BreathDrawn | null;
  /** Heroic and Mythic: the Knotted Gale's round, its clock and the rounds so far. */
  heart: BreathHeart | null;
  heartTimer: number;
  heartRuns: number;
  /** Mechanic casts started (the deterministic salt of every pick). */
  casts: number;
  /** Lines said this pull: `<speaker>_<moment>` to the fight clock. */
  said: Record<string, number>;
  /** The players seen dead this pull and the pull's deaths (the kill lines'
   *  watch, voice_slain.ts). */
  slain: SlainWatch;
}
