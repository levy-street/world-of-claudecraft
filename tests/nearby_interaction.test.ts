import { describe, expect, it, vi } from 'vitest';
import { tryNearbyInteraction } from '../src/game/nearby_interaction';
import type { Entity, GatherNodeDef } from '../src/sim/types';

function entity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind'>): Entity {
  return {
    templateId: 'test',
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

function rig(targets: Entity[] = [], nodes: GatherNodeDef[] = []) {
  const player = entity({ id: 1, kind: 'player' });
  const calls: string[] = [];
  const world = {
    playerId: 1,
    player,
    entities: new Map<number, Entity>([
      [player.id, player],
      ...targets.map((target): [number, Entity] => [target.id, target]),
    ]),
    lootCorpse: (id: number) => {
      calls.push(`loot:${id}`);
      return true;
    },
    delveInteract: (id: number) => {
      calls.push(`delve:${id}`);
      return true;
    },
    enterDungeon: (id: string) => {
      calls.push(`enter:${id}`);
      return true;
    },
    leaveDungeon: () => {
      calls.push('leave');
      return true;
    },
    pickUpObject: (id: number) => {
      calls.push(`pickup:${id}`);
      return true;
    },
    resurrectAtSpiritHealer: () => {
      calls.push('resurrect');
      return true;
    },
    nodeHarvestableByMe: vi.fn(() => true),
    harvestNode: (id: string) => {
      calls.push(`harvest:${id}`);
      return true;
    },
  };
  const hud = {
    openMailbox: () => calls.push('mailbox'),
    openQuestDialog: (id: number) => calls.push(`quest:${id}`),
    openDelveBoard: (id: number) => calls.push(`board:${id}`),
    showError: (text: string) => calls.push(`error:${text}`),
  };
  return { world, hud, nodes, calls, player };
}

function interact(r: ReturnType<typeof rig>) {
  return tryNearbyInteraction(r.world, r.hud, r.nodes, 'too far', 'not ready', 'nothing');
}

describe('tryNearbyInteraction', () => {
  it('dispatches the nearest visible corpse loot', () => {
    const fartherCorpse = entity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 3, y: 0, z: 0 },
    });
    const nearerCorpse = entity({
      id: 3,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const r = rig([fartherCorpse, nearerCorpse]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual(['loot:3']);
  });

  it('skips corpse loot that is personal to another player', () => {
    const corpse = entity({
      id: 2,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [9] }] },
      pos: { x: 1, y: 0, z: 0 },
    });
    const r = rig([corpse]);

    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it.each([
    [
      'door',
      entity({
        id: 2,
        kind: 'object',
        templateId: 'dungeon_door',
        dungeonId: 'crypt',
        lootable: true,
      }),
      'enter:crypt',
    ],
    [
      'exit',
      entity({ id: 2, kind: 'object', templateId: 'dungeon_exit', lootable: true }),
      'leave',
    ],
    [
      'mailbox',
      entity({ id: 2, kind: 'object', templateId: 'mailbox', lootable: true }),
      'mailbox',
    ],
    ['pickup', entity({ id: 2, kind: 'object', lootable: true }), 'pickup:2'],
  ])('dispatches a nearby %s object', (_name, target, expected) => {
    const r = rig([target]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual([expected]);
  });

  it.each([
    ['quest', 'elder_maren', 'quest:2'],
    ['delve board', 'brother_halven_marsh', 'board:2'],
  ])('opens the nearby %s interaction', (_name, templateId, expected) => {
    const r = rig([entity({ id: 2, kind: 'npc', templateId })]);

    expect(interact(r)).toBe(true);
    expect(r.calls).toEqual([expected]);
  });

  it('harvests a ready node and preserves movement for a not-ready node', () => {
    const node = {
      id: 'ore_1',
      zoneId: 'zone',
      type: 'ore',
      pos: { x: 1, z: 0 },
      level: 1,
    } as const;
    const ready = rig([], [node]);
    expect(interact(ready)).toBe(true);
    expect(ready.calls).toEqual(['harvest:ore_1']);

    const coolingDown = rig([], [node]);
    coolingDown.world.nodeHarvestableByMe.mockReturnValue(false);
    expect(interact(coolingDown)).toBe(false);
    expect(coolingDown.calls).toEqual(['error:not ready']);
  });

  it('keeps corpse, delve, object, npc, node priority stable', () => {
    const npc = entity({ id: 2, kind: 'npc', templateId: 'elder_maren' });
    const object = entity({ id: 3, kind: 'object', lootable: true });
    const delve = entity({ id: 4, kind: 'object', templateId: 'delve_chest', lootable: true });
    const corpse = entity({
      id: 5,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
    });
    const node = {
      id: 'ore_1',
      zoneId: 'zone',
      type: 'ore',
      pos: { x: 1, z: 0 },
      level: 1,
    } as const;
    const cases = [
      { targets: [corpse, delve, object, npc], expected: 'loot:5' },
      { targets: [delve, object, npc], expected: 'delve:4' },
      { targets: [object, npc], expected: 'pickup:3' },
      { targets: [npc], expected: 'quest:2' },
      { targets: [], expected: 'harvest:ore_1' },
    ];

    for (const { targets, expected } of cases) {
      const r = rig(targets, [node]);
      expect(interact(r)).toBe(true);
      expect(r.calls).toEqual([expected]);
    }
  });

  it('resurrects a ghost at a spirit healer and ignores all other dead-player actions', () => {
    const healer = entity({ id: 2, kind: 'npc', templateId: 'spirit_healer' });
    const competingNpc = entity({ id: 3, kind: 'npc', templateId: 'elder_maren' });
    const competingObject = entity({ id: 4, kind: 'object', lootable: true });
    const competingCorpse = entity({
      id: 5,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
    });
    const ghost = rig([healer, competingNpc, competingObject, competingCorpse]);
    ghost.player.dead = true;
    ghost.player.ghost = true;
    expect(interact(ghost)).toBe(true);
    expect(ghost.calls).toEqual(['resurrect']);

    const corpse = entity({
      id: 3,
      kind: 'mob',
      dead: true,
      lootable: true,
      loot: { copper: 1, items: [] },
    });
    const dead = rig([corpse]);
    dead.player.dead = true;
    expect(interact(dead)).toBe(false);
    expect(dead.calls).toEqual(['error:nothing']);
  });

  it('returns false and shows feedback when there is no eligible target', () => {
    const r = rig();

    expect(interact(r)).toBe(false);
    expect(r.calls).toEqual(['error:nothing']);
  });

  it('returns a rejected authoritative pickup result', async () => {
    const target = entity({ id: 2, kind: 'object', lootable: true });
    const r = rig([target]);
    (r.world as any).pickUpObject = async (id: number) => {
      r.calls.push(`pickup:${id}`);
      return false;
    };

    await expect(interact(r)).resolves.toBe(false);
    expect(r.calls).toEqual(['pickup:2']);
  });
});
