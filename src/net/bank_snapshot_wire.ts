// Strict decode for the owner-only bank/vault self snapshot keys, plus the one
// application function ClientWorld calls per snapshot. Kept ClientWorld-free so
// malformed or version-skewed frames can be judged without growing online.ts or
// partially replacing a good mirror.

import { BANK_BAG_SOCKETS, BANK_EXPANSION_SLOTS, BANK_PURCHASED_SLOTS_MAX } from '../sim/bank';
import { MAX_INSTANCE_STRING_LENGTH } from '../sim/item_instance_load';
import type { BankBonusSource, BankInfo, VaultInfo } from '../world_api';
// isRecord is the ONE record predicate both snapshot wire decoders share (the
// strict prototype-checking form; see its comment in vault_snapshot_wire.ts).
import { decodeVaultInfoWire, isRecord, isWireBankSlot } from './vault_snapshot_wire';

export { BANK_PURCHASED_SLOTS_MAX };

/** Compile-time exhaustiveness arm (the vault_snapshot_wire.ts idiom): a NEW
 *  field on the decoded interface fails tsc here, instead of the runtime
 *  allowlist silently rejecting every online snapshot. */
type AssertNever<T extends never> = T;

// The decoded BankInfo key set, bound to the type both ways: a stale entry
// fails the `satisfies`, a field this decoder does not yet admit fails the
// exhaustiveness arm.
const BANK_KEY_LIST = [
  'slots',
  'capacity',
  'purchasedSlots',
  'bonusSlots',
  'nextExpansionCost',
  'bonusSources',
  'socketsUnlocked',
  'socketBags',
  'nextSocketCost',
  'nextRungClaudiumPrice',
  'generalCapacity',
  'materialsCapacity',
  'generalUsed',
  'materialsUsed',
] as const satisfies readonly (keyof BankInfo)[];
type _BankKeysExhaustive = AssertNever<Exclude<keyof BankInfo, (typeof BANK_KEY_LIST)[number]>>;
const BANK_KEYS: ReadonlySet<string> = new Set(BANK_KEY_LIST);

const BONUS_SOURCE_KEY_LIST = [
  'id',
  'slots',
  'maxSlots',
  'count',
  'cap',
] as const satisfies readonly (keyof BankBonusSource)[];
type _BonusSourceKeysExhaustive = AssertNever<
  Exclude<keyof BankBonusSource, (typeof BONUS_SOURCE_KEY_LIST)[number]>
>;
const BONUS_SOURCE_KEYS: ReadonlySet<string> = new Set(BONUS_SOURCE_KEY_LIST);

/** One-shot dev-channel visibility for the strict reject policy. The wire
 *  epoch owns additive changes, so when a rolling deploy widens the bank frame
 *  before this client learns the shape, EVERY frame is rejected and the bank
 *  mirror silently freezes at its last good state. Name the first offense
 *  (unknown key or failing field) once instead of staying silent; the reject
 *  policy itself does not soften, and further rejects stay quiet. Dev channel
 *  only (console.warn), never a player-visible surface. */
let bankRejectWarned = false;

function rejectBankFrame(detail: string): undefined {
  if (!bankRejectWarned) {
    bankRejectWarned = true;
    console.warn(
      `bank snapshot wire: rejected bank frame (${detail}); the last good mirror is retained ` +
        'and further rejects are silent. A server that widened the bank wire needs a matching ' +
        'client in the same wire epoch.',
    );
  }
  return undefined;
}

function isSafeCount(value: unknown, allowZero = false): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
  );
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_INSTANCE_STRING_LENGTH
  );
}

function isBonusSource(value: unknown): value is BankBonusSource {
  if (!isRecord(value) || Object.keys(value).some((key) => !BONUS_SOURCE_KEYS.has(key))) {
    return false;
  }
  if (
    !isBoundedId(value.id) ||
    !isSafeCount(value.slots, true) ||
    !isSafeCount(value.maxSlots, true)
  ) {
    return false;
  }
  if (value.count !== undefined && !isSafeCount(value.count, true)) return false;
  if (value.cap !== undefined && !isSafeCount(value.cap, true)) return false;
  return true;
}

/** Decode one full `bank` self field, mirroring src/sim/bank.ts bankInfoFor
 *  field by field. Explicit null is the away-from-banker gate closure and
 *  passes through; undefined means malformed and tells the caller to RETAIN
 *  its prior mirror (the cvault/bpsl policy). A valid record is adopted by
 *  reference so an own `__proto__` row anywhere inside it stays inert data. */
export function decodeBankInfoWire(value: unknown): BankInfo | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return rejectBankFrame('not a plain record');
  const unknownKey = Object.keys(value).find((key) => !BANK_KEYS.has(key));
  if (unknownKey !== undefined) {
    return rejectBankFrame(`unknown key "${unknownKey.slice(0, MAX_INSTANCE_STRING_LENGTH)}"`);
  }
  if (!Array.isArray(value.slots) || !value.slots.every(isWireBankSlot)) {
    return rejectBankFrame('slots');
  }
  // purchasedSlots rides the exact same 6-slot ladder rule as the bpsl key.
  const purchased = decodeBankPurchasedSlotsWire(value.purchasedSlots);
  if (typeof purchased !== 'number') return rejectBankFrame('purchasedSlots');
  if (!isSafeCount(value.bonusSlots, true)) return rejectBankFrame('bonusSlots');
  // Null exactly at the top of the ladder, a price below it (bankInfoFor's
  // resolved table is length-stable under overrides by construction).
  if (purchased >= BANK_PURCHASED_SLOTS_MAX) {
    if (value.nextExpansionCost !== null) return rejectBankFrame('nextExpansionCost');
  } else if (!isSafeCount(value.nextExpansionCost, true)) {
    return rejectBankFrame('nextExpansionCost');
  }
  if (!Array.isArray(value.bonusSources) || !value.bonusSources.every(isBonusSource)) {
    return rejectBankFrame('bonusSources');
  }
  if (
    !isSafeCount(value.socketsUnlocked, true) ||
    value.socketsUnlocked > BANK_BAG_SOCKETS ||
    !Array.isArray(value.socketBags) ||
    value.socketBags.length !== BANK_BAG_SOCKETS ||
    !value.socketBags.every((bag) => bag === null || isBoundedId(bag))
  ) {
    return rejectBankFrame('socketsUnlocked/socketBags');
  }
  if (value.socketsUnlocked >= BANK_BAG_SOCKETS) {
    if (value.nextSocketCost !== null) return rejectBankFrame('nextSocketCost');
  } else if (!isSafeCount(value.nextSocketCost, true)) {
    return rejectBankFrame('nextSocketCost');
  }
  // Deliberately ABSENT (never null) when no Claudium price exists; see the
  // BankInfo field comment in src/world_api/bank.ts.
  if (
    value.nextRungClaudiumPrice !== undefined &&
    !isSafeCount(value.nextRungClaudiumPrice, true)
  ) {
    return rejectBankFrame('nextRungClaudiumPrice');
  }
  if (
    !isSafeCount(value.capacity, true) ||
    !isSafeCount(value.generalCapacity, true) ||
    !isSafeCount(value.materialsCapacity, true) ||
    !isSafeCount(value.generalUsed, true) ||
    !isSafeCount(value.materialsUsed, true) ||
    // The two-pool split invariant the emitter states: both pools summed ARE
    // the display capacity. Used counts stay unbounded on purpose (an
    // over-capacity bank is tolerated, never truncated).
    value.generalCapacity + value.materialsCapacity !== value.capacity
  ) {
    return rejectBankFrame('capacity split');
  }
  // The slots-length bound, as the invariant the emitter actually guarantees:
  // bankInfoFor derives both used counts from the SAME inventory it clones
  // into slots (poolOccupancyOf counts one cell per row, and the pool split
  // sums back to the row count identically), so on every honest frame the two
  // agree EXACTLY, tolerated over-capacity banks included (bankUnsocketBag can
  // push rows past capacity at runtime, so capacity itself is NOT a bound). A
  // frame whose slots array disagrees with its own meter is forged or
  // corrupted, and a forged array can no longer grow without the meter
  // announcing it.
  if (value.slots.length !== value.generalUsed + value.materialsUsed) {
    return rejectBankFrame('slots length disagrees with used counts');
  }
  return value as unknown as BankInfo;
}

/** Decode `self.cvault`. Undefined means malformed and tells the caller to
 * retain its prior mirror; null is the explicit craft-draw gate closure. A
 * valid record is returned by reference so an own `__proto__` row stays inert
 * data instead of passing through a prototype-setting keyed assignment.
 *
 * There is deliberately no second row-count or key-length ceiling here (and
 * no client-side byte bound exists anywhere on this path: by the time this
 * decoder runs, JSON.parse of the whole frame has already happened; the only
 * peer that can send a frame is the authenticated server, which bounds the
 * payload at the source). The authoritative load path preserves arbitrary
 * nonempty dormant keys and craftVaultStockFor emits every drawable one, so a
 * narrower client-only limit would make the online crafting view disagree
 * with the same saved character in an offline world. */
export function decodeCraftVaultStockWire(
  value: unknown,
): Record<string, number> | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  for (const [key, count] of Object.entries(value)) {
    if (key.length === 0 || !Number.isSafeInteger(count) || Number(count) <= 0) {
      return undefined;
    }
  }
  return value as Record<string, number>;
}

/** Decode `self.bpsl`. The resolver-backed server emitter can explicitly send
 * null when no player is resolvable; every numeric value must be one exact
 * position on the personal-bank expansion ladder. */
export function decodeBankPurchasedSlotsWire(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0 ||
    value > BANK_PURCHASED_SLOTS_MAX ||
    value % BANK_EXPANSION_SLOTS !== 0
  ) {
    return undefined;
  }
  return value;
}

/** The four owner-only bank/vault mirrors ClientWorld keeps; the concrete
 *  ClientWorld satisfies this structurally. */
export interface BankSelfMirrors {
  bankInfo: BankInfo | null;
  vaultInfo: VaultInfo | null;
  craftVaultStock: Record<string, number> | null;
  bankPurchasedSlots: number | null;
}

/** Apply the four owner-only bank/vault self keys from one snapshot self
 *  record. All four are delta-omitted: an omitted key means UNCHANGED, never
 *  "no bank"/"no vault", so omission must not wipe an open window's mirror,
 *  and explicit null is each key's gate closure. Valid records are adopted BY
 *  REFERENCE (a tolerated save can carry a dormant own `__proto__` key, which
 *  must stay inert data, never reach a prototype-setting keyed assignment).
 *  The malformed policies differ per key and are noted against each below. */
export function applyBankSelfWire(
  target: BankSelfMirrors,
  s: { bank?: unknown; vault?: unknown; cvault?: unknown; bpsl?: unknown },
): void {
  // `bank`: malformed RETAINS the last valid mirror (undefined from the decoder).
  if (s.bank !== undefined) {
    const decoded = decodeBankInfoWire(s.bank);
    if (decoded !== undefined) target.bankInfo = decoded;
  }
  // `vault`: malformed CLEARS to null, dropping the whole unsafe row rather
  // than rendering a partial or internally inconsistent snapshot (the one
  // deliberate divergence from the retain policy; see decodeVaultInfoWire).
  if (s.vault !== undefined) target.vaultInfo = decodeVaultInfoWire(s.vault);
  // `cvault`: malformed RETAINS the last valid mirror.
  if (s.cvault !== undefined) {
    const decoded = decodeCraftVaultStockWire(s.cvault);
    if (decoded !== undefined) target.craftVaultStock = decoded;
  }
  // `bpsl`: malformed RETAINS the last valid mirror.
  if (s.bpsl !== undefined) {
    const decoded = decodeBankPurchasedSlotsWire(s.bpsl);
    if (decoded !== undefined) target.bankPurchasedSlots = decoded;
  }
}
