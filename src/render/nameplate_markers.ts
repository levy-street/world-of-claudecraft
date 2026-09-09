// 'loot' is ordinary loot this viewer may take (the satchel); 'harvest' is a
// body with no ordinary loot for them but an open harvest claim (the blade).
export type NameplateMarkerTone =
  | 'none'
  | 'quest'
  | 'active'
  | 'loot'
  | 'harvest'
  | 'repeat'
  | 'cooldown';

import { drawNameplateHarvestIcon } from './nameplate_harvest_icon';
import { drawNameplateLootIcon } from './nameplate_loot_icon';

/** Corpse actions keep distinct silhouettes under normal and forced colors. */
export function drawNameplateCorpseIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  action: 'loot' | 'harvest',
  forcedColors: boolean,
): void {
  const draw = action === 'loot' ? drawNameplateLootIcon : drawNameplateHarvestIcon;
  draw(
    ctx,
    x,
    y,
    forcedColors ? 'CanvasText' : action === 'loot' ? '#f2c84b' : '#c98f4a',
    forcedColors ? 'Canvas' : '#1b1205',
  );
}
