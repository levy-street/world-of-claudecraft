// Run-state types for The Gauntlet (content shape: types.ts GauntletDef;
// tuning: content/gauntlet.ts). A leaf module (no sim.ts import) so the Sim
// coordinator, the gauntlet system modules, and tests all share these shapes
// without a cycle. The backing state lives on Sim (`gauntletRuns`), exposed to
// the modules as a live SimContext view, per the seam rules.

import type { Rng } from '../rng';
import type { GauntletPhase, Vec3 } from '../types';

// One roster entry per contestant, players and NPCs alike. Players additionally
// get a GauntletPlayerState entry in run.playerStates (keyed by pid, which in
// this codebase is the player's entity id).
export interface GauntletContestant {
  entityId: number;
  player: boolean;
  name: string;
  vitality: number;
  // Seeded 0..1 talent roll driving the NPC performance scripts; 0 for players
  // (a player's fate is decided by their own play, never by a roll).
  skill: number;
  eliminatedAtTrial: number | null;
  // Sentinel-trial NPC script, planned when the trial opens: green-light
  // advance speed (yards/s) and the red-flip index this NPC fumbles on (it
  // overruns the grace window and poofs), or null for a scripted survivor.
  script: { speed: number; fumbleOnFlip: number | null };
}

export interface GauntletPlayerState {
  savedPos: Vec3; // where to return the player when they leave the run
  spectating: boolean; // knocked out, parked on the spectator platform
  // Momentum carried after input release (yards per tick). The slide counts as
  // movement for red-light detection, so stopping must be anticipated.
  momentumX: number;
  momentumZ: number;
  // While heldUntil is ahead of the clock, the player is pinned at heldAt each
  // tick (the catch stun and the staging line-up); cleared when it elapses.
  heldAt: Vec3 | null;
  heldUntil: number;
  finishedAt: number | null; // sim time the player crossed the finish line
  bestZ: number; // furthest instance-local field progress this trial (score)
}

export interface GauntletSentinelState {
  kind: 'sentinel';
  light: 'green' | 'red';
  flipAt: number; // absolute sim time the current light ends
  graceUntil: number; // absolute; motion forgiveness after a red flip
  greenWindowS: number; // current green window length (shrinks per cycle)
  flipCount: number; // red flips so far; NPC fumble scripts key off this
}

export type GauntletTrialState = GauntletSentinelState;

export interface GauntletRun {
  id: number;
  slot: number;
  seed: number;
  // Per-run deterministic stream (NEVER the shared sim stream): the roster,
  // trial schedules, and NPC scripts all draw from here, so an active run
  // never perturbs the world's global rng draw order (the parity gate pins
  // this).
  rng: Rng;
  origin: { x: number; z: number };
  phase: GauntletPhase;
  trialIndex: number;
  phaseEndsAt: number; // absolute sim-time deadline of the current phase
  prizePool: number; // theater in v1: advertised, never paid out
  contestants: GauntletContestant[];
  playerStates: Map<number, GauntletPlayerState>;
  trial: GauntletTrialState | null;
  watcherId: number | null;
  podium: { first: string; second: string; third: string; winnerEntityId: number | null } | null;
  emptyFor: number; // seconds with no player attached; disposes the run
}
