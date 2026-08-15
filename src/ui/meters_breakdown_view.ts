// Pure core for the combat meters' hover breakdown: turns one member's raw
// per-source tallies into the ranked rows the tooltip paints.
//
// DOM-free and i18n-free on purpose: it emits stable discriminators (the raw
// ability name as the combat event reported it, the pet's display name, the
// folded-row count) plus the numbers, and meters.ts localizes them. That keeps
// the ranking and share math unit-testable in plain Node.
//
// The same shape serves all three tabs, and all three now break down BY
// ABILITY: a pet's abilities carry the pet's name, so a hunter running two pets
// can still tell which of them did what. Threat used to break down BY
// CONTRIBUTOR instead (the member's own hate plus one row per pet, every entry
// with a null ability); that mode is gone because the threat tab gives each
// contributor its own BAR now, so the panel behind one bar narrows to that
// contributor's abilities rather than re-splitting a folded column.
//
// Note what this core does NOT do: it ranks strictly by amount, so a pet's
// abilities interleave with its owner's and there is no pet SUBTOTAL row, and
// `rowCap` folds the tail globally rather than per contributor. Grouping a pet
// under a subtotal is a real gap, tracked separately from the threat work.

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

/** One contributor's subtotal plus the abilities behind it. */
export interface BreakdownGroup {
  /** null = the member themself; otherwise the pet's display name */
  petName: string | null;
  amount: number;
  /** 0..1 of the WHOLE tooltip total, so the group subtotals add to 100% */
  share: number;
  /** 0..1 of the biggest GROUP, for the subtotal's inline bar */
  fill: number;
  rows: BreakdownRow[];
}

export interface GroupedBreakdownModel {
  total: number;
  perSecond: number;
  /** biggest contributor first; a contributor with nothing is absent, not zero */
  groups: BreakdownGroup[];
}

/** Rows shown before the tail folds into a single "other" row. */
export const BREAKDOWN_ROW_CAP = 8;

/**
 * Per-GROUP row cap. Lower than the flat cap on purpose: the grouped panel pays
 * a header line per contributor, so reusing 8 would let a two-contributor panel
 * reach eighteen lines. Five keeps a member-plus-pet panel at twelve.
 */
export const BREAKDOWN_GROUP_ROW_CAP = 5;

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
 * Rank pre-sorted `kept` entries into rows against a caller-supplied total and
 * bar reference, folding everything past `rowCap` into one trailing row.
 *
 * Shared by the flat and grouped builders so the ranking, the share math and
 * the fold rule cannot drift apart. `shareTotal` and `fillTop` are parameters
 * rather than derived here because the GROUPED model measures every row against
 * the whole tooltip's total, not against its own group: that is what lets a
 * player compare a pet's ability with their own directly.
 */
function rankRows(
  kept: BreakdownEntry[],
  shareTotal: number,
  fillTop: number,
  rowCap: number,
): BreakdownRow[] {
  const shareOf = (amount: number) => (shareTotal > 0 ? amount / shareTotal : 0);
  const fillOf = (amount: number) => (fillTop > 0 ? amount / fillTop : 0);
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
  return rows;
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
  return {
    total,
    perSecond,
    rows: rankRows(kept, total, kept[0]?.amount ?? 0, rowCap),
  };
}

/**
 * The same tallies, split into one group per CONTRIBUTOR (the member, then each
 * pet that actually did something) with a subtotal on each.
 *
 * Why this exists: folding a pet's output into its owner is the right damage
 * meter convention for the BAR, but inside the hover panel it left a hunter
 * unable to answer "how much of that was the pet". The flat model ranks purely
 * by amount, so a pet's abilities interleave with its owner's and the global
 * `rowCap` can fold some of them into `Other` while the owner's fill the panel.
 *
 * Rules that follow from that:
 * - a contributor with nothing is omitted entirely, never rendered as a zero
 *   group (an idle or just-summoned pet must not add a dead row),
 * - the cap applies PER GROUP, so a pet can never be squeezed out by its owner,
 * - every share is measured against the WHOLE total so a pet ability and an
 *   owner ability are directly comparable, and the group subtotals add to 100%.
 */
export function buildGroupedMeterBreakdown(
  entries: Iterable<BreakdownEntry>,
  durationSeconds: number,
  rowCap: number = BREAKDOWN_GROUP_ROW_CAP,
): GroupedBreakdownModel {
  const kept = [...entries].filter((entry) => entry.amount > 0).sort(compareEntries);
  const total = kept.reduce((sum, entry) => sum + entry.amount, 0);
  const perSecond = total / Math.max(1, durationSeconds);
  const fillTop = kept[0]?.amount ?? 0;

  const byContributor = new Map<string | null, BreakdownEntry[]>();
  for (const entry of kept) {
    const key = entry.petName ?? null;
    const bucket = byContributor.get(key);
    if (bucket) bucket.push(entry);
    else byContributor.set(key, [entry]);
  }

  const groups: BreakdownGroup[] = [];
  for (const [petName, bucket] of byContributor) {
    const amount = bucket.reduce((sum, entry) => sum + entry.amount, 0);
    groups.push({
      petName,
      amount,
      share: total > 0 ? amount / total : 0,
      // Overwritten below once every group is known, since it is measured
      // against the biggest GROUP rather than the biggest row.
      fill: 0,
      rows: rankRows(bucket, total, fillTop, rowCap),
    });
  }
  // Biggest contributor first, the meter's convention everywhere else; the
  // member wins an exact tie so a freshly summoned pet cannot displace them.
  groups.sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    if ((a.petName === null) !== (b.petName === null)) return a.petName === null ? -1 : 1;
    return (a.petName ?? '').localeCompare(b.petName ?? '');
  });
  const topGroup = groups[0]?.amount ?? 0;
  for (const group of groups) group.fill = topGroup > 0 ? group.amount / topGroup : 0;
  return { total, perSecond, groups };
}
