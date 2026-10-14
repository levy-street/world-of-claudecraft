// The throwaway entity the prewarm passes build a character rig from, moved
// out of renderer.ts: the local player's record (so held items and look ride
// along) re-keyed to a stand-in id, kind, template and look. Never enters the
// world.

import type { Entity } from '../sim/types';

export function prewarmStandInEntity(
  player: Entity,
  kind: 'player' | 'mob' | 'npc',
  templateId: string,
  color: number,
  scale: number,
  skin = 0,
  id = -10_000,
): Entity {
  const p = player;
  return {
    ...p,
    id,
    kind,
    templateId,
    name: templateId,
    level: 1,
    pos: { ...p.pos },
    prevPos: { ...p.pos },
    facing: 0,
    prevFacing: 0,
    targetId: null,
    auras: [],
    hostile: kind === 'mob',
    color,
    scale,
    skin,
    dead: false,
    castingAbility: null,
    overheadEmoteId: null,
    overheadEmoteUntil: 0,
    objectItemId: null,
    lootable: false,
    dungeonId: null,
    ownerId: null,
  };
}
