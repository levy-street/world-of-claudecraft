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
// Two ladders, exactly like the arena tabs: the LIVE online one rides the `bg`
// snapshot key (BgInfo.ladder, built by src/sim/social/battleground.ts
// bgLadder), and the persistent all-time one is the server's cached REST board
// (GET /api/battleground/leaderboard) held in the painter-owned cache fed in
// here.
//
// DOM-free and i18n-free: rows carry the raw class id plus a `knownClass` flag
// the painter localizes; CLASSES is read here only to decide that flag.

import { CLASSES } from '../../../sim/data';
import { BATTLEGROUND_FIRST_WIN_BONUS_HONOR } from '../../../sim/pvp';
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

/** A LIVE-ladder row: rank + the raw class id (painter localizes when known).
 *  The arena's ArenaLadderRow shape (arena_window_view.ts); no `level`, because
 *  the live rows are drawn from the connected roster, not the stored board. */
export interface BgLadderRow {
  rank: number;
  me: boolean;
  name: string;
  cls: string;
  knownClass: boolean;
  rating: number;
  wins: number;
  losses: number;
}

/** An all-time ladder row: a live row plus the player level the title shows. */
export interface BgAllTimeRow extends BgLadderRow {
  level: number;
}

/** The main action affordance for the current state. */
export type BgWindowAction =
  | { kind: 'in-match'; scoreCrimson: number; scoreAzure: number }
  | { kind: 'queued'; queueSize: number; queuedParty: number }
  | {
      kind: 'idle';
      partySize: number;
      requiredLevel: number;
      locked: boolean;
      /** In a real party but not its leader: only the leader may queue the
       *  group (the sim refuses server-side regardless). Mirrors the arena
       *  arm's own leader gate in arena_window_view.ts. */
      queueDisabled: boolean;
    };

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
      /** The first-win-of-the-day Honor bonus chip, or null once today's win has
       *  claimed it. `honor` is the sim's own constant, imported here the same
       *  way BG_MIN_LEVEL is, rather than shipped as a second wire field. */
      firstWinBonus: { honor: number } | null;
      /** Rated champions online right now, best first (BgInfo.ladder). */
      ladder: BgLadderRow[];
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
  /** Own pid, to tell the party leader from a member (the queue is leader-only). */
  playerId: number;
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
  const { info: b, playerName, playerLevel, party, playerId, allTime } = input;
  if (!b) return { kind: 'offline' };

  const partySize = party?.members.length ?? 1;
  // Solo counts as leader of self, so a lone player is never gated.
  const isLeader = !party || party.leader === playerId;
  const action: BgWindowAction = b.match
    ? { kind: 'in-match', scoreCrimson: b.match.scores[0], scoreAzure: b.match.scores[1] }
    : b.queued
      ? { kind: 'queued', queueSize: b.queueSize, queuedParty: b.queuedParty }
      : {
          kind: 'idle',
          partySize,
          requiredLevel: BG_MIN_LEVEL,
          locked: playerLevel < BG_MIN_LEVEL,
          queueDisabled: partySize > 1 && !isLeader,
        };

  // The live online ladder off the snapshot. `?? []` guards a snapshot mirrored
  // from an older server that predates the field during a rolling deploy (the
  // ArenaInfo.match.map precedent); the section renders its empty state then.
  const ladderRows = b.ladder ?? [];
  const ladder: BgLadderRow[] = ladderRows.map((r, i) => ({
    rank: i + 1,
    me: r.pid === playerId,
    name: r.name,
    cls: r.cls,
    knownClass: Boolean((CLASSES as Record<string, unknown>)[r.cls]),
    rating: r.rating,
    wins: r.wins,
    losses: r.losses,
  }));

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
    // `=== true` on purpose, not a truthiness read: a snapshot mirrored from a
    // server that predates the field (rolling deploy) leaves it undefined, and
    // the honest degradation is to omit the chip rather than promise a bonus
    // that side may not pay. Same guard shape as the `b.ladder ?? []` arm below.
    firstWinBonus:
      b.firstWinBonusReady === true ? { honor: BATTLEGROUND_FIRST_WIN_BONUS_HONOR } : null,
    ladder,
    allTime: allTimeRows,
    // The live rows go in whole (rank, identity, rating, record), so any move
    // on the ladder rebuilds the panel; the all-time rows keep their existing
    // narrower digest. Both are the DERIVED rows, never the raw payload: the
    // payload is the caller's object and may not be JSON-safe.
    sig: JSON.stringify([
      b.rating,
      b.wins,
      b.losses,
      b.captures,
      action,
      // In the signature so the chip really disappears the moment a win claims
      // it: without this the panel would keep the stale chip until some other
      // field moved (and the very win that claims it also moves the record, so
      // the bug would hide behind that until a draw or a rollover).
      b.firstWinBonusReady === true,
      partySize,
      ladder,
      allTimeRows?.map((r) => [r.name, r.rating, r.wins, r.losses]) ?? null,
    ]),
  };
}
