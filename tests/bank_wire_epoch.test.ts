import { describe, expect, it } from 'vitest';
import {
  type BankInfo,
  ONLINE_WORLD_AUTH_TYPE,
  ONLINE_WORLD_LAYOUT_VERSION,
  type VaultInfo,
} from '../src/world_api';

// Exact required BankInfo shape from origin/release/v0.41.0. Keeping the
// historical fixture here makes the epoch rationale reviewable without relying
// on a comment or on whichever fields a current UI happens to read first.
const RELEASE_V041_BANK_INFO = {
  slots: [],
  capacity: 24,
  purchasedSlots: 0,
  bonusSlots: 0,
  nextExpansionCost: 500,
  bonusSources: [],
} as const;

const BANK_STORAGE_REQUIRED_KEYS = [
  'socketsUnlocked',
  'socketBags',
  'nextSocketCost',
  'generalCapacity',
  'materialsCapacity',
  'generalUsed',
  'materialsUsed',
] as const satisfies readonly (keyof BankInfo)[];

// Exact auth-world-10 VaultInfo shape. It has no way to reveal or select an
// identity-bearing material after the new server stores one in `special`.
const AUTH_WORLD_10_VAULT_INFO = {
  stock: { copper_ore: 3 },
  upgrades: 1,
  perMaterialCap: 40,
  nextUpgradeCost: 50000,
} as const;

const VAULT_SPECIAL_REQUIRED_KEYS = ['special'] as const satisfies readonly (keyof VaultInfo)[];

// The load-bearing check on both historical fixtures is COMPILE-TIME and tsc
// is its gate: the `satisfies` arms above prove every required key is a real
// field of today's interfaces, and the AssertNever arms below prove neither
// historical fixture carries any of them (an overlap makes the Extract<>
// non-never, which fails the AssertNever constraint). A runtime loop over the
// same literals could never fail on a source change, so none is kept.
type AssertNever<T extends never> = T;
type _BankStorageKeysAreNew = AssertNever<
  Extract<(typeof BANK_STORAGE_REQUIRED_KEYS)[number], keyof typeof RELEASE_V041_BANK_INFO>
>;
type _VaultSpecialKeysAreNew = AssertNever<
  Extract<(typeof VAULT_SPECIAL_REQUIRED_KEYS)[number], keyof typeof AUTH_WORLD_10_VAULT_INFO>
>;

describe('BankInfo wire compatibility epoch', () => {
  it('separates the bank-storage snapshot from release/v0.41.0 before admission', () => {
    // The runtime epoch pin: the world handshake version that fences the
    // pre-bank-storage shape out before any snapshot is admitted. The Ignivar
    // raid ladder moved the current epoch past the vault's own 11
    // (src/world_api.ts); any epoch at or above 11 keeps the fence.
    expect(ONLINE_WORLD_LAYOUT_VERSION).toBe(25);
    expect(ONLINE_WORLD_AUTH_TYPE).toBe('auth-world-25');
  });

  it('separates identity-preserving vault snapshots from auth-world-10 before admission', () => {
    expect(ONLINE_WORLD_LAYOUT_VERSION).toBe(25);
    expect(ONLINE_WORLD_AUTH_TYPE).toBe('auth-world-25');
    expect(ONLINE_WORLD_AUTH_TYPE).not.toBe('auth-world-10');
    expect(ONLINE_WORLD_AUTH_TYPE).not.toBe('auth-world-9');
  });
});
