import * as THREE from 'three';

/** Red Harvest's extraction is a collection of curled, torn lobes with open
 * space between them. Local +Y rises, +Z exits through the receiving body. */
export function buildHarvestShape(eruption: boolean): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const columns = 64,
    rows = 12;
  const lobes = eruption ? 7 : 3;
  for (let lobe = 0; lobe < lobes; lobe++) {
    const base = positions.length / 3;
    const side = lobe % 2 ? -1 : 1;
    const pair = Math.floor(lobe / 2);
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const bend = Math.sin(u * Math.PI * 0.68);
      const length = eruption ? [7.1, 6.4, 5.5, 4.8, 3.8, 4.2, 3.2][lobe] : 4.7;
      const width =
        Math.sin(Math.PI * u) ** 0.7 *
        (eruption ? (pair === 0 ? 0.78 : pair === 1 ? 0.5 : 0.3) : 0.95);
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const torn = 0.72 + 0.18 * Math.sin(u * 41 + lobe) + 0.12 * Math.sin(u * 89);
        const fold = Math.sin(v * 5.1 + u * 8 + lobe) * width * 0.21;
        if (eruption) {
          // Unequal volumetric ligaments, with swollen heads and pinched necks.
          // The open middle lets the receiving body survive the silhouette.
          const spread = [4.1, 3.7, 3.15, 3.45, 2.3, 2.8, 1.65][lobe];
          const neck = 0.7 + 0.19 * Math.sin(u * 13 + lobe * 2.1);
          const head = Math.sqrt(Math.max(0, 1 - ((u - 0.79) / 0.21) ** 2));
          const thickness = pair === 0 ? 0.78 : pair === 1 ? 0.5 : 0.3;
          const radius = thickness * (Math.sin(Math.PI * u) ** 0.45 * neck * 0.52 + head * 0.64);
          const turn = v * Math.PI * 2 + u * 5 + lobe;
          const x = side * (0.08 + spread * bend) + Math.cos(turn) * radius;
          positions.push(
            x,
            u * length + Math.sin(turn) * radius * 0.34,
            u * (0.7 + pair * 0.5) +
              Math.sin(u * 4 + lobe) * width * 0.65 +
              Math.sin(turn) * radius,
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
  if (eruption) {
    // UVs wrap here, but liquid lighting must remain continuous around the tube.
    const normals = geometry.getAttribute('normal');
    const seam = new THREE.Vector3();
    for (let lobe = 0; lobe < lobes; lobe++) {
      for (let i = 0; i <= columns; i++) {
        const first = (lobe * (columns + 1) + i) * (rows + 1);
        const last = first + rows;
        seam
          .set(
            normals.getX(first) + normals.getX(last),
            normals.getY(first) + normals.getY(last),
            normals.getZ(first) + normals.getZ(last),
          )
          .normalize();
        normals.setXYZ(first, seam.x, seam.y, seam.z);
        normals.setXYZ(last, seam.x, seam.y, seam.z);
      }
    }
  }
  geometry.computeBoundingSphere();
  return geometry;
}
