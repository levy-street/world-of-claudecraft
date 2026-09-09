import { describe, expect, it } from 'vitest';
import {
  countMatchingUnlocked,
  grantCopies,
  removeMatchingInstance,
  sanitizeEscrowSlot,
} from '../src/sim/item_instance_transfer';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const source = { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' }, signer: 'Ana' };
const mixed = (): InvSlot => ({
  itemId: 'copper_ore',
  count: 5,
  materialSources: [
    { source: {}, count: 3 },
    { source, count: 2 },
  ],
});
const setup = () => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  sim.inventory.splice(0, sim.inventory.length, mixed());
  return sim;
};
describe('source-bearing exchange custody', () => {
  it('matches a premium bucket and transfers its exact unit without a legacy signer on the carrier', () => {
    const sim = setup();
    const meta = sim.players.get(sim.playerId)!;
    expect(countMatchingUnlocked(meta, 'copper_ore', { signer: 'Ana' })).toBe(2);
    const unit = removeMatchingInstance(sim.ctx, 'copper_ore', { signer: 'Ana' }, sim.playerId);
    expect(unit).toEqual({
      instance: undefined,
      craftedRecipeId: undefined,
      materialSources: [{ source, count: 1 }],
    });
    expect(sim.inventory).toEqual([
      {
        itemId: 'copper_ore',
        count: 4,
        materialSources: [
          { source: {}, count: 3 },
          { source, count: 1 },
        ],
      },
    ]);
  });
  it('does not remove another source when the named signature is unavailable', () => {
    const sim = setup();
    const before = structuredClone(sim.inventory);
    expect(
      removeMatchingInstance(sim.ctx, 'copper_ore', { signer: 'Bru' }, sim.playerId),
    ).toBeNull();
    expect(sim.inventory).toEqual(before);
  });
  it('regrants a transferred composition through the shared grant', () => {
    const sim = setup();
    sim.inventory.splice(0);
    grantCopies(
      sim.ctx,
      sim.playerId,
      'copper_ore',
      5,
      undefined,
      undefined,
      mixed().materialSources,
    );
    expect(sim.inventory[0]).toEqual({
      ...mixed(),
      materialSources: [
        { source: {}, count: 3 },
        { source, count: 2 },
      ],
    });
  });
  it('keeps valid legacy excess and exact detached composition on escrow load', () => {
    const raw: InvSlot = {
      itemId: 'copper_ore',
      count: 21,
      materialSources: [{ source, count: 21 }],
    };
    const loaded = sanitizeEscrowSlot(raw, 20);
    expect(loaded).toEqual(raw);
    expect(loaded.materialSources).not.toBe(raw.materialSources);
    expect(loaded.materialSources![0].source.gatherer).not.toBe(source.gatherer);
  });
  it('refuses a malformed source claim before a legacy count cap can hide it', () => {
    expect(() => sanitizeEscrowSlot({ ...mixed(), count: 4 }, 20)).toThrow();
    expect(() =>
      sanitizeEscrowSlot({ ...mixed(), instance: { charges: { use: 1 } } }, 1),
    ).toThrow();
  });
});
