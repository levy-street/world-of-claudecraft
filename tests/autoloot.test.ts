import { describe, expect, it } from 'vitest';
import { AutoLoot, type AutoLootWorld } from '../src/game/autoloot';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import type { CorpseLoot, Entity, LootSlot } from '../src/sim/types';
import type { PartyInfo, PartyMemberInfo } from '../src/world_api';

// Minimal corpse stub: AutoLoot only reads kind/dead/lootable/loot/tappedById/pos/id.
function corpse(id: number, partial: Partial<Entity> = {}): Entity {
  return {
    id,
    kind: 'mob',
    dead: true,
    lootable: true,
    tappedById: null,
    pos: { x: 0, y: 0, z: 0 },
    loot: { copper: 0, items: [] } as CorpseLoot,
    ...partial,
  } as Entity;
}

function lootSlot(partial: Partial<LootSlot> = {}): LootSlot {
  return { itemId: 'test_item', count: 1, ...partial };
}

function member(pid: number, partial: Partial<PartyMemberInfo> = {}): PartyMemberInfo {
  return {
    pid,
    name: 'Ally',
    cls: 'warrior',
    level: 1,
    hp: 1,
    mhp: 1,
    res: 0,
    mres: 0,
    rtype: null,
    x: 0,
    z: 0,
    dead: 0,
    inCombat: 0,
    group: 1,
    ...partial,
  };
}

function partyInfo(members: PartyMemberInfo[]): PartyInfo {
  return {
    leader: members[0]?.pid ?? 1,
    raid: false,
    master: { enabled: false, looter: 0, threshold: 'rare' },
    members,
  };
}

const PLAYER_ID = 1;

function makeWorld(overrides: Partial<AutoLootWorld> = {}): {
  world: AutoLootWorld;
  calls: number[];
} {
  const calls: number[] = [];
  const entities = new Map<number, Entity>();
  const world: AutoLootWorld = {
    player: { id: PLAYER_ID, dead: false, pos: { x: 0, y: 0, z: 0 } } as Entity,
    playerId: PLAYER_ID,
    partyInfo: null,
    entities,
    autoLoot(id: number) {
      calls.push(id);
    },
    ...overrides,
  };
  return { world, calls };
}

describe('AutoLoot', () => {
  it('attempts a corpse the player tapped, in range', () => {
    const { world, calls } = makeWorld();
    world.entities.set(2, corpse(2, { tappedById: PLAYER_ID, pos: { x: 1, y: 0, z: 0 } }));
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([2]);
  });

  it('attempts a corpse tapped by a party member, in range', () => {
    const { world, calls } = makeWorld({ partyInfo: partyInfo([member(PLAYER_ID), member(9)]) });
    world.entities.set(2, corpse(2, { tappedById: 9, pos: { x: 1, y: 0, z: 0 } }));
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([2]);
  });

  it('attempts a corpse with personal loot for the player even when tapped by a stranger', () => {
    const { world, calls } = makeWorld();
    world.entities.set(
      2,
      corpse(2, {
        tappedById: 99,
        pos: { x: 1, y: 0, z: 0 },
        loot: { copper: 0, items: [lootSlot({ personalFor: [PLAYER_ID] })] },
      }),
    );
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([2]);
  });

  it('attempts a corpse whose loot has gone open-to-all even when tapped by a stranger', () => {
    const { world, calls } = makeWorld();
    world.entities.set(
      2,
      corpse(2, {
        tappedById: 99,
        pos: { x: 1, y: 0, z: 0 },
        loot: { copper: 0, items: [lootSlot({ openToAll: true, count: 1 })] },
      }),
    );
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([2]);
  });

  it('ignores a corpse whose open-to-all loot is fully depleted (count 0)', () => {
    const { world, calls } = makeWorld();
    world.entities.set(
      2,
      corpse(2, {
        tappedById: 99,
        pos: { x: 1, y: 0, z: 0 },
        loot: { copper: 0, items: [lootSlot({ openToAll: true, count: 0 })] },
      }),
    );
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([]);
  });

  it("ignores a stranger's corpse", () => {
    const { world, calls } = makeWorld();
    world.entities.set(2, corpse(2, { tappedById: 99, pos: { x: 1, y: 0, z: 0 } }));
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([]);
  });

  it('ignores an owned corpse that is out of range', () => {
    const { world, calls } = makeWorld();
    world.entities.set(2, corpse(2, { tappedById: PLAYER_ID, pos: { x: 500, y: 0, z: 0 } }));
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([]);
  });

  it('is a no-op while the player is dead', () => {
    const { world, calls } = makeWorld({
      player: { id: PLAYER_ID, dead: true, pos: { x: 0, y: 0, z: 0 } } as Entity,
    });
    world.entities.set(2, corpse(2, { tappedById: PLAYER_ID, pos: { x: 1, y: 0, z: 0 } }));
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([]);
  });

  it('suppresses a re-attempt within the 2s cooldown, then allows one after', () => {
    const { world, calls } = makeWorld();
    world.entities.set(2, corpse(2, { tappedById: PLAYER_ID, pos: { x: 1, y: 0, z: 0 } }));
    const al = new AutoLoot();
    al.run(world, 1000);
    al.run(world, 1500); // < 2000ms since last attempt
    al.run(world, 2999); // still < 2000ms since last attempt (1000 + 2000 = 3000)
    expect(calls).toEqual([2]);
    al.run(world, 3000); // exactly 2000ms later: allowed again
    expect(calls).toEqual([2, 2]);
  });

  it('does not attempt any loot while the player is physically inside a raid instance', () => {
    const origin = instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, 0);
    const { world, calls } = makeWorld({
      player: { id: PLAYER_ID, dead: false, pos: { x: origin.x, y: 0, z: origin.z } } as Entity,
    });
    world.entities.set(
      2,
      corpse(2, { tappedById: PLAYER_ID, pos: { x: origin.x + 1, y: 0, z: origin.z } }),
    );
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([]);
  });

  it('prunes cooldown state on despawn so a reused id can loot again immediately', () => {
    const { world, calls } = makeWorld();
    world.entities.set(2, corpse(2, { tappedById: PLAYER_ID, pos: { x: 1, y: 0, z: 0 } }));
    const al = new AutoLoot();
    al.run(world, 1000);
    expect(calls).toEqual([2]);

    // The corpse despawns and its id gets reused by a fresh, unrelated corpse
    // well within the retry window.
    world.entities.delete(2);
    al.run(world, 1100); // triggers pruning even though nothing new is lootable
    world.entities.set(2, corpse(2, { tappedById: PLAYER_ID, pos: { x: 1, y: 0, z: 0 } }));
    al.run(world, 1200);
    expect(calls).toEqual([2, 2]);
  });
});
