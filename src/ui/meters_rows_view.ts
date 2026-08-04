// Pure core for a meter panel's bar list: which members get a bar, in what
// order, with what value and how full.
//
// Extracted from the single Meters.render() when the panel became
// instance-parameterized: the damage window and each detached Threat / Healing
// window now build their rows through this one function, so a ranking or
// pet rule can never drift between them. DOM-free and i18n-free; the painter
// localizes the names and formats the numbers.
//
// The pet rule is per TAB. On damage/healing a pet folds into its owner's bar
// (the damage-meter convention). On THREAT it gets its own bar, because the
// mob's pull-over rule compares each hate-table ENTRY separately: a combined
// owner+pet number is measured against a threshold that is never applied to it.

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
  /**
   * Set when this row is a PET's own hate row rather than its owner's; the
   * painter labels the bar with it. Null on every damage/healing row and on an
   * owner's own row.
   */
  petName: string | null;
  /**
   * The entity whose hate this row represents: the member's pid, or the pet's.
   * The mob's pull-over rule compares each hate-table ENTRY on its own, so this
   * is the id that decides the aggro marker.
   */
  threatPid: number;
  value: number;
  /** 0..1 of the biggest row, for the bar width */
  fill: number;
  /** the engaged mob is swinging at exactly this entity */
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

function valueFor(tally: MeterRowTally, input: MeterRowsInput): number {
  if (input.tab === 'dmg') return tally.dmg;
  if (input.tab === 'heal') return tally.heal;
  // No live hate table (a finished encounter whose mob is gone): fall back to
  // each member's damage on the threat-subject mob. The panel says so; these
  // are damage numbers and must never read as live hate.
  return input.mainMobId !== null ? (tally.dmgByMob.get(input.mainMobId) ?? 0) : 0;
}

/** Every candidate bar before ranking: one per member, plus one per live pet. */
function candidates(
  input: MeterRowsInput,
): { tally: MeterRowTally; petName: string | null; threatPid: number; value: number }[] {
  const out: { tally: MeterRowTally; petName: string | null; threatPid: number; value: number }[] =
    [];
  const live = input.tab === 'threat' ? input.liveThreat : null;
  for (const tally of input.tallies) {
    if (!live) {
      out.push({ tally, petName: null, threatPid: tally.pid, value: valueFor(tally, input) });
      continue;
    }
    // A pet is its OWN hate-table entry and can rip aggro on its own, so it gets
    // its own bar. Folding it into the owner (which is right for a damage meter)
    // overstated every pet class against a threshold the mob never applies to
    // the combined number.
    out.push({ tally, petName: null, threatPid: tally.pid, value: live.get(tally.pid) ?? 0 });
    for (const pet of input.petsByOwner?.get(tally.pid) ?? []) {
      out.push({ tally, petName: pet.name, threatPid: pet.pid, value: live.get(pet.pid) ?? 0 });
    }
  }
  return out;
}

/**
 * Rank the tallies into bars for one tab. Zero rows are dropped, and `fill` is
 * relative to the top bar so the leader always fills its track.
 */
export function buildMeterRows(input: MeterRowsInput): MeterRow[] {
  const scored = candidates(input)
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const top = scored[0]?.value ?? 1;
  const { aggroPid } = input;
  return scored.map(({ tally, petName, threatPid, value }) => ({
    tally,
    petName,
    threatPid,
    value,
    fill: value / top,
    // Exactly the entity the mob is swinging at, which is now always a row of
    // its own.
    hasAggro: input.tab === 'threat' && aggroPid !== null && aggroPid === threatPid,
  }));
}
