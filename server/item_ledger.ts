// The item_ledger observer: mirrors the sim's server-only `itemTracked`
// event (src/sim/types.ts, minted by src/sim/item_tracking.ts) into the
// database, fire-and-forget, behind a bounded FIFO (the craft_roll_events.ts
// shape). The game loop never awaits a write and a rejected insert logs
// rather than throws; past MAX_PENDING queued inserts (a database stall at
// the loop's event volume) new rows are shed and counted rather than growing
// the chain without bound.

import type { SimEvent } from '../src/sim/types';
import { pool } from './db';
import { insertItemLedgerEvent } from './item_ledger_db';
import { REALM } from './realm';

export type ItemTrackedEvent = Extract<SimEvent, { type: 'itemTracked' }>;

/** The session fields the observer reads; game.ts sessions satisfy this
 *  structurally and tests pass a plain object. Copied into the row before
 *  chaining, so a queued backlog never pins a live session after logout. */
export interface ItemLedgerWho {
  characterId: number;
  accountId: number;
}

/** FIFO depth bound: past this many queued-but-unflushed inserts, new rows
 *  are shed and counted rather than queued. */
export const MAX_PENDING_ITEM_LEDGER_EVENTS = 1000;

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
    console.error(`item ledger FIFO full; shed ${shedRows} rows so far`);
  }
}

/** Rows shed by the depth bound since boot (observability + tests). */
export function itemLedgerShedCount(): number {
  return shedRows;
}

/** Resolves once every queued insert has settled (tests). */
export function itemLedgerIdle(): Promise<void> {
  return tail;
}

/** Mirror one tracked-item event into item_ledger, fire-and-forget. The row
 *  is built synchronously from the event and the caller identity, so a later
 *  mutation of either never reaches the write. */
export function recordItemTracked(who: ItemLedgerWho, ev: ItemTrackedEvent): void {
  try {
    if (pending >= MAX_PENDING_ITEM_LEDGER_EVENTS) {
      shed();
      return;
    }
    const row = {
      realm: REALM,
      guid: ev.guid,
      itemId: ev.itemId,
      quality: ev.quality,
      kind: ev.kind,
      characterId: who.characterId,
      accountId: who.accountId,
      characterName: ev.by,
      source: ev.source,
      zone: ev.zone ?? null,
      occurredAtMs: ev.at,
    };
    pending += 1;
    tail = tail
      .then(() => insertItemLedgerEvent(pool, row))
      .catch((err) => {
        console.error('item_ledger write failed:', err);
      })
      .finally(() => {
        pending -= 1;
      });
  } catch (err) {
    console.error('item ledger recordItemTracked failed:', err);
  }
}
