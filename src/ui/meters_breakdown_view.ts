// Pure core for the combat meters' hover breakdown: turns one member's raw
// per-source tallies into the ranked rows the tooltip paints.
//
// DOM-free and i18n-free on purpose: it emits stable discriminators (the raw
// ability name as the combat event reported it, the pet's display name, the
// folded-row count) plus the numbers, and meters.ts localizes them. That keeps
// the ranking and share math unit-testable in plain Node.
//
// The same shape serves all three tabs: damage and healing break down BY
// ABILITY (a pet's abilities carry the pet's name, so a hunter running two pets
// can still tell which of them did what), while threat breaks down BY
// CONTRIBUTOR (the member's own hate plus one row per pet), where every entry
// has a null ability.

/** One raw contribution before ranking: an ability, or a whole contributor. */
export interface BreakdownEntry {
  /** ability name as the combat event reported it; null = a white/melee swing */
  ability: string | null;
  /** display name of the pet that dealt it, or null when the member did */
  petName: string | null;
  amount: number;
}

export interface BreakdownRow extends BreakdownEntry {
  /** 0..1 of the model total, for the percentage cell */
  share: number;
  /** 0..1 of the biggest row, for the inline bar width */
  fill: number;
  /** 0 on a normal row; on the trailing row, how many entries folded into it */
  folded: number;
}

export interface BreakdownModel {
  total: number;
  /** total over the encounter duration (DPS / HPS) */
  perSecond: number;
  rows: BreakdownRow[];
}

/** Rows shown before the tail folds into a single "other" row. */
export const BREAKDOWN_ROW_CAP = 8;

/** Merge key for two contributions that belong on the same row. */
export function breakdownKey(petName: string | null, ability: string | null): string {
  return `${petName ?? ''}\u0000${ability ?? ''}`;
}

// Descending by amount, then a deterministic name tie-break so two abilities
// that traded blow for blow never swap places between renders.
function compareEntries(a: BreakdownEntry, b: BreakdownEntry): number {
  if (b.amount !== a.amount) return b.amount - a.amount;
  const pet = (a.petName ?? '').localeCompare(b.petName ?? '');
  if (pet !== 0) return pet;
  return (a.ability ?? '').localeCompare(b.ability ?? '');
}

/**
 * Rank `entries` into tooltip rows. Zero and negative amounts are dropped, and
 * everything past `rowCap` folds into one trailing row carrying its count.
 */
export function buildMeterBreakdown(
  entries: Iterable<BreakdownEntry>,
  durationSeconds: number,
  rowCap: number = BREAKDOWN_ROW_CAP,
): BreakdownModel {
  const kept = [...entries].filter((entry) => entry.amount > 0).sort(compareEntries);
  const total = kept.reduce((sum, entry) => sum + entry.amount, 0);
  // The duration is a measured encounter length, but a segment one tick old must
  // not divide by ~0 and report a nonsense rate (MeterData floors it at 1s too).
  const perSecond = total / Math.max(1, durationSeconds);
  const top = kept[0]?.amount ?? 0;
  const shareOf = (amount: number) => (total > 0 ? amount / total : 0);
  const fillOf = (amount: number) => (top > 0 ? amount / top : 0);

  // Past the cap the LAST shown slot belongs to the folded row, so the tooltip
  // never grows beyond rowCap lines.
  const shown = rowCap > 0 && kept.length > rowCap ? kept.slice(0, rowCap - 1) : kept;
  const rows: BreakdownRow[] = shown.map((entry) => ({
    ...entry,
    share: shareOf(entry.amount),
    fill: fillOf(entry.amount),
    folded: 0,
  }));

  const folded = kept.slice(shown.length);
  if (folded.length > 0) {
    const amount = folded.reduce((sum, entry) => sum + entry.amount, 0);
    rows.push({
      ability: null,
      petName: null,
      amount,
      share: shareOf(amount),
      fill: fillOf(amount),
      folded: folded.length,
    });
  }
  return { total, perSecond, rows };
}
