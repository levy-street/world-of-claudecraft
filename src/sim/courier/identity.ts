import { cloneInvSlot, type InvSlot } from '../types';
import { COURIER_CAPACITY, COURIER_PAYLOAD_BYTES, type CourierDispatchRequest } from './types';

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
export function validCourierRequest(raw: unknown): raw is CourierDispatchRequest {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as CourierDispatchRequest;
  if (!Array.isArray(r.deposits) || !Array.isArray(r.withdrawals)) return false;
  const total = r.deposits.length + r.withdrawals.length;
  if (total < 1 || total > COURIER_CAPACITY) return false;
  for (const list of [r.deposits, r.withdrawals]) {
    const indices = new Set<number>();
    for (const s of list) {
      if (
        !s ||
        !Number.isSafeInteger(s.index) ||
        s.index < 0 ||
        typeof s.fingerprint !== 'string' ||
        s.fingerprint.length > COURIER_PAYLOAD_BYTES ||
        indices.has(s.index)
      )
        return false;
      indices.add(s.index);
    }
  }
  return courierPayloadFits(raw);
}
