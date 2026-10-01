// Pure view core for the unowned-mob target frame menu (right-click, long
// press or double tap on the target frame, or a nameplate's menu gesture).
// Every such mob gets an Inspect row (the mob inspect window); a live hostile
// mob also gets the raid-marker picker while the viewer is in a party, which
// is exactly the set the menu offered before Inspect existed (markers are a
// coordination feature). The controller (mob_target_menu_controller.ts)
// paints these rows into the shared #ctx-menu.

import { t } from '../../i18n';
import { RAID_MARKER_LABEL_KEYS, raidMarkerDisplayName } from '../../raid_marker_labels_view';

export type MobTargetMenuAction = 'inspect' | 'clear' | 'close' | `m${number}`;

export interface MobTargetMenuRow {
  readonly act: MobTargetMenuAction;
  readonly label: string;
  /** An explicit accessible name, or null to use the visible label. */
  readonly aria: string | null;
  /** The raid marker index a marker row sets, else null. */
  readonly marker: number | null;
  /** Whether this marker row is the one already on the mob. */
  readonly selected: boolean;
}

export interface MobTargetMenuInput {
  /** A live, hostile, unowned mob while the viewer is in a party. */
  readonly markable: boolean;
  /** The marker currently on the mob, or null. */
  readonly currentMarker: number | null;
}

export function mobTargetMenuRows(input: MobTargetMenuInput): MobTargetMenuRow[] {
  const rows: MobTargetMenuRow[] = [
    {
      act: 'inspect',
      label: t('hudChrome.mobInspect.menuInspect'),
      aria: null,
      marker: null,
      selected: false,
    },
  ];
  if (input.markable) {
    for (let i = 0; i < RAID_MARKER_LABEL_KEYS.length; i++) {
      const markerName = raidMarkerDisplayName(i);
      const selected = input.currentMarker === i;
      rows.push({
        act: `m${i}`,
        label: markerName,
        aria: selected
          ? t('hud.markers.markerSelectedAria', { marker: markerName })
          : t('hud.markers.markerAria', { marker: markerName }),
        marker: i,
        selected,
      });
    }
    rows.push({
      act: 'clear',
      label: t('hud.markers.clear'),
      aria: null,
      marker: null,
      selected: false,
    });
  }
  rows.push({
    act: 'close',
    label: t('hud.markers.cancel'),
    aria: null,
    marker: null,
    selected: false,
  });
  return rows;
}
