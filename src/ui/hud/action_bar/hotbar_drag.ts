// The HTML5 drag payload of an action-bar binding, and the Attack row's
// fixed-destination disposition. Extracted from the Hud coordinator under the
// monolith ratchet: every drag source (a bar slot, the bags, the spellbook)
// writes the same payload through
// writeDraggedAction, and the bar's drop handler reads it back through
// readDraggedAction with the host's existence predicates. Pure over the
// DataTransfer it is handed: no globals, no Hud state.

import {
  attackDragDisposition,
  encodeHotbarAction,
  HOTBAR_ACTION_MIME,
  type HotbarAction,
  parseHotbarAction,
} from './hotbar';

/** What the host can resolve at drop time: learned abilities, placeable item
 *  ids. Each predicate gates its own action type. */
export interface HotbarActionExists {
  ability(id: string): boolean;
  item(id: string): boolean;
}

export function writeDraggedAction(
  dt: DataTransfer | null,
  action: Exclude<HotbarAction, null>,
): void {
  if (!dt) return;
  dt.setData(HOTBAR_ACTION_MIME, encodeHotbarAction(action));
  dt.setData('text/plain', action.id);
}

export function readDraggedAction(
  dt: DataTransfer | null,
  exists: HotbarActionExists,
): Exclude<HotbarAction, null> | null {
  if (!dt) return null;
  const raw = dt.getData(HOTBAR_ACTION_MIME);
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseHotbarAction(parsed, exists.ability, exists.item);
}

/** Attack is accepted only by slot 0, its fixed destination. The pure
 *  disposition keeps that behavior testable and lets every other slot reject
 *  the drag truthfully. `onDrop` runs the host's own drop effect (turning the
 *  Attack button back on, hiding the tooltip). Returns true when the event was
 *  an Attack drag and has been handled either way. */
export function acceptAttackDrag(
  e: DragEvent,
  btn: HTMLButtonElement,
  slot: number,
  phase: 'over' | 'drop',
  onDrop: () => void,
): boolean {
  const disposition = attackDragDisposition(e.dataTransfer?.types, slot, phase);
  if (disposition === 'ignore') return false;
  e.preventDefault();
  if (phase === 'over') {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    btn.classList.toggle('drop-target', disposition === 'highlight');
  } else {
    btn.classList.remove('drop-target');
    onDrop();
  }
  return true;
}
