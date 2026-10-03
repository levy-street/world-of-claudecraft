// The online client's gate mirror (src/net/dungeon_gate_wire.ts): the
// ClientWorld rebuilds each slot's open set from the gate entities it holds,
// so its local movement prediction walls exactly where the server does.

import { afterEach, describe, expect, it } from 'vitest';
import { syncClientDungeonGates } from '../src/net/dungeon_gate_wire';
import { isBlocked } from '../src/sim/colliders';
import { HOLLOW_CRYPT_GATES } from '../src/sim/content/hollow_crypt';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const SEED = 13;

function gateEntity(id: number, slot: number, gateId: string, templateId: string): Entity {
  const g = HOLLOW_CRYPT_GATES.find((x) => x.id === gateId);
  if (!g) throw new Error(gateId);
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, slot);
  return {
    id,
    kind: 'object',
    templateId,
    dungeonId: 'hollow_crypt',
    pos: { x: o.x + g.x, y: 0, z: o.z + g.z },
  } as Entity;
}

describe('client dungeon gate mirror', () => {
  afterEach(() => clearDungeonGateStateForTest());

  it('opens the collision of exactly the gates its mirrored entities say are open', () => {
    const slot = 6;
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, slot);
    const player = { id: 1, kind: 'player', pos: { x: o.x, y: 20, z: o.z - 130 } } as Entity;
    const entities = new Map<number, Entity>([
      [1, player],
      [2, gateEntity(2, slot, 'grille', 'dungeon_gate_open')],
      [3, gateEntity(3, slot, 'twin_seals', 'dungeon_gate_closed')],
      [4, gateEntity(4, slot, 'yard_barrier', 'dungeon_gate_sealed')],
    ]);
    syncClientDungeonGates({ entities, player });
    expect(isBlocked(SEED, o.x, o.z + 21, 0.5)).toBe(false);
    expect(isBlocked(SEED, o.x, o.z + 113, 0.5)).toBe(true);
    expect(isBlocked(SEED, o.x - 82, o.z + 93, 0.5)).toBe(true);
    // The grille shuts again the moment the mirror says so.
    entities.set(2, gateEntity(2, slot, 'grille', 'dungeon_gate_sealed'));
    syncClientDungeonGates({ entities, player });
    expect(isBlocked(SEED, o.x, o.z + 21, 0.5)).toBe(true);
  });

  it('does nothing outside a gated dungeon', () => {
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, 2);
    const player = { id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 } } as Entity;
    const entities = new Map<number, Entity>([
      [2, gateEntity(2, 2, 'grille', 'dungeon_gate_open')],
    ]);
    syncClientDungeonGates({ entities, player });
    expect(isBlocked(SEED, o.x, o.z + 21, 0.5)).toBe(true);
  });

  it('mirrors a live server claim: same walls from the same gate entities', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world: WORLD });
    const pid = sim.addPlayer('warrior', 'Mirror');
    expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
    const inst = sim.ctx.instances.find((i) => i.dungeonId === 'hollow_crypt' && i.partyKey);
    if (!inst) throw new Error('no claim');
    DUNGEONS.hollow_crypt.spawns.forEach((s, i) => {
      if (!['c1', 'c2', 'c3', 'c4'].includes(s.packId ?? '')) return;
      const mob = sim.ctx.entities.get(inst.mobIds[i]) as Entity;
      mob.dead = true;
      mob.hp = 0;
    });
    sim.tick();
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
    const serverView = HOLLOW_CRYPT_GATES.map((g) => isBlocked(SEED, o.x + g.x, o.z + g.z, 0.5));
    // A fresh client with only the mirrored entities rebuilds the same view.
    clearDungeonGateStateForTest();
    const mirrored = new Map<number, Entity>();
    for (const id of inst.objectIds) {
      const e = sim.ctx.entities.get(id);
      if (e) mirrored.set(id, { ...e });
    }
    const player = sim.ctx.entities.get(pid) as Entity;
    syncClientDungeonGates({ entities: mirrored, player });
    const clientView = HOLLOW_CRYPT_GATES.map((g) => isBlocked(SEED, o.x + g.x, o.z + g.z, 0.5));
    expect(clientView).toEqual(serverView);
    expect(serverView[0]).toBe(false); // the grille is open on both
  });
});
