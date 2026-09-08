import * as THREE from 'three';

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
