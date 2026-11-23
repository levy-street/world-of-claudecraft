// Small courier pose and revision-gated cargo arrive independently. Omission
// retains the previous value; malformed frames never replace a valid mirror.
import type {
  CourierAccountLeg,
  CourierInfo,
  CourierPose,
  CourierVaultSelection,
} from '../sim/courier';
import { COURIER_FLIGHT_DISTANCE, COURIER_MAX_LEG_TICKS } from '../sim/courier/motion';
import type { InvSlot } from '../sim/types';
import { decodeVaultInfoWire, isRecord, isWireBankSlot } from './vault_snapshot_wire';

type Pose = Omit<CourierPose, 'travelTicks' | 'legTicks'>;
type VaultPart = Pick<CourierInfo, 'vault' | 'vaultCargo' | 'vaultWithdrawals' | 'account'>;
type Data = Omit<CourierInfo, keyof CourierPose | keyof VaultPart>;
const PHASES = new Set(['ready', 'outbound', 'returning', 'waiting']);
export function decodeCourierPose(value: unknown): Pose | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          'phase',
          'x',
          'z',
          'bankerId',
          'inventoryRevision',
          'travelDistance',
          'remainingDistance',
        ].includes(k),
    ) ||
    !PHASES.has(value.phase as string) ||
    !Number.isSafeInteger(value.inventoryRevision) ||
    (value.inventoryRevision as number) < 0 ||
    !Number.isFinite(value.travelDistance) ||
    (value.travelDistance as number) < 0 ||
    (value.travelDistance as number) > COURIER_FLIGHT_DISTANCE ||
    !Number.isFinite(value.remainingDistance) ||
    (value.remainingDistance as number) < 0 ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.z) ||
    (value.bankerId !== null &&
      (!Number.isSafeInteger(value.bankerId) || (value.bankerId as number) <= 0))
  )
    return undefined;
  return value as unknown as Pose;
}
export function decodeCourierData(value: unknown): Data | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          'cargo',
          'withdrawals',
          'revision',
          'active',
          'bankSlots',
          'bankCapacity',
          'bankRevision',
        ].includes(k),
    ) ||
    !Array.isArray(value.cargo) ||
    value.cargo.length > 24 ||
    !value.cargo.every(isWireBankSlot) ||
    !Array.isArray(value.withdrawals) ||
    value.withdrawals.length > 24 ||
    !value.withdrawals.every(
      (r) =>
        isRecord(r) &&
        Object.keys(r).every((k) => ['index', 'fingerprint'].includes(k)) &&
        Number.isSafeInteger(r.index) &&
        (r.index as number) >= 0 &&
        typeof r.fingerprint === 'string' &&
        r.fingerprint.length > 0 &&
        r.fingerprint.length <= 12 * 1024,
    ) ||
    !Number.isSafeInteger(value.bankRevision) ||
    (value.bankRevision as number) < 0 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.active !== 'boolean' ||
    !Array.isArray(value.bankSlots) ||
    !value.bankSlots.every(isWireBankSlot) ||
    !Number.isSafeInteger(value.bankCapacity) ||
    (value.bankCapacity as number) < 0
  )
    return undefined;
  return value as unknown as Data;
}
const isSelection = (r: unknown): boolean =>
  isRecord(r) &&
  Object.keys(r).every((k) => ['index', 'fingerprint'].includes(k)) &&
  Number.isSafeInteger(r.index) &&
  (r.index as number) >= 0 &&
  typeof r.fingerprint === 'string' &&
  r.fingerprint.length > 0 &&
  r.fingerprint.length <= 12 * 1024;

/** The vault half of the courier (`courierVault`): its own key because older
 *  clients reject unknown courierData keys. Null clears it; undefined means
 *  malformed, and the prior mirror stays. */
export function decodeCourierStores(value: unknown): VaultPart | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (k) => !['vault', 'vaultCargo', 'vaultWithdrawals', 'account'].includes(k),
    ) ||
    !Array.isArray(value.vaultCargo) ||
    value.vaultCargo.length > 24 ||
    !value.vaultCargo.every(isWireBankSlot) ||
    !Array.isArray(value.vaultWithdrawals) ||
    value.vaultWithdrawals.length > 24 ||
    !value.vaultWithdrawals.every(
      (r) =>
        isRecord(r) &&
        Object.keys(r).every((k) => ['itemId', 'count', 'special'].includes(k)) &&
        typeof r.itemId === 'string' &&
        r.itemId.length > 0 &&
        r.itemId.length <= 64 &&
        Number.isSafeInteger(r.count) &&
        (r.count as number) > 0 &&
        (r.special === undefined || isSelection(r.special)),
    )
  )
    return undefined;
  const vault = value.vault === null ? null : decodeVaultInfoWire(value.vault);
  if (value.vault !== null && vault === null) return undefined;
  const account = value.account;
  if (
    account !== undefined &&
    account !== null &&
    (!isRecord(account) ||
      Object.keys(account).some((k) => !['characterId', 'cargo', 'withdrawals'].includes(k)) ||
      !Number.isSafeInteger(account.characterId) ||
      (account.characterId as number) <= 0 ||
      !Array.isArray(account.cargo) ||
      account.cargo.length > 24 ||
      !account.cargo.every(isWireBankSlot) ||
      !Array.isArray(account.withdrawals) ||
      account.withdrawals.length > 24 ||
      !account.withdrawals.every(isSelection))
  )
    return undefined;
  // Empty legs stay absent, exactly as the sim's CourierInfo carries them.
  return {
    vault,
    ...(value.vaultCargo.length ? { vaultCargo: value.vaultCargo as InvSlot[] } : {}),
    ...(value.vaultWithdrawals.length
      ? { vaultWithdrawals: value.vaultWithdrawals as CourierVaultSelection[] }
      : {}),
    ...(isRecord(account) ? { account: account as unknown as CourierAccountLeg } : {}),
  };
}

/** Separate from the legacy pose so older clients can ignore the new timing. */
export function decodeCourierTravelTicks(value: unknown, min = 0): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= COURIER_MAX_LEG_TICKS
    ? value
    : undefined;
}

export function applyCourierSelfWire(
  target: { courierInfo: CourierInfo | null },
  self: Record<string, unknown>,
): void {
  if (
    self.courier === undefined &&
    self.courierData === undefined &&
    self.courierTravelTicks === undefined &&
    self.courierLegTicks === undefined &&
    self.courierStores === undefined
  )
    return;
  const pose = decodeCourierPose(self.courier);
  const data = decodeCourierData(self.courierData);
  const travelTicks = decodeCourierTravelTicks(self.courierTravelTicks);
  const legTicks = decodeCourierTravelTicks(self.courierLegTicks, 1);
  const vaultPart = decodeCourierStores(self.courierStores);
  if (
    (self.courierStores !== undefined && vaultPart === undefined) ||
    (self.courier !== undefined && pose === undefined) ||
    (self.courierData !== undefined && data === undefined) ||
    (self.courierTravelTicks !== undefined && travelTicks === undefined) ||
    (self.courierLegTicks !== undefined && legTicks === undefined)
  )
    return;
  if (pose === null || data === null) {
    target.courierInfo = null;
    return;
  }
  const prior = target.courierInfo;
  if ((!pose || !data) && !prior) return;
  // An older server never sends courierStores: its courier simply has no vault.
  const merged = { vault: null, ...prior, ...data, ...pose } as CourierInfo;
  if (vaultPart !== undefined) {
    delete merged.vaultCargo;
    delete merged.vaultWithdrawals;
    delete merged.account;
    if (vaultPart === null) merged.vault = null;
    else Object.assign(merged, vaultPart);
  }
  if (travelTicks === null) delete merged.travelTicks;
  else if (travelTicks !== undefined) merged.travelTicks = travelTicks;
  if (legTicks === null) delete merged.legTicks;
  else if (legTicks !== undefined) merged.legTicks = legTicks;
  target.courierInfo = merged;
}
