// Resolve an action-bar core icon key (action_bar_view.ts) to the slot label's
// background-image value. Kept out of the painter so it holds no icon table or
// literal URL; the painter calls this only when a slot's icon key changes.
// Extracted from hud.ts (a pure key-to-url resolver needs none of the
// coordinator's state), so the Hud passes it through as a bare function.

import { iconDataUrl } from '../../icons';
import {
  ABILITY_ICON_PREFIX,
  ATTACK_ICON_KEY,
  EMPTY_ICON_KEY,
  ITEM_ICON_PREFIX,
} from './action_bar_view';

export function actionBarIconBg(iconKey: string): string {
  if (iconKey === EMPTY_ICON_KEY) return '';
  if (iconKey === ATTACK_ICON_KEY) return `url(${iconDataUrl('ability', 'attack')})`;
  if (iconKey.startsWith(ITEM_ICON_PREFIX)) {
    return `url(${iconDataUrl('item', iconKey.slice(ITEM_ICON_PREFIX.length))})`;
  }
  return `url(${iconDataUrl('ability', iconKey.slice(ABILITY_ICON_PREFIX.length))})`;
}
