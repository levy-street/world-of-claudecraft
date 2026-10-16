import { describe, expect, it } from 'vitest';
import {
  HIGHWATCH_MANOR_NPCS,
  HIGHWATCH_STEWARD_ENTITY_ID,
  HIGHWATCH_STEWARD_NPC_ID,
} from '../src/sim/content/highwatch_manor';
import { NPCS } from '../src/sim/data';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';
import { distancePointToObb } from '../src/sim/placed_town_kit';
import { Sim } from '../src/sim/sim';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('the Highwatch manor steward', () => {
  it('is a gossip-only resident: no quests, no stock, dynamic (raised under a reserved id)', () => {
    const def = HIGHWATCH_MANOR_NPCS[HIGHWATCH_STEWARD_NPC_ID];
    expect(NPCS[HIGHWATCH_STEWARD_NPC_ID]).toBe(def);
    expect(def.questIds).toEqual([]);
    expect(def.vendorItems ?? []).toEqual([]);
    expect(def.dynamic).toBe(true);
    expect(def.greeting.length).toBeGreaterThan(40);
  });

  it('stands once, under his reserved id, inside the great hall on its floor', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const copies = [...sim.entities.values()].filter(
      (e) => e.kind === 'npc' && e.templateId === HIGHWATCH_STEWARD_NPC_ID,
    );
    expect(copies).toHaveLength(1);
    const steward = sim.entities.get(HIGHWATCH_STEWARD_ENTITY_ID);
    expect(steward?.templateId).toBe(HIGHWATCH_STEWARD_NPC_ID);
    const manor = HIGHWATCH_BUILDINGS_BY_ID.highwatch_manor;
    // inside the manor's walls (the great hall's box), on the floor a hand over the pad
    expect(distancePointToObb({ x: steward!.pos.x, z: steward!.pos.z }, manor.footprint)).toBe(0);
    expect(steward!.pos.y).toBeGreaterThan(12.5 + 0.4);
    expect(steward!.pos.y).toBeLessThan(12.5 + 0.9);
  });
});
