import { describe, expect, it } from 'vitest';
import { wireEntity } from '../server/game';
import { publicInstanceView } from '../src/sim/item_instance_transfer';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

const enhanced = (): ItemInstancePayload => ({
  lootQuality: { version: 1, tier: 3, weights: [1, 1000, 25, 600, 84] },
  boundTo: 17,
  bindOnTrade: true,
  charges: { private: 2 },
});

describe('loot quality public identity', () => {
  it('bounds saved growth per copy, including a synthetic overflow inventory', () => {
    const lootQuality = { version: 1, tier: 4, weights: [1000, 1000, 1000, 1000, 1000] };
    expect(Buffer.byteLength(JSON.stringify(lootQuality))).toBe(59);
    const ordinary = { itemId: 'chest', count: 1 };
    const enhancedSlot = { ...ordinary, instance: { lootQuality } };
    expect(
      Buffer.byteLength(JSON.stringify(enhancedSlot)) - Buffer.byteLength(JSON.stringify(ordinary)),
    ).toBe(87);
    const populated = { ...ordinary, instance: { signer: 'Crafter' } };
    const withQuality = { ...populated, instance: { ...populated.instance, lootQuality } };
    expect(
      Buffer.byteLength(JSON.stringify(withQuality)) - Buffer.byteLength(JSON.stringify(populated)),
    ).toBe(74);
    // Overflow is legitimate: pin linear per-copy growth instead of claiming a bag-slot cap.
    const containers = { inventory: Array(1000).fill(ordinary), bank: Array(100).fill(ordinary) };
    const enhancedContainers = {
      inventory: Array(1000).fill(enhancedSlot),
      bank: Array(100).fill(enhancedSlot),
    };
    expect(
      Buffer.byteLength(JSON.stringify(enhancedContainers)) -
        Buffer.byteLength(JSON.stringify(containers)),
    ).toBe(1100 * 87);
  });

  it('carries a bounded public descriptor by value without private custody data', () => {
    const original = enhanced();
    const view = publicInstanceView(original);
    expect(view).toEqual({ lootQuality: original.lootQuality });
    view.lootQuality!.weights[0] = 900;
    expect(original.lootQuality!.weights[0]).toBe(1);
  });

  it('preserves the exact tier and allocation through server inspect and client mirroring', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Loot Tester');
    const entity = sim.entities.get(pid)!;
    entity.equippedInstances.chest = enhanced();
    const wire = JSON.parse(JSON.stringify(wireEntity(entity)));
    expect(wire.eqi.chest).toEqual({ lootQuality: enhanced().lootQuality });
    const client = bareClient(999);
    (client as any).applySnapshot({ t: 'snap', ents: [wire] });
    const mirrored = client.entities.get(pid)!.equippedInstances.chest!;
    expect(mirrored).toEqual(wire.eqi.chest);
    wire.eqi.chest.lootQuality.weights[0] = 999;
    expect(mirrored.lootQuality!.weights[0]).toBe(1);
    (client as any).applySnapshot({ t: 'snap', ents: [{ id: pid, x: 1, y: 0, z: 0 }] });
    expect(client.entities.get(pid)!.equippedInstances.chest).toEqual(mirrored);
    entity.equippedInstances = {};
    (client as any).applySnapshot({ t: 'snap', ents: [wireEntity(entity)] });
    expect(client.entities.get(pid)!.equippedInstances).toEqual({});
  });
});
