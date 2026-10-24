// Which overhead emote a body plays (renderer.ts, the per-entity loop): a
// player's own emote, or a talking NPC's gesture (the dungeon lore guides set
// one as they speak, src/sim/dungeon_guide/speech.ts), or a FRIENDLY mob's (the
// Mirefen muster's soldiers cheer a kill, src/sim/mirefen_muster.ts). Hostile mobs
// and ground objects never play one; neither does the dead. Pure.

import type { Entity, OverheadEmoteId } from '../sim/types';

export function bodyEmoteId(
  e: Pick<Entity, 'kind' | 'overheadEmoteId' | 'dead'> & Partial<Pick<Entity, 'hostile'>>,
): OverheadEmoteId | null {
  const friendlyMob = e.kind === 'mob' && e.hostile === false;
  if (e.kind !== 'player' && e.kind !== 'npc' && !friendlyMob) return null;
  return e.overheadEmoteId && !e.dead ? e.overheadEmoteId : null;
}
