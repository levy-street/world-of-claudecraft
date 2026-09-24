import * as THREE from 'three';

/** Curved leading seam and curled, ragged trailing film. The visible hot edge
 * samples this same surface so it cannot detach from its blood backing. */
export function furyCutSurfacePoint(
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
): void {
  const angle = (u - 0.5) * 2.6;
  const arch = (Math.cos(angle) - Math.cos(1.3)) / (1 - Math.cos(1.3));
  const taper = Math.sin(Math.PI * u);
  const tear = 0.84 + 0.11 * Math.sin(u * 43) + 0.07 * Math.sin(u * 91);
  const film = v * taper * tear;
  const curl = Math.sin(v * 2.8 + u * 7.5) * film * 0.22;
  out.x = Math.sin(angle) * (1.85 / Math.sin(1.3)) + curl * 0.35;
  out.y = arch * 0.46 - 0.18 - film * (1.3 + u * 0.3) + curl;
  out.z = arch * 0.52 + film * 0.48 + Math.sin(u * 8.4) * film * 0.21;
}

/** A torn cutting sheet, open along the exit edge. Built once with the existing
 * crest family, never on a cast. Its lobes are material, not an area boundary. */
export function buildFuryCutShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 48,
    rows = 10;
  const point = { x: 0, y: 0, z: 0 };
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let col = 0; col <= columns; col++) {
      const u = col / columns;
      furyCutSurfacePoint(u, v, point);
      positions.push(point.x, point.y, point.z);
      uvs.push(u, v);
      if (row < rows && col < columns) {
        const i = row * (columns + 1) + col;
        indices.push(i, i + 1, i + columns + 1, i + 1, i + columns + 2, i + columns + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
