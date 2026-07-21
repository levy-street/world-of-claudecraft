// Pure contiguous-span bookkeeping for undo/redo over appended batches.
// Strokes, pastes, and procgen all APPEND their items contiguously, so undo can
// remove the whole span with one splice instead of a per-item indexOf scan
// (which is O(n * m) over a 4000-entry array). DOM-free; Vitest drives it
// directly (tests/editor_span_core.test.ts).

/** Append a batch and return the start index the matching removeSpan needs. */
export function appendSpan<T>(arr: T[], items: readonly T[]): number {
  const start = arr.length;
  arr.push(...items);
  return start;
}

/**
 * Remove a previously appended batch. Fast path: the batch still sits
 * contiguously at `start` (the normal undo case), one splice. Defensive
 * fallback: if anything shifted, remove per item by identity so undo never
 * deletes the wrong entries.
 */
export function removeSpan<T>(arr: T[], start: number, items: readonly T[]): void {
  if (items.length === 0) return;
  let contiguous = start >= 0 && start + items.length <= arr.length;
  if (contiguous) {
    for (let i = 0; i < items.length; i++) {
      if (arr[start + i] !== items[i]) {
        contiguous = false;
        break;
      }
    }
  }
  if (contiguous) {
    arr.splice(start, items.length);
    return;
  }
  for (const item of items) {
    const i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
  }
}
