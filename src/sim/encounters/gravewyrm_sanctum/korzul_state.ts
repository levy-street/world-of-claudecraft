// Korzul's fight state (encounters/gravewyrm_sanctum/korzul.ts), on the boss as
// Entity.sanctumFight. A type-only leaf so src/sim/types.ts can name it in the
// SanctumFightState union. Sim authority only: the client reads the fight from
// casts, auras, heights and the encounter objects (the plates' template ids).
//
// Unlike the other Sanctum fights this state lives for the whole claim: the
// lake's nineteen plates exist before the pull (the lake reads Sound from the
// shore), so `phase` is 'idle' between pulls and the plates reset on a wipe.

import type { PlateRec } from './plates';

export type KorzulPhase =
  /** Not in his fight (frozen in the face before the pull, or reset). */
  | 'idle'
  /** Break Free, the cinematic (the burst, the rise, the arc over the lake,
   *  the landing), out of reach throughout. Played when a player wakes him
   *  (no pull: `waking`) or, from a forced pull, as the fight's opening. */
  | 'emerge'
  /** Awake and free of the ice, standing on the arena centre, NOT in his
   *  fight: he waits there until a player walks into his aggro radius or
   *  strikes him (the ordinary pull), then his ground fight begins. */
  | 'ready'
  /** On the ice, his ground kit. */
  | 'ground'
  /** A flight: Wing Gale's bar, the climb, the air (the descent included). */
  | 'gale'
  | 'takeoff'
  | 'air'
  /** No ice left: he hovers over open water and breathes without pause. */
  | 'drown'
  /** He fell (the plate under him broke). */
  | 'slain';

export interface KorzulFlight {
  /** 1 or 2. */
  n: number;
  /** Seconds since the climb ended (the air's clock). */
  t: number;
  /** Wyrm's Eye rounds this flight, and how many have been marked. */
  rounds: number;
  marked: number;
  /** The live marks: the player, and the seconds left on the eye. */
  eyes: { pid: number; remaining: number }[];
  /** Every player marked this flight (the next mark goes to someone else). */
  carried: number[];
  /** Plunging Fire's warning on its plates: plate indices, the fire objects,
   *  seconds left. */
  plunge: { plates: number[]; objectIds: number[]; remaining: number } | null;
  /** Crashing Descent: the landing plate, the shadow object, seconds left. */
  landing: { plate: number; objectId: number; remaining: number } | null;
  /** Where he hovers (claim-local). */
  hoverX: number;
  hoverZ: number;
}

export interface KorzulFightState {
  kind: 'korzul';
  phase: KorzulPhase;
  /** Seconds into the current phase step (emerge: since the pull; gale,
   *  takeoff, drown). */
  pt: number;
  /** The lake: one record per LAKE_PLATES entry. */
  plates: PlateRec[];
  breathTimer: number;
  tailTimer: number;
  infernoTimer: number;
  galeTimer: number;
  /** The Inferno's hp gates consumed (KORZUL_TUNING.infernoAtHpPct). */
  infernoGates: number;
  /** The channel in flight: seconds in, pulses landed. */
  inferno: { t: number; pulses: number } | null;
  /** Seconds he still hauls himself out of the water after being Doused. */
  doused: number;
  /** A locked cone's aim while its bar runs (breath, tail). */
  aimYaw: number | null;
  /** Where he braced for a bar (world). */
  plantedAt: { x: number; y: number; z: number } | null;
  /** Flights taken (0 to 2); the flight in progress. */
  flights: number;
  flight: KorzulFlight | null;
  /** The last phase (after the second flight): the shard flares. */
  lastPhase: boolean;
  enraged: boolean;
  /** The brood he called from the water (entity ids). */
  broodIds: number[];
  /** The quench-water's one-second clock. */
  quenchTick: number;
  /** Mechanic casts started (the deterministic salt). */
  casts: number;
  /** Break Free's cinematic (korzul_emerge.ts): where he set out from
   *  (claim-local; `pt` is its clock). Null outside it. */
  emergeFrom: { x: number; z: number } | null;
  /** The cinematic was started by a player walking into the wake ring, not by
   *  a pull: it plays out of combat and lands him 'ready', never on anyone. */
  waking: boolean;
}
