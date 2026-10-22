import { cloneInvSlot, type InvSlot } from '../types';
import {
  COURIER_CAPACITY,
  COURIER_PAYLOAD_BYTES,
  type CourierDispatchRequest,
  type CourierSelection,
  type CourierVaultSelection,
  courierSelectionCount,
} from './types';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}
export function courierSlotFingerprint(slot: InvSlot): string {
  return JSON.stringify(canonical(cloneInvSlot(slot)));
}
export function courierPayloadFits(value: unknown, maxBytes = COURIER_PAYLOAD_BYTES): boolean {
  const text = JSON.stringify(value);
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > maxBytes) return false;
  }
  return true;
}
function validSelection(s: unknown): s is CourierSelection {
  if (!s || typeof s !== 'object') return false;
  const r = s as CourierSelection;
  return (
    Number.isSafeInteger(r.index) &&
    r.index >= 0 &&
    typeof r.fingerprint === 'string' &&
    r.fingerprint.length <= COURIER_PAYLOAD_BYTES
  );
}
/** Distinct, well-formed indices; `taken` rejects a stack another list claimed. */
function validSelections(list: unknown, taken = new Set<number>()): list is CourierSelection[] {
  if (!Array.isArray(list)) return false;
  const indices = new Set<number>();
  for (const s of list) {
    if (!validSelection(s) || indices.has(s.index) || taken.has(s.index)) return false;
    indices.add(s.index);
  }
  return true;
}
function validVaultSelections(list: unknown): list is CourierVaultSelection[] {
  if (!Array.isArray(list)) return false;
  const pooled = new Set<string>();
  const rows = new Set<number>();
  for (const s of list) {
    if (
      !s ||
      typeof s !== 'object' ||
      typeof s.itemId !== 'string' ||
      s.itemId === '' ||
      s.itemId.length > 64 ||
      !Number.isSafeInteger(s.count) ||
      s.count <= 0
    )
      return false;
    if (s.special === undefined) {
      if (pooled.has(s.itemId)) return false;
      pooled.add(s.itemId);
    } else {
      if (!validSelection(s.special) || rows.has(s.special.index)) return false;
      rows.add(s.special.index);
    }
  }
  return true;
}
export function validCourierRequest(raw: unknown): raw is CourierDispatchRequest {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as CourierDispatchRequest;
  if (!validSelections(r.deposits) || !validSelections(r.withdrawals)) return false;
  // A carried stack goes to one store: the bank or the vault, never both.
  if (
    r.vaultDeposits !== undefined &&
    !validSelections(r.vaultDeposits, new Set(r.deposits.map((s) => s.index)))
  )
    return false;
  if (r.vaultWithdrawals !== undefined && !validVaultSelections(r.vaultWithdrawals)) return false;
  if (r.account !== undefined) {
    const a = r.account;
    const carried = new Set([...r.deposits, ...(r.vaultDeposits ?? [])].map((s) => s.index));
    if (
      !a ||
      typeof a !== 'object' ||
      !Number.isSafeInteger(a.characterId) ||
      a.characterId <= 0 ||
      !validSelections(a.deposits, carried) ||
      !validSelections(a.withdrawals)
    )
      return false;
  }
  // Zero selections is the dismissal request (see courierDispatch).
  if (courierSelectionCount(r) > COURIER_CAPACITY) return false;
  return courierPayloadFits(raw);
}
