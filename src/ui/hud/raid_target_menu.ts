// The raid target icon picker (star to skull) for one unit, opened from the
// target frame's right-click on any markable unit and from the "Raid Target
// Icon" row of the player and pet menus. Extracted from the Hud coordinator
// under the monolith ratchet, the same shape as buddy_menu.ts: the popup
// chrome (placement, on-screen clamp, row binding) is the Hud's, handed in as
// a narrow host, and this module only decides what the picker shows and what
// each row sends.
//
// Whether a unit gets the picker at all is offersRaidTargetIcon's rule
// (raid_target_icons_core.ts), the sim's own; the write is server-authoritative
// and the check mark follows the next snapshot.

import type { IWorld } from '../../world_api';
import { CTX_MENU_PICKER_CLASS } from '../bag_item_action_menu';
import { raidMarkerDataUrl } from '../icons';
import type { BuddyMenuHost } from './buddy_menu';
import { raidTargetMenuHtml } from './target_frame_menu';

export function openRaidTargetMenu(
  host: Pick<BuddyMenuHost, 'placePopupAt' | 'keepPopupOnScreen' | 'bindContextMenuActions'>,
  world: Pick<IWorld, 'partyInfo' | 'markerFor' | 'setMarker' | 'clearMarker'>,
  entityId: number,
  name: string,
  x: number,
  y: number,
): void {
  if (!world.partyInfo) return; // marks are a group thing: every row would be refused
  const el = document.querySelector('#ctx-menu') as HTMLElement;
  el.classList.remove(CTX_MENU_PICKER_CLASS);
  el.innerHTML = raidTargetMenuHtml(name, world.markerFor(entityId), raidMarkerDataUrl);
  el.style.display = 'block';
  host.placePopupAt(el, x, y, 170, 340);
  host.keepPopupOnScreen(el);
  host.bindContextMenuActions((act) => {
    if (act === 'clear') world.clearMarker(entityId);
    else if (act.startsWith('m')) world.setMarker(entityId, Number(act.slice(1)));
  });
  // Opened from another menu's row by keyboard, focus would fall to the page:
  // land it on the symbol the unit wears, else the first one.
  const selected = el.querySelector<HTMLElement>('.ctx-item:has(.ctx-selected)');
  (selected ?? el.querySelector<HTMLElement>('.ctx-item'))?.focus();
}
