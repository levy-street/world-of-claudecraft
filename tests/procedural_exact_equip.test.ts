import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import type { ProceduralItemInstance } from '../src/sim/procedural_item';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';

const BASE_ID = 'gravecaller_ring';
const LOW_UID = 'pi1:test:101';
const HIGH_UID = 'pi1:test:102';

type InspectableSim = Sim & {
  players: Map<
    number,
    {
      equipmentInstance: Record<string, ItemInstancePayload>;
      inventory: Array<{ itemId: string; count: number; instance?: ItemInstancePayload }>;
    }
  >;
};

function intellectRing(uid: string, intellect: number, itemLevel = 18): ItemInstancePayload {
  const procedural: ProceduralItemInstance = {
    version: 1,
    uid,
    baseId: BASE_ID,
    itemLevel,
    rarity: 'magic',
    affixes: [
      {
        affixId: 'sages',
        family: 'primary.intellect',
        position: 'prefix',
        tier: 5,
        revision: 1,
        budget: intellect,
        values: { int: intellect },
        ranges: { int: { min: 6, max: 24 } },
      },
    ],
    generatedName: {
      baseId: BASE_ID,
      prefixId: 'procedural.name.sages',
    },
    seed: intellect,
  };
  return { procedural };
}

function makeSim(level = 20): { sim: InspectableSim; pid: number } {
  const sim = new Sim({
    seed: 404,
    playerClass: 'mage',
    noPlayer: true,
  }) as InspectableSim;
  const pid = sim.addPlayer('mage', 'Exact');
  sim.setPlayerLevel(level, pid);
  return { sim, pid };
}

function meta(sim: InspectableSim, pid: number) {
  const value = sim.players.get(pid);
  if (!value) throw new Error(`missing player ${pid}`);
  return value;
}

function proceduralUids(sim: InspectableSim, pid: number): string[] {
  return meta(sim, pid).inventory.flatMap((slot) => {
    const uid = slot.instance?.procedural?.uid;
    return uid ? [uid] : [];
  });
}

describe('exact procedural instance equip', () => {
  it('equips the requested UID when two copies share one base ID', () => {
    const { sim, pid } = makeSim();
    sim.addItemInstance(BASE_ID, intellectRing(LOW_UID, 7), pid);
    sim.addItemInstance(BASE_ID, intellectRing(HIGH_UID, 8), pid);

    sim.equipItemToSlot(BASE_ID, 'ring1', pid, LOW_UID);

    expect(meta(sim, pid).equipmentInstance.ring1?.procedural?.uid).toBe(LOW_UID);
    expect(proceduralUids(sim, pid)).toEqual([HIGH_UID]);
  });

  it('applies the selected copy final stats and changes them on an exact swap', () => {
    const { sim, pid } = makeSim();
    const baseInt = sim.entities.get(pid)?.stats.int;
    if (baseInt === undefined) throw new Error('missing player entity');
    sim.addItemInstance(BASE_ID, intellectRing(LOW_UID, 7), pid);
    sim.addItemInstance(BASE_ID, intellectRing(HIGH_UID, 8), pid);

    sim.equipItemToSlot(BASE_ID, 'ring1', pid, LOW_UID);
    expect(sim.entities.get(pid)?.stats.int).toBe(baseInt + 7);

    sim.equipItemToSlot(BASE_ID, 'ring1', pid, HIGH_UID);
    expect(sim.entities.get(pid)?.stats.int).toBe(baseInt + 8);
    expect(meta(sim, pid).equipmentInstance.ring1?.procedural?.uid).toBe(HIGH_UID);
    expect(proceduralUids(sim, pid)).toEqual([LOW_UID]);
  });

  it('rejects a stale or mismatched UID without equipping another copy', () => {
    const { sim, pid } = makeSim();
    sim.addItemInstance(BASE_ID, intellectRing(LOW_UID, 7), pid);
    sim.equipItemToSlot(BASE_ID, 'ring1', pid, 'pi1:test:999');

    expect(sim.equipment.ring1).toBeUndefined();
    expect(proceduralUids(sim, pid)).toEqual([LOW_UID]);
  });

  it('uses the selected instance item level for the equip gate', () => {
    const { sim, pid } = makeSim(18);
    const overLevelUid = 'pi1:test:103';
    sim.addItemInstance(BASE_ID, intellectRing(overLevelUid, 9, 20), pid);
    sim.equipItemToSlot(BASE_ID, 'ring1', pid, overLevelUid);

    expect(sim.equipment.ring1).toBeUndefined();
    expect(proceduralUids(sim, pid)).toEqual([overLevelUid]);
  });

  it('preserves exact worn and bag UIDs through save and reconnect', () => {
    const { sim, pid } = makeSim();
    sim.addItemInstance(BASE_ID, intellectRing(LOW_UID, 7), pid);
    sim.addItemInstance(BASE_ID, intellectRing(HIGH_UID, 8), pid);
    sim.equipItemToSlot(BASE_ID, 'ring1', pid, HIGH_UID);
    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error('failed to serialize character');

    const reloaded = new Sim({
      seed: 404,
      playerClass: 'mage',
      noPlayer: true,
    }) as InspectableSim;
    const reloadedPid = reloaded.addPlayer('mage', 'Exact', {
      state: structuredClone(state) as CharacterState,
    });

    expect(meta(reloaded, reloadedPid).equipmentInstance.ring1?.procedural?.uid).toBe(HIGH_UID);
    expect(proceduralUids(reloaded, reloadedPid)).toEqual([LOW_UID]);
    expect(reloaded.entities.get(reloadedPid)?.stats.int).toBe(sim.entities.get(pid)?.stats.int);
  });
});

describe('exact procedural equip wire', () => {
  it('sends a UID for quick equip and aimed-slot equip', () => {
    const world = Object.create(ClientWorld.prototype) as {
      cmd(payload: unknown): void;
    };
    const sent: unknown[] = [];
    world.cmd = (payload) => sent.push(payload);

    ClientWorld.prototype.equipItem.call(world, BASE_ID, HIGH_UID);
    ClientWorld.prototype.equipItemToSlot.call(world, BASE_ID, 'ring2', LOW_UID);

    expect(sent).toEqual([
      { cmd: 'equip', item: BASE_ID, uid: HIGH_UID },
      { cmd: 'equip', item: BASE_ID, slot: 'ring2', uid: LOW_UID },
    ]);
  });
});
