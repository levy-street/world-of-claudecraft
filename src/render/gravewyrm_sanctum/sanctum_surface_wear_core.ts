// Static, shallow frost fractures. These never alter collision or resemble
// the glowing, stateful cracks on the boss lake. All vertices stay on one
// visible snow/ice surface, including at overlaps and platform edges.
import { GRAVEWYRM_SANCTUM_FIELD } from '../../sim/content/gravewyrm_sanctum_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { sanctumHash } from './sanctum_plan_core';

export interface SanctumSurfaceWear {
  readonly family: 'snow' | 'ice';
  readonly positions: readonly number[];
  readonly colors: readonly number[];
  readonly uvs: readonly number[];
}

// The plan takes no input: it is a pure function of the authored field, in
// the instance's own frame, so every claimed slot wears the same fractures.
// Planned once per session and shared, read-only, by every slot's terrain
// build (about five hundred lattice cells, each walking the field several
// hundred times, is not work to repeat per slot).
let planned: readonly SanctumSurfaceWear[] | null = null;

export function planSanctumSurfaceWear(): readonly SanctumSurfaceWear[] {
  planned ??= computeSanctumSurfaceWear();
  return planned;
}

function computeSanctumSurfaceWear(): SanctumSurfaceWear[] {
  const field = GRAVEWYRM_SANCTUM_FIELD;
  const batches = (['snow', 'ice'] as const).map((family) => ({
    family,
    positions: [] as number[],
    colors: [] as number[],
    uvs: [] as number[],
  }));
  // A jittered field breaks the regular rectangular terraces at a scale
  // visible from the chase camera, without an expensive per-fragment shader.
  for (let gx = -110; gx <= 110; gx += 13) {
    for (let gz = -232; gz < 138; gz += 13) {
      const x = gx + sanctumHash(gx, gz) * 10;
      const z = gz + sanctumHash(gz, gx + 5) * 10;
      const surface = authoredFieldSurfaceAt(field, x, z);
      if (!surface || surface.hidden || (surface.kind === 'path' && surface.stairs)) continue;
      if (surface.ground !== 'snow' && surface.ground !== 'ice') continue;
      const batch = batches[surface.ground === 'snow' ? 0 : 1];
      const h = authoredFieldHeight(field, x, z);
      const angle = sanctumHash(x, z + 1) * Math.PI * 2;
      const length = 4 + sanctumHash(x, z + 2) * 6;
      // Tiny dark seams with a broad, pale compressed-snow bevel. Branches
      // terminate in hairlines, not wide black crevasses suggesting danger.
      const ribbon = (sx: number, sz: number, direction: number, size: number, seed: number) => {
        let ax = sx;
        let az = sz;
        for (let step = 0; step < 5; step++) {
          const heading = direction + (sanctumHash(seed, step) - 0.5) * 0.9;
          const bx = ax + (Math.cos(heading) * size) / 5;
          const bz = az + (Math.sin(heading) * size) / 5;
          const width = (0.055 + sanctumHash(seed, step + 8) * 0.055) * (1 - step / 6);
          const nx = -Math.sin(heading);
          const nz = Math.cos(heading);
          for (const [offset, spread, shade] of [
            [0, width, 0.53],
            [width * 2.1, width * 1.1, 0.88],
          ]) {
            const p = [
              [ax + nx * (offset - spread), az + nz * (offset - spread)],
              [bx + nx * (offset - spread), bz + nz * (offset - spread)],
              [bx + nx * (offset + spread * 0.65), bz + nz * (offset + spread * 0.65)],
              [ax + nx * (offset + spread), az + nz * (offset + spread)],
            ];
            // Check the complete narrow quad as well as its midpoint. A
            // fracture cannot bridge a crevasse, hidden deck or a stair.
            if (
              [...p, [(ax + bx) / 2, (az + bz) / 2]].some(
                ([px, pz]) =>
                  authoredFieldSurfaceAt(field, px, pz) !== surface ||
                  Math.abs(authoredFieldHeight(field, px, pz) - h) > 0.02,
              )
            )
              continue;
            for (const i of [0, 2, 1, 0, 3, 2]) {
              const [px, pz] = p[i];
              batch.positions.push(px, authoredFieldHeight(field, px, pz) + 0.018, pz);
              batch.colors.push(shade * 0.76, shade * 0.88, shade);
              batch.uvs.push(px * 0.25, pz * 0.25);
            }
          }
          if (step === 1 && size === length) {
            ribbon(bx, bz, direction + 0.85, size * 0.4, seed + 71);
          }
          ax = bx;
          az = bz;
        }
      };
      ribbon(x, z, angle, length, x * 3 + z);
    }
  }
  return batches;
}
