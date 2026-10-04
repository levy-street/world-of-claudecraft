import { describe, expect, it } from 'vitest';
import { sanitizeBankState } from '../src/sim/bank';
import { isMaterialItemId } from '../src/sim/material_ids';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const mixed = (): InvSlot => ({
  itemId: 'minor_healing_potion',
  count: 20,
  materialSources: Array.from({ length: 20 }, (_, i) => ({
    source: { signer: `Crafter${String.fromCharCode(65 + i)}` },
    count: 1,
  })),
});

describe('crafted consumable source persistence', () => {
  it('loads a full stack with twenty makers without reclassifying it as a material', () => {
    const slot = mixed();
    expect(isMaterialItemId(slot.itemId)).toBe(false);
    expect(sanitizeBankState({ inventory: [slot] }).inventory).toEqual([slot]);
  });

  it('round trips exact makers in bags, bank and vendor buyback', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const state = sim.serializeCharacter(sim.playerId)!;
    state.inventory = [mixed()];
    state.bank!.inventory = [mixed()];
    state.vendorBuyback = [mixed()];
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Ana', { state });
    const saved = restored.serializeCharacter(pid)!;
    expect(saved.inventory).toEqual(state.inventory);
    expect(saved.bank!.inventory).toEqual(state.bank!.inventory);
    expect(saved.vendorBuyback).toEqual(state.vendorBuyback);
  });

  it('refuses malformed counts and provenance on equipment', () => {
    expect(() => sanitizeBankState({ inventory: [{ ...mixed(), count: 19 }] })).toThrow();
    expect(() =>
      sanitizeBankState({ inventory: [{ ...mixed(), itemId: 'worn_sword' }] }),
    ).toThrow();
  });
});
