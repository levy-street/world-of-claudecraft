// Pure keyboard-navigation logic for the always-visible roving-tabindex pattern (a
// tablist, a radiogroup, a menu of sibling options), lifted out of talents_window.ts so
// the three handlers that triplicated it share one tested core. It is the sibling of
// dropdown_nav.ts: that core models the OPEN/COLLAPSE listbox (a trigger that expands a
// hidden menu); this one models ALWAYS-VISIBLE roving siblings, where Arrow/Home/End move
// a roving focus among peers that are all on screen. Keep the two separate primitives: a
// future reader must not merge them (dropdown_nav = open/collapse, roving_index = visible
// siblings).
//
// DOM-free and deterministic (no Math.random/Date.now/performance.now): it maps a
// (key, current index, count, orientation) tuple to the next roving index, or null for any
// key it does not own (so the caller falls through to its own Escape / Enter-Space
// activation tail). The wrap is the single normalized form (((x % n) + n) % n), which
// unifies the radiogroup's (i - 1 + n) % n and the flyout's ((idx % n) + n) % n: both are
// equal to (((i +/- 1) % n) + n) % n for every i in [0, n), so folding the three handlers
// onto this one expression is byte-faithful, not merely close.
//
// It takes primitives, not an IWorld, so the ClientWorld-vs-Sim parity row
// is N/A for it, exactly like dropdown_nav.ts; same-input-same-output is the contract.

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

// The next roving index for `key`, or null when the key is not a roving move. `count` is
// the number of siblings; `current` is the focused sibling's index. Home -> 0,
// End -> count - 1, next/prev wrap around the ends. 'horizontal' owns ArrowRight (next) /
// ArrowLeft (prev) only; 'vertical' owns ArrowDown (next) / ArrowUp (prev) only (the Esc
// menu rail, spec section 5: it leaves Left/Right free so in-row value adjust never
// competes); 'both' owns all four for a 2D grid. Home/End are owned by every orientation.
export function rovingTarget(
  key: string,
  current: number,
  count: number,
  orientation: RovingOrientation,
): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const horizontal = orientation === 'horizontal' || orientation === 'both';
  const vertical = orientation === 'vertical' || orientation === 'both';
  const next = (horizontal && key === 'ArrowRight') || (vertical && key === 'ArrowDown');
  const prev = (horizontal && key === 'ArrowLeft') || (vertical && key === 'ArrowUp');
  if (next) return (((current + 1) % count) + count) % count;
  if (prev) return (((current - 1) % count) + count) % count;
  return null;
}
