import type { SimEvent } from '../sim/types';

export interface MirroredRiftDeathZone {
  x: number;
  z: number;
  radius: number;
  expiresAtMs: number;
  totalSecs: number;
}

/** Mirror the existing event envelope, preserving original fuse progress on
 * replays. Older servers omit totalSecs; malformed optional totals fall back
 * to the remaining fuse. The caller injects the presentation clock. */
export function appendRiftDeathZone(
  zones: readonly MirroredRiftDeathZone[],
  event: Extract<SimEvent, { type: 'riftDeathZoneSpawn' }>,
  now: number,
): MirroredRiftDeathZone[] {
  // Prune at spawn, so expired warnings cannot accumulate behind the reader.
  const live = zones.filter((zone) => zone.expiresAtMs > now);
  live.push({
    x: event.x,
    z: event.z,
    radius: event.radius,
    expiresAtMs: now + event.durationSecs * 1000,
    totalSecs:
      typeof event.totalSecs === 'number' &&
      Number.isFinite(event.totalSecs) &&
      event.totalSecs >= event.durationSecs
        ? event.totalSecs
        : event.durationSecs,
  });
  return live;
}
