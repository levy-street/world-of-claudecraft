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
  // Sentinel-trial NPC script. Planned when the trial opens: the green-light
  // pace (yards/s, skill-lerped between the npcSpeed bounds) and the red-flip
  // index this NPC fumbles on (it overruns the grace window and poofs), or
  // null for a scripted survivor. The rest is per-light-window improv,
  // replanned from run.rng whenever the light changes (planKey tracks the
  // window): a start hesitation (goAt), a stop lag after red (stopAt), this
  // green's speed multiplier, and an optional mid-run stutter (a pause is
  // armed only while pauseUntil > pauseAt).
  script: {
    speed: number;
    fumbleOnFlip: number | null;
    planKey: number;
    goAt: number;
    stopAt: number;
    mult: number;
    pauseAt: number;
    pauseUntil: number;
  };
}

export interface GauntletPlayerState {
  savedPos: Vec3; // where to return the player when they leave the run
  // Real hp when the run started: during trials every contestant's entity hp
  // MIRRORS their event vitality (so nameplates and frames show the meter that
  // matters); restored on elimination and on leaving the run.
  savedHp: number;
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

// Trial 2: per-player etched shape + crack meter (trial_sigils.ts).
export interface GauntletSigilsPlayer {
  shapeSeed: number; // (seed, shapeId) fully determine the outline everywhere
  shapeId: number; // 0 ring, 1 wedge, 2 star, 3 crown (ascending difficulty)
  crack: number;
  // Order-free freedraw coverage: one flag per outline vertex, marked as the
  // stroke passes near that vertex's arc position; progress is the covered
  // fraction (coveredCount / covered.length). Reset on shatter.
  covered: boolean[];
  coveredCount: number;
  // Fractional carve budget carried between batches (accrues at
  // coverageCapPerS, banks at most one second's worth), so the cap is
  // independent of batch cadence.
  carveBank: number;
  lastPointAt: number; // sim time of the last accepted trace batch
  shatters: number;
  done: boolean;
}
export interface GauntletSigilsState {
  kind: 'sigils';
  players: Map<number, GauntletSigilsPlayer>;
}

// Trial 3: one shared rope (trial_pull.ts). Player pulls claim beat indexes.
export interface GauntletPullState {
  kind: 'pull';
  beatAnchor: number; // absolute sim time of beat 0
  marker: number; // + = team 0 (the players' side) winning
  braceUntil: number;
  braced: Set<number>; // pids that landed the opening brace
  claimed: Map<number, number>; // pid -> highest beat index already consumed
  teamOf: Map<number, 0 | 1>; // pid -> team (solo runs put every player on 0)
  npcForce: [number, number]; // rolled per-beat NPC pull means per team
  // Every gripping contestant's base spot on the rope line (entity id ->
  // instance-local x/z); the whole line renders at base + the eased drag.
  gripBase: Map<number, { x: number; z: number }>;
  // The eased rope translation (instance-local yards, + toward team 0's side):
  // the tick driver slides every grip (and the players' pins) by this.
  kx: number;
  resolved: boolean;
  wonBy: 0 | 1 | null;
}

// Trial 4: one duel per player against a seeded partner (trial_wager.ts).
export interface GauntletWagerPair {
  pid: number;
  partnerName: string;
  partnerSkill: number;
  // The cosmetic partner NPC entity seated across the pair's mat (0 once
  // dropped). Pure theater: the duel logic never reads it.
  partnerEntityId: number;
  mine: number;
  theirs: number;
  holder: boolean; // the player hides this round
  stage: 'hold' | 'guess' | 'done';
  held: number; // marbles hidden by whoever holds
  wager: number;
  roundEndsAt: number;
  finished: boolean;
  won: boolean;
}
export interface GauntletWagerState {
  kind: 'wager';
  pairs: Map<number, GauntletWagerPair>;
}

// Trial 5: the shared brittle-panel crossing (trial_span.ts).
export interface GauntletSpanState {
  kind: 'span';
  safeSide: number[]; // per step: 0 left safe, 1 right safe (server knowledge)
  revealed: number[]; // per step: -1 unknown, else the known safe side
  npcCrossers: { entityId: number; step: number; fallStep: number | null }[];
  nextNpcStepAt: number;
  playerStep: Map<number, number>; // pid -> furthest safe step reached (-1 = none)
  finished: Set<number>;
}

// Trial 6: parallel court duels, one per surviving player (trial_court.ts).
export interface GauntletCourtDuel {
  pid: number;
  rivalId: number; // entity id of the rival
  rivalPid: number | null; // set when the rival is the other player
  attacker: boolean; // is PID currently the attacker
  swapAt: number;
  shoveReadyAt: number;
  rivalShoveAt: number;
  laneX: number; // instance-local court center for this duel
  done: boolean;
  won: boolean;
}
export interface GauntletCourtState {
  kind: 'court';
  duels: Map<number, GauntletCourtDuel>;
}

export type GauntletTrialState =
  | GauntletSentinelState
  | GauntletSigilsState
  | GauntletPullState
  | GauntletWagerState
  | GauntletSpanState
  | GauntletCourtState;

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
