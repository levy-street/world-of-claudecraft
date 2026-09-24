// Pure hidden-valley geometry. Outdoor hoards begin in a short rock gorge,
// open through a broad reveal, and finish in a clear boss basin. The shell is
// both the collision boundary and the renderer's natural-dressing guide.

import type { Collider } from '../colliders';
import { type DungeonLayout, layoutColliders } from '../dungeon_layout';
import type { Rng } from '../rng';
import type { VaultSizeTier } from './vault_seed';

export interface HoardValleyGeometry {
  layout: DungeonLayout;
  colliders: Collider[];
  halfWidthAt: (z: number) => number;
  archetype: 'hoard_valley';
  spawnStartZ: number;
  gorgeEndZ: number;
  valleyStartZ: number;
}

const VALLEY_LENGTH = [82, 112, 140, 164] as const;
const VALLEY_WIDTH: readonly (readonly [number, number])[] = [
  [20, 24],
  [24, 29],
  [29, 34],
  [34, 37],
];

function smoothstep(t: number): number {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
}

/** Build one deterministic, obstacle-free fight envelope inside the Rift region. */
export function buildHoardValleyLayout(rng: Rng, tier: VaultSizeTier): HoardValleyGeometry {
  const zMin = -19;
  const zMax = zMin + VALLEY_LENGTH[tier] + rng.int(0, 6);
  const gorgeWidth = rng.range(8.5, 10.5);
  const valleyWidth = rng.range(VALLEY_WIDTH[tier][0], VALLEY_WIDTH[tier][1]);
  const gorgeEndZ = zMin + rng.range(31, 37);
  const valleyStartZ = gorgeEndZ + rng.range(18, 23);
  const farShoulder = valleyWidth - rng.range(0, 2.2);
  const halfWidthAt = (z: number): number => {
    if (z <= gorgeEndZ) return gorgeWidth;
    if (z < valleyStartZ) {
      return (
        gorgeWidth +
        (valleyWidth - gorgeWidth) * smoothstep((z - gorgeEndZ) / (valleyStartZ - gorgeEndZ))
      );
    }
    const farT = (z - valleyStartZ) / Math.max(1, zMax - valleyStartZ);
    return valleyWidth + (farShoulder - valleyWidth) * smoothstep(farT);
  };

  const zs: number[] = [];
  for (let z = zMin; z <= zMax; z += 4) zs.push(z);
  if (zs[zs.length - 1] !== zMax) zs.push(zMax);
  const right = zs.map((z) => ({ x: Math.round(halfWidthAt(z) * 10) / 10, z }));
  const shellPolygon = [...right, ...right.map((p) => ({ x: -p.x, z: p.z })).reverse()];
  const maxWidth = Math.max(...right.map((p) => p.x));
  const daisR = Math.min(tier === 3 ? 14 : 12.5, halfWidthAt(zMax - 18) - 3);
  const dais = { x: 0, z: zMax - 19, r: daisR };
  const layout: DungeonLayout = {
    zMin,
    zMax,
    sideWallZ: (zMin + zMax) / 2,
    sideWallHd: (zMax - zMin) / 2 + 1,
    wallX: Math.ceil(maxWidth) + 2,
    endWallHw: Math.ceil(maxWidth) + 1,
    floorHalfX: Math.ceil(maxWidth),
    doorZ: zMin + 2,
    pillars: [],
    tombs: [],
    stubs: [],
    dais,
    clutter: [],
    shellPolygon,
    shellPole: { x: 0, z: (valleyStartZ + zMax) / 2 },
  };
  return {
    layout,
    colliders: layoutColliders(layout),
    halfWidthAt,
    archetype: 'hoard_valley',
    spawnStartZ: valleyStartZ + 7,
    gorgeEndZ,
    valleyStartZ,
  };
}
