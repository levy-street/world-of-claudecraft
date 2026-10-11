import * as THREE from 'three';

export type IronguardShape = 'iron_counter' | 'iron_quake' | 'iron_fault' | 'breach_wedge';

/** The live cone uses a 2.2-radian half angle. Its broad shoulders must not
 * become a narrow cinematic wedge. All three actions reach eight yards. */
export function ironguardPath(
  kind: IronguardShape,
  branch: number,
  u: number,
  out: { x: number; y: number; z: number },
): void {
  if (kind === 'iron_counter') {
    const angle = -2.2 + (branch + u) * 1.1;
    const radius = 8 - Math.sin(u * Math.PI) * 0.42;
    out.x = Math.sin(angle) * radius;
    out.z = Math.cos(angle) * radius;
    out.y = 0.5 + Math.sin((branch + u) * Math.PI * 0.25) * 0.55;
    return;
  }
  const angle = kind === 'iron_quake' ? (branch * Math.PI) / 6 : -2.2 + (branch * 4.4) / 6;
  const r = 0.65 + u * 7.35;
  // Angular breaks belong to masonry under compression, not lightning noise.
  const tooth =
    kind === 'iron_fault' && (branch === 0 || branch === 6)
      ? 0
      : Math.sin(Math.floor(u * 8) * 2.4 + branch) * Math.sin(u * Math.PI) * 0.28;
  out.x = Math.sin(angle) * r + Math.cos(angle) * tooth;
  out.z = Math.cos(angle) * r - Math.sin(angle) * tooth;
  out.y = 0.045;
}

/** Faceted plates have dark scored faces, bevels and solid thickness. They
 * are prepared once and borrow the existing eight sculpture slots. */
export function buildIronguardShape(kind: IronguardShape): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  let plateIndex = 0;
  function face(a: number[], b: number[], c: number[], bevel: boolean) {
    const start = positions.length / 3;
    positions.push(...a, ...b, ...c);
    uvs.push(0, bevel ? 0 : 0.7, 1, bevel ? 0 : 0.7, 0.5, bevel ? 0.15 : 0.7);
    indices.push(start, start + 1, start + 2);
  }
  function plate(angle: number, near: number, far: number, width: number, height: number) {
    const seed = ++plateIndex;
    // Broad split slabs, oblique wedges and narrow teeth share a closed mesh
    // budget, but never the same roof or silhouette. Variation is authored at
    // preparation, so combat does not allocate or regenerate geometry.
    const cut = 0.5 + 0.5 * Math.sin(seed * 2.399963);
    const lean = Math.sin(seed * 1.73) * width * 0.48;
    const shoulder = 0.35 + cut * 0.55;
    const firstUv = uvs.length;
    const sin = Math.sin(angle),
      cos = Math.cos(angle);
    const point = (side: number, y: number, radius: number) => {
      const x = sin * radius + cos * side,
        z = cos * radius - sin * side;
      const a =
        kind === 'iron_fault' ? Math.max(-2.2, Math.min(2.2, Math.atan2(x, z))) : Math.atan2(x, z);
      const r = Math.min(8, Math.hypot(x, z));
      return [Math.sin(a) * r, y, Math.cos(a) * r];
    };
    const a = point(-width * (0.72 + cut * 0.28), height * (0.18 + cut * 0.38), near),
      b = point(width, height * (0.62 - cut * 0.31), near + cut * 0.12);
    const c = point(width * shoulder, height * (0.38 + cut * 0.56), far - 0.18 - cut * 0.38);
    const d = point(
        kind === 'iron_quake' && far === 8 && Math.abs(Math.sin(angle)) < 1e-6 ? 0 : lean,
        height,
        far,
      ),
      e = point(-width * (1.02 - cut * 0.4), height * (0.88 - cut * 0.56), far - 0.63 + cut * 0.39);
    const ridge = point(
      -lean * 0.65,
      height * (0.69 + cut * 0.25),
      near + (far - near) * (0.3 + cut * 0.36),
    );
    face(a, ridge, b, false);
    face(b, ridge, c, false);
    face(c, ridge, d, false);
    face(d, ridge, e, false);
    face(e, ridge, a, false);
    const rim = [a, b, c, d, e];
    const floor = rim.map((p, edge) => {
      if (kind !== 'iron_fault') return [p[0], 0.04, p[2]];
      // Unequal splayed feet twist the two existing wall triangles into
      // fracture facets. Keep the roof silhouette and the closed 18-triangle
      // plate rather than adding a fan of triangles to every wall.
      const flare = 0.08 + (0.5 + 0.5 * Math.sin(seed * 1.91 + edge * 2.4)) * 0.1;
      const middle = (near + far) * 0.5;
      return point(
        (p[0] * cos - p[2] * sin) * (1 + flare),
        0.04,
        middle + (p[0] * sin + p[2] * cos - middle) * (1 + flare),
      );
    });
    for (let i = 0; i < rim.length; i++) {
      const topA = rim[i],
        topB = rim[(i + 1) % rim.length];
      const lowA = floor[i],
        lowB = floor[(i + 1) % rim.length];
      const first = uvs.length;
      if (kind === 'iron_fault' && (seed + i) % 2 === 0) {
        face(topA, topB, lowB, false);
        face(topA, lowB, lowA, false);
        uvs.splice(first, 12, 0, 0, 1, 0, 1, 8, 0, 0, 1, 8, 0, 8);
        continue;
      }
      face(topA, topB, lowA, false);
      face(topB, lowB, lowA, false);
      // A narrow material bevel at the wall's upper edge, using two wall
      // triangles instead of four coplanar ones. This leaves room for a cap.
      uvs.splice(first, 12, 0, 0, 1, 0, 0, 8, 1, 0, 1, 8, 0, 8);
    }
    for (let i = 1; i < floor.length - 1; i++) face(floor[0], floor[i], floor[i + 1], false);
    // Ground materials use world-space texture projection; UV.x is free to
    // carry one coherent travel phase across every face of this plate.
    for (let i = firstUv; i < uvs.length; i += 2) uvs[i] = near / 8;
  }
  if (kind === 'breach_wedge') {
    const tail = [0, 0, -3.3],
      tip = [0, 0, 2.3];
    const corners = [
      [-1.15, 0, -0.45],
      [0, 0.78, -0.45],
      [1.15, 0, -0.45],
      [0, -0.78, -0.45],
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i],
        b = corners[(i + 1) % 4];
      const insetA = a.map((v) => v * 0.86),
        insetB = b.map((v) => v * 0.86);
      face(tail, a, b, false);
      face(a, tip, insetA, true);
      face(insetA, tip, insetB, false);
      face(insetB, tip, b, true);
    }
  } else if (kind === 'iron_counter') {
    const p = { x: 0, y: 0, z: 0 };
    // Three broad returning steel wakes read as one driven counter-sweep.
    // Narrow air breaks retain distinct heads without a fan of loose panels.
    for (let segment = 0; segment < 3; segment++) {
      const angle = -2.2 + ((segment + 0.5) * 4.4) / 3;
      const left: number[][] = [],
        right: number[][] = [];
      for (let i = 0; i < 13; i++) {
        const u = i / 12,
          a = angle + (u - 0.5) * (4.4 / 3) * 0.98;
        const taper = Math.sin(u * Math.PI);
        ironguardPath(kind, (a + 2.2) / 1.1, 0, p);
        left.push([Math.sin(a) * 8, p.y + taper * 0.12, Math.cos(a) * 8]);
        right.push([
          Math.sin(a) * (8 - 2.2 * taper),
          p.y - taper * 0.4,
          Math.cos(a) * (8 - 2.2 * taper),
        ]);
      }
      for (let i = 0; i < 12; i++) {
        const bevelA = left[i].map((v, axis) => v + (right[i][axis] - v) * 0.12);
        const bevelB = left[i + 1].map((v, axis) => v + (right[i + 1][axis] - v) * 0.12);
        face(left[i], left[i + 1], bevelA, true);
        face(left[i + 1], bevelB, bevelA, true);
        face(bevelA, bevelB, right[i], false);
        face(bevelB, right[i + 1], right[i], false);
      }
    }
  } else {
    const branches = kind === 'iron_quake' ? 12 : 7;
    for (let branch = 0; branch < branches; branch++) {
      const angle = kind === 'iron_quake' ? (branch * Math.PI) / 6 : -2.2 + (branch * 4.4) / 6;
      for (let step = 0; step < 3; step++) {
        const near =
            (step === 0
              ? kind === 'iron_fault'
                ? 2.45
                : 0.7
              : step === 1
                ? kind === 'iron_fault'
                  ? 4.7
                  : 3.6
                : 6.7) + (step === 2 ? 0 : Math.sin(branch * 2.1 + step) * 0.18),
          far = step === 2 ? 8 : near + 1.6 + (branch % 3) * 0.15;
        plate(
          angle +
            (step === 2 || branch === 0 || branch === branches - 1
              ? 0
              : Math.sin(branch * 2.4 + step * 1.8) * 0.12),
          near,
          far,
          ((kind === 'iron_quake' ? 0.62 : 0.83) + step * 0.18) *
            (0.8 + 0.35 * (0.5 + 0.5 * Math.sin(branch * 1.7 + step * 2.8))),
          (kind === 'iron_quake'
            ? 0.85 + (branch % 3) * 0.11
            : 1.65 + Math.max(0, 1 - Math.abs(branch - 3) / 2) * 1.45) +
            step * 0.22,
        );
      }
      if (kind === 'iron_fault' && branch > 0 && branch < 6)
        plate(angle + (branch % 2 ? -0.19 : 0.19), 4.6, 6.1, 0.54, 1.2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
