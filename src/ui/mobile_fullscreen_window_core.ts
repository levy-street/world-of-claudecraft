// Pure visibility decision for whether the mobile bottom action bar (the
// player frame / petbar / meters stack docked under #bottom-bar) is safe to
// hide entirely. Only windows that are documented and CSS-verified to cover
// the player frame (src/styles/hud.mobile.css: bags pins the full viewport
// height with the 10px safe margin top and bottom, at content width from the
// edge away from the action ring, covering the bottom-centre frame;
// char-window pins inset 0 and covers the entire viewport) qualify:
// hiding the frame there was already an accepted tradeoff before this rule
// existed (see the "Covering the frame is fine here" comments in
// hud.mobile.css) because nothing behind them is reachable or visible anyway.
// Every other game window (loot, lockpick, delve-rite, loot-settings, map,
// quest-log, vendor, ...) only pins its edges/top on touch and leaves real
// screen visible below, so hiding the frame there would hide HP/resource
// while combat continues, which the CLAUDE.md graphics-fairness invariant
// forbids. Hud owns the DOM class toggle; this core keeps the decision
// independently testable.
//
// bags is NOT actually fullscreen in the four "paired cluster" layouts
// (body.vendor-open, body.bank-open, body.market-open, body.char-bags-paired):
// those blocks in hud.mobile.css deliberately reserve the bottom 72px so the
// player frame stays visible underneath the docked pair. Hiding the bottom bar
// there would hide HP/resource while the world keeps running (talking to a
// vendor or opening the bank/market/character sheet does not pause combat) and
// leave an empty 72px band where the frame used to be. Neither half of a
// paired cluster is fullscreen, so this returns false whenever any of the four
// disqualifying body classes is set. The four flags are taken separately
// (rather than pre-reduced by the caller) so the disqualifying-class list
// itself is part of what a test can pin down.

export function isMobileFullscreenWindowOpen(
  bagsVisible: boolean,
  charWindowVisible: boolean,
  vendorOpen: boolean,
  bankOpen: boolean,
  marketOpen: boolean,
  charBagsPaired: boolean,
): boolean {
  if (vendorOpen || bankOpen || marketOpen || charBagsPaired) return false; // no half of a paired cluster is fullscreen
  return bagsVisible || charWindowVisible;
}
