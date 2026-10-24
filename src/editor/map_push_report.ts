// The dialog a refused change-only push shows (map_push.ts): which items both
// the maker and someone else changed, so the maker can reopen the latest repo
// map and redo just those. Thin DOM over the merge's conflict list.

import { formatNumber, type TranslationKey, t } from '../ui/i18n';
import { button, el } from './dom';
import type { MapChangeKind, MapMergeConflict } from './map_merge_core';
import { buildModal } from './toasts';

const KIND_LABEL: Readonly<Record<MapChangeKind, TranslationKey>> = {
  placement: 'editor.push.kindPlacement',
  terrain: 'editor.push.kindTerrain',
  grassClear: 'editor.push.kindGrassClear',
  npc: 'editor.push.kindNpc',
  objectMove: 'editor.push.kindObjectMove',
  road: 'editor.push.kindRoad',
  roadEdit: 'editor.push.kindRoadEdit',
  paint: 'editor.push.kindPaint',
  field: 'editor.push.kindField',
};

const REASON_LABEL: Readonly<Record<MapMergeConflict['reason'], TranslationKey>> = {
  both: 'editor.push.reasonBoth',
  deleted: 'editor.push.reasonDeleted',
  overlap: 'editor.push.reasonOverlap',
};

/** The most conflicts the dialog lists by name; the rest are counted. */
const LISTED = 25;

export function showPushConflicts(
  parent: HTMLElement,
  conflicts: readonly MapMergeConflict[],
): void {
  const modal = buildModal(parent, t('editor.push.conflictsTitle'), () => {});
  modal.panel.appendChild(
    el(
      'p',
      'ed-modal-body',
      t('editor.push.conflictsBody', { count: formatNumber(conflicts.length) }),
    ),
  );
  const list = el('ul', 'ed-push-conflicts');
  for (const conflict of conflicts.slice(0, LISTED)) {
    list.appendChild(
      el(
        'li',
        undefined,
        t('editor.push.conflictRow', {
          kind: t(KIND_LABEL[conflict.kind]),
          // A paint clash names how many cells clash, not an item; a world
          // road is numbered from 1, as the Roads tab lists it.
          id:
            conflict.kind === 'paint'
              ? formatNumber(Number(conflict.id))
              : conflict.kind === 'roadEdit' && /^[0-9]+$/.test(conflict.id)
                ? formatNumber(Number(conflict.id) + 1)
                : conflict.id,
          reason: t(REASON_LABEL[conflict.reason]),
        }),
      ),
    );
  }
  modal.panel.appendChild(list);
  if (conflicts.length > LISTED) {
    modal.panel.appendChild(
      el(
        'p',
        'ed-hint',
        t('editor.push.conflictsMore', { count: formatNumber(conflicts.length - LISTED) }),
      ),
    );
  }
  const row = el('div', 'ed-modal-actions');
  row.appendChild(button(t('editor.push.close'), () => modal.close(), 'primary'));
  modal.panel.appendChild(row);
}
