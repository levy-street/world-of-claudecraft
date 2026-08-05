// Pure core for a meter panel's bar list: which members get a bar, in what
// order, with what value and how full.
//
// Extracted from the single Meters.render() when the panel became
// instance-parameterized: the damage window and each detached Threat / Healing
// window now build their rows through this one function, so a ranking or
// threat-folding rule can never drift between them. DOM-free and i18n-free; the
// painter localizes the names and formats the numbers.

/** The three meters a panel can show. */
export type MeterTab = 'dmg' | 'heal' | 'threat';

/** A member's live pets, needed because pet hate folds into the owner column. */
export interface MeterPet {
  pid: number;
  name: string;
}

/** The slice of a MemberTally the row model reads. */
export interface MeterRowTally {
  pid: number;
  name: string;
  cls: string | null;
  dmg: number;
  heal: number;
  /** damage per mob entity id, the threat fallback for a finished encounter */
  dmgByMob: Map<number, number>;
}

export interface MeterRow {
  tally: MeterRowTally;
  value: number;
  /** 0..1 of the biggest row, for the bar width */
  fill: number;
  /** the engaged mob is targeting this member, or one of their pets */
  hasAggro: boolean;
}

export interface MeterRowsInput {
  tallies: Iterable<MeterRowTally>;
  tab: MeterTab;
  /** The engaged mob's live hate table, or null for a finished encounter. */
  liveThreat: Map<number, number> | null;
  /** Live pets per owner; only read on the threat tab. */
  petsByOwner: Map<number, MeterPet[]> | null;
  /** Threat-subject mob, used for the damage fallback when hate is gone. */
  mainMobId: number | null;
  /** Who the engaged mob is actually swinging at. */
  aggroPid: number | null;
}

/** A member's threat column: their own hate plus every pet they own. */
export function threatOf(
  pid: number,
  threat: Map<number, number>,
  pets: MeterPet[] | undefined,
): number {
  let total = threat.get(pid) ?? 0;
  for (const pet of pets ?? []) total += threat.get(pet.pid) ?? 0;
  return total;
}

function valueFor(tally: MeterRowTally, input: MeterRowsInput): number {
  if (input.tab === 'dmg') return tally.dmg;
  if (input.tab === 'heal') return tally.heal;
  if (input.liveThreat) {
    return threatOf(tally.pid, input.liveThreat, input.petsByOwner?.get(tally.pid));
  }
  // No live hate table (a finished encounter whose mob is gone): fall back to
  // each member's damage on the threat-subject mob.
  return input.mainMobId !== null ? (tally.dmgByMob.get(input.mainMobId) ?? 0) : 0;
}

/**
 * Rank the tallies into bars for one tab. Zero rows are dropped, and `fill` is
 * relative to the top bar so the leader always fills its track.
 */
export function buildMeterRows(input: MeterRowsInput): MeterRow[] {
  const scored = [...input.tallies]
    .map((tally) => ({ tally, value: valueFor(tally, input) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = scored[0]?.value ?? 1;
  const { aggroPid } = input;
  return scored.map(({ tally, value }) => ({
    tally,
    value,
    fill: value / top,
    // The mob's own target keeps the marker; a pet holding aggro marks its
    // OWNER's bar, since the pet no longer has one of its own.
    hasAggro:
      input.tab === 'threat' &&
      aggroPid !== null &&
      (aggroPid === tally.pid ||
        (input.petsByOwner?.get(tally.pid)?.some((pet) => pet.pid === aggroPid) ?? false)),
  }));
}
