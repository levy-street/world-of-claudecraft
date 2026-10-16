// The inspector's panel for a selected built-in gameplay object (a farm bed,
// practice dummy, gather node or dungeon door): what it is, where it stands
// on this map, and Reset. Thin DOM over the pure roster
// (object_moves_core.ts); the move itself is object_move_controller.ts.

import type { MovableObjectKind, ObjectMoves } from '../sim/moved_objects';
import { tEntity } from '../ui/entity_i18n';
import { formatNumber, type TranslationKey, t } from '../ui/i18n';
import { button, el } from './dom';
import { movableObjectByKey, objectIsMoved, objectPosition } from './object_moves_core';

const KIND_LABEL: Readonly<Record<MovableObjectKind, TranslationKey>> = {
  farmBed: 'editor.objectMove.kindFarmBed',
  practiceDummy: 'editor.objectMove.kindPracticeDummy',
  gatherNode: 'editor.objectMove.kindGatherNode',
  dungeonDoor: 'editor.objectMove.kindDungeonDoor',
};

export interface ObjectMovePanelDeps {
  selectedKey(): string | null;
  moves(): ObjectMoves | undefined;
  reset(): void;
}

function coord(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1, useGrouping: false });
}

/** The panel for the selected object, or null when none is selected. */
export function buildObjectMovePanel(deps: ObjectMovePanelDeps): HTMLElement | null {
  const key = deps.selectedKey();
  const object = key ? movableObjectByKey(key) : undefined;
  if (!key || !object) return null;
  const root = el('section', 'ed-section');
  root.appendChild(el('h2', 'ed-section-title', t('editor.objectMove.title')));
  // Entity names localize through their own resolver; a bed or a vein has no
  // display name of its own, so its stable content id is what names it.
  const name =
    object.kind === 'dungeonDoor'
      ? tEntity({ kind: 'dungeon', id: object.id, field: 'name' })
      : object.kind === 'practiceDummy'
        ? tEntity({ kind: 'mob', id: object.id, field: 'name' })
        : object.id;
  root.appendChild(el('p', 'ed-muted', t(KIND_LABEL[object.kind])));
  root.appendChild(el('p', undefined, name));
  const moves = deps.moves();
  const pos = objectPosition(moves, object);
  root.appendChild(
    el('p', 'ed-muted', t('editor.objectMove.position', { x: coord(pos.x), z: coord(pos.z) })),
  );
  const moved = objectIsMoved(moves, key);
  root.appendChild(
    el('p', 'ed-muted', t(moved ? 'editor.objectMove.moved' : 'editor.objectMove.original')),
  );
  root.appendChild(el('p', 'ed-hint', t('editor.objectMove.hint')));
  const reset = button(t('editor.objectMove.reset'), () => deps.reset(), 'small');
  reset.disabled = !moved;
  root.appendChild(reset);
  return root;
}
