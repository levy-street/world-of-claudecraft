// Arena season records: an OBSERVER of the sim's ranked bout results, never an
// authority. The sim decides every match outcome and every Elo move; this module
// only mirrors "these characters competed in this season, and these two fought
// as a pair" into the tables the season settlement later ranks over.
//
// Runtime shape copied from deeds_records.ts, for the same reasons: each write
// chains onto a per-process FIFO promise tail the game loop NEVER awaits, a
// rejected write logs and never blocks or reorders anything, and the whole body
// is guarded so the observer can never throw into the tick. A lost row costs at
// most one bout of participation credit out of a half-year season, which is why
// the fire-and-forget trade is the right one here: correctness of the ladder
// itself never depends on it.

import {
  ARENA_SEASON_BRACKETS,
  type ArenaSeasonBracket,
  isArenaSeasonIndex,
} from '../src/sim/arena_season';
import { recordArenaSeasonEntrant, recordArenaSeasonPair } from './arena_season_db';

/** What one `arenaEnd` report should write. Both fields may be null. */
export interface ArenaSeasonBoutWrites {
  /** The bracket to credit this reporter with entering, or null to write none. */
  entrant: ArenaSeasonBracket | null;
  /** The duo to credit, in canonical (low, high) order, or null. */
  pair: [number, number] | null;
}

const NO_WRITES: ArenaSeasonBoutWrites = { entrant: null, pair: null };

/**
 * Decide what one participant's bout report writes. Pure, so the two rules that
 * are easy to get wrong are testable without a live GameServer:
 *
 * - Only the two RANKED brackets count. Fiesta and the Protect Yumi brackets
 *   never move the Elo ladder, so they can never crown a champion.
 * - A 2v2 duo is written by exactly ONE of its members. Both teammates report
 *   the same bout with the other as their ally, so the lower character id is
 *   elected the single writer; without that the duo would be counted twice.
 *
 * An absent ally (a bot, or a teammate whose session already left) yields the
 * entrant row alone: the reporter still competed.
 */
export function arenaSeasonBoutWrites(input: {
  season: number;
  format: string;
  selfCharacterId: number;
  allyCharacterId?: number;
}): ArenaSeasonBoutWrites {
  // Preseason (and any junk index) writes nothing: participation only means
  // something inside a season that can actually be settled.
  if (!isArenaSeasonIndex(input.season)) return NO_WRITES;
  const bracket = (ARENA_SEASON_BRACKETS as readonly string[]).includes(input.format)
    ? (input.format as ArenaSeasonBracket)
    : null;
  if (!bracket) return NO_WRITES;
  const ally = input.allyCharacterId;
  const pairs =
    bracket === '2v2' && ally !== undefined && input.selfCharacterId < ally
      ? ([input.selfCharacterId, ally] as [number, number])
      : null;
  return { entrant: bracket, pair: pairs };
}

// Per-process FIFO tail. Ordering across bouts does not affect the result
// (participation is a counter, and the ranking reads ratings live), but chaining
// keeps the write pressure of a busy Coliseum to one in-flight statement.
let tail: Promise<void> = Promise.resolve();

function chain(work: () => Promise<void>, label: string): void {
  tail = tail.then(work).catch((err) => console.error(`arena season ${label} record failed:`, err));
}

/** Record that a character fought a ranked bout in a season and bracket. */
export function recordArenaSeasonEntry(row: {
  realm: string;
  season: number;
  bracket: ArenaSeasonBracket;
  characterId: number;
}): void {
  try {
    chain(() => recordArenaSeasonEntrant(row), 'entrant');
  } catch (err) {
    console.error('arena season entrant record failed:', err);
  }
}

/** Record that two characters fought a ranked 2v2 bout as a pair. */
export function recordArenaSeasonPartnership(row: {
  realm: string;
  season: number;
  characterIdA: number;
  characterIdB: number;
}): void {
  try {
    chain(() => recordArenaSeasonPair(row), 'pair');
  } catch (err) {
    console.error('arena season pair record failed:', err);
  }
}
