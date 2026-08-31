import { describe, expect, it, vi } from 'vitest';
import {
  BANK_PURCHASED_SLOTS_MAX,
  decodeBankInfoWire,
  decodeBankPurchasedSlotsWire,
  decodeCraftVaultStockWire,
} from '../src/net/bank_snapshot_wire';
import type { ClientWorld } from '../src/net/online';
import { BANK_BAG_SOCKETS, BANK_EXPANSION_SLOTS } from '../src/sim/bank';
import { STORAGE_SKUS } from '../src/sim/content/storage_charters';
import { bareClient } from './helpers/bare_client';

function playerWire(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    k: 'player',
    tid: 'warrior',
    nm: 'Vaultkeeper',
    lv: 20,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    ...extra,
  };
}

function apply(client: ClientWorld, extra: Record<string, unknown> = {}): void {
  (client as unknown as { applySnapshot(value: unknown): void }).applySnapshot({
    t: 'snap',
    tick: 1,
    ents: [],
    self: playerWire(extra),
  });
}

/** A wire-shaped BankInfo exactly as bankInfoFor emits it (fresh per call so
 *  it.each mutation spreads never alias). */
function validBankWire(): Record<string, unknown> {
  return {
    slots: [
      { itemId: 'copper_ore', count: 3, slot: 2 },
      { itemId: 'signed_blade', count: 1, instance: { signer: 'Ada' } },
      { itemId: 'smelted_bar', count: 2, craftedRecipeId: 'smelt_copper' },
    ],
    capacity: 30,
    purchasedSlots: BANK_EXPANSION_SLOTS,
    bonusSlots: 2,
    nextExpansionCost: 1400,
    bonusSources: [
      { id: 'email', slots: 2, maxSlots: 2 },
      { id: 'referral', slots: 0, maxSlots: 8, count: 1, cap: 4 },
    ],
    socketsUnlocked: 1,
    socketBags: ['bag_small', null, null, null],
    nextSocketCost: 2000000,
    generalCapacity: 20,
    materialsCapacity: 10,
    // One cell per slots row, split by the material taxonomy (copper_ore is
    // the material; the blade and the bar are general): the used counts and
    // the slots array come from ONE inventory at the emitter, so their sum is
    // the row count exactly, and the decoder holds the frame to it.
    generalUsed: 2,
    materialsUsed: 1,
  };
}

describe('bank self snapshot wire decoders', () => {
  it('adopts a valid bank snapshot by reference and passes the null gate closure through', () => {
    const bank = validBankWire();
    expect(decodeBankInfoWire(bank)).toBe(bank);
    expect(decodeBankInfoWire(null)).toBeNull();
    // The optional Claudium price is additive: absent above, valid when present.
    const priced = { ...validBankWire(), nextRungClaudiumPrice: 90 };
    expect(decodeBankInfoWire(priced)).toBe(priced);
    // The top of both ladders flips the two next-price fields to null.
    const maxed = {
      ...validBankWire(),
      purchasedSlots: BANK_PURCHASED_SLOTS_MAX,
      nextExpansionCost: null,
      socketsUnlocked: BANK_BAG_SOCKETS,
      nextSocketCost: null,
    };
    expect(decodeBankInfoWire(maxed)).toBe(maxed);
  });

  it.each([
    undefined,
    false,
    1,
    'bank',
    [],
    new Date(0),
    { ...validBankWire(), extra: true },
    { ...validBankWire(), slots: {} },
    { ...validBankWire(), slots: [{ itemId: '', count: 1 }] },
    { ...validBankWire(), slots: [{ itemId: 'copper_ore', count: 0 }] },
    { ...validBankWire(), slots: [{ itemId: 'copper_ore', count: 1, slot: -1 }] },
    { ...validBankWire(), slots: [{ itemId: 'copper_ore', count: 1, rogue: 1 }] },
    { ...validBankWire(), slots: [{ itemId: 'copper_ore', count: 1, instance: [] }] },
    {
      ...validBankWire(),
      slots: [{ itemId: 'copper_ore', count: 1, instance: { signer: 'x'.repeat(65) } }],
    },
    { ...validBankWire(), capacity: 31 },
    { ...validBankWire(), purchasedSlots: BANK_EXPANSION_SLOTS + 1 },
    { ...validBankWire(), purchasedSlots: BANK_PURCHASED_SLOTS_MAX + BANK_EXPANSION_SLOTS },
    { ...validBankWire(), bonusSlots: -1 },
    { ...validBankWire(), nextExpansionCost: null },
    { ...validBankWire(), nextExpansionCost: '500' },
    { ...validBankWire(), purchasedSlots: BANK_PURCHASED_SLOTS_MAX, nextExpansionCost: 1 },
    { ...validBankWire(), bonusSources: [{ id: '', slots: 0, maxSlots: 2 }] },
    { ...validBankWire(), bonusSources: [{ id: 'email', slots: -1, maxSlots: 2 }] },
    { ...validBankWire(), bonusSources: [{ id: 'email', slots: 0 }] },
    { ...validBankWire(), bonusSources: [{ id: 'email', slots: 0, maxSlots: 2, rogue: 1 }] },
    { ...validBankWire(), socketsUnlocked: BANK_BAG_SOCKETS + 1 },
    { ...validBankWire(), socketsUnlocked: 1.5 },
    { ...validBankWire(), socketBags: [null, null, null] },
    { ...validBankWire(), socketBags: ['', null, null, null] },
    { ...validBankWire(), socketBags: [7, null, null, null] },
    { ...validBankWire(), nextSocketCost: null },
    {
      ...validBankWire(),
      socketsUnlocked: BANK_BAG_SOCKETS,
      nextSocketCost: 1,
    },
    { ...validBankWire(), nextRungClaudiumPrice: '90' },
    { ...validBankWire(), nextRungClaudiumPrice: -1 },
    { ...validBankWire(), generalCapacity: 21 },
    { ...validBankWire(), generalUsed: -1 },
    { ...validBankWire(), materialsUsed: 1.5 },
    // The slots array must agree with its own used-count meter (one cell per
    // row): a lying meter under the same rows...
    { ...validBankWire(), generalUsed: 3 },
    // ...and extra rows under the same meter both reject.
    {
      ...validBankWire(),
      slots: [
        { itemId: 'copper_ore', count: 3, slot: 2 },
        { itemId: 'signed_blade', count: 1, instance: { signer: 'Ada' } },
        { itemId: 'smelted_bar', count: 2, craftedRecipeId: 'smelt_copper' },
        { itemId: 'oak_staff', count: 1 },
      ],
    },
  ])('rejects a malformed bank snapshot without producing a replacement: %#', (value) => {
    expect(decodeBankInfoWire(value)).toBeUndefined();
  });

  it('accepts a tolerated over-capacity bank: rows past capacity, meter agreeing', () => {
    // bankUnsocketBag leaves every row in place while the pools shrink
    // (src/sim/bank_sockets.ts, the tolerated over-capacity state), so rows
    // can legitimately exceed capacity at a banker. The decoder therefore
    // bounds slots by the used-count meter, never by capacity.
    const over = {
      ...validBankWire(),
      slots: [
        { itemId: 'copper_ore', count: 3, slot: 0 },
        { itemId: 'iron_ore', count: 2, slot: 1 },
        { itemId: 'signed_blade', count: 1, slot: 2 },
        { itemId: 'smelted_bar', count: 2, slot: 3 },
        { itemId: 'oak_staff', count: 1, slot: 4 },
      ],
      generalCapacity: 2,
      materialsCapacity: 2,
      capacity: 4,
      generalUsed: 3,
      materialsUsed: 2,
    };
    expect(decodeBankInfoWire(over)).toBe(over);
  });

  it('keeps every shipped storage-SKU grant on the ladder the wire decoders enforce', () => {
    // decodeBankPurchasedSlotsWire (and decodeBankInfoWire through it) rejects
    // any purchased-slot count not divisible by BANK_EXPANSION_SLOTS, silently
    // retaining a stale mirror; a shipped grant off that ladder would make
    // every post-purchase frame undecodable. Pin the whole catalog to it.
    const skus = Object.values(STORAGE_SKUS);
    expect(skus.length).toBeGreaterThan(0);
    for (const sku of skus) {
      expect(sku.grantSlots, sku.id).toBeGreaterThan(0);
      expect(sku.grantSlots % BANK_EXPANSION_SLOTS, sku.id).toBe(0);
    }
  });

  it('adopts valid craft-vault stock by reference, including an inert own __proto__ row', () => {
    const stock = Object.fromEntries([
      ['copper_ore', 3],
      ['__proto__', Number.MAX_SAFE_INTEGER],
    ]);

    const decoded = decodeCraftVaultStockWire(stock);

    expect(decoded).toBe(stock);
    expect(Object.hasOwn(decoded as object, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(decodeCraftVaultStockWire(null)).toBeNull();
  });

  it('adopts a valid null-prototype craft-vault record by reference', () => {
    const stock = Object.create(null) as Record<string, number>;
    stock.copper_ore = 4;

    expect(decodeCraftVaultStockWire(stock)).toBe(stock);
    expect(Object.getPrototypeOf(stock)).toBeNull();
  });

  it('keeps server-valid dormant rows beyond 256 keys and with long ids', () => {
    const stock = Object.fromEntries([
      ...Array.from({ length: 300 }, (_, index) => [`future_material_${index}`, index + 1]),
      ['x'.repeat(512), 1],
      ['__proto__', 2],
    ]);

    expect(decodeCraftVaultStockWire(stock)).toBe(stock);
    expect(Object.keys(stock)).toHaveLength(302);
    expect(Object.getOwnPropertyDescriptor(stock, '__proto__')?.value).toBe(2);
  });

  it.each([
    undefined,
    false,
    1,
    'stock',
    [],
    new Date(0),
    { copper_ore: 0 },
    { copper_ore: -1 },
    { copper_ore: 1.5 },
    { copper_ore: Number.NaN },
    { copper_ore: Number.POSITIVE_INFINITY },
    { copper_ore: Number.MAX_SAFE_INTEGER + 1 },
    { copper_ore: '3' },
    { copper_ore: { count: 3 } },
    { '': 1 },
  ])('rejects malformed craft-vault stock without producing a replacement: %#', (value) => {
    expect(decodeCraftVaultStockWire(value)).toBeUndefined();
  });

  it('accepts only the canonical personal-bank ladder positions plus explicit null', () => {
    expect(BANK_PURCHASED_SLOTS_MAX).toBe(72);
    expect(decodeBankPurchasedSlotsWire(null)).toBeNull();
    for (let slots = 0; slots <= BANK_PURCHASED_SLOTS_MAX; slots += BANK_EXPANSION_SLOTS) {
      expect(decodeBankPurchasedSlotsWire(slots)).toBe(slots);
    }
    expect(decodeBankPurchasedSlotsWire(72)).toBe(72);
    expect(decodeBankPurchasedSlotsWire(78)).toBeUndefined();
  });

  it.each([
    undefined,
    false,
    '6',
    [],
    {},
    -1,
    -0,
    0.5,
    BANK_EXPANSION_SLOTS - 1,
    BANK_EXPANSION_SLOTS + 1,
    BANK_PURCHASED_SLOTS_MAX - 1,
    BANK_PURCHASED_SLOTS_MAX + BANK_EXPANSION_SLOTS,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects a malformed or off-ladder purchased-slot value: %#', (value) => {
    expect(decodeBankPurchasedSlotsWire(value)).toBeUndefined();
  });

  it('retains the last good ClientWorld mirrors on malformed values and omission', () => {
    const client = bareClient(1);
    const stock = Object.fromEntries([
      ['copper_ore', 3],
      ['__proto__', 2],
    ]);
    const bank = validBankWire();
    const vault = {
      stock: { copper_ore: 3 },
      special: [],
      upgrades: 1,
      perMaterialCap: 40,
      nextUpgradeCost: 50000,
    };

    apply(client, { cvault: stock, bpsl: 12, bank, vault });
    expect(client.craftVaultStock).toBe(stock);
    expect(client.bankPurchasedSlots).toBe(12);
    expect(client.bankInfo).toBe(bank);
    expect(client.vaultInfo).toBe(vault);

    // Malformed frames: bank/cvault/bpsl RETAIN the last good mirror, while
    // vault deliberately CLEARS to null (drop the whole unsafe row rather than
    // render a partial snapshot; the applyBankSelfWire policy split).
    apply(client, {
      cvault: { copper_ore: 1.5 },
      bpsl: 11,
      bank: { ...validBankWire(), capacity: 1 },
      vault: { bogus: true },
    });
    expect(client.craftVaultStock).toBe(stock);
    expect(client.bankPurchasedSlots).toBe(12);
    expect(client.bankInfo).toBe(bank);
    expect(client.vaultInfo).toBeNull();

    apply(client);
    expect(client.craftVaultStock).toBe(stock);
    expect(client.bankPurchasedSlots).toBe(12);
    expect(client.bankInfo).toBe(bank);

    apply(client, { cvault: null, bpsl: null, bank: null });
    expect(client.craftVaultStock).toBeNull();
    expect(client.bankPurchasedSlots).toBeNull();
    expect(client.bankInfo).toBeNull();
  });
});

describe('bank frame reject warn latch', () => {
  // A fresh module registry per test: the latch is module-scoped one-shot
  // state, and the reject suite above already burned the static instance's
  // shot by design.
  it('stays silent across valid frames and both gate closures', async () => {
    vi.resetModules();
    const fresh = await import('../src/net/bank_snapshot_wire');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(fresh.decodeBankInfoWire(validBankWire())).not.toBeUndefined();
      expect(fresh.decodeBankInfoWire(null)).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('warns exactly once, on the FIRST reject, naming the offending key', async () => {
    vi.resetModules();
    const fresh = await import('../src/net/bank_snapshot_wire');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(fresh.decodeBankInfoWire({ ...validBankWire(), rogue: 1 })).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0][0])).toContain('unknown key "rogue"');
      // One-shot: a second reject (a different offense class) stays silent,
      // and the strict reject policy itself has not softened.
      expect(fresh.decodeBankInfoWire({ ...validBankWire(), bonusSlots: -1 })).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
