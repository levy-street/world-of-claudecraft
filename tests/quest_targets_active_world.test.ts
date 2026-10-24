// The quest markers (src/sim/quest_targets.ts questObjectiveAreas and
// questGiverNpcMarkers, plus the quest log's "Show on Map" fallback in
// src/ui/quest_map_location_core.ts) follow the LOADED world, not the
// built-in tables: a Studio map that moves a mob camp, a ground-object
// cluster or an NPC must move the marker with it. Driven with synthetic
// variants of the built-in world (never a particular map file), so the pin
// holds on any branch.

import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_WORLD,
  CAMPS,
  GROUND_OBJECTS,
  MOBS,
  NPCS,
  QUESTS,
  setActiveWorldContent,
} from '../src/sim/data';
import { questGiverNpcMarkers, questObjectiveAreas } from '../src/sim/quest_targets';
import type { NpcDef, QuestDef, QuestProgress, WorldContent } from '../src/sim/types';
import { questMapLocation } from '../src/ui/quest_map_location_core';

function activeLog(quest: QuestDef): Map<string, QuestProgress> {
  return new Map([
    [
      quest.id,
      { questId: quest.id, counts: quest.objectives.map(() => 0), state: 'active' as const },
    ],
  ]);
}

// Far enough that no moved blob can coincide with any built-in one.
const SHIFT = { x: 37.5, z: -41.25 };

function withCampsShifted(mobId: string): WorldContent {
  return {
    ...BUILTIN_WORLD,
    camps: CAMPS.map((camp) =>
      camp.mobId === mobId
        ? { ...camp, center: { x: camp.center.x + SHIFT.x, z: camp.center.z + SHIFT.z } }
        : camp,
    ),
  };
}

function centersFor(quest: QuestDef, objectiveIndex: number): string[] {
  return questObjectiveAreas(activeLog(quest))
    .filter((area) =>
      area.objectives.some((o) => o.questId === quest.id && o.objectiveIndex === objectiveIndex),
    )
    .map((area) => `${area.center.x},${area.center.z}`)
    .sort();
}

function campCenters(world: WorldContent, mobId: string): string[] {
  return world.camps
    .filter((camp) => camp.mobId === mobId)
    .map((camp) => `${camp.center.x},${camp.center.z}`)
    .sort();
}

function requireKillQuest(): { quest: QuestDef; mobId: string; objIndex: number } {
  for (const quest of Object.values(QUESTS)) {
    for (const [objIndex, o] of quest.objectives.entries()) {
      if (o.type === 'kill' && CAMPS.some((camp) => camp.mobId === o.targetMobId))
        return { quest, mobId: o.targetMobId, objIndex };
    }
  }
  throw new Error('expected a kill quest whose target mob has camps');
}

function requireLootQuest(): { quest: QuestDef; mobId: string; objIndex: number } {
  for (const quest of Object.values(QUESTS)) {
    for (const [objIndex, o] of quest.objectives.entries()) {
      if (o.type !== 'collect' || !o.itemId) continue;
      for (const [mobId, def] of Object.entries(MOBS)) {
        if (
          def.loot.some((l) => l.itemId === o.itemId && l.questId === quest.id) &&
          CAMPS.some((camp) => camp.mobId === mobId)
        )
          return { quest, mobId, objIndex };
      }
    }
  }
  throw new Error('expected a collect quest fed by tagged loot from a camp mob');
}

afterEach(() => setActiveWorldContent(null));

describe('questObjectiveAreas reads the active world', () => {
  it('moves a kill objective blob onto the moved camps', () => {
    const { quest, mobId, objIndex } = requireKillQuest();
    const builtin = centersFor(quest, objIndex);
    expect(builtin).toEqual(campCenters(BUILTIN_WORLD, mobId));

    const world = withCampsShifted(mobId);
    setActiveWorldContent(world);
    const moved = centersFor(quest, objIndex);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved).toEqual(campCenters(world, mobId));
    // Nothing is left behind at a built-in spot the map moved away from.
    for (const center of builtin) expect(moved).not.toContain(center);
  });

  it('moves a loot objective blob onto the moved camps of the dropping mob', () => {
    const { quest, mobId, objIndex } = requireLootQuest();
    const world = withCampsShifted(mobId);
    setActiveWorldContent(world);
    const centers = centersFor(quest, objIndex);
    for (const center of campCenters(world, mobId)) expect(centers).toContain(center);
    for (const center of campCenters(BUILTIN_WORLD, mobId)) expect(centers).not.toContain(center);
  });

  it('drops the blob when the map has no camp of the target mob', () => {
    const { quest, mobId, objIndex } = requireKillQuest();
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      camps: CAMPS.filter((camp) => camp.mobId !== mobId),
    });
    expect(centersFor(quest, objIndex)).toEqual([]);
  });

  it('moves a ground-object cluster blob with the map', () => {
    let found: { quest: QuestDef; itemId: string; objIndex: number } | null = null;
    for (const quest of Object.values(QUESTS)) {
      for (const [objIndex, o] of quest.objectives.entries()) {
        const itemId =
          o.type === 'collect'
            ? o.itemId
            : o.type === 'interact'
              ? o.targetObjectItemId
              : undefined;
        if (itemId && GROUND_OBJECTS.some((g) => g.itemId === itemId && g.positions.length > 0)) {
          found = { quest, itemId, objIndex };
          break;
        }
      }
      if (found) break;
    }
    expect(found, 'expected a quest fed by ground objects').not.toBeNull();
    if (!found) return;
    const { quest, itemId, objIndex } = found;
    const builtin = centersFor(quest, objIndex);
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      groundObjects: GROUND_OBJECTS.map((def) =>
        def.itemId === itemId
          ? {
              ...def,
              positions: def.positions.map((p) => ({ x: p.x + SHIFT.x, z: p.z + SHIFT.z })),
            }
          : def,
      ),
    });
    const moved = centersFor(quest, objIndex);
    expect(moved.length).toBeGreaterThan(0);
    for (const center of builtin) expect(moved).not.toContain(center);
  });

  it('keeps unchanged built-in tables and NPC identities while applying the layout', () => {
    expect(BUILTIN_WORLD.camps).toBe(CAMPS);
    expect(BUILTIN_WORLD.groundObjects).toBe(GROUND_OBJECTS);
    expect(Object.keys(BUILTIN_WORLD.npcs)).toEqual(Object.keys(NPCS));
    for (const [id, npc] of Object.entries(NPCS)) {
      const { pos: _pos, facing: _facing, ...gameplay } = npc;
      expect(BUILTIN_WORLD.npcs[id]).toMatchObject(gameplay);
    }
  });
});

function withNpc(id: string, npc: NpcDef | null): WorldContent {
  const npcs: Record<string, NpcDef> = { ...NPCS };
  if (npc) npcs[id] = npc;
  else delete npcs[id];
  return { ...BUILTIN_WORLD, npcs };
}

const MOVED_NPC_POS = { x: -86.25, z: -44.5 };
const at = (p: { x: number; z: number }) => `${p.x},${p.z}`;

describe('quest givers and quest NPCs follow the active world', () => {
  const available = () => 'available' as const;

  function requireGiver(): { npc: NpcDef; questId: string } {
    for (const marker of questGiverNpcMarkers(available, new Set())) {
      const questId = marker.quests[0].questId;
      const npc = Object.values(NPCS).find(
        (n) => n.questIds.includes(questId) && at(n.pos) === at(marker.pos),
      );
      if (npc) return { npc, questId };
    }
    throw new Error('expected a quest giver with a map glyph');
  }

  it('moves the glyph of a moved quest giver', () => {
    const { npc, questId } = requireGiver();
    setActiveWorldContent(withNpc(npc.id, { ...npc, pos: MOVED_NPC_POS }));
    const markers = questGiverNpcMarkers(available, new Set());
    const glyph = markers.find((m) => m.quests.some((q) => q.questId === questId));
    expect(glyph?.pos).toEqual(MOVED_NPC_POS);
    expect(markers.some((m) => at(m.pos) === at(npc.pos))).toBe(false);
  });

  it('draws no glyph for a quest giver the map dropped', () => {
    const { npc } = requireGiver();
    setActiveWorldContent(withNpc(npc.id, null));
    const markers = questGiverNpcMarkers(available, new Set());
    expect(markers.some((m) => at(m.pos) === at(npc.pos))).toBe(false);
  });

  it('moves an interact-NPC objective area with the map', () => {
    let found: { quest: QuestDef; npcId: string; objIndex: number } | null = null;
    for (const quest of Object.values(QUESTS)) {
      for (const [objIndex, o] of quest.objectives.entries()) {
        if (o.type === 'interact' && o.targetNpcId && NPCS[o.targetNpcId]) {
          found = { quest, npcId: o.targetNpcId, objIndex };
          break;
        }
      }
      if (found) break;
    }
    expect(found, 'expected a quest with an interact-NPC objective').not.toBeNull();
    if (!found) return;
    const { quest, npcId, objIndex } = found;
    setActiveWorldContent(withNpc(npcId, { ...NPCS[npcId], pos: MOVED_NPC_POS }));
    const centers = centersFor(quest, objIndex);
    expect(centers).toContain(at(MOVED_NPC_POS));
    expect(centers).not.toContain(at(NPCS[npcId].pos));
  });

  it('routes a ready quest to the moved turn-in NPC when no live entity answers', () => {
    const quest = Object.values(QUESTS).find(
      (q) => NPCS[q.turnInNpcId] && !NPCS[q.turnInNpcId].dynamic,
    );
    expect(quest, 'expected a quest with a placed turn-in NPC').toBeDefined();
    if (!quest) return;
    const npc = NPCS[quest.turnInNpcId];
    setActiveWorldContent(withNpc(npc.id, { ...npc, pos: MOVED_NPC_POS }));
    const log = new Map([
      [
        quest.id,
        { questId: quest.id, counts: quest.objectives.map(() => 0), state: 'ready' as const },
      ],
    ]);
    expect(questMapLocation(quest.id, log, () => null)).toEqual({
      questId: quest.id,
      ...MOVED_NPC_POS,
    });
  });
});
