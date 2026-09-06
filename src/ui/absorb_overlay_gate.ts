// The "Show Absorb Shields" gate for the player / target unit-frame overlays.
//
// The party rows read the `partyFrameShowAbsorbs` setting live on every sync
// (Hud.updatePartyFrames rebuilds its config from the store), but the player and
// target frames paint their `.bar-absorb` overlay every animation frame through
// UnitFramePainter with no settings access. Rather than thread a settings read
// through the coordinator's per-frame paint (hud.ts sits at its monolith
// ceiling), the option flips ONE class on the document root and hud.css hides
// every `.bar-absorb` beneath it. The painter keeps writing the segment so the
// overlay reappears in the right place the moment the option is turned back on;
// the health text's "(shield)" suffix is unaffected (numbers are information,
// the hatch is decoration).
//
// Kept DOM-shape-agnostic (a `classList` host) so a Vitest drives it directly.

/** The root class hud.css keys `.bar-absorb { display: none }` on. */
export const ABSORB_OVERLAY_HIDDEN_CLASS = 'absorb-shields-hidden';

export interface ClassListHost {
  classList: { toggle(token: string, force?: boolean): boolean };
}

/** Apply the Show Absorb Shields option: hide the unit-frame shield overlays when off. */
export function applyAbsorbOverlayGate(root: ClassListHost, shown: boolean): void {
  root.classList.toggle(ABSORB_OVERLAY_HIDDEN_CLASS, !shown);
}
