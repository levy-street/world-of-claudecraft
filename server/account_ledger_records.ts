// Relic-find records: an OBSERVER of the sim's relicRecorded events, never an
// authority, the exact sibling of server/deeds_records.ts for the Reliquary
// half of the account ledger. The sim alone decides a fill
// (src/sim/reliquary.ts) and persists membership inside the characters.state
// blob; this module only mirrors each find into the account_relic_finds index
// the per-join ledger load reads. Same runtime shape as the deeds observer:
// a per-process FIFO tail the game loop NEVER awaits, a rejected insert logs
// and never blocks or reorders anything, the whole body is guarded so the
// observer can never throw into the caller, and idempotence lives in the SQL
// (ON CONFLICT DO NOTHING over UNIQUE (character_id, relic_key)). The login
// reconcile replays the blob's proven finds (selfRelicKeys) on every join so a
// row a transient insert failure dropped is re-created next login; its rows
// land UNDATED (found_at NULL, the ledger's "no calendar" value), because the
// blob keeps no per-relic day and the replay moment is not the find.

import type { PlayerClass } from '../src/sim/types';
import { insertAccountRelicFinds } from './account_ledger_db';
import { bustAccountLedgerKeys } from './account_ledger_keys_cache';
import { REALM } from './realm';

let tail: Promise<void> = Promise.resolve();

/** The finder identity every row carries: ids for the joins, name and class
 *  snapshotted so the find outlives the character. */
export interface RelicRecordWho {
  characterId: number;
  accountId: number;
  name: string;
  cls: PlayerClass;
}

const UNDATED: Readonly<{ undated: true }> = { undated: true };

function enqueue(
  who: RelicRecordWho,
  keys: readonly string[],
  opts?: Readonly<{ undated?: boolean }>,
): void {
  try {
    const row = { realm: REALM, ...who };
    tail = tail
      // Two-argument for the live path on purpose: the dated call is the
      // pinned shape, and the undated arm is the reconcile's alone.
      .then(() =>
        opts ? insertAccountRelicFinds(row, keys, opts) : insertAccountRelicFinds(row, keys),
      )
      // The public sheet's cached ledger view learns the row on its next read.
      .then(() => bustAccountLedgerKeys(who.accountId))
      .catch((err) => {
        console.error('account_relic_finds write failed:', err);
      });
  } catch (err) {
    console.error('relic recordRelicFinds failed:', err);
  }
}

/** Mirror a batch of sim-decided relic finds into account_relic_finds in ONE
 *  insert, fire-and-forget. The post-save drain uses this (the
 *  recordDeedUnlocks durability ordering: only finds already inside a landed
 *  blob publish). Dated: the row default stamps the find moment. An empty
 *  slice never touches the tail. */
export function recordRelicFinds(who: RelicRecordWho, relicKeys: readonly string[]): void {
  if (relicKeys.length === 0) return;
  enqueue(who, [...relicKeys]);
}

/** Login-time reconcile: replay every relic the character's authoritative
 *  state proves it holds into account_relic_finds idempotently, chained onto
 *  the SAME FIFO tail as live finds so it never races them. Heals a dropped
 *  row and backfills a veteran whose blob predates the table, UNDATED (see
 *  the header). Fire-and-forget, fully guarded; an empty set never touches
 *  the tail. */
export function reconcileAccountRelics(who: RelicRecordWho, relicKeys: readonly string[]): void {
  if (relicKeys.length === 0) return;
  enqueue(who, [...relicKeys], UNDATED);
}

/** The current FIFO tail, for tests and the shutdown drain. */
export function relicRecordsIdle(): Promise<void> {
  return tail;
}
