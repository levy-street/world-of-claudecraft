// Which mob or NPC templates a zone can show, for the entry and zone-crossing
// prewarm. Pure: it reads the STATIC content tables plus whatever live entities
// the caller hands it, and returns a sorted id list, so the selection is
// testable without a renderer, a scene or a world.
//
// Static content is authoritative here on purpose: online clients only receive
// nearby entities, so a just-crossed zone may not have delivered its first
// snapshot by the time the transition prewarm starts. Dynamic and event content
// has no static camp record, so whatever the sim already knows is unioned in,
// without making correctness depend on snapshot timing.
import { CAMPS, DUNGEON_X_THRESHOLD, MOBS, NPCS, QUESTS, zoneAt } from '../sim/data';

export interface ZonePrewarmEntity {
  kind: string;
  templateId?: string | null;
  pos: { x: number; z: number };
}

export function zonePrewarmTemplateIds(
  zoneId: string,
  kind: 'mob' | 'npc',
  liveEntities: Iterable<ZonePrewarmEntity>,
): string[] {
  const ids = new Set<string>();
  if (kind === 'mob') {
    for (const camp of CAMPS) {
      if (zoneAt(camp.center.x, camp.center.z).id === zoneId) ids.add(camp.mobId);
    }
    // The kill targets of the zone's quests: a summon-only mob (the Proving
    // Shore's Mister Crabs, called by a quest item) has no camp, and its rig
    // linked cold the first time the lure was used.
    for (const npc of Object.values(NPCS)) {
      if (npc.dynamic || zoneAt(npc.pos.x, npc.pos.z).id !== zoneId) continue;
      for (const questId of npc.questIds) {
        for (const objective of QUESTS[questId]?.objectives ?? []) {
          if (objective.type === 'kill' && MOBS[objective.targetMobId])
            ids.add(objective.targetMobId);
        }
      }
    }
  } else {
    for (const npc of Object.values(NPCS)) {
      if (!npc.dynamic && zoneAt(npc.pos.x, npc.pos.z).id === zoneId) ids.add(npc.id);
    }
  }
  for (const entity of liveEntities) {
    // Dungeon interiors sit past the instance threshold and belong to no zone.
    if (entity.kind !== kind || !entity.templateId || entity.pos.x > DUNGEON_X_THRESHOLD) continue;
    if (zoneAt(entity.pos.x, entity.pos.z).id === zoneId) ids.add(entity.templateId);
  }
  return [...ids].sort();
}
