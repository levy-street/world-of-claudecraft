import * as THREE from 'three';

export type WarriorAreaShape = 'steel_storm' | 'steel_reap';

/** Open forged blades, not an expanding circular outline. The storm carries
 * three separated helical fins; Reaping Arc is one long, tapered steel sweep. */
export function warriorAreaPoint(
  kind: WarriorAreaShape,
  blade: number,
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
): void {
  const storm = kind === 'steel_storm';
  const angle = (storm ? (blade * Math.PI * 2) / 3 : 0) + u * (storm ? 1.9 : 5.82);
  const taper = Math.max(0, Math.sin(u * Math.PI)) ** 0.7;
  const radius =
    (storm ? 6 : 5) -
    (1 - taper) * (storm ? 1.9 : 0.5) -
    v * taper * (storm ? 1.35 + 1.6 * (1 - u) : 1.35);
  out.x = Math.sin(angle) * radius;
  out.z = Math.cos(angle) * radius;
  out.y =
    (storm ? 0.45 + blade * 0.3 : 0.95) +
    Math.sin(u * Math.PI) * (storm ? 1.2 : 0.7) -
    v * taper * (storm ? 0.9 : 0.38);
}

export function buildWarriorArea(kind: WarriorAreaShape): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = kind === 'steel_storm' ? 36 : 84;
  const rows = [0, 0.1, 0.24, 0.88, 1];
  const point = { x: 0, y: 0, z: 0 };
  for (let blade = 0; blade < (kind === 'steel_storm' ? 3 : 1); blade++) {
    const bladeStart = positions.length / 3;
    const faceCount = rows.length * (columns + 1);
    for (const side of [-1, 1]) {
      const base = positions.length / 3;
      for (let row = 0; row < rows.length; row++)
        for (let col = 0; col <= columns; col++) {
          const u = col / columns,
            bevel = row === 0 || row === rows.length - 1;
          warriorAreaPoint(kind, blade, u, rows[row], point);
          positions.push(
            point.x,
            point.y + side * (bevel ? 0.012 : 0.065) * Math.sin(u * Math.PI),
            point.z,
          );
          uvs.push(u, bevel ? 0 : row === 1 ? 0.18 : 0.7);
          if (row < rows.length - 1 && col < columns) {
            const a = base + row * (columns + 1) + col,
              b = a + 1,
              c = a + columns + 1,
              d = c + 1;
            indices.push(...(side > 0 ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
          }
        }
    }
    for (const row of [0, rows.length - 1])
      for (let col = 0; col < columns; col++) {
        const a = bladeStart + row * (columns + 1) + col,
          b = a + 1;
        indices.push(a, b, a + faceCount, b, b + faceCount, a + faceCount);
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
