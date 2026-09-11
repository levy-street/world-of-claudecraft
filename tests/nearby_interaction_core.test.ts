import { describe, expect, it } from 'vitest';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { feastTemplateIds } from '../src/sim/professions/feast';
import type { Entity, QuestProgress } from '../src/sim/types';
import type { FarmPatchDef } from '../src/world_api/farming';

const FEAST_TEMPLATE_ID = feastTemplateIds()[0];

const BED_PATCH: readonly FarmPatchDef[] = [
  {
    id: 'patch_test',
    zoneId: 'zone',
    tier: 1,
    x: 0,
    z: 0,
    beds: [{ id: 'bed_test_1', x: 1, z: 0 }],
  },
];

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
    name: 'Test target',
    pos: { x: 0, y: 0, z: 0 },
    dead: false,
    ghost: false,
    lootable: false,
    loot: null,
    harvestClaimedBy: null,
    dungeonId: null,
    ...overrides,
  } as Entity;
}

function scan(targets: Entity[] = [], farmPatches: readonly FarmPatchDef[] = []) {
  const player = entity({ id: 1, kind: 'player', name: 'Adventurer' });
  return {
    world: {
      playerId: player.id,
      player,
      entities: new Map<number, Entity>([
        [player.id, player],
        ...targets.map((target): [number, Entity] => [target.id, target]),
      ]),
      questLog: new Map<string, QuestProgress>(),
      farmPatches,
    },
  };
}

describe('resolveNearbyInteractionCandidate', () => {
  // The ladder IS the press ladder in nearby_interaction.ts, arm for arm. Note
  // what is absent: intentional gathering made the generic press ordinary
  // interaction only, so no gather node and no corpse harvest ever resolves
  // here.
  it('returns the same stable corpse, delve, object, npc, feast, bed priority used by dispatch', () => {
    const corpse = entity({
      id: 2,
      kind: 'mob',
      templateId: 'forest_wolf',
      name: 'Forest Wolf',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
    });
    const delve = entity({
      id: 3,
      kind: 'object',
      templateId: 'delve_chest',
      name: 'Delve Cache',
      lootable: true,
    });
    const object = entity({ id: 4, kind: 'object', name: 'Supply Crate', lootable: true });
    const npc = entity({ id: 5, kind: 'npc', templateId: 'elder_maren', name: 'Elder Maren' });
    const feast = entity({
      id: 6,
      kind: 'object',
      templateId: FEAST_TEMPLATE_ID,
      name: 'Harvest Feast',
    });

    const cases = [
      { targets: [corpse, delve, object, npc, feast], kind: 'corpse', id: 2 },
      { targets: [delve, object, npc, feast], kind: 'delve', id: 3 },
      { targets: [object, npc, feast], kind: 'object', id: 4 },
      { targets: [npc, feast], kind: 'npc', id: 5 },
      { targets: [feast], kind: 'feast', id: 6 },
      { targets: [], kind: 'bed', id: 'bed_test_1' },
    ] as const;

    for (const expected of cases) {
      const { targets, ...match } = expected;
      const { world } = scan([...targets], BED_PATCH);
      expect(resolveNearbyInteractionCandidate(world)).toMatchObject(match);
    }
  });

  it('resolves a ground object candidate dispatch can route, without dispatching it', () => {
    const mailbox = entity({
      id: 2,
      kind: 'object',
      templateId: 'mailbox',
      name: 'Mailbox',
      lootable: true,
    });
    const { world } = scan([mailbox]);

    // The candidate carries only what dispatch reads: the arm, the id, and the
    // entity it routes on (nearby_interaction.ts branches on templateId here).
    const candidate = resolveNearbyInteractionCandidate(world);
    expect(candidate).toMatchObject({ kind: 'object', id: 2 });
    expect(candidate?.kind === 'object' && candidate.entity.templateId).toBe('mailbox');
    expect(Object.keys(candidate ?? {}).sort()).toEqual(['entity', 'id', 'kind']);
  });

  it('carries the bed id, which is content and not an entity id', () => {
    const { world } = scan([], BED_PATCH);
    const candidate = resolveNearbyInteractionCandidate(world);
    expect(candidate).toEqual({ kind: 'bed', id: 'bed_test_1' });
  });

  it('ignores a harvest-only corpse entirely, and still resolves the npc behind it', () => {
    // hasLoot, never canOpen: a corpse with nothing this viewer may loot is no
    // candidate at all, so it cannot swallow an interaction standing behind it.
    const corpse = entity({
      id: 2,
      kind: 'mob',
      templateId: 'forest_wolf',
      name: 'Forest Wolf',
      dead: true,
      lootable: true,
      loot: { copper: 0, items: [] },
    });
    const banker = entity({
      id: 3,
      kind: 'npc',
      templateId: 'bursar_wick',
      name: 'Bursar Wick',
    });

    expect(resolveNearbyInteractionCandidate(scan([corpse]).world)).toBeNull();
    expect(resolveNearbyInteractionCandidate(scan([corpse, banker]).world)).toMatchObject({
      kind: 'npc',
      id: 3,
    });
  });
});
