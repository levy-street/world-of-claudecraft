// Where a TOUCH drag released: the finger has no dragover/drop events, so the
// release point has to be resolved against the live DOM by hand (the desktop HTML5
// drag gets this from the browser for free, via the drop target the event lands on).
//
// One shared hit test so both arms of the gesture agree on what "over the paperdoll"
// and "over the world" mean: a paperdoll socket is any element carrying
// data-equip-slot (char_window stamps it), the world is the game canvas, and every
// other surface (a window, the HUD chrome, the action bar) is inert, so releasing a
// stack over the chat box never destroys it.

import { ALL_EQUIP_SLOTS, type EquipSlot } from '../sim/types';

/** The world surface: the one element the destroy drop accepts. */
const WORLD_CANVAS_SELECTOR = '#game-canvas';

export type DropTargetAt =
  | { kind: 'equip'; slot: EquipSlot }
  | { kind: 'bagCell'; index: number }
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
  // Validate against the canonical slot list rather than trusting the attribute:
  // a stale or hand-edited value must resolve to no target, never to a wrong slot.
  // ALL_EQUIP_SLOTS (includes the additive 'offhand' slot), not the frozen
  // EQUIP_SLOTS, else a finger-drag released over the offhand socket resolves to
  // no target.
  if (raw && (ALL_EQUIP_SLOTS as readonly string[]).includes(raw)) {
    return { kind: 'equip', slot: raw as EquipSlot };
  }
  // A bag cell (the manual-order drop): its data-bag-index IS an inventory index
  // while the grid shows the raw array order, which is the only view that stamps it.
  const cell = el.closest?.('[data-bag-index]') as HTMLElement | null;
  const cellIndex = Number(cell?.dataset.bagIndex);
  if (cell && Number.isInteger(cellIndex) && cellIndex >= 0) {
    return { kind: 'bagCell', index: cellIndex };
  }
  if (el.closest?.(WORLD_CANVAS_SELECTOR)) return { kind: 'world' };
  return { kind: 'none' };
}
