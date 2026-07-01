import { describe, expect, it } from 'vitest';
import type { CharacterState, PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, ItemInstancePayload, PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function entityOrThrow(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function metaOrThrow(sim: Sim, pid: number): PlayerMeta {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

function characterStateOrThrow(sim: Sim, pid: number): CharacterState {
  const state = sim.serializeCharacter(pid);
  if (!state) throw new Error(`missing serialized character ${pid}`);
  return state;
}

function merchant(sim: Sim): Entity {
  for (const e of sim.entities.values()) if (e.templateId === 'the_merchant') return e;
  throw new Error('the Merchant was not spawned');
}

function standAtMerchant(sim: Sim, pid: number) {
  const m = merchant(sim);
  const e = entityOrThrow(sim, pid);
  e.pos.x = m.pos.x;
  e.pos.z = m.pos.z;
  e.pos.y = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function errorsSince(sim: Sim): string[] {
  return sim.events.filter((e) => e.type === 'error').map((e) => (e as { text: string }).text);
}

const TOOL_INSTANCE: ItemInstancePayload = {
  signer: { characterId: 101, name: 'Mira' },
  effectCharges: { sharpening: 3, polish: 1 },
  rolledQuality: 'rare',
  rolledStats: { str: 2, sta: 1 },
  boundTo: { characterId: 202, name: 'Saver' },
};

const PLAYER_CLASS: PlayerClass = 'warrior';

describe('item-instance inventory slots', () => {
  it('records the additive go decision shape with the professions instance payload', () => {
    const slot: InvSlot = { itemId: 'worn_sword', count: 1, instance: TOOL_INSTANCE };

    expect(slot).toMatchObject({
      itemId: 'worn_sword',
      count: 1,
      instance: {
        signer: { characterId: 101, name: 'Mira' },
        effectCharges: { sharpening: 3, polish: 1 },
        rolledQuality: 'rare',
        rolledStats: { str: 2, sta: 1 },
        boundTo: { characterId: 202, name: 'Saver' },
      },
    });
  });

  it('round-trips instance payloads through character save/load without aliasing', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer(PLAYER_CLASS, 'Saver', { characterId: 202 });
    const meta = metaOrThrow(sim, pid);
    meta.inventory.push({ itemId: 'worn_sword', count: 1, instance: TOOL_INSTANCE });
    meta.vendorBuyback.push({
      itemId: 'wolf_fang',
      count: 1,
      instance: { signer: { characterId: 303, name: 'Buyer' }, boundTo: { characterId: 202 } },
    });

    const saved = characterStateOrThrow(sim, pid);
    const inventoryInstance = meta.inventory[0]?.instance;
    const buybackSigner = meta.vendorBuyback[0]?.instance?.signer;
    if (!inventoryInstance?.effectCharges || !buybackSigner)
      throw new Error('missing instance data');
    inventoryInstance.effectCharges.sharpening = 0;
    buybackSigner.name = 'Mutated';

    const loaded = makeWorld();
    const loadedPid = loaded.addPlayer(PLAYER_CLASS, 'Saver', { characterId: 202, state: saved });
    const resaved = characterStateOrThrow(loaded, loadedPid);

    expect(resaved.inventory).toEqual(saved.inventory);
    expect(resaved.vendorBuyback).toEqual(saved.vendorBuyback);
    expect(resaved.inventory[0]?.instance?.effectCharges?.sharpening).toBe(3);
    expect(resaved.vendorBuyback?.[0]?.instance?.signer?.name).toBe('Buyer');
  });

  it('keeps instanced items inert in the World Market while fungible stacks can list', () => {
    const sim = makeWorld();
    const seller = sim.addPlayer(PLAYER_CLASS, 'Seller');
    standAtMerchant(sim, seller);
    const meta = metaOrThrow(sim, seller);
    meta.inventory.push({ itemId: 'wolf_fang', count: 1, instance: TOOL_INSTANCE });
    sim.events.length = 0;

    sim.marketList('wolf_fang', 1, 100, seller);

    expect(errorsSince(sim)).toEqual(['Instanced items cannot be listed on the World Market yet.']);
    expect(sim.marketListings.some((l) => !l.house && l.itemId === 'wolf_fang')).toBe(false);
    expect(meta.inventory).toEqual([{ itemId: 'wolf_fang', count: 1, instance: TOOL_INSTANCE }]);

    sim.addItem('wolf_fang', 2, seller);
    sim.events.length = 0;
    sim.marketList('wolf_fang', 2, 100, seller);

    expect(errorsSince(sim)).toEqual([]);
    expect(
      sim.marketListings.some((l) => !l.house && l.itemId === 'wolf_fang' && l.count === 2),
    ).toBe(true);
    expect(meta.inventory).toEqual([{ itemId: 'wolf_fang', count: 1, instance: TOOL_INSTANCE }]);
  });
});
