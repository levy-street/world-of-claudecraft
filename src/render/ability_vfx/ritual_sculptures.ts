import * as THREE from 'three';

/** Three additional prepared geometries share the existing eight crest slots
 * and shader. They give bone, plate and feather rites actual shaded volume. */
export function buildRitualSculpture(kind: 'bone' | 'ward' | 'feather'): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const surface = (
    rows: number,
    cols: number,
    point: (u: number, v: number) => [number, number, number],
  ) => {
    const base = positions.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const u = i / cols,
          v = j / rows;
        positions.push(...point(u, v));
        uvs.push(u, v);
        if (i < cols && j < rows) {
          const n = base + j * (cols + 1) + i;
          indices.push(n, n + 1, n + cols + 1, n + 1, n + cols + 2, n + cols + 1);
        }
      }
  };
  if (kind === 'bone') {
    // Six opposing, tapered ribs with a gap along the sternum; curved solid
    // cross-sections catch the scene light instead of forming emissive rings.
    for (let row = 0; row < 3; row++)
      for (const side of [-1, 1])
        surface(14, 6, (u, v) => {
          const angle = (v * 0.92 - 0.18) * Math.PI;
          const radius = 0.055 * (0.45 + Math.sin(v * Math.PI) * 0.55);
          const cross = u * Math.PI * 2;
          return [
            side * (0.08 + Math.sin(angle) * (0.5 - row * 0.055)) * 2 + Math.cos(cross) * radius,
            0.25 + row * 0.21 + Math.sin(angle) * 0.07 + Math.sin(cross) * radius,
            Math.cos(angle) * (0.36 - row * 0.03) * 2,
          ];
        });
  } else if (kind === 'ward') {
    for (let k = 0; k < 3; k++) {
      const angle = (k - 1) * 0.72;
      surface(6, 8, (u, v) => {
        const taper = v < 0.25 ? 0.4 + v * 2.4 : 1 - (v - 0.25) * 0.95;
        const px = (u - 0.5) * 0.95 * taper,
          py = 1.02 - v * 0.9;
        const pz = 1.05 + Math.sin(u * Math.PI) * 0.06 + (k % 2) * 0.035;
        return [
          Math.cos(angle) * px + Math.sin(angle) * pz,
          py,
          -Math.sin(angle) * px + Math.cos(angle) * pz,
        ];
      });
    }
  } else {
    for (let k = 0; k < 4; k++)
      for (const side of [-1, 1])
        surface(16, 6, (u, v) => {
          const width = Math.sin(v * Math.PI) * (0.15 - k * 0.008);
          const barb = Math.sin(v * 64 + k) * 0.025 + 0.96;
          const px = side * (0.28 + k * 0.2 + Math.sin(v * Math.PI * 0.65) * (0.6 + k * 0.07));
          return [
            px + (u - 0.5) * 2 * width * barb,
            0.3 + v * (0.7 - k * 0.055),
            -0.18 - k * 0.065 + Math.sin(v * Math.PI) * 0.14 + (u - 0.5) * width * 0.45,
          ];
        });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
