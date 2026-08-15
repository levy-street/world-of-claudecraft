// Resolved-match records for Thornhollow Fields: the compact post-tick readout the
// authoritative host drains to answer "is BG_CAPS_TO_WIN tuned right", without
// which cap tuning is guesswork (the cut from 5 to 3 was made on one playtest).
//
// A PURE LEAF, the src/sim/mob/scan_counters.ts shape: plain data the host reads
// after a tick, feeding no gameplay branch and drawing no rng, so appending to it
// cannot perturb determinism. The backing array lives on `Sim` like every other
// piece of sim state and reaches this module as a live SimContext view.
//
// Rated matches only (the caller gates it): a /dev force-started match is
// deliberately asymmetric and would poison the very averages this exists for.
//
// BOUNDED BY CONSTRUCTION. The authoritative server drains every tick, but the
// offline and headless hosts never drain at all, so an unbounded array here would
// be a slow leak in exactly the two hosts nobody watches. Past the cap the OLDEST
// record is dropped: a stale record is worth less than a fresh one to every
// consumer, and a host that is not draining has no consumer at all.

/** The one record a resolved rated match leaves behind. Scalars only: nothing
 *  per-player, so this can never become a per-character log. */
export interface BgOutcomeRecord {
  /** `BgMatch.id`. Test and debug identity ONLY: no metric labels itself with
   *  it (that would be an unbounded series), and the drain does not read it. */
  matchId: number;
  /** Elapsed seconds of ACTIVE play, 0 for a match resolved during form-up. */
  durationSec: number;
  scoreCrimson: number;
  scoreAzure: number;
  /** The same vocabulary the `bgEnd` event ships to the client. */
  ended: 'caps' | 'timer' | 'forfeit';
  /** At least one side was seated from a QUEUED GROUP of 2 or more, as the
   *  matchmaker reported it at match start. NOT the matchmaker's own
   *  `premadeVsPugs` fairness notion (a block of BG_PREMADE_SIZE facing solos);
   *  see `BgMatch.grouped`. */
  grouped: boolean;
}

/** How many undrained records a host keeps. Comfortably more than BG_SLOT_COUNT
 *  concurrent matches could resolve between two drains, and small enough that a
 *  never-draining host holds a fixed, trivial amount of memory forever. */
export const BG_OUTCOME_LOG_CAP = 64;

export function createBgOutcomeLog(): BgOutcomeRecord[] {
  return [];
}

/** Append one resolved-match record, dropping the oldest past the cap. */
export function recordBgOutcome(log: BgOutcomeRecord[], record: BgOutcomeRecord): void {
  log.push(record);
  while (log.length > BG_OUTCOME_LOG_CAP) log.shift();
}

/** Take every pending record and leave the log empty. The host calls this once
 *  per tick; a caller that never calls it simply keeps the capped tail. */
export function drainBgOutcomes(log: BgOutcomeRecord[]): BgOutcomeRecord[] {
  if (log.length === 0) return [];
  return log.splice(0, log.length);
}
