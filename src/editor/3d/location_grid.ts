import * as THREE from 'three';

export const LOCATION_GRID_CELL_SIZE = 5;
export const LOCATION_GRID_MAX_INTERVALS = 64;

interface LocationBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** One material is shared by every location and retained across grid refreshes. */
export function createLocationGridMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color: 0xa7a7a7,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
}

/** Neutral authoring lines, with no filled surface over the landscape. The
 *  border belongs to the same bounded line geometry as the inner grid. */
export function createLocationGrid(
  bounds: LocationBounds,
  groundY: number,
  material: THREE.LineBasicMaterial,
): THREE.LineSegments | null {
  const { minX, maxX, minZ, maxZ } = bounds;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (![minX, maxX, minZ, maxZ, groundY, width, depth].every(Number.isFinite)) return null;
  if (width <= 0 || depth <= 0) return null;
  const nx = Math.min(LOCATION_GRID_MAX_INTERVALS, Math.ceil(width / LOCATION_GRID_CELL_SIZE));
  const nz = Math.min(LOCATION_GRID_MAX_INTERVALS, Math.ceil(depth / LOCATION_GRID_CELL_SIZE));
  const positions = new Float32Array((nx + nz + 2) * 6);
  let offset = 0;
  for (let step = 0; step <= nx; step++) {
    const x = -width / 2 + (step * width) / nx;
    positions.set([x, 0, -depth / 2, x, 0, depth / 2], offset);
    offset += 6;
  }
  for (let step = 0; step <= nz; step++) {
    const z = -depth / 2 + (step * depth) / nz;
    positions.set([-width / 2, 0, z, width / 2, 0, z], offset);
    offset += 6;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const grid = new THREE.LineSegments(geometry, material);
  grid.position.set((minX + maxX) / 2, groundY + 0.25, (minZ + maxZ) / 2);
  grid.renderOrder = 2;
  return grid;
}

/** Drop per-location GPU geometry while retaining the viewport-owned material. */
export function disposeLocationGrids(group: THREE.Group | null): null {
  if (!group) return null;
  group.removeFromParent();
  group.traverse((object) => {
    const line = object as THREE.Line;
    if (line.isLine) line.geometry.dispose();
  });
  group.clear();
  return null;
}
