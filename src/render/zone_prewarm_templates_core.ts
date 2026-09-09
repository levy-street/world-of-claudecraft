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
import { MAGE_PET_MOBS } from '../sim/content/mage_pets';
import { WARLOCK_PET_MOBS } from '../sim/content/warlock_pets';
import { ABILITIES, CAMPS, DUNGEON_X_THRESHOLD, MOBS, NPCS, QUESTS, zoneAt } from '../sim/data';

export interface ZonePrewarmEntity {
  kind: string;
  templateId?: string | null;
  pos: { x: number; z: number };
}

let summonableIds: string[] | null = null;

/** Every template a player of ANY class can call to their side: the class
 *  pet tables plus the target of every summonDemon effect, base rank and
 *  later ranks (a talent-summoned guardian has a table row and no effect, a
 *  future effect may have no table row yet; the union covers both). A summon
 *  falls through every other arm (no camp, no quest, not live until the
 *  cast) and any other player can raise one in front of you, so the set is
 *  never scoped to the local class or spec. Static content, so computed
 *  once; sorted and deduplicated. */
export function summonableTemplateIds(): string[] {
  if (summonableIds) return summonableIds;
  const ids = new Set<string>([...Object.keys(MAGE_PET_MOBS), ...Object.keys(WARLOCK_PET_MOBS)]);
  for (const ability of Object.values(ABILITIES)) {
    const effectLists = [ability.effects, ...(ability.ranks ?? []).map((rank) => rank.effects)];
    for (const effects of effectLists) {
      for (const effect of effects) {
        if (effect.type === 'summonDemon' && MOBS[effect.mobId]) ids.add(effect.mobId);
      }
    }
  }
  summonableIds = [...ids].sort();
  return summonableIds;
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
    // The summonable pets, in every zone: the water elemental's first summon
    // linked its body cold on a live frame (a 4 s frame in the 2026-08-28
    // combat audit). The caller's per-session set pays each rig once.
    for (const templateId of summonableTemplateIds()) ids.add(templateId);
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
