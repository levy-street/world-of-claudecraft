import * as THREE from 'three';

/** Elbow-side mineral ridge in native lowerarm units. The open grip side
 * reserves the wrist, sword and shield instead of enclosing them in a cuff. */
export function warriorAvatarBracerShape(): THREE.BufferGeometry {
  const outer = 0.42,
    inner = 0.11,
    start = -0.015,
    end = 0.08;
  const profile = [
    [inner, start + 0.015],
    [inner + 0.015, start],
    [outer - 0.025, start],
    [outer, start + 0.025],
    [outer * 0.9, end - 0.025],
    [outer * 0.9 - 0.02, end],
    [inner + 0.01, end],
    [inner, end - 0.01],
  ];
  const vertices: THREE.Vector3[] = [],
    positions: number[] = [],
    colors: number[] = [],
    uv: number[] = [];
  const steps = 12,
    count = profile.length,
    begin = (Math.PI * 16) / 9,
    sweep = Math.PI / 6;
  const color = new THREE.Color();
  for (let step = 0; step <= steps; step++) {
    const theta = begin + (sweep * step) / steps;
    for (const [radius, y] of profile)
      vertices.push(new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius));
  }
  function face(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint: number) {
    color.setHex(tint);
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
      uv.push(0.3 + p.x, 0.5 + p.z + p.y * 0.7);
    }
  }
  for (let step = 0; step < steps; step++)
    for (let i = 0; i < count; i++) {
      const a = vertices[step * count + i],
        b = vertices[(step + 1) * count + i];
      const c = vertices[(step + 1) * count + ((i + 1) % count)],
        d = vertices[step * count + ((i + 1) % count)];
      const tint = i === 2 || i === 4 ? 0xd7cbb0 : i === 3 ? 0x99a392 : 0x7e8d80;
      face(a, d, c, tint);
      face(a, c, b, tint);
    }
  for (const step of [0, steps]) {
    const center = vertices
      .slice(step * count, step * count + count)
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .multiplyScalar(1 / count);
    for (let i = 0; i < count; i++) {
      const a = vertices[step * count + i],
        b = vertices[step * count + ((i + 1) % count)];
      if (step === 0) face(center, b, a, 0xa2ad99);
      else face(center, a, b, 0xa2ad99);
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
