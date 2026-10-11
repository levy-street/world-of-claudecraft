import * as THREE from 'three';

/** A closed forged lamella: broad inset face, raised spine, copper bevel and
 * four hammered rivets. Local Y points up; local Z is the exposed face. */
export function warriorGuardGeometry(): THREE.BufferGeometry {
  const positions: number[] = [],
    colors: number[] = [],
    uv: number[] = [];
  const outline = [
    [0, -0.65],
    [0.38, -0.36],
    [0.5, 0.25],
    [0.31, 0.55],
    [0, 0.67],
    [-0.31, 0.55],
    [-0.5, 0.25],
    [-0.38, -0.36],
  ];
  const steel = new THREE.Color(0x819faf),
    bevel = new THREE.Color(0xd5ac7a);
  function triangle(a: number[], b: number[], c: number[], color: THREE.Color) {
    for (const p of [a, b, c]) {
      positions.push(p[0], p[1], p[2]);
      colors.push(color.r, color.g, color.b);
      uv.push(p[0] * 0.8 + 0.5, p[1] * 0.65 + 0.5);
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length];
    const outerA = [a[0], a[1], 0],
      outerB = [b[0], b[1], 0];
    const innerA = [a[0] * 0.92, a[1] * 0.94, 0.095];
    const innerB = [b[0] * 0.92, b[1] * 0.94, 0.095];
    triangle(outerA, outerB, innerB, bevel);
    triangle(outerA, innerB, innerA, bevel);
    triangle(innerA, innerB, [0, 0.06, 0.18], steel);
    const backA = [a[0], a[1], -0.095],
      backB = [b[0], b[1], -0.095];
    triangle(backA, backB, outerB, steel);
    triangle(backA, outerB, outerA, steel);
    const insetA = [a[0] * 0.92, a[1] * 0.94, -0.15];
    const insetB = [b[0] * 0.92, b[1] * 0.94, -0.15];
    triangle(backB, backA, insetA, bevel);
    triangle(backB, insetA, insetB, bevel);
    triangle(insetB, insetA, [0, 0.06, -0.2], steel);
  }
  for (const [x, y] of [
    [-0.29, 0.25],
    [0.29, 0.25],
    [-0.18, -0.27],
    [0.18, -0.27],
  ]) {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3,
        b = ((i + 1) * Math.PI) / 3;
      triangle(
        [x + Math.cos(a) * 0.037, y + Math.sin(a) * 0.037, 0.15],
        [x + Math.cos(b) * 0.037, y + Math.sin(b) * 0.037, 0.15],
        [x, y, 0.2],
        bevel,
      );
      triangle(
        [x + Math.cos(b) * 0.037, y + Math.sin(b) * 0.037, -0.15],
        [x + Math.cos(a) * 0.037, y + Math.sin(a) * 0.037, -0.15],
        [x, y, -0.245],
        bevel,
      );
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
