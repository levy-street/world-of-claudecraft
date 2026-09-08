import * as THREE from 'three';

export type WarriorPressureKind = 'rally_pressure' | 'dread_pressure' | 'challenge_pressure';

/** Three intersecting curved voice fans give the painted air density volume.
 * Dust owns surrounding displacement; these pointed fans project from the mouth. */
export function buildWarriorPressure(kind: WarriorPressureKind): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 24,
    rows = 8;
  for (let layer = 0; layer < 3; layer++) {
    const base = positions.length / 3;
    const bank = (layer - 1) * (kind === 'dread_pressure' ? 0.28 : 0.5);
    for (let column = 0; column <= columns; column++)
      for (let row = 0; row <= rows; row++) {
        const u = column / columns,
          v = row / rows;
        const width = (0.2 + u * 5.6) * (v * 2 - 1);
        const curl =
          Math.sin(u * Math.PI) *
          (kind === 'rally_pressure' ? 1.3 : kind === 'dread_pressure' ? 0.4 : 0.85);
        const y = curl + Math.sin(bank) * width + u * Math.abs(Math.sin(bank)) * 5.8;
        positions.push(
          Math.cos(bank) * width,
          y,
          u * 9 - u * u * Math.abs(v - 0.5) * 2.5 + Math.sin(u * Math.PI) * Math.abs(v - 0.5),
        );
        uvs.push(u, v);
        if (column < columns && row < rows) {
          const i = base + column * (rows + 1) + row;
          indices.push(i, i + rows + 1, i + 1, i + 1, i + rows + 1, i + rows + 2);
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
