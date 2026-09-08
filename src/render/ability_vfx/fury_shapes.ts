import * as THREE from 'three';

/** A torn cutting sheet, open along the exit edge. Built once with the existing
 * crest family, never on a cast. Its lobes are material, not an area boundary. */
export function buildFuryCutShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 48,
    rows = 10;
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let col = 0; col <= columns; col++) {
      const u = col / columns;
      const taper = Math.sin(Math.PI * u);
      const tear = 0.82 + 0.12 * Math.sin(u * 43) + 0.06 * Math.sin(u * 91);
      const exit = v * taper * tear;
      positions.push(
        (u - 0.5) * 3.7,
        Math.sin(u * Math.PI) * 0.65 - 0.18 - exit * 1.45,
        (0.08 + exit * 0.2) * Math.sin(u * Math.PI) + Math.sin(u * 5.4) * 0.12,
      );
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
