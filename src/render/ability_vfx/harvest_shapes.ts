import * as THREE from 'three';

/** Open blade membranes. All layers follow one sweep, with no closed tubes.
 * Local X travels across the cut; +Z carries its bow away from the caster. */
export function buildHarvestShape(finisher: boolean): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 64,
    rows = 12,
    layers = finisher ? 7 : 3;
  for (let layer = 0; layer < layers; layer++) {
    const base = positions.length / 3;
    const reach = finisher ? 5.3 : 3.1;
    const start = [0, 0.03, 0.44, 0.7, 0.2, 0.5, 0.84][layer];
    const end = [1, 0.31, 0.8, 0.98, 0.49, 0.67, 0.96][layer];
    const offset = [0, 0.18, 0.09, 0.34, 0.46, 0.23, 0.52][layer];
    const breadth = layer === 0 ? 1.05 : layer < 3 ? 0.32 : 0.16;
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const along = start + (end - start) * u;
      const angle = (along - 0.5) * 2.65;
      // The middle of the cutting edge passes through the receiving contact.
      const bow = Math.cos(angle) - 1;
      const taper = Math.sin(Math.PI * u) ** 0.7;
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const torn = 0.76 + 0.15 * Math.sin(u * 43 + layer) + 0.09 * Math.sin(u * 97);
        const width = breadth * taper * torn;
        positions.push(
          Math.sin(angle) * reach,
          bow * 0.5 - v * width - offset + Math.sin(u * 17 + v * 4 + layer) * width * 0.08 * v,
          bow * (finisher ? 1.8 : 1.05) + v * width * 0.25 + layer * 0.06,
        );
        uvs.push(along, v);
        if (i < columns && j < rows) {
          const n = base + i * (rows + 1) + j;
          indices.push(n, n + rows + 1, n + 1, n + 1, n + rows + 1, n + rows + 2);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
