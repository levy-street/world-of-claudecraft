import * as THREE from 'three';

/** Opposed widening blade wakes: open centre, rising cutting edge and torn
 * red trailing face. The authored outer reach is the actual eight-yard AoE. */
export function warriorGyrePoint(
  blade: number,
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
): void {
  const angle = blade * Math.PI + u * 2.2 - 0.65;
  const taper = Math.max(0, Math.sin(u * Math.PI)) ** 0.55;
  const radius =
    1.6 + 6.4 * Math.sin(u * Math.PI * 0.5) - v * taper * (1.55 + 0.18 * Math.sin(u * 23));
  out.x = Math.sin(angle) * radius;
  out.z = Math.cos(angle) * radius;
  out.y = 0.82 + blade * 0.24 + Math.sin(u * Math.PI) * 0.35 - v * taper * 0.18;
}
export function warriorGyreShape(): THREE.BufferGeometry {
  const pos: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const point = { x: 0, y: 0, z: 0 },
    columns = 52,
    rows = [0, 0.08, 0.24, 0.85, 1];
  for (let blade = 0; blade < 2; blade++) {
    const start = pos.length / 3,
      faceCount = (columns + 1) * rows.length;
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let r = 0; r < rows.length; r++)
        for (let c = 0; c <= columns; c++) {
          const u = c / columns,
            edge = r === 0 || r === rows.length - 1;
          warriorGyrePoint(blade, u, rows[r], point);
          pos.push(
            point.x,
            point.y + side * (edge ? 0.009 : 0.043) * Math.sin(u * Math.PI),
            point.z,
          );
          uv.push(u, rows[r]);
          if (r < rows.length - 1 && c < columns) {
            const a = base + r * (columns + 1) + c,
              b = a + 1,
              k = a + columns + 1,
              d = k + 1;
            indices.push(...(side > 0 ? [a, b, k, b, d, k] : [a, k, b, b, k, d]));
          }
        }
    }
    for (const r of [0, rows.length - 1])
      for (let c = 0; c < columns; c++) {
        const a = start + r * (columns + 1) + c,
          b = a + 1;
        indices.push(a, b, a + faceCount, b, b + faceCount, a + faceCount);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
