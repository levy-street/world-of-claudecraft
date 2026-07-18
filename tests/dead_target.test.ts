// Tests for src/sim/dead_target.ts: which DEAD entities stay selectable. Covers the
// pure predicate directly, plus an integration check that Targeting.targetEntity lets
// a player select their OWN dead pet and dead players while still rejecting other
// corpses that are neither lootable nor owned.

import { describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { deadTargetSelectable } from '../src/sim/dead_target';
import type { SimContext } from '../src/sim/sim_context';
import { Targeting } from '../src/sim/targeting';
import type { Entity } from '../src/sim/types';

function ent(partial: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'mob',
    dead: false,
    hostile: true,
    ownerId: null,
    lootable: false,
    pos: { x: 0, y: 0, z: 0 },
    facing: 0,
    targetId: null,
    autoAttack: false,
    followTargetId: null,
    aggroTargetId: null,
    ...partial,
  } as unknown as Entity;
}

describe('deadTargetSelectable', () => {
  it('allows a lootable corpse regardless of owner', () => {
    expect(deadTargetSelectable(ent({ id: 10, dead: true, lootable: true }), 1)).toBe(true);
  });

  it("allows the viewer's own pet", () => {
    const pet = ent({ id: 20, dead: true, ownerId: 1, hostile: false });
    expect(deadTargetSelectable(pet, 1)).toBe(true);
  });

  it("rejects another player's pet", () => {
    const pet = ent({ id: 20, dead: true, ownerId: 2, hostile: false });
    expect(deadTargetSelectable(pet, 1)).toBe(false);
  });

  it('rejects an unlootable, unowned corpse', () => {
    expect(deadTargetSelectable(ent({ id: 10, dead: true }), 1)).toBe(false);
  });

  it('allows a dead player corpse so allies can target it for resurrection', () => {
    expect(deadTargetSelectable(ent({ id: 5, kind: 'player', dead: true }), 1)).toBe(true);
  });
});

describe('Targeting.targetEntity with a dead pet', () => {
  function makeCtx() {
    const entities = new Map<number, Entity>();
    const stopFollow = vi.fn();
    const ctx = {
      entities,
      resolve: (pid?: number) => {
        const e = entities.get(pid as number);
        return e ? { e, meta: { entityId: pid as number } } : null;
      },
      stopFollow,
      isHostileTo: (_a: Entity, b: Entity) => b.kind === 'mob' && b.hostile === true,
    } as unknown as SimContext;
    return { ctx, entities };
  }

  it("selects the player's own dead pet so the pet menu stays reachable", () => {
    const { ctx, entities } = makeCtx();
    const player = ent({ id: 1, kind: 'player', dead: false, hostile: false });
    const pet = ent({ id: 20, kind: 'mob', dead: true, ownerId: 1, hostile: false });
    entities.set(1, player);
    entities.set(20, pet);
    const targeting = new Targeting(ctx);

    targeting.targetEntity(20, 1);

    expect(player.targetId).toBe(20);
    // a non-hostile dead pet must not flip on auto-attack
    expect(player.autoAttack).toBe(false);
  });

  it("does not select another player's dead pet", () => {
    const { ctx, entities } = makeCtx();
    const player = ent({ id: 1, kind: 'player', dead: false, hostile: false });
    const otherPet = ent({ id: 21, kind: 'mob', dead: true, ownerId: 2, hostile: false });
    entities.set(1, player);
    entities.set(21, otherPet);
    const targeting = new Targeting(ctx);

    targeting.targetEntity(21, 1);

    expect(player.targetId).toBeNull();
  });
});

describe('ClientWorld.targetEntity with a dead player', () => {
  it('mirrors the dead-player selection optimistically before the server reply', () => {
    const viewer = ent({ id: 1, kind: 'player', dead: false, hostile: false });
    const fallen = ent({ id: 5, kind: 'player', dead: true, hostile: false });
    const client = Object.create(ClientWorld.prototype) as {
      playerId: number;
      entities: Map<number, Entity>;
      targetEntity(id: number | null): void;
      cmd: ReturnType<typeof vi.fn>;
    };
    Object.assign(client, {
      playerId: viewer.id,
      entities: new Map([
        [viewer.id, viewer],
        [fallen.id, fallen],
      ]),
      cmd: vi.fn(),
    });

    client.targetEntity(fallen.id);

    expect(viewer.targetId).toBe(fallen.id);
    expect(client.cmd).toHaveBeenCalledWith({ cmd: 'target', id: fallen.id });
  });
});
