// Pure shore mask for the Drowned Temple's lagoon: how close each spot of open
// water lies to a walkway or terrace (1 against the stone, fading to 0 out in
// the lagoon), so the water shader can lighten the shallows, ring the stone
// with foam and scatter the bioluminescence along the edges. Three-free,
// DOM-free, deterministic.

import { DROWNED_TEMPLE_FIELD } from '../../sim/content/drowned_temple_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';

/** The mask's rectangle (instance-local), a little past the crater ring. */
export const TEMPLE_SHORE_BOUNDS = { minX: -160, maxX: 160, minZ: -270, maxZ: 300 } as const;

/** How far out (yards) the shallows fade to open water. */
const REACH = 9;

/** A size x size mask, row-major from minZ, each texel in [0, 1]. */
export function planTempleShoreMask(size: number): Float32Array {
  const b = TEMPLE_SHORE_BOUNDS;
  const land = new Uint8Array(size * size);
  const field = DROWNED_TEMPLE_FIELD;
  for (let j = 0; j < size; j++) {
    const z = b.minZ + ((j + 0.5) / size) * (b.maxZ - b.minZ);
    for (let i = 0; i < size; i++) {
      const x = b.minX + ((i + 0.5) / size) * (b.maxX - b.minX);
      land[j * size + i] = authoredFieldHeight(field, x, z) > field.voidHeight + 1e-6 ? 1 : 0;
    }
  }
  // Distance to the nearest land texel, a two-pass chamfer transform.
  const INF = 1e9;
  const d = new Float32Array(size * size).fill(INF);
  for (let k = 0; k < land.length; k++) if (land[k]) d[k] = 0;
  const diag = Math.SQRT2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      if (i > 0) d[k] = Math.min(d[k], d[k - 1] + 1);
      if (j > 0) d[k] = Math.min(d[k], d[k - size] + 1);
      if (i > 0 && j > 0) d[k] = Math.min(d[k], d[k - size - 1] + diag);
      if (i < size - 1 && j > 0) d[k] = Math.min(d[k], d[k - size + 1] + diag);
    }
  }
  for (let j = size - 1; j >= 0; j--) {
    for (let i = size - 1; i >= 0; i--) {
      const k = j * size + i;
      if (i < size - 1) d[k] = Math.min(d[k], d[k + 1] + 1);
      if (j < size - 1) d[k] = Math.min(d[k], d[k + size] + 1);
      if (i < size - 1 && j < size - 1) d[k] = Math.min(d[k], d[k + size + 1] + diag);
      if (i > 0 && j < size - 1) d[k] = Math.min(d[k], d[k + size - 1] + diag);
    }
  }
  const yardsPerTexel = (b.maxX - b.minX) / size;
  const out = new Float32Array(size * size);
  for (let k = 0; k < out.length; k++) {
    const yards = d[k] * yardsPerTexel;
    out[k] = land[k] ? 1 : Math.max(0, 1 - yards / REACH) ** 1.5;
  }
  return out;
}
