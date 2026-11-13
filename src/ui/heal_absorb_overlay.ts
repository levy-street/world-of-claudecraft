// One-time DOM builder for the heal-absorb overlay on a unit-frame health bar.
//
// Builds the three nodes the UnitFramePainter's heal-absorb group paints into:
//   .bar-heal-absorb        root: the on class + the segment-edge custom props
//     .bar-heal-absorb-fill   the icy hatch, clipped to [start, end] in hud.css
//     .bar-heal-absorb-text   the healing-left number, anchored at the health edge
// Runs once per frame instance (HUD boot for the player and target frames, row
// creation for a party/raid row), never on the hot path; the per-frame writes
// all ride the painter's elided writers. The overlay is decorative to assistive
// tech (aria-hidden), like the shield hatch beside it: the frame's health text
// stays the accessible readout.

/** The overlay's nodes, in the shape UnitFrameElements.healAbsorb takes. */
export interface HealAbsorbOverlay {
  root: HTMLElement;
  text: HTMLElement;
}

export const HEAL_ABSORB_ROOT_CLASS = 'bar-heal-absorb';
export const HEAL_ABSORB_FILL_CLASS = 'bar-heal-absorb-fill';
export const HEAL_ABSORB_TEXT_CLASS = 'bar-heal-absorb-text';

/** Build a detached overlay; the caller appends `root` into the health bar. */
export function createHealAbsorbOverlay(doc: Document): HealAbsorbOverlay {
  const root = doc.createElement('div');
  root.className = HEAL_ABSORB_ROOT_CLASS;
  root.setAttribute('aria-hidden', 'true');
  const fill = doc.createElement('div');
  fill.className = HEAL_ABSORB_FILL_CLASS;
  const text = doc.createElement('span');
  text.className = HEAL_ABSORB_TEXT_CLASS;
  root.append(fill, text);
  return { root, text };
}

/** Build an overlay and seat it right after a static frame's shield overlay
 *  (`#pf-absorb` / `#tf-absorb`), inside the same health bar. */
export function mountHealAbsorbOverlay(shieldOverlay: HTMLElement): HealAbsorbOverlay {
  const overlay = createHealAbsorbOverlay(shieldOverlay.ownerDocument);
  shieldOverlay.after(overlay.root);
  return overlay;
}
