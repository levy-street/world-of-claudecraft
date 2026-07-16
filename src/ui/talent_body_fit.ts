// Pure fit math for the desktop Talents window "Create build" overlap fix.
//
// The Specialization tab adds a spec-picker row and a Mastery banner above the
// tree, inside #tal-body. On a tall build (many rows, or the extra spec
// chrome) that pushes #tal-body's natural height past the window's own
// max-height budget (the `.window` shell clamp in layout.css), and since
// `.tal-foot` (the Current/Create build panel) is #tal-body's sibling
// rendered right after it, the whole window's own overflow:auto scroll
// swallows the last few pixels of the foot panel: it reads as the create-build
// card being cut off/overlapped rather than a window that needs scrolling.
//
// The fix is to cap #tal-body's own height (letting the class/spec tree
// scroll internally) so the foot panel always has its full natural height
// left over inside the window's budget. DOM-free so a Vitest pins the math;
// the thin wiring (measuring the live rects) lives in talents_window.ts.
export function talentBodyMaxHeight(
  windowMaxHeight: number,
  bodyTopWithinWindow: number,
  footHeight: number,
  bufferPx = 4,
): number | null {
  if (windowMaxHeight <= 0 || bodyTopWithinWindow < 0 || footHeight < 0) return null;
  const cap = windowMaxHeight - bodyTopWithinWindow - footHeight - bufferPx;
  return cap > 0 ? cap : null;
}
