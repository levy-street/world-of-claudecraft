import { describe, expect, it } from 'vitest';
import { LAST_KEEP_SPIRIT_HEALER_ENTITY_ID } from '../src/sim/content/graveyards';
import { HEALING_TRAINING_ENTITY_IDS } from '../src/sim/content/healing_training';
import { CRUCIBLE_VENDOR_ENTITY_ID } from '../src/sim/content/ignivar_loot';
import { FURY_ENTITY_ID } from '../src/sim/content/pvp_honor';
import { HARBOR_HOUSE_KEEPER_ENTITY_ID } from '../src/sim/content/wyrmwatch_harbor_house';
import { WARFARE_QUARTERMASTER_ENTITY_ID } from '../src/sim/pvp/warfare_quartermaster';
import { Sim } from '../src/sim/sim';
import { STATIC_WORLD_SERVICE_ENTITY_ID_MIN } from '../src/sim/types';
import { WEEKLY_KEEPER_ENTITY_ID, WEEKLY_KEEPER_ID } from '../src/sim/weekly_rewards';
import { WORLD_SEED } from '../src/sim/world_seed';
import { HARBOR_HOUSE_KEEPER_NPC_ID } from '../src/sim/wyrmwatch_harbor_house';

// The singleton NPCs spawn OUTSIDE the sequential allocator, each under a
// reserved 1_000_000_x id (types.ts, STATIC_WORLD_SERVICE_ENTITY_ID_MIN's
// note), and every spawn site skips when its id is already occupied. Two
// branches reserving the same slot therefore fail silently: whichever spawns
// second never exists, and neither parent's tests see it. That happened at the
// fourth release/v0.44.0 base merge into integration/world-quests-v0440 (the
// Weekly Vault keeper and the Wyrmwatch harbormaster both took _005), so the
// band is pinned here as one table.
const RESERVED: Record<string, number> = {
  FURY_ENTITY_ID,
  WARFARE_QUARTERMASTER_ENTITY_ID,
  CRUCIBLE_VENDOR_ENTITY_ID,
  LAST_KEEP_SPIRIT_HEALER_ENTITY_ID,
  HARBOR_HOUSE_KEEPER_ENTITY_ID,
  WEEKLY_KEEPER_ENTITY_ID,
  ...Object.fromEntries(
    Object.entries(HEALING_TRAINING_ENTITY_IDS).map(([id, n]) => [`HEALING_TRAINING:${id}`, n]),
  ),
};

describe('reserved singleton entity ids', () => {
  it('every reserved id sits in the singleton band, below the static service namespace', () => {
    for (const [name, id] of Object.entries(RESERVED)) {
      expect(id, name).toBeGreaterThanOrEqual(1_000_000_000);
      expect(id, name).toBeLessThan(STATIC_WORLD_SERVICE_ENTITY_ID_MIN);
      expect(Number.isSafeInteger(id), name).toBe(true);
    }
  });

  it('no two singletons reserve the same id', () => {
    const byId = new Map<number, string[]>();
    for (const [name, id] of Object.entries(RESERVED)) {
      byId.set(id, [...(byId.get(id) ?? []), name]);
    }
    const collisions = [...byId.entries()].filter(([, names]) => names.length > 1);
    expect(collisions, 'ids reserved more than once').toEqual([]);
  });

  it('the vault keeper and the harbormaster both spawn, each under her own id', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    expect(sim.entities.get(WEEKLY_KEEPER_ENTITY_ID)?.templateId).toBe(WEEKLY_KEEPER_ID);
    expect(sim.entities.get(HARBOR_HOUSE_KEEPER_ENTITY_ID)?.templateId).toBe(
      HARBOR_HOUSE_KEEPER_NPC_ID,
    );
    for (const templateId of [WEEKLY_KEEPER_ID, HARBOR_HOUSE_KEEPER_NPC_ID]) {
      const copies = [...sim.entities.values()].filter(
        (e) => e.kind === 'npc' && e.templateId === templateId,
      );
      expect(copies, templateId).toHaveLength(1);
    }
  });
});
