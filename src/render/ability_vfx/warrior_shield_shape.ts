import * as THREE from 'three';

/** Six thick beveled steel plates, with open seams and a pointed lower crest.
 * This is an instantaneous shield contact sculpture, not a persistent barrier. */
export function buildWarriorShield(): THREE.BufferGeometry {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [];
  const triangle = (a: number[], b: number[], c: number[], values: number[]) => {
    const normal = new THREE.Vector3()
      .fromArray(b)
      .sub(new THREE.Vector3().fromArray(a))
      .cross(new THREE.Vector3().fromArray(c).sub(new THREE.Vector3().fromArray(a)))
      .normalize();
    positions.push(...a, ...b, ...c);
    normals.push(...normal.toArray(), ...normal.toArray(), ...normal.toArray());
    for (let i = 0; i < 3; i++) uvs.push(([a, b, c][i][0] + 1.15) / 2.3, values[i]);
  };
  for (const side of [-1, 1])
    for (let row = 0; row < 3; row++) {
      const top = 1.18 - row * 0.63;
      const outer = [1.03, 0.91, 0.65][row];
      const polygon = [
        [0.045, top - 0.23],
        [outer, top],
        [outer * 0.78, top - 0.49],
        [0.045, top - 0.84],
      ];
      const center = polygon.reduce((sum, p) => [sum[0] + p[0] / 4, sum[1] + p[1] / 4], [0, 0]);
      const rim = polygon.map(([x, y]) => [x * side, y, 0.45 - x * 0.62]);
      const inset = polygon.map(([x, y]) => [
        (center[0] + (x - center[0]) * 0.85) * side,
        center[1] + (y - center[1]) * 0.85,
        0.51 - x * 0.62,
      ]);
      const back = rim.map(([x, y, z]) => [x, y, z - 0.14]);
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        triangle(rim[i], rim[next], inset[i], [0, 0, 0.2]);
        triangle(rim[next], inset[next], inset[i], [0, 0.2, 0.2]);
        triangle(back[i], back[next], rim[i], [1, 1, 0.65]);
        triangle(back[next], rim[next], rim[i], [1, 0.65, 0.65]);
      }
      triangle(inset[0], inset[1], inset[2], [0.7, 0.7, 0.7]);
      triangle(inset[0], inset[2], inset[3], [0.7, 0.7, 0.7]);
      triangle(back[0], back[2], back[1], [1, 1, 1]);
      triangle(back[0], back[3], back[2], [1, 1, 1]);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}
