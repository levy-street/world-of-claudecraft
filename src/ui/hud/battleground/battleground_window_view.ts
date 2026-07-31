// Pure, host-agnostic view model for the Thornhollow Fields (battleground) queue window.
//
// The pure-core half of the pure-core + thin-painter split (arena_window_view.ts
// is the family template). It models the one thing the window decides that is
// worth testing without a DOM: which state the snapshot is in (offline vs live),
// the player's standing, the main action affordance (in-match / queued / idle),
// and the all-time ladder rows. The DOM/i18n + network side lives in the
// merged PvP window (src/ui/arena_window.ts, renderThornhollowFields: Thornhollow Fields is
// that window's primary tab); rendering is driven off the structure here.
//
// Unlike the arena there is no live-online ladder on the wire: the persistent
// ladder is the server's cached REST board (GET /api/battleground/leaderboard),
// held in the painter-owned all-time cache fed in here.
//
// DOM-free and i18n-free: rows carry the raw class id plus a `knownClass` flag
// the painter localizes; CLASSES is read here only to decide that flag.

import { CLASSES } from '../../../sim/data';
import { BG_MIN_LEVEL } from '../../../sim/social/battleground';
import type { BgInfo, PartyInfo } from '../../../world_api';

/** One all-time ladder entry as the HUD caches it (server-fetched, online only). */
export interface BgAllTimeEntry {
  name: string;
  class: string;
  level: number;
  rating: number;
  wins: number;
  losses: number;
}

/** An all-time ladder row: rank + the raw class id (painter localizes when known). */
export interface BgAllTimeRow {
  rank: number;
  me: boolean;
  name: string;
  cls: string;
  knownClass: boolean;
  level: number;
  rating: number;
  wins: number;
  losses: number;
}

/** The main action affordance for the current state. */
export type BgWindowAction =
  | { kind: 'in-match'; scoreCrimson: number; scoreAzure: number }
  | { kind: 'queued'; queueSize: number; queuedParty: number }
  | { kind: 'idle'; partySize: number; requiredLevel: number; locked: boolean };

/** The full window view-model: the offline/not-synced notice, or the live panel. */
export type BgWindowView =
  | { kind: 'offline' }
  | {
      kind: 'live';
      rating: number;
      wins: number;
      losses: number;
      captures: number;
      action: BgWindowAction;
      allTime: BgAllTimeRow[] | null;
      /** Identity of the rendered content; the painter skips a rebuild when equal. */
      sig: string;
    };

/** Inputs the painter feeds the builder each render. */
export interface BgWindowViewInput {
  info: BgInfo | null;
  playerName: string;
  /** Own level, for the queue floor (BG_MIN_LEVEL) display + lock. */
  playerLevel: number;
  party: PartyInfo | null;
  /** The all-time board cache (painter-owned, server-fetched; null until seen). */
  allTime: BgAllTimeEntry[] | null;
}

/**
 * Build the window view-model. `info === null` is the offline / not-yet-synced
 * mirror state. Reads only IWorld-mirrored data plus the painter-owned all-time
 * cache, so the offline Sim and the online ClientWorld mirror produce identical
 * output for identical snapshots.
 */
export function buildBgWindowView(input: BgWindowViewInput): BgWindowView {
  const { info: b, playerName, playerLevel, party, allTime } = input;
  if (!b) return { kind: 'offline' };

  const partySize = party?.members.length ?? 1;
  const action: BgWindowAction = b.match
    ? { kind: 'in-match', scoreCrimson: b.match.scores[0], scoreAzure: b.match.scores[1] }
    : b.queued
      ? { kind: 'queued', queueSize: b.queueSize, queuedParty: b.queuedParty }
      : {
          kind: 'idle',
          partySize,
          requiredLevel: BG_MIN_LEVEL,
          locked: playerLevel < BG_MIN_LEVEL,
        };

  const allTimeRows: BgAllTimeRow[] | null = allTime
    ? allTime.map((r, i) => ({
        rank: i + 1,
        me: r.name === playerName,
        name: r.name,
        cls: r.class,
        knownClass: Boolean((CLASSES as Record<string, unknown>)[r.class]),
        level: r.level,
        rating: r.rating,
        wins: r.wins,
        losses: r.losses,
      }))
    : null;

  return {
    kind: 'live',
    rating: b.rating,
    wins: b.wins,
    losses: b.losses,
    captures: b.captures,
    action,
    allTime: allTimeRows,
    sig: JSON.stringify([
      b.rating,
      b.wins,
      b.losses,
      b.captures,
      action,
      partySize,
      allTimeRows?.map((r) => [r.name, r.rating, r.wins, r.losses]) ?? null,
    ]),
  };
}
