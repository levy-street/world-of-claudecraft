import { sanitizeBankState } from '../bank';
import { cloneInvSlot } from '../types';
import { courierPayloadFits } from './identity';
import { COURIER_CAPACITY, COURIER_CUSTODY_BYTES, type CourierState } from './types';

export function savedCourierState(state: CourierState): CourierState {
  return {
    ...state,
    cargo: state.cargo.map(cloneInvSlot),
    withdrawals: state.withdrawals.map((s) => ({ ...s })),
  };
}

/** Invalid geometry stops a trip, never destroys its cargo. Oversized custody
 * refuses the load rather than silently truncating owned items. */
export function sanitizeCourierState(
  raw: unknown,
  owner?: string,
  drops?: string[],
  ownerId?: number,
): CourierState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<CourierState>;
  if (Array.isArray(r.cargo) && r.cargo.length > COURIER_CAPACITY) {
    throw new Error('Courier cargo exceeds its bounded storage capacity');
  }
  const cargo = sanitizeBankState({ inventory: r.cargo }, owner, drops, ownerId).inventory;
  if (!courierPayloadFits({ cargo, withdrawals: [] }, COURIER_CUSTODY_BYTES)) {
    throw new Error('Courier cargo exceeds its bounded payload capacity');
  }
  const phase = ['ready', 'outbound', 'returning', 'waiting'].includes(r.phase ?? '')
    ? r.phase!
    : 'waiting';
  const geometry = Number.isFinite(r.x) && Number.isFinite(r.z);
  const withdrawals = Array.isArray(r.withdrawals)
    ? r.withdrawals
        .slice(0, COURIER_CAPACITY)
        .filter(
          (s) =>
            s &&
            Number.isSafeInteger(s.index) &&
            s.index >= 0 &&
            typeof s.fingerprint === 'string' &&
            s.fingerprint.length <= 12 * 1024,
        )
        .map((s) => ({ index: s.index, fingerprint: s.fingerprint }))
    : [];
  const state: CourierState = {
    phase: !geometry || (phase === 'ready' && cargo.length > 0) ? 'waiting' : phase,
    x: geometry ? r.x! : 0,
    z: geometry ? r.z! : 0,
    bankerId: Number.isSafeInteger(r.bankerId) && r.bankerId! > 0 ? r.bankerId! : null,
    cargo,
    withdrawals,
    revision: Number.isSafeInteger(r.revision) && r.revision! >= 0 ? r.revision! : 0,
    retryRemaining: Number.isFinite(r.retryRemaining)
      ? Math.max(0, Math.min(1, r.retryRemaining!))
      : 0,
  };
  // Invalid request metadata can be abandoned without deleting owned inventory.
  if (cargo.length + state.withdrawals.length > COURIER_CAPACITY) state.withdrawals = [];
  if (!courierPayloadFits({ cargo, withdrawals: state.withdrawals }, COURIER_CUSTODY_BYTES))
    state.withdrawals = [];
  return state;
}
