// Should the character sheet and the bags dock side by side (the touch pairing)?
//
// On the touch HUD a window fills the screen, so the bags would sit ON TOP of the
// paperdoll and the drag-to-equip gesture would have no visible target to land on.
// When both are open we therefore split the viewport 50/50, exactly as the bank and
// the vendor already do with their bags companion (body.bank-open).
//
// The bank/vendor/market clusters OWN the bags companion when they are up (their own
// pairing docks it), so this one stands down there rather than fighting them for the
// layout. Desktop does not pair 50/50 (its windows float), but since the menu
// consolidation (2026-11-04) pressing C there opens the bags DOCKED beside the sheet
// (charBagsDocked), the way the bank seats its bags companion, so the drag-to-equip
// gesture has both windows in view; B still opens the bags alone.
//
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES).

export interface CharBagsPairingState {
  /** The touch HUD (body.mobile-touch): the only place windows go full-screen. */
  touch: boolean;
  charOpen: boolean;
  bagsShown: boolean;
  /** The bank cluster is up: it already docks the bags companion. */
  bankOpen: boolean;
  /** A vendor is up: same, its cluster owns the bags companion. */
  vendorOpen: boolean;
  /** The World Market is up: same, its cluster owns the bags companion. */
  marketOpen: boolean;
}

/** True when the character sheet and the bags should dock as one 50/50 cluster. */
export function charBagsPaired(s: CharBagsPairingState): boolean {
  if (!s.touch || !s.charOpen || !s.bagsShown) return false;
  return !s.bankOpen && !s.vendorOpen && !s.marketOpen;
}

/** Desktop: true when the bags should sit docked beside the open sheet. */
export function charBagsDocked(s: CharBagsPairingState): boolean {
  if (s.touch || !s.charOpen || !s.bagsShown) return false;
  return !s.bankOpen && !s.vendorOpen && !s.marketOpen;
}

/**
 * What a C press does to the bags on desktop, given the state AFTER the sheet
 * toggled: 'open' when the sheet just opened without them, 'close' when the
 * sheet just closed while they sat docked beside it, else nothing. Touch never
 * moves the bags (the 50/50 pairing is opt-in there).
 */
export function charToggleBagsAction(
  s: CharBagsPairingState,
  wasDocked: boolean,
): 'open' | 'close' | null {
  if (s.touch || s.bankOpen || s.vendorOpen || s.marketOpen) return null;
  if (s.charOpen && !s.bagsShown) return 'open';
  if (!s.charOpen && s.bagsShown && wasDocked) return 'close';
  return null;
}
