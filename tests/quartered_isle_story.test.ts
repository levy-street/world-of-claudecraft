import { describe, expect, it } from 'vitest';
import { QUARTERED_ISLE_CAMPS, QUARTERED_ISLE_MOBS } from '../src/sim/content/quartered_isle_mobs';
import {
  QUARTERED_ISLE_OBJECTS,
  QUARTERED_ISLE_QUEST_ORDER,
  QUARTERED_ISLE_STORY_NPCS,
  QUARTERED_ISLE_STORY_QUESTS,
  RIVALMOOT_KEEPER_NPC_ID,
  RIVALMOOT_TOWNSFOLK_ENTITY_IDS,
} from '../src/sim/content/quartered_isle_story';
import { GROUND_OBJECTS, ITEMS, NPCS, QUEST_ORDER, QUESTS, zoneAt } from '../src/sim/data';
import { isleFissureAt } from '../src/sim/quartered_shatter';
import { Sim } from '../src/sim/sim';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Rivalmoot's townsfolk and the isle's history line, The Moot Rolls
// (content/quartered_isle_story.ts).

describe("Rivalmoot's townsfolk", () => {
  it('are dynamic singletons spawned under their reserved ids', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    for (const [npcId, entityId] of Object.entries(RIVALMOOT_TOWNSFOLK_ENTITY_IDS)) {
      expect(NPCS[npcId], npcId).toBe(QUARTERED_ISLE_STORY_NPCS[npcId]);
      expect(NPCS[npcId].dynamic, npcId).toBe(true);
      const e = sim.entities.get(entityId);
      expect(e, npcId).toBeDefined();
      expect(e?.kind).toBe('npc');
      expect(zoneAt(e?.pos.x ?? 0, e?.pos.z ?? 0).id, npcId).toBe('quartered_isle');
    }
  });

  it('keep the inn and the shop: an innkeeper and an outfitter stocking live items, no tools', () => {
    expect(NPCS.innkeeper_bettany_quell.innkeeper).toBe(true);
    for (const npc of Object.values(QUARTERED_ISLE_STORY_NPCS)) {
      for (const id of npc.vendorItems ?? []) {
        expect(ITEMS[id], `${npc.id} sells ${id}`).toBeDefined();
      }
    }
    expect(NPCS.outfitter_harl_bracken.vendorItems).toEqual([
      'healing_potion',
      'mana_potion',
      'field_kit',
    ]);
  });
});

describe('The Moot Rolls', () => {
  it('is one ordered chain from the Keeper, registered in the merged tables', () => {
    const keeper = NPCS[RIVALMOOT_KEEPER_NPC_ID];
    expect(keeper.questIds).toEqual(QUARTERED_ISLE_QUEST_ORDER);
    expect(QUEST_ORDER.slice(-QUARTERED_ISLE_QUEST_ORDER.length)).toEqual(
      QUARTERED_ISLE_QUEST_ORDER,
    );
    QUARTERED_ISLE_QUEST_ORDER.forEach((id, i) => {
      const q = QUESTS[id];
      expect(q, id).toBe(QUARTERED_ISLE_STORY_QUESTS[id]);
      expect(q.giverNpcId).toBe(RIVALMOOT_KEEPER_NPC_ID);
      expect(q.minLevel).toBe(20);
      expect(q.requiresQuest).toBe(i === 0 ? undefined : QUARTERED_ISLE_QUEST_ORDER[i - 1]);
      expect(NPCS[q.turnInNpcId], id).toBeDefined();
    });
  });

  it('ends at the Fallen Giant, fighting the Remnant of the First Colossus', () => {
    const last = QUESTS[QUARTERED_ISLE_QUEST_ORDER[QUARTERED_ISLE_QUEST_ORDER.length - 1]];
    expect(last.objectives).toEqual([
      expect.objectContaining({ type: 'kill', targetMobId: 'remnant_first_colossus', count: 1 }),
    ]);
  });

  it('asks only for isle mobs with spawns, and isle objects on dry ground', () => {
    for (const id of QUARTERED_ISLE_QUEST_ORDER) {
      for (const o of QUESTS[id].objectives) {
        if (o.type === 'kill') {
          expect(QUARTERED_ISLE_MOBS[o.targetMobId], `${id}: ${o.targetMobId}`).toBeDefined();
          const spawns = QUARTERED_ISLE_CAMPS.filter((c) => c.mobId === o.targetMobId).reduce(
            (n, c) => n + c.count,
            0,
          );
          expect(spawns, `${id}: ${o.targetMobId}`).toBeGreaterThanOrEqual(Math.min(o.count, 3));
        }
        if (o.type === 'interact' && o.targetObjectItemId) {
          const obj = GROUND_OBJECTS.find((g) => g.itemId === o.targetObjectItemId);
          expect(obj, `${id}: ${o.targetObjectItemId}`).toBeDefined();
          expect(QUARTERED_ISLE_OBJECTS).toContain(obj);
          expect(ITEMS[o.targetObjectItemId].questId).toBe(id);
          expect(obj?.positions.length).toBeGreaterThanOrEqual(o.count);
          for (const p of obj?.positions ?? []) {
            expect(zoneAt(p.x, p.z).id).toBe('quartered_isle');
            expect(groundHeight(p.x, p.z, WORLD_SEED)).toBeGreaterThan(WATER_LEVEL + 1);
            expect(isleFissureAt(p.x, p.z, 1)).toBe(0);
          }
        }
      }
    }
  });
});
