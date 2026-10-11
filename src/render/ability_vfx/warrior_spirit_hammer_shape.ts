import * as THREE from 'three';

/** Bevelled spectral weapon. Built once with contrasting face, edge and inlay
 * colours; the broad striking head stays readable through a complete tumble. */
export function warriorSpiritHammerShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [];
  const color = new THREE.Color();
  function part(
    geometry: THREE.BufferGeometry,
    hex: number,
    x: number,
    y: number,
    z: number,
    roll = 0,
  ) {
    geometry.rotateZ(roll).translate(x, y, z);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    color.setHex(hex);
    const p = flat.getAttribute('position'),
      n = flat.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colors.push(color.r, color.g, color.b);
    }
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  }
  function head(width: number, height: number, depth: number, bevel: number) {
    const shape = new THREE.Shape();
    const x = width / 2,
      y = height / 2;
    shape.moveTo(-x + bevel, -y);
    shape.lineTo(x - bevel, -y);
    shape.lineTo(x, -y + bevel);
    shape.lineTo(x, y - bevel);
    shape.lineTo(x - bevel, y);
    shape.lineTo(-x + bevel, y);
    shape.lineTo(-x, y - bevel);
    shape.lineTo(-x, -y + bevel);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: depth - bevel * 2,
      steps: 1,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: bevel * 0.55,
      bevelThickness: bevel,
    }).translate(0, 0, -depth / 2 + bevel);
  }
  part(head(0.88, 0.38, 0.34, 0.045), 0x3b7895, 0, 0.35, 0);
  for (const side of [-1, 1]) {
    part(head(0.14, 0.46, 0.42, 0.035), 0xb4ebf6, side * 0.46, 0.35, 0);
    part(head(0.025, 0.34, 0.32, 0.008), 0x376d8b, side * 0.546, 0.35, 0);
    // A shaded striking face keeps the luminous bevel visible through bloom.
    for (const offset of [-0.07, 0.07])
      part(new THREE.BoxGeometry(0.012, 0.2, 0.022), 0xc0f1f8, side * 0.566, 0.35, offset);
    // Raised face plates frame the bright central rune on both sides.
    part(head(0.62, 0.24, 0.022, 0.009), 0x1c4967, 0, 0.35, side * 0.185);
    for (const hand of [-1, 1]) {
      part(
        new THREE.BoxGeometry(0.026, 0.22, 0.026),
        0xdbfbff,
        hand * 0.065,
        0.35,
        side * 0.202,
        hand * 0.55,
      );
      part(new THREE.BoxGeometry(0.12, 0.02, 0.026), 0x68cde9, hand * 0.225, 0.35, side * 0.202);
    }
  }
  part(new THREE.CylinderGeometry(0.046, 0.056, 0.72, 8), 0x29536b, 0, -0.14, 0);
  part(new THREE.CylinderGeometry(0.085, 0.062, 0.09, 8), 0xc3eef5, 0, 0.12, 0);
  for (let i = 0; i < 6; i++) {
    part(
      new THREE.CylinderGeometry(0.061, 0.061, 0.022, 8),
      i % 2 ? 0x74bcd1 : 0xb4e6ef,
      0,
      -0.15 - i * 0.052,
      0,
    );
  }
  part(new THREE.OctahedronGeometry(0.105), 0x9ddfe9, 0, -0.55, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
