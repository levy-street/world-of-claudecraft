// The Exchange service's process-local ledger arithmetic, extracted from the
// coordinator (the monolith ratchet's own rule: growth pays with extraction).
// These are pure walkers over the service's in-memory maps: the park ledgers
// (row id to next-retry time), the pending-grant and pending-mail intent
// stamps. The MAPS stay on WocMarketService (they are its live state, keyed
// to its process lifetime); only the arithmetic lives here, so a Vitest can
// drive it without a service.

/** Entries in the process-local ledgers older than this are dead weight: a
 *  pending grant is only usable while its exact session lives, a pending
 *  mail attempt retries within a pass or two, and a parked entry's skip
 *  window is minute-scale. Pruned on the delivery beat so an abandoned
 *  reference cannot pin memory for the process lifetime. */
export const WOC_LOCAL_LEDGER_TTL_MS = 10 * 60_000;

/** Hard entry bound for the PARK maps (the escrow write-path rider's growth
 *  bound). Steady state is batch-scale (each pass can park at most one
 *  SWEEP_BATCH of rows per arm, and the TTL prune reaps stale retries), so
 *  the cap only bites a mass-park event, an economy outage parking every
 *  delivery at once, where unbounded growth would also mean an unbounded
 *  `id <> ALL($n)` array in every batch read (wocBackedOffIds inherits this
 *  bound by construction). Sized at many multiples of the batch (the
 *  tunables ladder pins the relation against the scraped SWEEP_BATCH). */
export const WOC_LOCAL_PARK_MAX_ENTRIES = 512;

/** Process-lifetime count of cap-refused parks (the review round: the
 *  mass-park incident the cap exists for is exactly when an operator needs
 *  to know parks are being refused, and each refused row also costs one
 *  batch slot plus one rotation write per pass until the prune frees
 *  room). Module-level like the db contention counters. */
let parkRefusals = 0;
export function wocParkRefusalCount(): number {
  return parkRefusals;
}

/** Park a row's retry time, refusing NEW entries at the cap: a refused park
 *  costs one batch slot next pass (the row simply retries un-excluded),
 *  never memory. An EXISTING id may always re-park, or rotation itself
 *  would die exactly at the cap. Returns whether the entry stands; every
 *  refusal is counted. */
export function wocParkRow(
  park: Map<number, number>,
  id: number,
  retryAtMs: number,
  cap: number = WOC_LOCAL_PARK_MAX_ENTRIES,
): boolean {
  if (!park.has(id) && park.size >= cap) {
    parkRefusals++;
    return false;
  }
  park.set(id, retryAtMs);
  return true;
}

/** High-water mark for the STAMP maps (pendingGrants, pendingMail). These
 *  hold exactly-once intents, so nothing here may ever DROP an entry: the
 *  TTL prune is the only remover, and crossing this mark is an incident to
 *  warn about (a delivery system stamping faster than it settles), never a
 *  reason to shed state. */
export const WOC_LOCAL_STAMP_HIGH_WATER = 512;

/** The ids inside their backoff window (retry still in the future): the
 *  batch reads EXCLUDE them so a parked row costs no batch slot; the array
 *  is bounded by the park cap above. */
export function wocBackedOffIds(parked: ReadonlyMap<number, number>, nowMs: number): number[] {
  const out: number[] = [];
  for (const [id, retryAtMs] of parked) {
    if (retryAtMs > nowMs) out.push(id);
  }
  return out;
}

/** One prune beat over every process-local ledger. Stamp maps age on their
 *  stamp; park maps store RETRY times, not stamps, so they prune once the
 *  retry itself has been stale for the ledger horizon. */
export function pruneWocLocalLedgers(
  nowMs: number,
  stamped: ReadonlyArray<Map<string, { stampMs: number }>>,
  parks: ReadonlyArray<Map<number, number>>,
  ttlMs: number = WOC_LOCAL_LEDGER_TTL_MS,
): void {
  const cutoff = nowMs - ttlMs;
  for (const ledger of stamped) {
    for (const [ref, entry] of ledger) {
      if (entry.stampMs <= cutoff) ledger.delete(ref);
    }
  }
  for (const park of parks) {
    for (const [id, retryAtMs] of park) {
      if (nowMs - retryAtMs > ttlMs) park.delete(id);
    }
  }
}
