import { describe, expect, it } from 'vitest';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { ESCORTS } from '../src/sim/data';
import { feastTemplateIds } from '../src/sim/professions/feast';
import type { Entity, GatherNodeDef, QuestProgress } from '../src/sim/types';
import type { FarmPatchDef } from '../src/world_api/farming';

const FEAST_TEMPLATE_ID = feastTemplateIds()[0];

// The node the press is offered (the live call site passes GATHER_NODES);
// one yard off the player, so it is in reach unless a case moves it.
const ORE_NODE = {
  id: 'ore_1',
  zoneId: 'zone',
  type: 'ore',
  pos: { x: 1, z: 0 },
  level: 1,
  tier: 1,
} as const satisfies GatherNodeDef;

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

function scan(
  targets: Entity[] = [],
  farmPatches: readonly FarmPatchDef[] = [],
  inventory?: readonly { itemId: string; count: number }[],
) {
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
      ...(inventory ? { inventory } : {}),
    },
  };
}

const FIELD_KIT = [{ itemId: 'field_kit', count: 1 }];

describe('resolveNearbyInteractionCandidate', () => {
  // The ladder IS the press ladder in nearby_interaction.ts, arm for arm. Note
  // what is absent: intentional gathering made the generic press ordinary
  // interaction for bodies and crops, so no corpse harvest ever resolves here;
  // a gather NODE is the one exception, and only when the caller offers nodes.
  it('slots an offered gather node below npc and escort start and above feast and bed', () => {
    const npc = entity({ id: 5, kind: 'npc', templateId: 'elder_maren', name: 'Elder Maren' });
    const feast = entity({
      id: 6,
      kind: 'object',
      templateId: FEAST_TEMPLATE_ID,
      name: 'Harvest Feast',
    });
    const nodes = [ORE_NODE];
    // An npc in reach still wins the press over the node.
    expect(
      resolveNearbyInteractionCandidate(
        scan([npc, feast], BED_PATCH).world,
        true,
        undefined,
        nodes,
      ),
    ).toMatchObject({ kind: 'npc', id: 5 });
    // The node beats the placed feast and the bed behind it.
    expect(
      resolveNearbyInteractionCandidate(scan([feast], BED_PATCH).world, true, undefined, nodes),
    ).toMatchObject({ kind: 'node', id: 'ore_1', node: ORE_NODE });
    expect(
      resolveNearbyInteractionCandidate(scan([], BED_PATCH).world, true, undefined, nodes),
    ).toMatchObject({ kind: 'node', id: 'ore_1' });
    // An idle escortee at its post (quest active) beats the node beside it:
    // escort start sits above the node arm. With the quest inactive the same
    // escortee is no candidate at all, and the node beside it wins.
    const escortDef = Object.values(ESCORTS)[0];
    const post = escortDef.start;
    const escortee = entity({
      id: 7,
      kind: 'mob',
      templateId: escortDef.npcMobId,
      name: 'Escortee',
      pos: { x: post.x, y: 0, z: post.z },
    });
    const atPost = scan([escortee]);
    atPost.world.player.pos = { x: post.x + 1, y: 0, z: post.z };
    const postNode = { ...ORE_NODE, id: 'ore_post', pos: { x: post.x + 2, z: post.z } };
    atPost.world.questLog.set(escortDef.questId, { state: 'active' } as unknown as QuestProgress);
    expect(
      resolveNearbyInteractionCandidate(atPost.world, true, undefined, [postNode]),
    ).toMatchObject({ kind: 'escort', id: 7 });
    atPost.world.questLog.clear();
    expect(
      resolveNearbyInteractionCandidate(atPost.world, true, undefined, [postNode]),
    ).toMatchObject({ kind: 'node', id: 'ore_post' });
    // Nearest node wins among several in reach.
    const nearer = { ...ORE_NODE, id: 'ore_near', pos: { x: 0.5, z: 0 } };
    expect(
      resolveNearbyInteractionCandidate(scan([]).world, true, undefined, [ORE_NODE, nearer]),
    ).toMatchObject({ kind: 'node', id: 'ore_near' });
    // Out of reach, the ladder falls through to the bed; a dead player never
    // gathers; no offered list means no node arm at all.
    const far = { ...ORE_NODE, id: 'ore_far', pos: { x: 40, z: 0 } };
    expect(
      resolveNearbyInteractionCandidate(scan([], BED_PATCH).world, true, undefined, [far]),
    ).toMatchObject({ kind: 'bed', id: 'bed_test_1' });
    const dead = scan([]);
    dead.world.player.dead = true;
    expect(resolveNearbyInteractionCandidate(dead.world, true, undefined, nodes)).toBeNull();
    expect(resolveNearbyInteractionCandidate(scan([]).world)).toBeNull();
  });

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
    // The harvest-choice arm is the LAST rung, so a Field Kit never promotes
    // the corpse above the npc behind it either.
    expect(
      resolveNearbyInteractionCandidate(scan([corpse, banker], [], FIELD_KIT).world),
    ).toMatchObject({ kind: 'npc', id: 3 });
  });

  describe('the corpse harvest-choice arm (the keyboard, pad and touch route)', () => {
    function harvestOnlyCorpse(overrides: Partial<Entity> = {}): Entity {
      return entity({
        id: 2,
        kind: 'mob',
        templateId: 'forest_wolf',
        name: 'Forest Wolf',
        dead: true,
        lootable: true,
        loot: null,
        corpseTimer: 60,
        ...overrides,
      });
    }

    it('resolves a harvest-only corpse for a Field Kit carrier when nothing else is in reach', () => {
      expect(
        resolveNearbyInteractionCandidate(scan([harvestOnlyCorpse()], [], FIELD_KIT).world),
      ).toEqual({ kind: 'harvest', id: 2, entity: expect.objectContaining({ id: 2 }) });
    });

    it('is no candidate without a carried Field Kit, exactly as before', () => {
      expect(resolveNearbyInteractionCandidate(scan([harvestOnlyCorpse()]).world)).toBeNull();
      expect(
        resolveNearbyInteractionCandidate(scan([harvestOnlyCorpse()], [], []).world),
      ).toBeNull();
      expect(
        resolveNearbyInteractionCandidate(
          scan([harvestOnlyCorpse()], [], [{ itemId: 'field_kit', count: 0 }]).world,
        ),
      ).toBeNull();
    });

    it('is no candidate once the harvest claim is spent, out of reach, or for a dead viewer', () => {
      expect(
        resolveNearbyInteractionCandidate(
          scan([harvestOnlyCorpse({ harvestClaimedBy: 9 })], [], FIELD_KIT).world,
        ),
      ).toBeNull();
      expect(
        resolveNearbyInteractionCandidate(
          scan([harvestOnlyCorpse({ pos: { x: 6, y: 0, z: 0 } })], [], FIELD_KIT).world,
        ),
      ).toBeNull();
      const dead = scan([harvestOnlyCorpse()], [], FIELD_KIT);
      dead.world.player.dead = true;
      expect(resolveNearbyInteractionCandidate(dead.world)).toBeNull();
    });

    it('sits below the garden bed and above the escort-away line', () => {
      expect(
        resolveNearbyInteractionCandidate(scan([harvestOnlyCorpse()], BED_PATCH, FIELD_KIT).world),
      ).toEqual({ kind: 'bed', id: 'bed_test_1' });
    });
  });
});
