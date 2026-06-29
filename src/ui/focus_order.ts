// Pure focusable-order resolver for the shared focus manager (./focus_manager.ts).
//
// WIRING vs CORE split: the focus manager itself is wiring (it touches
// document.activeElement and listens on document), so it is NOT registered in
// tests/architecture.test.ts UI_PURE_CORES. This module is the DOM-FREE piece it
// leans on: the trap's boundary math, lifted out so a Vitest drives it directly. It
// imports nothing, touches no DOM globals, and is deterministic (same input -> same
// output), so it IS a registered UI pure core.

/**
 * Given the number of focusable elements currently in a trapped window, the index
 * of the focused one (-1 when focus is not on any of them), and whether Shift is
 * held (backward), return the index to move focus to, wrapping at both ends.
 *
 * This is the only decision the Tab/Shift+Tab trap needs: the manager re-queries the
 * live focusable set on every Tab (the DOM can change while a window is open) and
 * calls this to pick the next index. Wraparound at the ends is what makes it a trap:
 * Tab past the last element returns to the first, Shift+Tab before the first goes to
 * the last. Returns -1 only when there is nothing focusable (count <= 0).
 */
export function nextFocusIndex(count: number, currentIndex: number, backward: boolean): number {
  if (count <= 0) return -1;
  if (currentIndex < 0) return backward ? count - 1 : 0;
  const delta = backward ? -1 : 1;
  return (currentIndex + delta + count) % count;
}
