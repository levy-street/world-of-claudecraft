// On-bar action-bar key-binding mode (issue #1238): pure phase/state helpers for
// the click-a-slot-then-press-a-key rebind flow. DOM-free (no button refs, no key
// capture) so the state transitions are Vitest-testable directly. The controller
// (action_bar_bind_controller.ts) owns the slot clicks, the key capture and the
// confirm dialogs, the banner DOM lives in action_bar_bind_banner.ts, and hud.ts
// keeps only the action-bar click intercept.

/**
 * selectedSlot: the bar slot index awaiting a keypress, or null between
 * selections. lastBoundKeyLabel: the on-screen label of the key just bound (or
 * null after a cancelled/rejected capture), shown as transient feedback until
 * the next slot is selected.
 */
import {
  type KeybindConflictPrompt,
  keybindConflictPrompt,
} from '../../keybind_conflict_prompt_core';

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

/** The are-you-sure prompt the on-bar mode raises before a capture commits:
 *  the shared keybind conflict prompt, with the slot as the gaining action. */
export type ActionBarBindPrompt = KeybindConflictPrompt;

/**
 * Decide whether binding `key` to the selected slot needs a warning first.
 * `other` is the name of the action that would LOSE `key` (null when the key
 * is free); `slot` names the slot being bound. Only a key already in use
 * elsewhere warns: replacing the slot's own previous key is the point of the
 * mode and asks nothing.
 */
export function actionBarBindPrompt(input: {
  key: string;
  other: string | null;
  slot: string;
}): ActionBarBindPrompt | null {
  return keybindConflictPrompt({ key: input.key, other: input.other, action: input.slot });
}

/** A box in HUD author px (the #ui zoom already divided out). */
export interface ActionBarBindBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far above the bottom edge the banner sits when no bar has a box to
 *  anchor to (every bar hidden, or the touch layout): clear of the stock docked
 *  bar plus the player frame beneath it. */
export const ACTION_BAR_BIND_BANNER_FALLBACK_LIFT = 200;

/**
 * Where the banner goes, in HUD author px: centred on the primary bar (the
 * first box) and lifted `gap` above the TOPMOST visible bar, so it never sits
 * on the second or third bar stacked above the primary one (their slots are
 * rebind targets too, and a banner over them left those keys unbindable). When
 * there is no room above, it drops `gap` below the lowest bar, then tries the
 * widest free band between bars; a seat is only taken when its clamped box
 * overlaps no bar at all (a bar moved to the top edge with Interface Unlock
 * must not push the banner back onto the docked stack), and the above-seat is
 * the last resort. Every bar is measured live (never assumed docked in
 * #actionbar-stack) because Interface Unlock reparents a moved bar to the HUD
 * root. With no bar box at all the banner takes the stock bottom-centre seat.
 * `viewport` is the VISIBLE region in author px (the window box divided by the
 * UI scale, not the #ui client box, which is clipped under a scale above 1).
 * Clamped `gap` inside it on every edge.
 */
export function actionBarBindBannerPlacement(args: {
  bars: readonly ActionBarBindBox[];
  banner: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
}): { left: number; top: number } {
  const gap = args.gap ?? 8;
  const { banner, viewport, bars } = args;
  const maxLeft = Math.max(gap, viewport.width - banner.width - gap);
  const maxTop = Math.max(gap, viewport.height - banner.height - gap);
  const clampLeft = (v: number) => Math.min(Math.max(v, gap), maxLeft);
  const clampTop = (v: number) => Math.min(Math.max(v, gap), maxTop);
  const primary = bars[0];
  if (!primary) {
    return {
      left: clampLeft((viewport.width - banner.width) / 2),
      top: clampTop(viewport.height - banner.height - ACTION_BAR_BIND_BANNER_FALLBACK_LIFT),
    };
  }
  const left = clampLeft(primary.left + primary.width / 2 - banner.width / 2);
  const sorted = [...bars].sort((a, b) => a.top - b.top);
  const topmost = sorted[0]!.top;
  const lowest = Math.max(...bars.map((b) => b.top + b.height));
  // Candidate seats in preference order: above every bar, below every bar,
  // then the bands between bars, widest first.
  const seats = [topmost - gap - banner.height, lowest + gap];
  const bands: { top: number; room: number }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const bottom = sorted[i]!.top + sorted[i]!.height;
    bands.push({ top: bottom + gap, room: sorted[i + 1]!.top - bottom });
  }
  bands.sort((a, b) => b.room - a.room);
  for (const band of bands) seats.push(band.top);
  const clear = (top: number) =>
    bars.every((b) => top + banner.height <= b.top || top >= b.top + b.height);
  for (const seat of seats) {
    const top = clampTop(seat);
    if (clear(top)) return { left, top };
  }
  return { left, top: clampTop(seats[0]!) };
}
