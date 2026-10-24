// The inspector's panels for the built-in gameplay objects a map can change
// (a farm bed, practice dummy, gather node or dungeon door): the selected
// object's panel (what it is, where it stands, its turn and size where the
// kind allows, Delete and Reset) and the list of objects this map deleted,
// each with Restore. Thin DOM over the pure roster (object_moves_core.ts);
// the edits themselves are object_move_controller.ts.

import {
  MAX_OBJECT_SCALE,
  MIN_OBJECT_SCALE,
  type MovableObjectKind,
  OBJECT_EDIT_CAPS,
  type ObjectMoves,
} from '../sim/moved_objects';
import { tEntity } from '../ui/entity_i18n';
import { formatNumber, type TranslationKey, t } from '../ui/i18n';
import { button, el, slider } from './dom';
import {
  type MovableObject,
  movableObjectByKey,
  objectIsMoved,
  objectPose,
  removedObjects,
} from './object_moves_core';

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
  /** Turn the selected object (radians); `commit` closes the undo step. */
  turn(rotY: number, commit: boolean): void;
  /** Resize the selected object (a multiplier); `commit` as for turn. */
  resize(scale: number, commit: boolean): void;
  /** Delete the selected object from this map. */
  remove(): void;
}

export interface RemovedObjectsPanelDeps {
  moves(): ObjectMoves | undefined;
  restore(key: string): void;
}

function coord(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1, useGrouping: false });
}

const RAD_TO_DEG = 180 / Math.PI;

/** What names the object: entity names localize through their own resolver;
 *  a bed or a vein has no display name of its own, so its stable content id
 *  is what names it. */
function objectName(object: MovableObject): string {
  return object.kind === 'dungeonDoor'
    ? tEntity({ kind: 'dungeon', id: object.id, field: 'name' })
    : object.kind === 'practiceDummy'
      ? tEntity({ kind: 'mob', id: object.id, field: 'name' })
      : object.id;
}

/** The panel for the selected object, or null when none is selected. */
export function buildObjectMovePanel(deps: ObjectMovePanelDeps): HTMLElement | null {
  const key = deps.selectedKey();
  const object = key ? movableObjectByKey(key) : undefined;
  if (!key || !object) return null;
  const root = el('section', 'ed-section');
  root.appendChild(el('h2', 'ed-section-title', t('editor.objectMove.title')));
  root.appendChild(el('p', 'ed-muted', t(KIND_LABEL[object.kind])));
  root.appendChild(el('p', undefined, objectName(object)));
  const moves = deps.moves();
  const pose = objectPose(moves, object);
  root.appendChild(
    el('p', 'ed-muted', t('editor.objectMove.position', { x: coord(pose.x), z: coord(pose.z) })),
  );
  const edited = objectIsMoved(moves, key);
  root.appendChild(
    el('p', 'ed-muted', t(edited ? 'editor.objectMove.edited' : 'editor.objectMove.original')),
  );
  root.appendChild(el('p', 'ed-hint', t('editor.objectMove.hint')));
  const caps = OBJECT_EDIT_CAPS[object.kind];
  if (caps.rotate) {
    root.appendChild(
      slider(t('editor.objectMove.rotation'), {
        min: -180,
        max: 180,
        step: 5,
        value: Math.round(pose.rotY * RAD_TO_DEG),
        onInput: (deg) => deps.turn(deg / RAD_TO_DEG, false),
        onChange: (deg) => deps.turn(deg / RAD_TO_DEG, true),
        format: (deg) => formatNumber(deg, { maximumFractionDigits: 0 }),
      }).root,
    );
  }
  if (caps.scale) {
    root.appendChild(
      slider(t('editor.objectMove.size'), {
        min: MIN_OBJECT_SCALE,
        max: MAX_OBJECT_SCALE,
        step: 0.05,
        value: pose.scale,
        onInput: (scale) => deps.resize(scale, false),
        onChange: (scale) => deps.resize(scale, true),
        format: (scale) => formatNumber(scale, { maximumFractionDigits: 2 }),
      }).root,
    );
  }
  if (!caps.rotate && !caps.scale) {
    root.appendChild(el('p', 'ed-hint', t('editor.objectMove.doorFixed')));
  }
  const row = el('div', 'ed-row');
  const reset = button(t('editor.objectMove.resetAll'), () => deps.reset(), 'small');
  reset.disabled = !edited;
  row.appendChild(reset);
  row.appendChild(button(t('editor.objectMove.delete'), () => deps.remove(), 'small danger'));
  root.appendChild(row);
  root.appendChild(
    el(
      'p',
      'ed-hint',
      t(
        object.kind === 'dungeonDoor'
          ? 'editor.objectMove.doorDeleteHint'
          : object.kind === 'practiceDummy'
            ? 'editor.objectMove.dummyDeleteHint'
            : 'editor.objectMove.deleteHint',
      ),
    ),
  );
  return root;
}

/** The list of objects this map deleted, each with Restore; null when none. */
export function buildRemovedObjectsPanel(deps: RemovedObjectsPanelDeps): HTMLElement | null {
  const removed = removedObjects(deps.moves());
  if (removed.length === 0) return null;
  const root = el('section', 'ed-section');
  root.appendChild(el('h2', 'ed-section-title', t('editor.objectMove.deletedTitle')));
  root.appendChild(el('p', 'ed-hint', t('editor.objectMove.deletedHint')));
  for (const object of removed) {
    const row = el('div', 'ed-row');
    row.appendChild(
      el(
        'span',
        undefined,
        t('editor.objectMove.deletedRow', {
          kind: t(KIND_LABEL[object.kind]),
          name: objectName(object),
        }),
      ),
    );
    row.appendChild(
      button(t('editor.objectMove.restore'), () => deps.restore(object.key), 'small'),
    );
    root.appendChild(row);
  }
  return root;
}
