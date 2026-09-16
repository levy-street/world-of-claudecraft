import { describe, expect, it } from 'vitest';
import {
  normalizePartyTradeContainers,
  normalizePartyTradeSlots,
} from '../src/sim/loot/bop_trade_cleanup';
import {
  normalizeSavedVaultPartyTradeState,
  normalizeVaultPartyTradeState,
} from '../src/sim/materials_vault';
import { Sim } from '../src/sim/sim';
import { type InvSlot, TICK_RATE } from '../src/sim/types';

describe('bind-on-pickup party trade marker cleanup', () => {
  it('retires expired sigil markers and restacks copies that are otherwise identical', () => {
    const slots: InvSlot[] = [
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: { partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] } },
        slot: 4,
      },
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: { partyTrade: { untilMs: 200, eligible: ['Alice', 'Bob'] } },
        slot: 8,
      },
    ];

    const normalized = normalizePartyTradeSlots(slots, 200);

    expect(normalized).toEqual([{ itemId: 'sigil_anvil_helmet', count: 2, slot: 4 }]);
    expect(slots).toHaveLength(2);
    expect(slots[0].instance?.partyTrade).toBeDefined();
  });

  it('keeps active markers distinct and returns the original collection', () => {
    const slots: InvSlot[] = [
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: { partyTrade: { untilMs: 201, eligible: ['Alice', 'Bob'] } },
      },
    ];

    expect(normalizePartyTradeSlots(slots, 200)).toBe(slots);
  });

  it('preserves an active legacy marker on a currently tradable item for rollback safety', () => {
    const slots: InvSlot[] = [
      { itemId: 'heartspring_amulet', count: 1 },
      {
        itemId: 'heartspring_amulet',
        count: 1,
        instance: { partyTrade: { untilMs: 1_000, eligible: ['Alice', 'Bob'] } },
      },
    ];

    expect(normalizePartyTradeSlots(slots, 0)).toBe(slots);
  });

  it('preserves unrelated payload fields and crafting provenance while restacking', () => {
    const slots: InvSlot[] = [
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: {
          signer: 'Alice',
          partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] },
        },
        craftedRecipeId: 'recipe_a',
      },
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: {
          signer: 'Alice',
          partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] },
        },
        craftedRecipeId: 'recipe_a',
      },
    ];

    expect(normalizePartyTradeSlots(slots, 100)).toEqual([
      {
        itemId: 'sigil_anvil_helmet',
        count: 2,
        instance: { signer: 'Alice' },
        craftedRecipeId: 'recipe_a',
      },
    ]);
  });

  it('keeps different crafting provenance and sibling payloads in separate rows', () => {
    const expired = (craftedRecipeId: string, signer: string): InvSlot => ({
      itemId: 'sigil_anvil_helmet',
      count: 1,
      instance: {
        signer,
        partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] },
      },
      craftedRecipeId,
    });

    expect(
      normalizePartyTradeSlots(
        [expired('recipe_a', 'Alice'), expired('recipe_b', 'Alice'), expired('recipe_a', 'Bob')],
        100,
      ),
    ).toHaveLength(3);
  });

  it('does not merge unrelated partial stacks when another item marker expires', () => {
    const slots: InvSlot[] = [
      { itemId: 'wolf_pelt', count: 2, slot: 1 },
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: { partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] } },
      },
      { itemId: 'wolf_pelt', count: 3, slot: 7 },
    ];

    expect(normalizePartyTradeSlots(slots, 100)).toEqual([
      { itemId: 'wolf_pelt', count: 2, slot: 1 },
      { itemId: 'sigil_anvil_helmet', count: 1 },
      { itemId: 'wolf_pelt', count: 3, slot: 7 },
    ]);
  });

  it('preserves one counted non-mergeable row without increasing serialized bytes', () => {
    const slots: InvSlot[] = [
      {
        itemId: 'sigil_anvil_helmet',
        count: 20,
        instance: {
          locked: true,
          partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] },
        },
      },
    ];

    const normalized = normalizePartyTradeSlots(slots, 100);
    expect(normalized).toEqual([
      { itemId: 'sigil_anvil_helmet', count: 20, instance: { locked: true } },
    ]);
    expect(JSON.stringify(normalized).length).toBeLessThanOrEqual(JSON.stringify(slots).length);
  });

  it('splits a normalized stack at the live item cap and is idempotent', () => {
    const slots: InvSlot[] = [
      {
        itemId: 'sigil_anvil_helmet',
        count: 20,
        instance: { partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] } },
      },
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: { partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] } },
      },
    ];

    const normalized = normalizePartyTradeSlots(slots, 100);
    expect(normalized.map((slot) => slot.count)).toEqual([20, 1]);
    expect(normalizePartyTradeSlots(normalized, 100)).toBe(normalized);
  });

  it('normalizes every persisted player item container through its owning boundary', () => {
    const expired = (): InvSlot => ({
      itemId: 'sigil_anvil_helmet',
      count: 1,
      instance: { partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] } },
    });
    const owner = {
      inventory: [expired()],
      bank: { inventory: [expired()] },
      vault: { stock: { copper_ore: 7 }, special: [expired()], upgrades: 2 },
      vendorBuyback: [expired()],
    };

    expect(normalizePartyTradeContainers(owner, 100)).toEqual({
      inventory: true,
      bank: true,
      buyback: true,
    });
    expect(normalizeVaultPartyTradeState(owner.vault, 100)).toBe(true);
    expect(owner.vault.stock).toEqual({ copper_ore: 7 });
    expect(owner.vault.upgrades).toBe(2);
    expect(
      [
        ...owner.inventory,
        ...owner.bank.inventory,
        ...owner.vault.special,
        ...owner.vendorBuyback,
      ].every((slot) => slot.instance?.partyTrade === undefined),
    ).toBe(true);
  });

  it('does not materialize an absent optional vault special list at save time', () => {
    const vault = { stock: {}, upgrades: 0 };
    normalizeSavedVaultPartyTradeState(vault, 100);
    expect(vault).toEqual({ stock: {}, upgrades: 0 });
  });

  it('preserves buyback row order and oversized counts while stripping an expired marker', () => {
    const expired: InvSlot = {
      itemId: 'sigil_anvil_helmet',
      count: 20,
      instance: { partyTrade: { untilMs: 100, eligible: ['Alice', 'Bob'] } },
    };
    const owner = {
      inventory: [],
      bank: { inventory: [] },
      vault: { special: [] },
      vendorBuyback: [
        { itemId: 'wolf_pelt', count: 40 },
        expired,
        { itemId: 'wolf_pelt', count: 60 },
      ],
    };

    normalizePartyTradeContainers(owner, 100);

    expect(owner.vendorBuyback).toEqual([
      { itemId: 'wolf_pelt', count: 40 },
      { itemId: 'sigil_anvil_helmet', count: 20 },
      { itemId: 'wolf_pelt', count: 60 },
    ]);
  });

  it('normalizes the saved character without a realm-wide tick sweep', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Alice');
    const meta = sim.ctx.players.get(pid);
    expect(meta).toBeDefined();
    if (!meta) return;
    const expired = (): InvSlot => ({
      itemId: 'sigil_anvil_helmet',
      count: 1,
      instance: { partyTrade: { untilMs: 1, eligible: ['Alice', 'Bob'] } },
    });
    meta.inventory = [expired()];
    meta.bank.inventory = [expired()];
    meta.vault.special = [expired()];
    meta.vendorBuyback = [expired()];
    for (let i = 0; i < TICK_RATE; i++) sim.tick();

    const saved = sim.serializeCharacter(pid);

    expect(saved?.inventory[0].instance).toBeUndefined();
    expect(saved?.bank?.inventory[0].instance).toBeUndefined();
    expect(saved?.vault?.special?.[0].instance).toBeUndefined();
    expect(saved?.vendorBuyback?.[0].instance).toBeUndefined();
    expect(meta.inventory[0].instance?.partyTrade).toBeDefined();
  });

  it('retires and restacks expired persisted copies during load and resave', () => {
    const seed = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const seedPid = seed.addPlayer('warrior', 'Alice');
    const state = seed.serializeCharacter(seedPid);
    expect(state).toBeDefined();
    if (!state) return;
    state.inventory = [
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: { partyTrade: { untilMs: 1, eligible: ['Alice', 'Bob'] } },
      },
      {
        itemId: 'sigil_anvil_helmet',
        count: 1,
        instance: { partyTrade: { untilMs: 2, eligible: ['Alice', 'Bob'] } },
      },
    ];
    state.vault = {
      stock: { copper_ore: 7 },
      special: [
        {
          itemId: 'sigil_anvil_helmet',
          count: 1,
          instance: { partyTrade: { untilMs: 1, eligible: ['Alice', 'Bob'] } },
        },
      ],
      upgrades: 2,
    };
    const loaded = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    loaded.tick();

    const loadedPid = loaded.addPlayer('warrior', 'Alice', { state });
    const meta = loaded.ctx.players.get(loadedPid);

    expect(meta?.inventory).toEqual([{ itemId: 'sigil_anvil_helmet', count: 2 }]);
    expect(meta?.vault).toEqual({
      stock: { copper_ore: 7 },
      special: [{ itemId: 'sigil_anvil_helmet', count: 1 }],
      upgrades: 2,
    });
    const resaved = loaded.serializeCharacter(loadedPid);
    expect(resaved?.inventory).toEqual([{ itemId: 'sigil_anvil_helmet', count: 2 }]);
  });
});
