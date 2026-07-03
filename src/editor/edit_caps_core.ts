// Pure cap-clamping for bulk edit inserts (paste, procgen scatter/hills,
// placement appends). The document caps live in src/sim/map_doc.ts; every push
// site clamps through here so the sanitizer never has to silently truncate a
// saved document on the next load. DOM-free; Vitest drives it directly
// (tests/editor_edit_caps.test.ts).

export interface CapClampResult<T> {
  /** The items that fit under the cap (possibly all of them, possibly none). */
  accepted: readonly T[];
  /** True when at least one item was dropped to respect the cap. */
  truncated: boolean;
}

/** How many more items fit under `cap` given `currentCount` already stored. */
export function capRoom(currentCount: number, cap: number): number {
  return Math.max(0, cap - currentCount);
}

/**
 * Clamp a batch of new items against a document cap. Returns the accepted
 * prefix (order preserved) and whether anything was dropped.
 */
export function clampToCap<T>(
  items: readonly T[],
  currentCount: number,
  cap: number,
): CapClampResult<T> {
  const room = capRoom(currentCount, cap);
  if (items.length <= room) return { accepted: items, truncated: false };
  return { accepted: items.slice(0, room), truncated: true };
}
