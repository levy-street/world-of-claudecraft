import { describe, expect, it } from 'vitest';
import type { ItemInstancePayload } from '../src/sim/types';
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

// Exact auth-world-11 ItemInstancePayload key set from origin/release/v0.41.0
// (e19d832b47). The masterwrought epoch (26: one past the release's Ignivar
// ladder tip 25; it was 12 on the pre-merge branch) exists because
// equipped-instance snapshots now carry the Perfecting rank, the Perfected
// quality marker, and an orange piece's chosen name, none of which a
// pre-masterwrought binary (epoch 11 through 25) can render or select. The
// other half of the epoch-26 rationale, the `fplot` farm-plot self delta, has
// no compile-time wire interface to fixture here; its presence in today's
// delta registry is pinned by tests/snapshots.test.ts (the ALL_DELTA_KEYS /
// TERSE_TO_IWORLD fplot rows).
const AUTH_WORLD_11_ITEM_INSTANCE_PAYLOAD = {
  signer: 'Maker',
  charges: {},
  rolled: {},
  enchant: 'ench',
  craftedRecipeId: 'recipe',
  boundTo: 1,
  bindOnTrade: true,
  locked: true,
  rift: {},
} as const;

const PERFECTING_REQUIRED_KEYS = [
  'perfecting',
  'perfected',
  'name',
] as const satisfies readonly (keyof ItemInstancePayload)[];

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
type _PerfectingKeysAreNew = AssertNever<
  Extract<
    (typeof PERFECTING_REQUIRED_KEYS)[number],
    keyof typeof AUTH_WORLD_11_ITEM_INSTANCE_PAYLOAD
  >
>;

describe('wire compatibility epoch', () => {
  it('fences older item formats out at the epoch-27 handshake', () => {
    // The runtime epoch pin: the world handshake version that fences older
    // snapshot shapes out before any snapshot is admitted. The three frozen
    // fixtures above carry the per-epoch rationale: bank storage (10) added
    // the socket and two-pool BankInfo fields, the Materials Vault (11) the
    // identity-preserving `special` collection, and masterwrought (26) the
    // Perfecting instance fields plus the fplot self delta. The Ignivar raid
    // ladder moved release/v0.41.0 from 11 to 25 (src/world_api.ts) before
    // this branch merged it, so masterwrought sits one past that tip; any
    // epoch at or above 11 keeps the bank and vault fences.
    expect(ONLINE_WORLD_LAYOUT_VERSION).toBe(27);
    expect(ONLINE_WORLD_AUTH_TYPE).toBe(`auth-world-${ONLINE_WORLD_LAYOUT_VERSION}`);
    expect(ONLINE_WORLD_AUTH_TYPE).toBe('auth-world-27');
    expect(ONLINE_WORLD_AUTH_TYPE).not.toBe('auth-world-26');
    expect(ONLINE_WORLD_AUTH_TYPE).not.toBe('auth-world-25');
    expect(ONLINE_WORLD_AUTH_TYPE).not.toBe('auth-world-11');
    expect(ONLINE_WORLD_AUTH_TYPE).not.toBe('auth-world-10');
    expect(ONLINE_WORLD_AUTH_TYPE).not.toBe('auth-world-9');
  });
});
