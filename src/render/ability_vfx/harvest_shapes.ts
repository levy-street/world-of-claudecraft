import * as THREE from 'three';

/** Red Harvest's extraction is a collection of curled, torn lobes with open
 * space between them. Local +Y rises, +Z exits through the receiving body. */
export function buildHarvestShape(eruption: boolean): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 40,
    rows = 6;
  const lobes = eruption ? 7 : 3;
  for (let lobe = 0; lobe < lobes; lobe++) {
    const base = positions.length / 3;
    const side = lobe % 2 ? -1 : 1;
    const pair = Math.floor(lobe / 2);
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const bend = Math.sin(u * Math.PI * 0.85);
      const length = eruption ? (pair === 0 ? 6.3 : pair === 1 ? 4.5 : 3.1) : 4.7;
      const width =
        Math.sin(Math.PI * u) ** 0.7 *
        (eruption ? (pair === 0 ? 1.55 : pair === 1 ? 0.8 : 0.42) : 0.95);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const torn = 0.72 + 0.18 * Math.sin(u * 41 + lobe) + 0.12 * Math.sin(u * 89);
        const fold = Math.sin(v * 5.1 + u * 8 + lobe) * width * 0.21;
        if (eruption) {
          // Outer hooks bend back inward at the tips, with unequal inner jets.
          const spread = pair === 0 ? 3.6 : pair === 1 ? 2.4 : 1.4;
          const x = side * (0.12 + spread * bend + (v - 0.5) * width * torn);
          positions.push(
            x,
            u * length + fold - v * width * 0.5,
            u * (1.4 + pair * 0.28) + Math.sin(u * 5.5 + lobe) * width * 0.7 + v * width,
          );
        } else {
          const a = (u - 0.5) * 2.65;
          const arc = Math.cos(a) - Math.cos(1.325);
          positions.push(
            Math.sin(a) * length * 0.52,
            arc * 0.75 - v * width * torn + fold - lobe * 0.16,
            arc * 0.85 + v * width * 0.65 + lobe * 0.15,
          );
        }
        uvs.push(u, v);
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
