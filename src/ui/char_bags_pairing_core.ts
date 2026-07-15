// Should the character sheet and the bags dock side by side (the touch pairing)?
//
// On the touch HUD a window fills the screen, so the bags would sit ON TOP of the
// paperdoll and the drag-to-equip gesture would have no visible target to land on.
// When both are open we therefore split the viewport 50/50, exactly as the bank and
// the vendor already do with their bags companion (body.bank-open).
//
// The bank/vendor clusters OWN the bags companion when they are up (their own pairing
// docks it), so this one stands down there rather than fighting them for the layout.
// Desktop never pairs: its windows are free-floating and already show both at once.
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
}

/** True when the character sheet and the bags should dock as one 50/50 cluster. */
export function charBagsPaired(s: CharBagsPairingState): boolean {
  if (!s.touch || !s.charOpen || !s.bagsShown) return false;
  return !s.bankOpen && !s.vendorOpen;
}
