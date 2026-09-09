import * as THREE from 'three';
import { warriorAvatarShape } from './warrior_avatar_shape';

/** Closed sculpted shapes, authored independently from defensive kite plates.
 * Local Y runs from the rooted base to the point; Z is the exposed face. */
export function warriorPowerGeometry(blood: boolean): THREE.BufferGeometry {
  if (!blood) return warriorAvatarShape();
  const control = [
    [-0.1, 0],
    [0.12, -0.04],
    [0.32, 0.42],
    [0.46, 1.02],
    [0.18, 1.67],
    [-0.12, 1.9],
    [-0.27, 1.6],
    [0.04, 1.45],
    [0.14, 1.01],
    [-0.12, 0.49],
  ];
  const curve = new THREE.CatmullRomCurve3(
    control.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    true,
    'centripetal',
  );
  const outline = curve
    .getPoints(40)
    .slice(0, -1)
    .map((p) => [p.x, p.y]);
  const face = new THREE.Color(0xcb1838);
  // A continuous emissive body: bright hard bevels read as gemstone facets.
  const edge = face;
  const dark = new THREE.Color(0x490913);
  const positions: number[] = [],
    colors: number[] = [],
    uv: number[] = [];
  // Concave hooks require a true inward edge offset. Scaling toward a centre
  // folds the bevel across the open notch and exposes backwards triangles.
  const inset = outline.map((point, index) => {
    const before = outline[(index + outline.length - 1) % outline.length];
    const after = outline[(index + 1) % outline.length];
    const ax = point[0] - before[0],
      ay = point[1] - before[1];
    const bx = after[0] - point[0],
      by = after[1] - point[1];
    const al = Math.hypot(ax, ay),
      bl = Math.hypot(bx, by);
    const nx = -ay / al - by / bl,
      ny = ax / al + bx / bl;
    const denominator = nx * (-ay / al) + ny * (ax / al);
    return [point[0] + (nx * 0.014) / denominator, point[1] + (ny * 0.014) / denominator];
  });
  const depth = 0.08;
  const tri = (a: number[], b: number[], c: number[], color: THREE.Color) => {
    for (const p of [a, b, c]) {
      positions.push(...p);
      colors.push(color.r, color.g, color.b);
      uv.push(p[0] * 0.7 + 0.5, p[1] * 0.42 + 0.04);
    }
  };
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < outline.length; i++) {
      const j = (i + 1) % outline.length;
      const a = [...outline[i], side * depth * 0.65],
        b = [...outline[j], side * depth * 0.65];
      const c = [...inset[j], side * depth],
        d = [...inset[i], side * depth];
      if (side > 0) {
        tri(a, b, c, edge);
        tri(a, c, d, edge);
      } else {
        tri(b, a, d, edge);
        tri(b, d, c, edge);
      }
    }
    const faces = THREE.ShapeUtils.triangulateShape(
      inset.map((p) => new THREE.Vector2(...p)),
      [],
    );
    for (const [a, b, c] of faces) {
      const verts = [a, b, c].map((i) => [...inset[i], side * depth]);
      if (side > 0) tri(verts[0], verts[1], verts[2], face);
      // Blood flame emits from both faces. A metal-dark back leaves only the
      // bright bevel visible when the crown is viewed from behind or the side.
      else tri(verts[2], verts[1], verts[0], face);
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const j = (i + 1) % outline.length,
      a = [...outline[i], -depth * 0.65],
      b = [...outline[j], -depth * 0.65],
      c = [...outline[j], depth * 0.65],
      d = [...outline[i], depth * 0.65];
    tri(a, b, c, dark);
    tri(a, c, d, dark);
  }
  // Incisions lie inside the concave front face, not across its open notch.
  const z = depth + 0.002;
  tri([0.04, 0.42, z], [0.2, 0.52, z], [0.17, 0.545, z], dark);
  tri([0.21, 1.02, z], [0.33, 0.9, z], [0.34, 0.925, z], dark);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
