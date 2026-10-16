// Pure decisions for the authored per-zone atmosphere pass
// (zone_atmosphere.ts). Three- and DOM-free.

import type { WorldContent } from '../../sim/types';

/** Zone atmosphere is spatially coarse. Sampling every two yards keeps a
 *  boundary response effectively instant while avoiding a zone lookup on
 *  every single editor frame during free-fly movement. */
export const ATMOSPHERE_RESAMPLE_YD = 2;

/** Whether (x, z) has moved far enough from the last sample to look the zone
 *  up again. Always true until a zone has been adopted. */
export function atmosphereResampleDue(
  hasZone: boolean,
  lastX: number,
  lastZ: number,
  x: number,
  z: number,
): boolean {
  if (!hasZone || !Number.isFinite(lastX)) return true;
  const dx = x - lastX;
  const dz = z - lastZ;
  return dx * dx + dz * dz >= ATMOSPHERE_RESAMPLE_YD * ATMOSPHERE_RESAMPLE_YD;
}

/**
 * Whether the atmosphere pass may run at all. The SHIPPED game on the built-in
 * world authors no atmosphere, and must not come through here: restoring the
 * boot rig (lighting null) would restamp sun intensity, hue and direction on
 * every zone crossing, and the day/night easing would then visibly pull it
 * back. The editor and its playtest always run it, as does any map that
 * actually authors something.
 */
export function worldAuthorsAtmosphere(
  world: Pick<WorldContent, 'zoneAtmosphere' | 'lighting' | 'timeScale' | 'weather' | 'skybox'>,
  editorActive: boolean,
): boolean {
  return (
    editorActive ||
    !!world.zoneAtmosphere ||
    !!world.lighting ||
    world.timeScale !== undefined ||
    !!world.weather ||
    world.skybox !== undefined
  );
}
