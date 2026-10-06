// Small courier pose and revision-gated cargo arrive independently. Omission
// retains the previous value; malformed frames never replace a valid mirror.
import type { CourierInfo, CourierPose } from '../sim/courier';
import { isRecord, isWireBankSlot } from './vault_snapshot_wire';

type Pose = CourierPose;
type Data = Omit<CourierInfo, keyof Pose>;
const PHASES = new Set(['ready', 'outbound', 'returning', 'waiting']);
export function decodeCourierPose(value: unknown): Pose | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (k) => !['phase', 'x', 'z', 'bankerId', 'inventoryRevision'].includes(k),
    ) ||
    !PHASES.has(value.phase as string) ||
    !Number.isSafeInteger(value.inventoryRevision) ||
    (value.inventoryRevision as number) < 0 ||
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
export function applyCourierSelfWire(
  target: { courierInfo: CourierInfo | null },
  self: Record<string, unknown>,
): void {
  if (self.courier === undefined && self.courierData === undefined) return;
  const pose = decodeCourierPose(self.courier);
  const data = decodeCourierData(self.courierData);
  if (
    (self.courier !== undefined && pose === undefined) ||
    (self.courierData !== undefined && data === undefined)
  )
    return;
  if (pose === null || data === null) {
    target.courierInfo = null;
    return;
  }
  const prior = target.courierInfo;
  if ((!pose || !data) && !prior) return;
  target.courierInfo = { ...prior, ...data, ...pose } as CourierInfo;
}
