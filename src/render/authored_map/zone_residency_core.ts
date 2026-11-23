// Editor zone-isolate mode, pure: when a residency rect is set, only zones
// intersecting it may become (or stay) resident. Null = normal streaming (the
// game). Three- and DOM-free; renderer.ts is the consumer.

import { STRIP_MAX_X, STRIP_MIN_X } from '../../sim/data';

export interface ZoneResidencyRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** May this zone be resident under the current residency rect? Always true
 *  outside isolate mode. A zone with no x extent spans the whole strip. */
export function zoneAllowedByResidencyFilter(
  filter: ZoneResidencyRect | null,
  zone: { xMin?: number; xMax?: number; zMin: number; zMax: number },
): boolean {
  if (!filter) return true;
  const minX = zone.xMin ?? STRIP_MIN_X;
  const maxX = zone.xMax ?? STRIP_MAX_X;
  return (
    minX < filter.maxX && maxX > filter.minX && zone.zMin < filter.maxZ && zone.zMax > filter.minZ
  );
}
