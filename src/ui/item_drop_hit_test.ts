// Where a TOUCH drag released: the finger has no dragover/drop events, so the
// release point has to be resolved against the live DOM by hand (the desktop HTML5
// drag gets this from the browser for free, via the drop target the event lands on).
//
// One shared hit test so both arms of the gesture agree on what "over the paperdoll"
// and "over the world" mean: a paperdoll socket is any element carrying
// data-equip-slot (char_window stamps it), the world is the game canvas, and every
// other surface (a window, the HUD chrome, the action bar) is inert, so releasing a
// stack over the chat box never destroys it.

import { type EquipSlot, isEquipSlot } from '../sim/types';

/** The world surface: the one element the destroy drop accepts. */
const WORLD_CANVAS_SELECTOR = '#game-canvas';

export type DropTargetAt =
  | { kind: 'equip'; slot: EquipSlot }
  | { kind: 'bagCell'; index: number }
  // The action-slot arms (the UX pass): releasing a bag stack over a hotbar
  // seat places the item there, the touch twin of the desktop drag's item
  // branch, so a mobile angler parks the rod on the bar once instead of
  // reeling through bags-row taps inside the 2.5 s window. Desktop rows
  // stamp data-hotbar-slot (1-based bar slot); the mobile ring stamps
  // data-mobile-index (a RING position whose underlying bar slot depends on
  // the live page, so the HUD resolves it at drop time, not here). The
  // RING arm is the live one: the touch HUD hides all three desktop rows,
  // and the ring is reachable mid-drag via the touch-item-dragging z-raise
  // in hud.mobile.css (the phase 14 QA blocker). The row arm has no
  // reachable layout today; it is the forward twin for a touch tier that
  // shows the desktop rows, kept because the hit-test is the cheap half.
  | { kind: 'actionSlot'; slot: number }
  | { kind: 'actionRingSlot'; ringIndex: number }
  | { kind: 'world' }
  | { kind: 'none' };

/** Resolve what sits under the released finger at viewport point (x, y).
 *  `elementAt` is injected so the pure branch is testable without a layout
 *  engine; it defaults to the real hit test. */
export function resolveDropTargetAt(
  x: number,
  y: number,
  elementAt: (x: number, y: number) => Element | null = (px, py) =>
    document.elementFromPoint(px, py),
): DropTargetAt {
  const el = elementAt(x, y);
  if (!el) return { kind: 'none' };
  const socket = el.closest?.('[data-equip-slot]') as HTMLElement | null;
  const raw = socket?.dataset.equipSlot;
  // Validate rather than trusting the attribute: a stale or hand-edited value
  // must resolve to no target, never to a wrong slot.
  if (raw && isEquipSlot(raw)) {
    return { kind: 'equip', slot: raw };
  }
  // A bag cell (the manual-order drop): its data-bag-index IS an inventory index
  // while the grid shows the raw array order, which is the only view that stamps it.
  const cell = el.closest?.('[data-bag-index]') as HTMLElement | null;
  const cellIndex = Number(cell?.dataset.bagIndex);
  if (cell && Number.isInteger(cellIndex) && cellIndex >= 0) {
    return { kind: 'bagCell', index: cellIndex };
  }
  // The action-slot arms, validated the equip way (never trusting a stale
  // attribute into a wrong seat): a desktop row button carries the 1-based
  // bar slot, a mobile ring button carries its ring position.
  const actionBtn = el.closest?.('.action-btn[data-hotbar-slot]') as HTMLElement | null;
  const hotbarSlot = Number(actionBtn?.dataset.hotbarSlot);
  if (actionBtn && Number.isInteger(hotbarSlot) && hotbarSlot >= 1) {
    return { kind: 'actionSlot', slot: hotbarSlot };
  }
  const ringBtn = el.closest?.('.mobile-action-slot[data-mobile-index]') as HTMLElement | null;
  const ringIndex = Number(ringBtn?.dataset.mobileIndex);
  if (ringBtn && Number.isInteger(ringIndex) && ringIndex >= 0) {
    return { kind: 'actionRingSlot', ringIndex };
  }
  if (el.closest?.(WORLD_CANVAS_SELECTOR)) return { kind: 'world' };
  return { kind: 'none' };
}
