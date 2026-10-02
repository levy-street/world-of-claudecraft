// THE LOGIN PATH'S DURABLE READ POLICY, in one small named module: the clock
// read turned into the pair the store installs (a ready time and a revision, or
// a cold clock), and the COMBINED read that puts both login statements on one
// transaction. Extracted from server/freehold_persist.ts
// because none of it needs the store's private state, only somewhere to log, and
// because the clock's failure policy is the deliberate ASYMMETRY that file argues
// at length: the plot fails CLOSED (an unreadable row holds the account and the
// row is left alone) while the clock fails OPEN (an unreadable clock starts cold
// and the login proceeds). Keeping that policy in one small named module is what
// stops the next reader restoring symmetry by accident.

import { FREEHOLD_MAX_STORED_BYTES } from '../src/sim/freehold/persisted';
import { boundedDatabaseError } from './freehold_bounded_error';
import { FREEHOLD_GENERATION_TEXT_RE } from './freehold_claim_db';
import type { FreeholdRowLoad } from './freehold_db';
import type { FreeholdHearthLoad } from './freehold_hearth_db';
import type { FreeholdHearthAnswer, FreeholdPersistPorts } from './freehold_persist';

/** The absent clock's revision, spelled through a constant on both sides: the
 *  plot fence and the hearth counter are different counters that share a value,
 *  and a bare zero is how a later reader comes to think they are one. */
export const ABSENT_HEARTH_REVISION = '0';

/** What the store installs for one account: a forward-only ready time and the
 *  revision it was read at. */
export interface FreeholdHearthReading {
  readonly readyAtMs: number;
  readonly revision: string;
}

/**
 * Adopt onto a store entry a durable Hearth clock a LATER transaction proved
 * (a remote trip's committed advance, or the clock its cooldown refusal read),
 * FORWARD ONLY BY REVISION: an older or equal revision is a stale reading and
 * never replaces a newer one, so a replay of the entry (a relog on this process
 * before the entry is swept) answers the newest clock this process knows,
 * never the one it read at login. A revision that is not positive bigint text,
 * or a ready time that is not a positive finite number, changes nothing.
 * Answers whether it adopted.
 */
export function adoptFreeholdHearthReading(
  entry: { hearthReadyAtMs: number; hearthRevision: string },
  readyAtMs: number,
  revision: string,
): boolean {
  if (typeof revision !== 'string' || !FREEHOLD_GENERATION_TEXT_RE.test(revision)) return false;
  if (!Number.isFinite(readyAtMs) || readyAtMs <= 0) return false;
  if (BigInt(revision) <= BigInt(entry.hearthRevision)) return false;
  entry.hearthReadyAtMs = readyAtMs;
  entry.hearthRevision = revision;
  return true;
}

/**
 * The login read's clock, settled onto its entry. A FIRST read installs it as
 * read. A RE-READ of a loaded entry (the store re-reads a clean entry whose
 * claim it lost) only moves it forward by revision, so a cold fallback or an
 * older reading never undoes a newer clock a trip proved. Answers the clock
 * the entry now holds, which is the one the load must answer with.
 */
export function settleFreeholdHearthReading(
  entry: { loaded: boolean; hearthReadyAtMs: number; hearthRevision: string },
  reading: FreeholdHearthReading,
): FreeholdHearthReading {
  if (entry.loaded) {
    adoptFreeholdHearthReading(entry, reading.readyAtMs, reading.revision);
  } else {
    entry.hearthReadyAtMs = reading.readyAtMs;
    entry.hearthRevision = reading.revision;
  }
  return { readyAtMs: entry.hearthReadyAtMs, revision: entry.hearthRevision };
}

/** The cold clock, and the ONE place its shape is written. */
export const COLD_HEARTH: FreeholdHearthReading = {
  readyAtMs: 0,
  revision: ABSENT_HEARTH_REVISION,
};

/**
 * A durable clock load, normalized. A `state` load answers its own numbers, with
 * a non-finite or non-positive ready time floored to zero rather than carried
 * onward as NaN. Every other kind answers the cold clock, and an `unsupported`
 * one says so, because that kind means a row EXISTS in a shape this build cannot
 * read: silently starting cold there hides a schema the realm has outgrown.
 *
 * COLD IS READY, and that is the fail-open half of this module's asymmetry
 * rather than an oversight. The sibling reader's docblock once claimed the
 * 'unsupported' kind is what stops a damaged row granting a trip; it is not,
 * and both files now say so. The kind buys the WARN. Refusing the trip belongs
 * to the 07a admission participant, which is the caller that has a trip to
 * refuse; nothing writes the row in this release, so nothing acts on it yet.
 */
export function normalizeHearthLoad(
  load: FreeholdHearthLoad,
  warn: (message: string) => void,
): FreeholdHearthReading {
  if (load.kind === 'state') {
    const readyAtMs = Number(load.state.readyAtMs);
    return {
      readyAtMs: Number.isFinite(readyAtMs) && readyAtMs > 0 ? readyAtMs : 0,
      revision: load.state.revision,
    };
  }
  if (load.kind === 'unsupported') {
    warn(`freehold hearth clock unsupported (${load.detail}); the cooldown starts cold`);
  }
  return COLD_HEARTH;
}

/** The two login reads, on one client when the host offers one. The row half
 *  is allowed to throw, because the store's loadOnce turns that into a HOLD; the
 *  clock half is not, because a clock the store cannot read starts COLD rather
 *  than faulting the plot load beside it (a deliberate asymmetry carried as a
 *  named gate). ONE PATH FOR BOTH PORT SHAPES, deliberately: written as two
 *  returns, the combined arm normalized outside a `try` the fallback arm had, so a
 *  malformed clock payload failed OPEN on one host and held the whole login on the
 *  other. Which port a host binds must not decide that. Moved whole out of
 *  server/freehold_persist.ts (its monolith ceiling): it reads ports, never the
 *  store's state. */
export async function readFreeholdLoginPair(
  ports: Pick<FreeholdPersistPorts, 'readDurables' | 'readRow' | 'readHearth' | 'warn' | 'error'>,
  accountId: number,
): Promise<{ rowLoad: FreeholdRowLoad; hearth: FreeholdHearthReading }> {
  const cold = (err: unknown): FreeholdHearthReading => {
    ports.error(
      'freehold hearth clock read failed; the cooldown starts cold:',
      boundedDatabaseError(err),
    );
    return COLD_HEARTH;
  };
  const combined = ports.readDurables;
  const both = combined
    ? await combined(accountId, FREEHOLD_MAX_STORED_BYTES)
    : { row: await ports.readRow(accountId, FREEHOLD_MAX_STORED_BYTES), hearth: null };
  try {
    // ON THE PORT, NEVER ON THE VALUE. `both.hearth ?? await readHearth(...)`
    // sent a combined port answering a nullish clock to the UNSHARED reader,
    // which is the coupling this merge removes and, on the real host, a second
    // read outside the transaction. A nullish load throws INTO the catch below
    // and answers a cold clock, the same as any other unreadable clock.
    const load = combined ? both.hearth : await ports.readHearth(accountId);
    if (load === null) throw new Error('the durable port answered no hearth load');
    return {
      rowLoad: both.row,
      hearth: load.kind === 'threw' ? cold(load.error) : normalizeHearthLoad(load, ports.warn),
    };
  } catch (err) {
    return { rowLoad: both.row, hearth: cold(err) };
  }
}
