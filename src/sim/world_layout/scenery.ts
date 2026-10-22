import type { WorldContent } from '../types';
import type { SceneryLayout } from './types';

export function placeLayoutScenery(base: WorldContent, edit?: SceneryLayout): WorldContent {
  if (!edit) return base;
  return {
    ...base,
    ...(edit.lamps?.length ? { sceneryLamps: [...(base.sceneryLamps ?? []), ...edit.lamps] } : {}),
    ...(edit.decks?.length ? { sceneryDecks: [...(base.sceneryDecks ?? []), ...edit.decks] } : {}),
    ...(edit.ambience?.length
      ? { sceneryAmbience: [...(base.sceneryAmbience ?? []), ...edit.ambience] }
      : {}),
    ...(edit.decorationExclusions?.length
      ? {
          decorationExclusions: [
            ...new Set([...(base.decorationExclusions ?? []), ...edit.decorationExclusions]),
          ],
        }
      : {}),
    ...(edit.additions?.length
      ? { placements: [...(base.placements ?? []), ...edit.additions] }
      : {}),
    ...(edit.collisions?.length
      ? { sceneryCollisions: [...(base.sceneryCollisions ?? []), ...edit.collisions] }
      : {}),
  };
}
