// The bank window's chrome layout contract on a short phone, and where the
// personal pane's vertical scroll offset lives.
//
// WHY THIS IS A MODULE AND NOT JUST A MEDIA QUERY (Bank Storage phase 18). On a
// short landscape phone the personal pane's rigid chrome does not fit its box,
// and the band that fell out was the FOOTER: the capacity meter, the gilded
// near-full warning, the buy button and the Claudium purchase-result band, all
// clipped by the window's own `overflow: hidden`. The fix is that the pane
// scrolls as ONE region with the footer pinned to the window's bottom edge.
//
// Two of the decisions in that sentence are not about geometry at all, and
// trapping them in a stylesheet would mean only a real browser could ever read
// them back: the headless DOMs implement no LAYOUT, so a stylesheet is exactly
// where a rule goes to become untestable. (They do store a `scrollTop` you write,
// which is a separate fact and one a review round had to correct here; see
// tests/bank_chrome_layout.test.ts's rig note.) What lives here is the part a
// Vitest can drive:
//
//   - WHICH bands must never scroll out of view, and which may. The rule behind
//     the split is the one root CLAUDE.md states for graphics tiers: what a
//     player ACTS on survives, what merely helps them look may go. A capacity
//     warning, a price, and the only confirmation a real-money purchase gets are
//     all acted on; a category chip is a refinement tool over a store the player
//     can already see, and it stays one flick away rather than gone.
//   - The viewport height the compact regime engages at, which the stylesheet
//     also states as a literal. Two statements of one number drift silently.
//   - WHERE the pane's scroll offset lives, which changes with the regime.
//
// The guard that holds the stylesheet to the first two is
// `tests/bank_chrome_layout.test.ts`; `src/ui/bank_window.ts` consumes the third
// on every repaint. The window keeps every DOM read and write and stays a thin
// consumer, which is the pure-core-plus-thin-painter recipe in src/ui/CLAUDE.md.

/** The viewport height (px) at or below which the personal bank pane switches to
 *  the compact regime: one scroll region, pinned footer.
 *
 *  `src/styles/hud.mobile.css` states the same number as an
 *  `@media (max-height: ...)` literal, because a stylesheet cannot import. That
 *  is the drift `tests/bank_chrome_layout.test.ts` exists to catch: it reads the
 *  sheet and pins the literal against this constant, so the two can only move
 *  together. */
export const BANK_CHROME_COMPACT_MAX_HEIGHT = 480;

/** The bands that must NEVER scroll out of view in the compact regime.
 *
 *  `.bank-footer` is the whole point of the phase: it carries the capacity
 *  meter and its numbers, the gilded near-full treatment, the expansion price
 *  and its button, and the purchase-result band. Every one of those is
 *  information a player acts on, and all of it was invisible.
 *
 *  `.panel-title` is here because it already carries the sticky rule in
 *  `src/styles/layout.css` and had no scrollport to stick to. It is listed so
 *  that the guard notices if the window ever stops being a scrollport, which
 *  would silently un-pin it again. */
export const BANK_PINNED_BAND_SELECTORS = ['.panel-title', '.bank-footer'] as const;

/** The bands that MAY scroll in the compact regime, and therefore must stay
 *  REACHABLE rather than hidden. The guard asserts the compact block never
 *  gives one of these `display: none` or `visibility: hidden`: shedding a
 *  control is the failure this phase exists to end, not a cheaper way to fit. */
export const BANK_SCROLLING_BAND_SELECTORS = [
  '.bank-tabs',
  '.bank-sockets',
  '.bank-filter-bar',
  '.bank-status',
  '.bank-scroll',
] as const;

/** The two elements that can own the personal pane's vertical scroll offset.
 *
 *  In the FULL regime the `.bank-scroll` region is the scroller and the window
 *  clips. In the COMPACT regime the window is the scroller and the region flows
 *  inside it. Neither the window nor this module asks which regime is live: both
 *  offsets are carried.
 *
 *  A REVIEW ROUND CORRECTED THE REASON THIS IS SAFE, and the original was wrong
 *  in a way worth keeping written down. It said a write to an element that
 *  cannot scroll is a no-op that reads back zero. It is not: an `overflow:
 *  hidden` box is still programmatically scrollable in every engine, and on
 *  DESKTOP `.window` carries `overflow-y: auto` outright (src/styles/layout.css)
 *  under a `max-height` clamp, so a short desktop viewport makes the bank window
 *  a real scroller too.
 *
 *  Carrying both is still right, but as a GENERALIZATION rather than as a
 *  no-op. The rule is the one the window has always applied to its inner region:
 *  a pane switch starts at the top, never mid-list. Applying it to whatever
 *  actually scrolls is the consistent reading, and the alternative (asking which
 *  regime is live) would put a second copy of a media query in TypeScript, which
 *  is the thing that drifts. `tests/bank_chrome_layout.test.ts` drives the pane
 *  switch through the real window so the generalization is pinned rather than
 *  assumed. */
export interface BankScrollOffsets {
  /** `.bank-scroll`'s own offset. */
  inner: number;
  /** `#bank-window`'s own offset. */
  outer: number;
}

/** Which pane a paint drew, at the granularity the offset may be carried across.
 *  The guild pane's two sub-views both mount a `.bank-scroll`, so the tab alone
 *  is not enough: without the sub-view the contents grid's offset would be
 *  pasted onto the log the moment a player switched between them. */
export interface BankPaneKey {
  tab: string;
  guildView: string;
}

export function isSameBankPane(a: BankPaneKey, b: BankPaneKey): boolean {
  return a.tab === b.tab && a.guildView === b.guildView;
}

/** Clamp one captured offset to something safe to write back.
 *
 *  Negative is not hypothetical: mobile Safari is a first-class target
 *  (src/styles/CLAUDE.md's browser matrix) and its elastic overscroll reports a
 *  negative `scrollTop` mid-rubber-band. Capturing one and writing it back would
 *  hand the next paint a value the platform is already animating away from. */
function safeOffset(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** What to write back to each candidate scroller after a rebuild.
 *
 *  A rebuild replaces the pane's markup, which momentarily collapses whichever
 *  element is the scroller and makes the browser clamp its `scrollTop` to the
 *  intermediate height. The window's own `refreshGrid` already names that hazard
 *  for the inner region; the outer element has the same one and needs the same
 *  capture-and-reapply. Both are written after the LAST band is appended, or the
 *  write clamps against a pane that is still short of its footer.
 *
 *  A pane switch starts at the top, never mid-list, which is the rule the window
 *  has always applied to the inner region and which applies unchanged to both. */
export function planBankScrollRestore(
  prev: BankScrollOffsets,
  prevPane: BankPaneKey,
  nextPane: BankPaneKey,
): BankScrollOffsets {
  if (!isSameBankPane(prevPane, nextPane)) return { inner: 0, outer: 0 };
  return { inner: safeOffset(prev.inner), outer: safeOffset(prev.outer) };
}
