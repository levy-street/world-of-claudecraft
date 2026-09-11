// Soulfire: RETIRED FROM PLAY in v0.42.2 (owner call, 2026-09-11).
//
// Soulfire was the pool a Soul Rend mark left where it detonated (purple fire
// the stack point had to rotate away from). Together with everything else
// the redo layered onto the fight it made Nythraxis too hard, so the driver
// (encounters/nythraxis.ts updateNythraxisSoulRend) no longer ignites pools:
// a detonation splits its hit and leaves the floor clean. What remains here
// is the tuning the still-shipped plumbing reads: the `soul` flame kind stays
// on the wire and in the renderer (server/nythraxis_wire.ts,
// src/render/nythraxis_grave_flame_visual.ts) so a staged fixture still
// renders, the cast id still keys the ability VFX spec and the log matcher,
// and the tick fraction still sits in the avoidable-damage table. Removing the
// kind end to end is a normal-cycle cleanup, not a hotfix.
//
// `src/sim`-pure: no rng, no wall clock, no DOM.

import type { DungeonDifficulty } from './types';

export const NYTHRAXIS_SOULFIRE_CAST_ID = 'Soulfire';
export const NYTHRAXIS_SOULFIRE_RADIUS = 4;
export const NYTHRAXIS_SOULFIRE_SECONDS_NORMAL = 15;
export const NYTHRAXIS_SOULFIRE_SECONDS_HEROIC = 12;
export const NYTHRAXIS_SOULFIRE_TICK_MAX_HP_NORMAL = 0.08;
export const NYTHRAXIS_SOULFIRE_TICK_MAX_HP_HEROIC = 0.12;

export function nythraxisSoulfireSeconds(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_SOULFIRE_SECONDS_HEROIC
    : NYTHRAXIS_SOULFIRE_SECONDS_NORMAL;
}

export function nythraxisSoulfireTickMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? NYTHRAXIS_SOULFIRE_TICK_MAX_HP_HEROIC
    : NYTHRAXIS_SOULFIRE_TICK_MAX_HP_NORMAL;
}
