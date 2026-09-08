import * as THREE from 'three';

/** Broken radial bedrock, with an open landing pocket. Five unequal fault
 * clusters split into twenty raised slabs inside the actual six-yard area.
 * Every stone is closed and bevelled; no continuous disc or enclosing rim. */
export function warriorLeapShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [];
  const cross = new THREE.Vector3(),
    edge = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0),
    down = new THREE.Vector3(0, -1, 0);
  const face = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    normal: THREE.Vector3,
    bevel: boolean,
  ) => {
    cross.subVectors(b, a).cross(edge.subVectors(c, a));
    const vertices = cross.dot(normal) >= 0 ? [a, b, c] : [a, c, b];
    for (const p of vertices) positions.push(p.x, p.y, p.z);
    uvs.push(0, bevel ? 0.01 : 0.65, 1, bevel ? 0.01 : 0.65, 0.5, bevel ? 0.07 : 0.65);
  };
  const stone = (polygon: THREE.Vector3[]) => {
    const center = polygon
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .multiplyScalar(1 / polygon.length);
    const rings = [
      polygon.map((p) => new THREE.Vector3(p.x, 0.035, p.z)),
      polygon.map((p) => new THREE.Vector3(p.x, Math.max(0.045, p.y - 0.085), p.z)),
      polygon.map(
        (p) =>
          new THREE.Vector3(
            center.x + (p.x - center.x) * 0.91,
            p.y,
            center.z + (p.z - center.z) * 0.91,
          ),
      ),
    ];
    for (let ring = 0; ring < 2; ring++)
      for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        const a = rings[ring][i],
          b = rings[ring][j],
          c = rings[ring + 1][j],
          d = rings[ring + 1][i];
        const outward = a.clone().add(b).multiplyScalar(0.5).sub(center);
        outward.y = 0;
        face(a, b, c, outward, ring === 1);
        face(a, c, d, outward, ring === 1);
      }
    for (const end of [0, 2]) {
      const middle = rings[end]
        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
        .multiplyScalar(1 / polygon.length);
      for (let i = 0; i < polygon.length; i++)
        face(middle, rings[end][i], rings[end][(i + 1) % polygon.length], end ? up : down, false);
    }
  };
  const polar = (radius: number, angle: number, y: number) =>
    new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  const clusters = [0.18, 1.33, 2.8, 3.9, 5.3];
  for (let i = 0; i < clusters.length; i++) {
    const angle = clusters[i];
    const height = 1.24 + (i % 3) * 0.19;
    // Each dominant slab is broad and broken off before the area edge. The
    // detached outer pieces make fractured earth, rather than connected spokes.
    stone([
      polar(1.65 + (i % 2) * 0.22, angle - 0.18, height * 0.72),
      polar(2.7 + (i % 2) * 0.28, angle - 0.3, height),
      polar(4.35 + (i % 2) * 0.35, angle - 0.19, 0.31),
      polar(4.1, angle + 0.1, 0.16),
      polar(3.05, angle + 0.29, height * 0.66),
      polar(1.75, angle + 0.16, height * 0.42),
    ]);
    stone([
      polar(4.5, angle - 0.19, 0.46),
      polar(5.73 + (i % 2) * 0.16, angle - 0.23, 0.2),
      polar(5.55, angle + 0.06, 0.12),
      polar(4.42, angle + 0.14, 0.73),
    ]);
    stone([
      polar(2.32, angle + 0.46, 0.36),
      polar(3.37, angle + 0.36, 0.82 + (i % 2) * 0.22),
      polar(4.4, angle + 0.53, 0.24),
      polar(3.15, angle + 0.79, 0.14),
    ]);
    stone([
      polar(4.72, angle + 0.48, 0.15),
      polar(5.84, angle + 0.43, 0.28),
      polar(5.62, angle + 0.69, 0.12),
      polar(4.86, angle + 0.75, 0.42),
    ]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
