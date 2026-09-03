// The Nythraxis flame tongue: two crossed flame quads, the same silhouette as
// the meteor telegraph's rim flame, so an eruption's bone-shard burst hands off
// to a fire of the same read. One geometry shared by every Grave Flame and
// Soulfire patch and every Gravefire line (built once at module load, never
// disposed per visual). It lives in its own module so the patch painter and the
// line painter can both import it without importing each other.

import * as THREE from 'three';
import { METEOR_FLAME_GEOMETRY_HALF_HEIGHT } from './mage_ground_fx';

/** Tallest tongue any painter poses, in world units, for bounding spheres. */
export const NYTHRAXIS_FLAME_TONGUE_MAX_HEIGHT = METEOR_FLAME_GEOMETRY_HALF_HEIGHT * 2;

export function buildNythraxisFlameTongueGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let plane = 0; plane < 2; plane++) {
    const offset = vertices.length / 3;
    const points = [
      [-0.18, -0.44],
      [0.18, -0.44],
      [0.12, 0.02],
      [0.055, 0.46],
      [-0.11, 0.05],
    ] as const;
    for (const [horizontal, y] of points) {
      if (plane === 0) vertices.push(horizontal, y, 0);
      else vertices.push(0, y, horizontal);
    }
    indices.push(
      offset,
      offset + 1,
      offset + 2,
      offset,
      offset + 2,
      offset + 4,
      offset + 2,
      offset + 3,
      offset + 4,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The shared tongue mesh. Painters instance it; nobody disposes it. */
export const NYTHRAXIS_FLAME_TONGUE_GEOMETRY = buildNythraxisFlameTongueGeometry();
