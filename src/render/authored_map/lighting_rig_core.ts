// Pure half of the authored (Studio) lighting override: where an authored sun
// sits, and whether a profile change needs the carve interiors re-marched.
// Three- and DOM-free; lighting_rig.ts is the consumer.

import type { EditorLightingProfile } from '../editor_lighting';

/** The authored sun's anchor point (length `len`, the shipped anchor's) for a
 *  compass azimuth and an elevation clamped to 5..85 degrees, written into
 *  `out`. The key light, its shadow and the sun disc all aim from here. */
export function authoredSunAnchor<T extends { x: number; y: number; z: number }>(
  azimuthDeg: number,
  elevationDeg: number,
  len: number,
  out: T,
): T {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (Math.min(85, Math.max(5, elevationDeg)) * Math.PI) / 180;
  out.x = Math.cos(az) * Math.cos(el) * len;
  out.y = Math.sin(el) * len;
  out.z = Math.sin(az) * Math.cos(el) * len;
  return out;
}

/** The cave brightness is baked into the cavity vertices, so a profile swap
 *  that moves it has to re-march every carved tile. */
export function caveLightChanged(
  prev: EditorLightingProfile | null,
  next: EditorLightingProfile | null,
): boolean {
  return (next?.caveLight ?? 0) !== (prev?.caveLight ?? 0);
}
