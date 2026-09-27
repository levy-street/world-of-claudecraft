// The craft_roll_events observer: mirrors the sim's `craftRoll` audit event
// (src/sim/types.ts) into the database, fire-and-forget, behind a bounded
// FIFO (the progress_events.ts shape). The game loop never awaits a write and
// a rejected insert logs rather than throws; past MAX_PENDING queued inserts
// (a database stall at the loop's event volume) new rows are shed and counted
// rather than growing the chain without bound.

import type { SimEvent } from '../src/sim/types';
import { insertCraftRollEvent } from './craft_roll_events_db';
import { pool } from './db';
import { REALM } from './realm';

export type CraftRollEvent = Extract<SimEvent, { type: 'craftRoll' }>;

/** The session fields the observer reads; game.ts sessions satisfy this
 *  structurally and tests pass a plain object. Copied into the row before
 *  chaining, so a queued backlog never pins a live session after logout. */
export interface CraftRollWho {
  characterId: number;
  accountId: number;
}

/** FIFO depth bound: past this many queued-but-unflushed inserts, new rows
 *  are shed and counted rather than queued. */
export const MAX_PENDING_CRAFT_ROLL_EVENTS = 1000;

const SHED_LOG_INTERVAL_MS = 60_000;

let tail: Promise<void> = Promise.resolve();
let pending = 0;
let shedRows = 0;
let lastShedLogAt = 0;

function shed(): void {
  shedRows += 1;
  const now = Date.now();
  if (now - lastShedLogAt >= SHED_LOG_INTERVAL_MS) {
    lastShedLogAt = now;
    console.error(`craft roll events FIFO full; shed ${shedRows} rows so far`);
  }
}

/** Rows shed by the depth bound since boot (observability + tests). */
export function craftRollEventsShedCount(): number {
  return shedRows;
}

/** Mirror one resolved roll into craft_roll_events, fire-and-forget. The
 *  row is built synchronously from the event and the caller identity, so a
 *  later mutation of either never reaches the write. */
export function recordCraftRoll(who: CraftRollWho, ev: CraftRollEvent): void {
  try {
    if (pending >= MAX_PENDING_CRAFT_ROLL_EVENTS) {
      shed();
      return;
    }
    const row = {
      realm: REALM,
      characterId: who.characterId,
      accountId: who.accountId,
      kind: ev.kind,
      recipeId: ev.recipeId,
      itemId: ev.itemId,
      roll: ev.roll,
      chance: ev.chance,
      success: ev.success,
      rankBefore: ev.rankBefore ?? null,
      rankAfter: ev.rankAfter ?? null,
    };
    pending += 1;
    tail = tail
      .then(() => insertCraftRollEvent(pool, row))
      .catch((err) => {
        console.error('craft_roll_events write failed:', err);
      })
      .finally(() => {
        pending -= 1;
      });
  } catch (err) {
    console.error('craft roll recordCraftRoll failed:', err);
  }
}

/** Resolves once every queued insert has settled (the shutdown drain and
 *  tests). Never rejects: failures log inside the chain. */
export function craftRollEventsIdle(): Promise<void> {
  return tail;
}
