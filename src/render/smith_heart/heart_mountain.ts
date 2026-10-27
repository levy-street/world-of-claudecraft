// The Smith's Heart's mountain (heart_mountain_core.ts plans it): one indexed,
// flat-shaded heightfield of rock round every floor, tinted by height (dark
// basalt down by the chasm, paler granite on the ridges where the storm light
// catches it) with a hashed mottle. Static, one draw; the low tier builds it
// on a coarser grid (fewer facets, the same mountain).

import * as THREE from 'three';
import { detailedSurfaceMat } from '../worn_stone';
import {
  HAMMER_ROCK_GAIN,
  HAMMER_ROCK_MIX,
  HAMMER_ROCK_TONE,
  hammerRiserShade,
  hammerRockBed,
  hammerRockLift,
} from './heart_cliff_paint_core';
import {
  HEART_CROWN_GAIN,
  HEART_CROWN_MIX,
  HEART_CROWN_TONE,
  heartCrownWeight,
} from './heart_crown_core';
import {
  HAMMER_TERRACE_RISER,
  HEART_MOUNTAIN_CHASM,
  heartHammerTerraceStep,
  heartMountainCellDrawn,
  heartMountainGrid,
} from './heart_mountain_core';
import { heartHash } from './heart_plan_core';
import { HEART_WALL_CLEAR, HEART_WALL_PATH_CLEAR, heartFloorClearance } from './heart_walls_core';
import { HEAT_ROCK_GAIN, HEAT_ROCK_MIX, HEAT_ROCK_TONE, heatSootWeight } from './heat_soot_core';
import {
  QUENCH_ROCK_GAIN,
  QUENCH_ROCK_MIX,
  QUENCH_ROCK_TONE,
  quenchFrostWeight,
} from './quench_frost_core';

// Stormcrag's granite, a cool grey with a breath of violet low down and a
// warmer grey on the sunlit heights (phase 2C: the warm tan it had washed
// every vein to one tone under the Hammer's low sun).
const ROCK_LOW = new THREE.Color(0x24232a);
const ROCK_MID = new THREE.Color(0x48474c);
const ROCK_HIGH = new THREE.Color(0x6a6766);
const HAMMER_ROCK = new THREE.Color(HAMMER_ROCK_TONE);
const QUENCH_ROCK = new THREE.Color(QUENCH_ROCK_TONE);
const HEAT_ROCK = new THREE.Color(HEAT_ROCK_TONE);
const CROWN_ROCK = new THREE.Color(HEART_CROWN_TONE);

/** A Hammer step's shade (a gain): its own tone of the bed, the ledge's
 *  outer lip a touch paler, the crease where the next riser rises darker. */
function hammerStepShade(step: { k: number; f: number }): number {
  const tone = (heartHash(step.k * 13 + 5, 77) - 0.5) * 0.16;
  const ledge = 1 - HAMMER_TERRACE_RISER;
  const lip = step.f < 0.12 ? 0.08 * (1 - step.f / 0.12) : 0;
  const crease = step.f > ledge - 0.14 && step.f < ledge + 0.06 ? -0.16 : 0;
  return tone + lip + crease;
}

/** Build the mountain (instance-local). */
export function buildHeartMountain(lowGfx: boolean): THREE.Mesh {
  const g = heartMountainGrid(lowGfx ? 5 : 3);
  const count = g.nx * g.nz;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let j = 0; j < g.nz; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const h = g.heights[k];
      positions[k * 3] = g.x0 + i * g.cell;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = g.z0 + j * g.cell;
      // Height tint: chasm-dark low, granite high, a mottle on top.
      const t = Math.max(0, Math.min(1, (h - HEART_MOUNTAIN_CHASM) / 150));
      if (t < 0.45) c.copy(ROCK_LOW).lerp(ROCK_MID, t / 0.45);
      else c.copy(ROCK_MID).lerp(ROCK_HIGH, (t - 0.45) / 0.55);
      c.multiplyScalar(0.82 + heartHash(i * 3 + 1, j * 5 - 7) * 0.3);
      // The Hammer vein's own granite: lifted out of the near-black (the
      // fissure's walls are what the Gallery sees), blended at its edges.
      const lift = hammerRockLift(g.x0 + i * g.cell, g.z0 + j * g.cell);
      if (lift > 0) {
        c.lerp(HAMMER_ROCK, lift * HAMMER_ROCK_MIX).multiplyScalar(
          1 + lift * (HAMMER_ROCK_GAIN - 1),
        );
        // Its beds: level strata a few yards thick running round the
        // fissure (the quarry's benches are cut along the same beds).
        c.multiplyScalar(1 + lift * hammerRockBed(g.x0 + i * g.cell, h, g.z0 + j * g.cell));
        // The stepped slope's sheer risers a value darker than its ledges
        // (the dust lies on the flats): the three-value read of a cliff.
        const at = (di: number, dj: number) => {
          const ii = Math.max(0, Math.min(g.nx - 1, i + di));
          const jj = Math.max(0, Math.min(g.nz - 1, j + dj));
          return g.heights[jj * g.nx + ii];
        };
        const steep =
          Math.max(Math.abs(at(1, 0) - at(-1, 0)), Math.abs(at(0, 1) - at(0, -1))) / (2 * g.cell);
        c.multiplyScalar(1 - lift * hammerRiserShade(steep));
        // Each step its own shade of the bed; the ledge's outer lip worn
        // pale, the crease at the next riser's foot in shadow.
        const x = g.x0 + i * g.cell;
        const z = g.z0 + j * g.cell;
        const cl = heartFloorClearance(x, z);
        const back = cl.d - (cl.path ? HEART_WALL_PATH_CLEAR : HEART_WALL_CLEAR);
        if (back > 0)
          c.multiplyScalar(1 + lift * hammerStepShade(heartHammerTerraceStep(back, x, z)));
      }
      // The Quench's frost (phase 2H): its mountain a pale cold granite.
      const frost = quenchFrostWeight(g.x0 + i * g.cell, g.z0 + j * g.cell);
      if (frost > 0)
        c.lerp(QUENCH_ROCK, frost * QUENCH_ROCK_MIX).multiplyScalar(
          1 + frost * (QUENCH_ROCK_GAIN - 1),
        );
      // The Heat's basalt (phase 2I): its mountain a sooted dark warm grey.
      const soot = heatSootWeight(g.x0 + i * g.cell, g.z0 + j * g.cell);
      if (soot > 0)
        c.lerp(HEAT_ROCK, soot * HEAT_ROCK_MIX).multiplyScalar(1 + soot * (HEAT_ROCK_GAIN - 1));
      // The Heart's crown (phase 2J): a dark warm granite round the chamber.
      const crown = heartCrownWeight(g.x0 + i * g.cell, g.z0 + j * g.cell);
      if (crown > 0)
        c.lerp(CROWN_ROCK, crown * HEART_CROWN_MIX).multiplyScalar(
          1 + crown * (HEART_CROWN_GAIN - 1),
        );
      colors[k * 3] = c.r;
      colors[k * 3 + 1] = c.g;
      colors[k * 3 + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < g.nz - 1; j++) {
    for (let i = 0; i < g.nx - 1; i++) {
      if (!heartMountainCellDrawn(g, i, j)) continue;
      const a = j * g.nx + i;
      const b = a + 1;
      const d = a + g.nx;
      const e = d + 1;
      // Alternate the diagonal (a hashed flip), so the facets never line up.
      if (heartHash(i, j) < 0.5) index.push(a, d, b, b, d, e);
      else index.push(a, d, e, a, e, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    // The shared triplanar rock (natural fracture) on the tiers that draw it:
    // the faceted mass reads as stone, not as painted card.
    detailedSurfaceMat(
      { color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: true },
      'rock',
      { strength: 0.55 },
    ),
  );
  mesh.name = 'smithHeartMountain';
  mesh.matrixAutoUpdate = false;
  return mesh;
}
