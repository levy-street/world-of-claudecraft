// Which overhead emote a body plays (renderer.ts, the per-entity loop): a
// player's own emote, or a talking NPC's gesture (the dungeon lore guides set
// one as they speak, src/sim/dungeon_guide/speech.ts). Mobs and ground objects
// never play one; neither does the dead. Pure.

import type { Entity, OverheadEmoteId } from '../sim/types';

export function bodyEmoteId(
  e: Pick<Entity, 'kind' | 'overheadEmoteId' | 'dead'>,
): OverheadEmoteId | null {
  if (e.kind !== 'player' && e.kind !== 'npc') return null;
  return e.overheadEmoteId && !e.dead ? e.overheadEmoteId : null;
}
