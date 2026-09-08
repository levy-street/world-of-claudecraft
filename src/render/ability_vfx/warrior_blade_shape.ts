import * as THREE from 'three';

/** A forged crescent: broad dark face, narrow raised bevel, solid back edge.
 * The contact path samples this same leading seam. */
export function warriorBladePoint(
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
): void {
  const angle = (u - 0.5) * 2.55;
  const arch = (Math.cos(angle) - Math.cos(1.275)) / (1 - Math.cos(1.275));
  const taper = Math.sin(u * Math.PI);
  out.x = (Math.sin(angle) * 2.2) / Math.sin(1.275);
  out.y = arch * 0.62 - v * taper * (0.82 + u * 0.3);
  out.z = arch * 0.55 - v * 0.05;
}

export function buildWarriorBlade(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const bands = [0, 0.1, 0.22, 0.86, 1],
    columns = 36;
  const point = { x: 0, y: 0, z: 0 };
  for (const side of [-1, 1]) {
    const start = positions.length / 3;
    for (let row = 0; row < bands.length; row++)
      for (let col = 0; col <= columns; col++) {
        const u = col / columns,
          v = bands[row];
        warriorBladePoint(u, v, point);
        const bevel = row === 0 || row === bands.length - 1;
        positions.push(
          point.x,
          point.y,
          point.z + side * (bevel ? 0.012 : 0.09) * Math.sin(u * Math.PI),
        );
        uvs.push(u, bevel ? 0 : row === 1 ? 0.18 : 0.7);
        if (row < bands.length - 1 && col < columns) {
          const a = start + row * (columns + 1) + col,
            b = a + 1,
            c = a + columns + 1,
            d = c + 1;
          indices.push(...(side > 0 ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
        }
      }
  }
  // Close the outer cutting and trailing seams across the solid thickness.
  const faceCount = bands.length * (columns + 1);
  for (const row of [0, bands.length - 1])
    for (let col = 0; col < columns; col++) {
      const a = row * (columns + 1) + col,
        b = a + 1;
      indices.push(a, b, a + faceCount, b, b + faceCount, a + faceCount);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
