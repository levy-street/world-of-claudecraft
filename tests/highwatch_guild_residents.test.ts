import { describe, expect, it } from 'vitest';
import {
  CONTRACT_CLERK_NPC_ID,
  GUILD_QUARTERMASTER_NPC_ID,
  GUILD_RECRUITER_NPC_ID,
  GUILDMASTER_NPC_ID,
  HIGHWATCH_GUILD_ENTITY_IDS,
  HIGHWATCH_GUILD_NPCS,
} from '../src/sim/content/highwatch_guild';
import { NPCS } from '../src/sim/data';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';
import { distancePointToObb } from '../src/sim/placed_town_kit';
import { Sim } from '../src/sim/sim';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe("the Highwatch guild's residents", () => {
  const ids = [
    GUILDMASTER_NPC_ID,
    CONTRACT_CLERK_NPC_ID,
    GUILD_QUARTERMASTER_NPC_ID,
    GUILD_RECRUITER_NPC_ID,
  ];

  it('are four dynamic records in the NPC table: no quests, no copper stock', () => {
    expect(Object.keys(HIGHWATCH_GUILD_NPCS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const def = HIGHWATCH_GUILD_NPCS[id];
      expect(NPCS[id], id).toBe(def);
      expect(def.dynamic, id).toBe(true);
      expect(def.questIds, id).toEqual([]);
      expect(def.vendorItems ?? [], id).toEqual([]);
      expect(def.greeting.length, id).toBeGreaterThan(40);
    }
  });

  it('stand once each, under their reserved ids, on the great hall floor, facing into the hall', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const guild = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
    const ground = terrainHeight(guild.placement.x, guild.placement.z, WORLD_SEED);
    for (const id of ids) {
      const copies = [...sim.entities.values()].filter(
        (e) => e.kind === 'npc' && e.templateId === id,
      );
      expect(copies, id).toHaveLength(1);
      const npc = sim.entities.get(
        HIGHWATCH_GUILD_ENTITY_IDS[id as keyof typeof HIGHWATCH_GUILD_ENTITY_IDS],
      );
      expect(npc?.templateId, id).toBe(id);
      if (!npc) continue;
      // inside the hall's walls, on its floor a hand over the pad
      expect(distancePointToObb({ x: npc.pos.x, z: npc.pos.z }, guild.footprint), id).toBe(0);
      expect(npc.pos.y - ground, id).toBeGreaterThan(0.4);
      expect(npc.pos.y - ground, id).toBeLessThan(0.9);
      expect(npc.pos.y, id).toBeCloseTo(groundHeight(npc.pos.x, npc.pos.z, WORLD_SEED), 3);
      // each looks toward the hall's middle rather than at a wall
      const toMiddle = Math.atan2(guild.position.x - npc.pos.x, guild.position.z - npc.pos.z);
      const off = Math.abs(
        Math.atan2(Math.sin(npc.facing - toMiddle), Math.cos(npc.facing - toMiddle)),
      );
      expect(off, id).toBeLessThan(Math.PI / 2);
    }
  });
});
