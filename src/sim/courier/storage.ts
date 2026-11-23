import { sanitizeBankState } from '../bank';
import { cloneInvSlot } from '../types';
import { courierPayloadFits } from './identity';
import { COURIER_FLIGHT_DISTANCE, courierLegPlan } from './motion';
import {
  COURIER_CAPACITY,
  COURIER_CUSTODY_BYTES,
  type CourierAccountLeg,
  type CourierSelection,
  type CourierState,
  type CourierVaultSelection,
} from './types';

export function savedCourierState(state: CourierState): CourierState {
  return {
    ...state,
    cargo: state.cargo.map(cloneInvSlot),
    withdrawals: state.withdrawals.map((s) => ({ ...s })),
    ...(state.vaultCargo ? { vaultCargo: state.vaultCargo.map(cloneInvSlot) } : {}),
    ...(state.vaultWithdrawals
      ? { vaultWithdrawals: state.vaultWithdrawals.map(cloneVaultRow) }
      : {}),
    ...(state.account ? { account: cloneAccountLeg(state.account) } : {}),
  };
}

function cloneAccountLeg(leg: CourierAccountLeg): CourierAccountLeg {
  return {
    characterId: leg.characterId,
    cargo: leg.cargo.map(cloneInvSlot),
    withdrawals: leg.withdrawals.map((s) => ({ ...s })),
  };
}

function loadSelections(raw: unknown): CourierSelection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, COURIER_CAPACITY)
    .filter(
      (s): s is CourierSelection =>
        !!s &&
        Number.isSafeInteger(s.index) &&
        s.index >= 0 &&
        typeof s.fingerprint === 'string' &&
        s.fingerprint.length <= 12 * 1024,
    )
    .map((s) => ({ index: s.index, fingerprint: s.fingerprint }));
}

function cloneVaultRow(s: CourierVaultSelection): CourierVaultSelection {
  return { ...s, ...(s.special ? { special: { ...s.special } } : {}) };
}

/** Request metadata only: a malformed row is dropped, never the cargo. */
function loadVaultRows(raw: unknown): CourierVaultSelection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, COURIER_CAPACITY)
    .filter(
      (s): s is CourierVaultSelection =>
        !!s &&
        typeof s.itemId === 'string' &&
        s.itemId.length > 0 &&
        s.itemId.length <= 64 &&
        Number.isSafeInteger(s.count) &&
        s.count > 0 &&
        (s.special === undefined ||
          (!!s.special &&
            Number.isSafeInteger(s.special.index) &&
            s.special.index >= 0 &&
            typeof s.special.fingerprint === 'string' &&
            s.special.fingerprint.length <= 12 * 1024)),
    )
    .map(cloneVaultRow);
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
  const vaultBound = Array.isArray(r.vaultCargo) ? r.vaultCargo.length : 0;
  const rawAccount = r.account && typeof r.account === 'object' ? r.account : undefined;
  const accountBound = Array.isArray(rawAccount?.cargo) ? rawAccount.cargo.length : 0;
  if (Array.isArray(r.cargo) && r.cargo.length + vaultBound + accountBound > COURIER_CAPACITY) {
    throw new Error('Courier cargo exceeds its bounded storage capacity');
  }
  const cargo = sanitizeBankState({ inventory: r.cargo }, owner, drops, ownerId).inventory;
  const vaultCargo = sanitizeBankState(
    { inventory: r.vaultCargo },
    owner,
    drops,
    ownerId,
  ).inventory;
  const accountCargo = sanitizeBankState(
    { inventory: rawAccount?.cargo },
    owner,
    drops,
    ownerId,
  ).inventory;
  if (
    !courierPayloadFits({ cargo, vaultCargo, accountCargo, withdrawals: [] }, COURIER_CUSTODY_BYTES)
  ) {
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
    phase:
      !geometry || (phase === 'ready' && cargo.length + vaultCargo.length > 0) ? 'waiting' : phase,
    x: geometry ? r.x! : 0,
    z: geometry ? r.z! : 0,
    bankerId: Number.isSafeInteger(r.bankerId) && r.bankerId! > 0 ? r.bankerId! : null,
    travelDistance:
      Number.isFinite(r.travelDistance) && r.travelDistance! >= 0
        ? Math.min(COURIER_FLIGHT_DISTANCE, r.travelDistance!)
        : 0,
    cargo,
    withdrawals,
    revision: Number.isSafeInteger(r.revision) && r.revision! >= 0 ? r.revision! : 0,
    retryRemaining: Number.isFinite(r.retryRemaining)
      ? Math.max(0, Math.min(1, r.retryRemaining!))
      : 0,
  };
  // Old (fixed ten-second) or malformed motion metadata restarts the remaining
  // leg from its saved position; owned cargo and selections remain intact and no wall clock runs.
  if (
    Number.isFinite(r.legDistance) &&
    r.legDistance! >= 0 &&
    Number.isSafeInteger(r.travelTicks) &&
    r.travelTicks! >= 0 &&
    r.travelTicks! <= courierLegPlan(r.legDistance!).ticks &&
    Number.isFinite(r.legStartX) &&
    Number.isFinite(r.legStartZ)
  ) {
    state.travelTicks = r.travelTicks;
    state.legStartX = r.legStartX;
    state.legStartZ = r.legStartZ;
    state.legDistance = r.legDistance;
  }
  if (Number.isFinite(r.landingYaw)) state.landingYaw = r.landingYaw;
  // Vault-bound stacks are owned inventory like the rest: only an outbound
  // trip still carries them to the vault; any other phase brings them home.
  if (vaultCargo.length > 0) {
    if (state.phase === 'outbound') state.vaultCargo = vaultCargo;
    else state.cargo.push(...vaultCargo);
  }
  const vaultRows = state.phase === 'outbound' ? loadVaultRows(r.vaultWithdrawals) : [];
  if (vaultRows.length > 0) state.vaultWithdrawals = vaultRows;
  // The other-character leg is owned cargo too. Only an outbound trip keeps it
  // (its database half has not committed: a committed leg is already cleared
  // from the saved courier), and a malformed target brings its stacks home.
  const characterId = rawAccount?.characterId;
  if (
    state.phase === 'outbound' &&
    Number.isSafeInteger(characterId) &&
    (characterId as number) > 0
  ) {
    if (accountCargo.length > 0 || Array.isArray(rawAccount?.withdrawals))
      state.account = {
        characterId: characterId as number,
        cargo: accountCargo,
        withdrawals: loadSelections(rawAccount?.withdrawals),
      };
  } else state.cargo.push(...accountCargo);
  // An outbound courier whose bank and vault legs are done carries homeward
  // cargo, with or without a leg still to run: never run those legs again.
  if (state.phase === 'outbound' && r.banked === true) state.banked = true;
  // Invalid request metadata can be abandoned without deleting owned inventory.
  const requests = () =>
    state.withdrawals.length +
    (state.vaultWithdrawals?.length ?? 0) +
    (state.account?.withdrawals.length ?? 0);
  const stacks = () =>
    state.cargo.length + (state.vaultCargo?.length ?? 0) + (state.account?.cargo.length ?? 0);
  const payload = () => ({
    cargo: state.cargo,
    vaultCargo: state.vaultCargo ?? [],
    withdrawals: state.withdrawals,
    vaultWithdrawals: state.vaultWithdrawals ?? [],
    account: state.account,
  });
  if (
    stacks() + requests() > COURIER_CAPACITY ||
    !courierPayloadFits(payload(), COURIER_CUSTODY_BYTES)
  ) {
    state.withdrawals = [];
    delete state.vaultWithdrawals;
    if (state.account) state.account.withdrawals = [];
  }
  return state;
}
