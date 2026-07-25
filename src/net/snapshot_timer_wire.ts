import {
  STABLE_TIMER_WIRE_VERSION,
  type StableCooldownWire,
  type StableTimerWireVersion,
} from '../world_api';

export type { StableCooldownWire, StableTimerWireVersion };
export { STABLE_TIMER_WIRE_VERSION };

// Unknown markers are isolated from both legacy and v2 decoding so a future
// server cannot make an older client reinterpret fields it does not understand.
export type SnapshotTimerWireMode = 'legacy' | 'stable' | 'unsupported';

export function snapshotTimerWireMode(value: unknown): SnapshotTimerWireMode {
  if (value === undefined) return 'legacy';
  if (value === STABLE_TIMER_WIRE_VERSION) return 'stable';
  return 'unsupported';
}

export function isStableTimerWireVersion(value: unknown): value is StableTimerWireVersion {
  return value === STABLE_TIMER_WIRE_VERSION;
}

export function stableDeadlineRemaining(value: unknown, now: number): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isFinite(now) ||
    now < 0
  )
    return null;
  const remaining = Math.max(0, value - now);
  return Number.isFinite(remaining) ? remaining : null;
}

export function stableCooldownRemaining(value: unknown, now: number): number | null {
  if (!Number.isFinite(now) || now < 0) return null;
  if (typeof value === 'number') return stableDeadlineRemaining(value, now);
  if (!Array.isArray(value) || value.length !== 3) return null;

  const [expiresAt, recoveryRate, acceleratedUntilRaw] = value;
  if (
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    expiresAt < 0 ||
    typeof recoveryRate !== 'number' ||
    !Number.isFinite(recoveryRate) ||
    recoveryRate <= 0 ||
    typeof acceleratedUntilRaw !== 'number' ||
    !Number.isFinite(acceleratedUntilRaw) ||
    acceleratedUntilRaw < 0
  )
    return null;

  const acceleratedUntil = Math.min(expiresAt, acceleratedUntilRaw);
  if (now >= acceleratedUntil) return stableDeadlineRemaining(expiresAt, now);
  const remaining = Math.max(
    0,
    (acceleratedUntil - now) * recoveryRate + Math.max(0, expiresAt - acceleratedUntil),
  );
  return Number.isFinite(remaining) ? remaining : null;
}
