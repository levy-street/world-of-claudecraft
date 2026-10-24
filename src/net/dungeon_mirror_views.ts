// Read-only dungeon mirror projections, clock supplied by the online host.
import type { RaidLockout } from '../world_api';
import type { RiftBossDeathZoneView } from '../world_api/dungeons';

export function riftMs(expiresAt: number | null, now: number): number | null {
  return expiresAt === null ? null : Math.max(0, expiresAt - now);
}

export function activeRiftBossDeathZones(
  zones: readonly {
    x: number;
    z: number;
    radius: number;
    expiresAtMs: number;
    totalSecs: number;
  }[],
  now: number,
): RiftBossDeathZoneView[] {
  const out: import('../world_api/dungeons').RiftBossDeathZoneView[] = [];
  for (const z of zones) {
    const remaining = (z.expiresAtMs - now) / 1000;
    if (remaining > 0) {
      out.push({ x: z.x, z: z.z, radius: z.radius, remaining, total: z.totalSecs });
    }
  }
  return out;
}

export function activeRaidLockouts(lockouts: Record<string, number>, now: number): RaidLockout[] {
  const src = lockouts ?? {};
  const out: RaidLockout[] = [];
  for (const id of Object.keys(src)) {
    const msRemaining = src[id] - now;
    if (msRemaining > 0) out.push({ id, msRemaining });
  }
  return out;
}
