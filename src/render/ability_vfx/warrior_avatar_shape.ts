import * as THREE from 'three';

/** Native chest-local V-neck, reserving the helmet and crossed grip sweep.
 * Facet rings remain a closed volume rather than a translucent body repaint. */
export function warriorAvatarChestShape(): THREE.BufferGeometry {
  return avatarBeveledShell(
    [
      [-0.34, 0.03],
      [-0.13, 0.045],
      [0, -0.045],
      [0.13, 0.045],
      [0.34, 0.03],
      [0.34, -0.15],
      [0.2448, -0.3],
      [0, -0.335],
      [-0.2448, -0.3],
      [-0.34, -0.15],
    ],
    [0, -0.15],
    0.08,
    0.2,
  );
}

function avatarBeveledShell(
  outline: number[][],
  center: number[],
  back: number,
  front: number,
): THREE.BufferGeometry {
  const area = outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  if (area < 0) outline.reverse();
  const vertices: THREE.Vector3[] = [],
    positions: number[] = [],
    colors: number[] = [],
    uv: number[] = [];
  const count = outline.length,
    color = new THREE.Color();
  for (const [factor, z] of [
    [0.9, back],
    [1, back + 0.025],
    [1, front - 0.025],
    [0.85, front],
  ])
    for (const [x, y] of outline)
      vertices.push(
        new THREE.Vector3(
          center[0] + (x - center[0]) * factor,
          center[1] + (y - center[1]) * factor,
          z,
        ),
      );
  function face(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint: number) {
    color.setHex(tint);
    for (const p of [a, b, c]) {
      // Convex sternum follows the actual breastplate; recessed sides reserve
      // the hands. A flat plate at this depth would be buried in the body.
      positions.push(p.x, p.y, p.z + 0.22 * Math.max(0, 1 - (p.x / 0.34) ** 2));
      colors.push(color.r, color.g, color.b);
      uv.push(0.4 + p.x * 0.6, 0.5 + p.y * 0.8);
    }
  }
  for (let ring = 0; ring < 3; ring++)
    for (let i = 0; i < count; i++) {
      const a = vertices[ring * count + i],
        b = vertices[ring * count + ((i + 1) % count)];
      const c = vertices[(ring + 1) * count + ((i + 1) % count)],
        d = vertices[(ring + 1) * count + i];
      const tint = ring === 1 ? 0x727e76 : ring === 2 ? 0xd5cdb7 : 0x969d8e;
      face(a, b, c, tint);
      face(a, c, d, tint);
    }
  for (const ring of [0, 3]) {
    const point = new THREE.Vector3(center[0], center[1], ring === 0 ? back : front);
    for (let i = 0; i < count; i++) {
      const a = vertices[ring * count + i],
        b = vertices[ring * count + ((i + 1) % count)];
      if (ring === 0) face(point, b, a, 0x76817a);
      else face(point, a, b, i % 3 === 0 ? 0xadb49f : 0xa0a796);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Asymmetric weathered bedrock with broad mineral facets on every side. */
export function warriorAvatarShape(): THREE.BufferGeometry {
  const rings = [
    [0, 0.18, 0.22, -0.06],
    [0.24, 0.45, 0.36, 0],
    [0.88, 0.4, 0.46, 0.08],
    [0.925, 0.37, 0.425, 0.08],
    [0.97, 0.41, 0.47, 0.08],
    [1.64, 0.32, 0.35, -0.08],
    [2.03, 0.19, 0.25, 0.03],
  ];
  const vertices = rings.map(([y, rx, rz, ox], ring) =>
    Array.from({ length: 8 }, (_, side) => {
      const angle = (side * Math.PI) / 4 + 0.16;
      return new THREE.Vector3(
        ox + Math.cos(angle) * rx,
        y + (ring === 6 ? Math.sin(side * 2.3) * 0.14 : (side % 2) * 0.055),
        Math.sin(angle) * rz,
      );
    }),
  );
  const p: number[] = [],
    colors: number[] = [],
    uv: number[] = [];
  const palette = [0xb6b1a0, 0x8e948d, 0xc0b59c, 0x939d99, 0xa4a492, 0xc3bca8, 0x8e9790, 0xb0b4a3];
  const color = new THREE.Color();
  function tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint: number) {
    color.setHex(tint);
    for (const point of [a, b, c]) {
      p.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
      // Use the material interior, keeping dark atlas borders off the outline.
      uv.push(0.35 + point.x * 0.15 + point.z * 0.12, 0.35 + point.y * 0.12);
    }
  }
  for (let ring = 0; ring < vertices.length - 1; ring++)
    for (let side = 0; side < 8; side++) {
      const next = (side + 1) % 8,
        a = vertices[ring][side],
        b = vertices[ring][next],
        c = vertices[ring + 1][next],
        d = vertices[ring + 1][side];
      const tint = ring === 2 || ring === 3 ? 0x596962 : palette[(side + ring) % palette.length];
      tri(a, c, b, tint);
      tri(a, d, c, tint);
    }
  for (const end of [0, vertices.length - 1]) {
    const center = vertices[end]
      .reduce((sum, v) => sum.add(v), new THREE.Vector3())
      .multiplyScalar(1 / 8);
    for (let side = 0; side < 8; side++) {
      const next = (side + 1) % 8;
      if (end === 0) tri(center, vertices[end][side], vertices[end][next], 0x7c8a81);
      else tri(center, vertices[end][next], vertices[end][side], palette[side]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
