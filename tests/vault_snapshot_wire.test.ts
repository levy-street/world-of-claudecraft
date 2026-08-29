import { describe, expect, it } from 'vitest';
import { decodeVaultInfoWire, vaultWithdrawPayload } from '../src/net/vault_snapshot_wire';
import {
  VAULT_BASE_CAP,
  VAULT_UPGRADE_PRICES,
  VAULT_UPGRADE_STEP,
} from '../src/sim/materials_vault';

// Literal fixture on purpose: perMaterialCap 80 is the ladder position the
// decoder must recompute from the sim constants (40 + 40 * (2 - 1)), so this
// arm fails if either the decoder formula or the sim ladder drifts.
const VALID = {
  stock: { copper_ore: 3 },
  special: [
    {
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
    },
    { itemId: 'future_material', count: 2, craftedRecipeId: 'future_recipe' },
  ],
  upgrades: 2,
  perMaterialCap: 80,
  nextUpgradeCost: 100_000,
};

describe('Materials Vault snapshot wire decoder', () => {
  it('accepts null and a strict identity-preserving snapshot without rebuilding it', () => {
    expect(decodeVaultInfoWire(null)).toBeNull();
    expect(decodeVaultInfoWire(VALID)).toBe(VALID);
  });

  it('pins the sim ladder the decoder validates against (change-detector)', () => {
    // The decoder imports these instead of restating 40/5; a DELIBERATE ladder
    // change must update this pin alongside the wire-epoch story.
    expect(VAULT_BASE_CAP).toBe(40);
    expect(VAULT_UPGRADE_STEP).toBe(40);
    expect(VAULT_UPGRADE_PRICES).toHaveLength(5);
  });

  it('accepts the locked and fully upgraded ladder ends exactly as the sim emits them', () => {
    // vaultInfoFor at a banker with a still-locked vault: upgrades 0, cap 0,
    // the unlock price next.
    const locked = {
      stock: {},
      special: [],
      upgrades: 0,
      perMaterialCap: 0,
      nextUpgradeCost: VAULT_UPGRADE_PRICES[0],
    };
    expect(decodeVaultInfoWire(locked)).toBe(locked);
    // The top of the ladder, derived from the same constants the decoder uses.
    const maxed = {
      stock: { copper_ore: 1 },
      special: [],
      upgrades: VAULT_UPGRADE_PRICES.length,
      perMaterialCap: VAULT_BASE_CAP + VAULT_UPGRADE_STEP * (VAULT_UPGRADE_PRICES.length - 1),
      nextUpgradeCost: null,
    };
    expect(decodeVaultInfoWire(maxed)).toBe(maxed);
  });

  it.each([
    { ...VALID, special: undefined },
    { ...VALID, special: {} },
    { ...VALID, special: [{ itemId: 'copper_ore', count: 1, slot: 4 }] },
    { ...VALID, special: [{ itemId: 'copper_ore', count: 0, instance: {} }] },
    { ...VALID, special: [{ itemId: '', count: 1, instance: {} }] },
    { ...VALID, special: [{ itemId: 'copper_ore', count: 1, instance: [] }] },
    { ...VALID, special: [{ itemId: 'copper_ore', count: 1, instance: { n: Number.NaN } }] },
    { ...VALID, stock: { copper_ore: 1.5 } },
    { ...VALID, stock: { copper_ore: { polluted: true } } },
    { ...VALID, upgrades: 1.5 },
    { ...VALID, upgrades: 6, perMaterialCap: 240, nextUpgradeCost: null },
    // One past the top of the ladder, derived from the same constant the
    // decoder caps against (a sixth sim rung moves this case with it).
    {
      ...VALID,
      upgrades: VAULT_UPGRADE_PRICES.length + 1,
      perMaterialCap: VAULT_BASE_CAP + VAULT_UPGRADE_STEP * VAULT_UPGRADE_PRICES.length,
      nextUpgradeCost: null,
    },
    // A locked vault must report cap 0 (the sim formula's locked arm), never a
    // paid ceiling.
    { ...VALID, upgrades: 0, perMaterialCap: VAULT_BASE_CAP, nextUpgradeCost: 20000 },
    { ...VALID, perMaterialCap: 81 },
    { ...VALID, nextUpgradeCost: null },
    { ...VALID, upgrades: 5, perMaterialCap: 200, nextUpgradeCost: 1 },
    {
      ...VALID,
      special: [{ itemId: 'copper_ore', count: 1, instance: { signer: 'x'.repeat(65) } }],
    },
    {
      ...VALID,
      special: [{ itemId: 'copper_ore', count: 1, instance: { ['x'.repeat(65)]: 1 } }],
    },
    { ...VALID, extra: true },
    // The shared strict record predicate (isRecord, exported to the bank
    // decoder too): a class-instance frame carrying valid-looking fields
    // fails the prototype check and is never adopted by reference.
    Object.assign(Object.create(Date.prototype), VALID),
  ])('drops a malformed snapshot instead of exposing partial state: %#', (raw) => {
    expect(decodeVaultInfoWire(raw)).toBeNull();
  });

  it('adopts a valid null-prototype snapshot (a JSON.parse shape) by reference', () => {
    // The strict predicate admits exactly the two plain-data prototypes:
    // Object.prototype and null. This pins the null arm so tightening to
    // "plain object only" cannot silently drop parsed frames.
    const bare = Object.assign(Object.create(null), VALID);
    expect(decodeVaultInfoWire(bare)).toBe(bare);
  });

  it('encodes and deep-clones the exact special withdrawal fingerprint', () => {
    const special = {
      index: 3,
      instance: { signer: 'Ada', rolled: { quality: 'rare' as const, stats: { sta: 2 } } },
      craftedRecipeId: 'smelt_copper',
    };
    const payload = vaultWithdrawPayload('copper_ore', 1, special);

    expect(payload).toEqual({
      itemId: 'copper_ore',
      count: 1,
      special,
    });
    expect(payload.special).not.toBe(special);
    expect(payload.special?.instance).not.toBe(special.instance);
    special.instance.rolled.stats.sta = 99;
    expect(payload.special?.instance?.rolled?.stats?.sta).toBe(2);
  });
});
