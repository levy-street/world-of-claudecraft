import { describe, expect, it } from 'vitest';
import { sanitizeBankState } from '../src/sim/bank';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const mixed = (): InvSlot => ({
  itemId: 'copper_ore',
  count: 25,
  materialSeparated: true,
  materialSources: [
    { source: { signer: 'Bru' }, count: 5 },
    { source: { gatherer: { kind: 'character', id: 11, name: 'Ana' } }, count: 20 },
  ],
  instance: JSON.parse('{"future":{"nested":[1,2]},"__proto__":{"kept":true}}'),
});
const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior' as const, autoEquip: false });

describe('source-tracked material load boundaries', () => {
  it('refuses a source-bearing charge stack instead of clipping its attributed units', () => {
    const slot = mixed();
    slot.instance = { charges: { zap: 2 } };
    expect(() => sanitizeBankState({ inventory: [slot] })).toThrow();
  });

  it('canonicalizes descriptor order without changing any quantity or identity', () => {
    const expected = mixed();
    const unordered = { ...mixed(), materialSources: [...expected.materialSources!].reverse() };
    expect(sanitizeBankState({ inventory: [unordered] }).inventory[0]).toEqual(expected);
  });

  it('keeps all banked sources, legal legacy excess, and explicit grouping', () => {
    const slot = mixed();
    const result = sanitizeBankState({ inventory: [slot] });
    expect(result.inventory[0]).toEqual(slot);
    expect(result.inventory[0].materialSources).not.toBe(slot.materialSources);
    expect(Object.hasOwn(result.inventory[0].instance!, '__proto__')).toBe(true);
  });
  it('refuses a malformed bank source count instead of rewriting it as unknown', () => {
    const slot = mixed();
    slot.count = 26;
    expect(() => sanitizeBankState({ inventory: [slot] })).toThrow();
  });
  it('preserves source-bearing dormant item rows for a future catalog', () => {
    const slot = { ...mixed(), itemId: 'future_gathering_material' };
    expect(sanitizeBankState({ inventory: [slot] }).inventory[0]).toEqual(slot);
  });
  it('round-trips carried and banked material sources through the live save loader', () => {
    const original = makeSim();
    const state = original.serializeCharacter(original.playerId)!;
    state.inventory = [mixed()];
    state.bank!.inventory = [mixed()];
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Ana', { state });
    const saved = restored.serializeCharacter(pid)!;
    expect(saved.inventory).toEqual(state.inventory);
    expect(saved.bank!.inventory).toEqual(state.bank!.inventory);
    expect(saved.inventory[0].materialSources).not.toBe(state.inventory[0].materialSources);
  });
  it('rejects malformed source state before registering a player or entity', () => {
    const original = makeSim();
    const state = original.serializeCharacter(original.playerId)!;
    state.inventory = [mixed()];
    state.inventory[0].count = 26;
    const restored = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const beforeEntities = restored.entities.size;
    const beforePlayers = restored.players.size;
    expect(() => restored.addPlayer('warrior', 'Ana', { state })).toThrow();
    expect(restored.entities.size).toBe(beforeEntities);
    expect(restored.players.size).toBe(beforePlayers);
  });
});
