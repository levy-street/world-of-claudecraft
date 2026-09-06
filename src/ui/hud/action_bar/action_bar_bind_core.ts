// On-bar action-bar key-binding mode (issue #1238): pure phase/state helpers for
// the click-a-slot-then-press-a-key rebind flow. DOM-free (no button refs, no key
// capture) so the state transitions are Vitest-testable directly; the thin
// controller in hud.ts owns the banner DOM, the action-bar click intercept, the
// Reset confirm dialog, and the shared key-capture seam (Input.captureNextKey via
// OptionsHooks.captureKey) every other rebind flow already uses.

/**
 * selectedSlot: the bar slot index awaiting a keypress, or null between
 * selections. lastBoundKeyLabel: the on-screen label of the key just bound (or
 * null after a cancelled/rejected capture), shown as transient feedback until
 * the next slot is selected.
 */
export interface ActionBarBindState {
  selectedSlot: number | null;
  lastBoundKeyLabel: string | null;
}

/** The mode's starting state: no slot selected yet. */
export function actionBarBindEnter(): ActionBarBindState {
  return { selectedSlot: null, lastBoundKeyLabel: null };
}

/** Clicking a bar slot selects it (replacing any prior selection, mid-capture
 *  or not) and clears any leftover "bound to X" feedback from an earlier capture. */
export function actionBarBindSelectSlot(slot: number): ActionBarBindState {
  return { selectedSlot: slot, lastBoundKeyLabel: null };
}

/** A capture resolved (a key was pressed and bound, or the capture was
 *  cancelled/rejected): clear the selection and record the outcome. Pass the
 *  bound key's label, or null for a cancelled/rejected capture. */
export function actionBarBindResolveCapture(keyLabel: string | null): ActionBarBindState {
  return { selectedSlot: null, lastBoundKeyLabel: keyLabel };
}

export type ActionBarBindStatus = 'idle' | 'capturing' | 'bound';

/** Which status line the banner should show for the current state. */
export function actionBarBindStatus(state: ActionBarBindState): ActionBarBindStatus {
  if (state.selectedSlot !== null) return 'capturing';
  if (state.lastBoundKeyLabel !== null) return 'bound';
  return 'idle';
}

/** A box in HUD author px (the #ui zoom already divided out). */
export interface ActionBarBindBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far above the bottom edge the banner sits when the primary bar has no
 *  box to anchor to (hidden under the cross hotbar, or the touch layout):
 *  clear of the stock docked bar plus the player frame beneath it. */
export const ACTION_BAR_BIND_BANNER_FALLBACK_LIFT = 200;

/**
 * Where the banner goes, in HUD author px: centred above the LIVE primary bar
 * with `gap` between them, dropping below the bar when there is no room above,
 * and clamped `gap` inside the viewport on every edge. The bar is measured live
 * (not assumed docked in #actionbar-stack) because Interface Unlock reparents a
 * moved bar to the HUD root: anchoring to the stack left the banner under the
 * moved bar, whose slots ate every Done / Reset click and re-armed a capture
 * instead, trapping the player in the mode until a restart. With no bar box at
 * all the banner takes the stock bottom-centre seat.
 */
export function actionBarBindBannerPlacement(args: {
  bar: ActionBarBindBox | null;
  banner: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
}): { left: number; top: number } {
  const gap = args.gap ?? 8;
  const { banner, viewport, bar } = args;
  let left: number;
  let top: number;
  if (bar) {
    left = bar.left + bar.width / 2 - banner.width / 2;
    top = bar.top - gap - banner.height;
    if (top < gap) top = bar.top + bar.height + gap;
  } else {
    left = (viewport.width - banner.width) / 2;
    top = viewport.height - banner.height - ACTION_BAR_BIND_BANNER_FALLBACK_LIFT;
  }
  const maxLeft = Math.max(gap, viewport.width - banner.width - gap);
  const maxTop = Math.max(gap, viewport.height - banner.height - gap);
  return {
    left: Math.min(Math.max(left, gap), maxLeft),
    top: Math.min(Math.max(top, gap), maxTop),
  };
}
