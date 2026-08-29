// Strict decoder for the owner-only Materials Vault snapshot. The world epoch
// guarantees this required shape, but every field is still validated at the
// browser boundary so a malformed frame is dropped instead of feeding
// undefined counts or aliased payload junk into the vault painter.

import { MAX_INSTANCE_STRING_LENGTH } from '../sim/item_instance_load';
import { VAULT_BASE_CAP, VAULT_UPGRADE_RUNGS, VAULT_UPGRADE_STEP } from '../sim/materials_vault';
import { cloneItemInstancePayload, type InvSlot } from '../sim/types';
import type { VaultInfo, VaultSpecialRef } from '../world_api';

/** Compile-time exhaustiveness arm: instantiate it with an Exclude<> that must
 *  resolve to never. A NEW field on the decoded interface then fails tsc RIGHT
 *  HERE, instead of the runtime allowlist silently rejecting every online
 *  snapshot while the offline Sim keeps working. */
type AssertNever<T extends never> = T;

// The decoded VaultInfo key set, bound to the type both ways: a stale entry
// fails the `satisfies`, and a VaultInfo field this decoder does not yet admit
// fails the exhaustiveness arm.
const VAULT_KEY_LIST = [
  'stock',
  'special',
  'upgrades',
  'perMaterialCap',
  'nextUpgradeCost',
] as const satisfies readonly (keyof VaultInfo)[];
type _VaultKeysExhaustive = AssertNever<Exclude<keyof VaultInfo, (typeof VAULT_KEY_LIST)[number]>>;
const VAULT_KEYS: ReadonlySet<string> = new Set(VAULT_KEY_LIST);

// One vault special row: the InvSlot key set MINUS the advisory bag cell
// (vaultInfoFor deletes `slot` at the emitter), so a subset `satisfies` with no
// exhaustiveness arm is the right bind here.
const SPECIAL_KEY_LIST = [
  'itemId',
  'count',
  'instance',
  'craftedRecipeId',
] as const satisfies readonly (keyof InvSlot)[];
const SPECIAL_KEYS: ReadonlySet<string> = new Set(SPECIAL_KEY_LIST);

// One bank inventory row as bankInfoFor boundary-clones it: the FULL InvSlot
// key set, the advisory `slot` cell included (the bank emitter keeps it), so
// this list does take the exhaustiveness arm.
const BANK_SLOT_KEY_LIST = [
  ...SPECIAL_KEY_LIST,
  'slot',
] as const satisfies readonly (keyof InvSlot)[];
type _BankSlotKeysExhaustive = AssertNever<
  Exclude<keyof InvSlot, (typeof BANK_SLOT_KEY_LIST)[number]>
>;
const BANK_SLOT_KEYS: ReadonlySet<string> = new Set(BANK_SLOT_KEY_LIST);

const MAX_JSON_DEPTH = 12;
const MAX_JSON_NODES = 1_024;
/** The vault purchase cap is the sim's rung count (a GEOMETRY export, the price
 *  table itself is banned from client trees): a sixth sim rung widens this
 *  decoder automatically instead of closing every online vault window at rung
 *  six while offline kept working. */
const MAX_VAULT_UPGRADES = VAULT_UPGRADE_RUNGS;

/** The ONE record predicate for both snapshot wire decoders (this module and
 *  bank_snapshot_wire.ts, which imports it; the import runs this way because
 *  the bank module already depends on this one). The strict prototype check
 *  matters: decoded records are adopted BY REFERENCE, so only plain data
 *  (JSON.parse output: Object.prototype or null prototype) may pass. A class
 *  instance (Date, Map, a proxy-backed exotic) smuggles behavior alongside its
 *  own keys and is rejected as a shape class of its own. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeCount(value: unknown, allowZero = false): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
  );
}

function isBoundedJson(value: unknown): boolean {
  let nodes = 0;
  const visit = (current: unknown, depth: number): boolean => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (current === null || typeof current === 'boolean') return true;
    if (typeof current === 'string') return current.length <= MAX_INSTANCE_STRING_LENGTH;
    if (typeof current === 'number') return Number.isFinite(current);
    if (Array.isArray(current)) return current.every((entry) => visit(entry, depth + 1));
    if (!isRecord(current)) return false;
    return Object.entries(current).every(
      ([key, entry]) => key.length <= MAX_INSTANCE_STRING_LENGTH && visit(entry, depth + 1),
    );
  };
  return visit(value, 0);
}

function isWireInvSlotRow(value: unknown, keys: ReadonlySet<string>): value is InvSlot {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.has(key))) return false;
  if (typeof value.itemId !== 'string' || value.itemId === '' || !isSafeCount(value.count)) {
    return false;
  }
  if (
    value.craftedRecipeId !== undefined &&
    (typeof value.craftedRecipeId !== 'string' ||
      value.craftedRecipeId === '' ||
      value.craftedRecipeId.length > MAX_INSTANCE_STRING_LENGTH)
  ) {
    return false;
  }
  if (
    value.instance !== undefined &&
    (!isRecord(value.instance) || !isBoundedJson(value.instance))
  ) {
    return false;
  }
  if (value.slot !== undefined && !isSafeCount(value.slot, true)) return false;
  return true;
}

function isSpecialSlot(value: unknown): value is InvSlot {
  return isWireInvSlotRow(value, SPECIAL_KEYS);
}

/** One personal-bank inventory row off the wire, for the bank decoder
 *  (bank_snapshot_wire.ts): the vault special-row validation plus the advisory
 *  `slot` cell the bank emitter keeps on its boundary clones. */
export function isWireBankSlot(value: unknown): value is InvSlot {
  return isWireInvSlotRow(value, BANK_SLOT_KEYS);
}

/** Decode one full `vault` self field. Explicit null closes the view; any
 *  malformed object also resolves to null, dropping the whole unsafe row
 *  rather than rendering a partial or internally inconsistent snapshot. */
export function decodeVaultInfoWire(value: unknown): VaultInfo | null {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).some((key) => !VAULT_KEYS.has(key))) return null;
  if (!isRecord(value.stock) || !Array.isArray(value.special)) return null;
  if (!isSafeCount(value.upgrades, true) || value.upgrades > MAX_VAULT_UPGRADES) return null;
  // The sim's own capacity formula (vaultCapacityPerMaterial): nothing while
  // locked, then VAULT_BASE_CAP plus VAULT_UPGRADE_STEP per extra rung, which
  // is exactly what vaultInfoFor emits for every ladder position including the
  // locked upgrades:0 snapshot at a banker.
  const expectedCap =
    value.upgrades <= 0 ? 0 : VAULT_BASE_CAP + VAULT_UPGRADE_STEP * (value.upgrades - 1);
  if (value.perMaterialCap !== expectedCap) return null;
  if (value.upgrades === MAX_VAULT_UPGRADES) {
    if (value.nextUpgradeCost !== null) return null;
  } else if (!isSafeCount(value.nextUpgradeCost, true)) return null;
  for (const count of Object.values(value.stock)) {
    if (!isSafeCount(count)) return null;
  }
  if (!value.special.every(isSpecialSlot)) return null;
  return value as unknown as VaultInfo;
}

export interface VaultWithdrawPayload {
  itemId: string;
  count?: number;
  special?: VaultSpecialRef;
}

/** Build a withdrawal intent without aliasing the UI's identity fingerprint. */
export function vaultWithdrawPayload(
  itemId: string,
  count?: number,
  special?: VaultSpecialRef,
): VaultWithdrawPayload {
  return {
    itemId,
    ...(count === undefined ? {} : { count }),
    ...(special === undefined
      ? {}
      : {
          special: {
            index: special.index,
            ...(special.instance === undefined
              ? {}
              : { instance: cloneItemInstancePayload(special.instance) }),
            ...(special.craftedRecipeId === undefined
              ? {}
              : { craftedRecipeId: special.craftedRecipeId }),
          },
        }),
  };
}
