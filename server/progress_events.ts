// Progress events: an OBSERVER of the sim's levelup / questAccepted /
// questDone / death events at the game.ts drain, never an authority. It
// copies the deeds_records runtime shape: each insert chains onto a
// per-process FIFO promise tail the game loop NEVER awaits, a rejected
// insert logs and never blocks or reorders anything, and every entry point
// is guarded so the observer can never throw into the event-routing path.
// A lost row costs one analytics data point, never gameplay. Shutdown awaits
// progressEventsIdle() (server/main.ts) so queued rows are not dropped by
// pool.end(); unlike deeds there is no reconcile heal path for a lost row.
//
// Volume gates live HERE (one place, unit-testable):
// - level_up_events records every ding at any level (a ding is rare and the
//   table is the whole point: the full per-level friction map).
// - ftue_events records only while the character's level is at or below
//   FTUE_MAX_LEVEL; quest rows are additionally first-touch-unique in SQL
//   (progress_events_db.ts), and death rows are capped per character below,
//   so no client-drivable loop can grow the table unboundedly.
// - The FIFO itself is depth-bounded: past MAX_PENDING queued inserts the
//   observer sheds new rows (counted, log-throttled) instead of growing an
//   unbounded promise chain during a db stall.

import { zoneContaining } from '../src/sim/data';
import type { Entity } from '../src/sim/types';
import { pool } from './db';
import {
  FTUE_MAX_LEVEL,
  type FtueEventKind,
  insertFtueEvent,
  insertLevelUpEvent,
} from './progress_events_db';
import { REALM } from './realm';

/** The session fields the observer reads; game.ts sessions satisfy this
 *  structurally, and tests pass a plain object. The fields are COPIED into a
 *  plain object before chaining, so a queued backlog never pins the live
 *  session graph after logout. */
export interface ProgressEventWho {
  characterId: number;
  accountId: number;
}

/** The one sim read the death observer needs: the live entity map, for the
 *  dying player's level/position and the killer's identity. Structural so a
 *  test passes a bare Map without building a Sim. */
export interface ProgressEventSimView {
  entities: Map<number, Entity>;
}

/** FIFO depth bound: past this many queued-but-unflushed inserts (a db stall
 *  at the ~50 ms loop's event volume), new rows are shed and counted rather
 *  than growing the chain without bound. */
export const MAX_PENDING_PROGRESS_EVENTS = 1000;

/** Death rows recorded per character per process lifetime. Dying this many
 *  times inside the level 1-10 window is far past any real player's run; the
 *  cap exists so deaths (which have no quest id and therefore no SQL
 *  first-touch bound) cannot be farmed into table growth. */
export const FTUE_DEATH_ROWS_PER_CHARACTER = 30;

// Bound on the death-counter map itself so it can never become a slow leak on
// a very long-lived process; clearing resets caps, which only re-opens the
// (already generous) per-character allowance.
const DEATH_COUNTER_MAP_MAX = 50_000;

// Per-process FIFO tail, the deeds_records pattern: chaining preserves event
// order per process; a rejection is caught (logged) and the chain continues.
let tail: Promise<void> = Promise.resolve();
let pending = 0;
let shedRows = 0;
let lastShedLogAt = 0;
const deathRowsByCharacter = new Map<number, number>();

const SHED_LOG_INTERVAL_MS = 60_000;

function shed(): void {
  shedRows += 1;
  const now = Date.now();
  if (now - lastShedLogAt >= SHED_LOG_INTERVAL_MS) {
    lastShedLogAt = now;
    console.error(`progress events FIFO full; shed ${shedRows} rows so far`);
  }
}

function enqueue(run: () => Promise<void>, label: string): void {
  if (pending >= MAX_PENDING_PROGRESS_EVENTS) {
    shed();
    return;
  }
  pending += 1;
  tail = tail
    .then(run)
    .catch((err) => {
      console.error(`${label} write failed:`, err);
    })
    .finally(() => {
      pending -= 1;
    });
}

/** Rows shed by the depth bound since boot (observability + tests). */
export function progressEventsShedCount(): number {
  return shedRows;
}

/** Mirror one level-up into level_up_events, fire-and-forget. */
export function recordLevelUp(who: ProgressEventWho, level: number): void {
  try {
    const characterId = who.characterId;
    const accountId = who.accountId;
    enqueue(
      () => insertLevelUpEvent(pool, { realm: REALM, characterId, accountId, level }),
      'level_up_events',
    );
  } catch (err) {
    // The observer must never fault the event-routing path.
    console.error('progress recordLevelUp failed:', err);
  }
}

/** Mirror one quest accept/turn-in into ftue_events, fire-and-forget.
 *  Silently drops events past the FTUE window (the gate, not an error);
 *  repeat touches of the same quest collapse in SQL (first-touch unique). */
export function recordFtueQuest(
  who: ProgressEventWho,
  kind: Extract<FtueEventKind, 'quest_accepted' | 'quest_done'>,
  questId: string,
  level: number,
): void {
  if (level > FTUE_MAX_LEVEL) return;
  try {
    const characterId = who.characterId;
    const accountId = who.accountId;
    enqueue(
      () => insertFtueEvent(pool, { realm: REALM, characterId, accountId, kind, questId, level }),
      'ftue_events',
    );
  } catch (err) {
    console.error('progress recordFtueQuest failed:', err);
  }
}

/** Mirror one player death into ftue_events, fire-and-forget. Derives the
 *  level, zone, and killer template from the live entity map at call time
 *  (the drain runs the same tick, so both entities are still present; a
 *  despawned killer degrades to null, never an error). zoneContaining is the
 *  caller-facing zone read: it answers null for the instance plane instead of
 *  misreporting an instanced death as an overworld zone. */
export function recordFtueDeath(
  who: ProgressEventWho,
  sim: ProgressEventSimView,
  entityId: number,
  killerId: number,
): void {
  try {
    const player = sim.entities.get(entityId);
    if (!player) return;
    const level = player.level;
    if (level > FTUE_MAX_LEVEL) return;
    const characterId = who.characterId;
    const accountId = who.accountId;
    if (deathRowsByCharacter.size >= DEATH_COUNTER_MAP_MAX) deathRowsByCharacter.clear();
    const deaths = deathRowsByCharacter.get(characterId) ?? 0;
    if (deaths >= FTUE_DEATH_ROWS_PER_CHARACTER) return;
    deathRowsByCharacter.set(characterId, deaths + 1);
    const zone = zoneContaining(player.pos.x, player.pos.z)?.id ?? null;
    const killer = sim.entities.get(killerId)?.templateId ?? null;
    enqueue(
      () =>
        insertFtueEvent(pool, {
          realm: REALM,
          characterId,
          accountId,
          kind: 'death',
          level,
          zone,
          killer,
        }),
      'ftue_events death',
    );
  } catch (err) {
    console.error('progress recordFtueDeath failed:', err);
  }
}

/** The current FIFO tail: tests await it to drain deterministically, and the
 *  server shutdown path awaits it before pool.end() so queued rows land. */
export function progressEventsIdle(): Promise<void> {
  return tail;
}
