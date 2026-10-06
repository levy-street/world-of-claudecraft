import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Compact donkey proportions, facing +Z. Each articulated part becomes one
// vertex-coloured mesh, so detail does not multiply the live draw-call budget.
export function createCourierDonkey() {
  const root = new THREE.Group();
  root.name = 'CourierDonkey';
  const material = new THREE.MeshStandardMaterial({
    name: 'CourierVertexColour',
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
  });
  const body = [];
  function part(bucket, geometry, color, pos, scale = [1, 1, 1], rot = [0, 0, 0]) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
        new THREE.Vector3(...scale),
      ),
    );
    const c = new THREE.Color(color);
    const values = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < values.length; i += 3) values.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(values, 3));
    bucket.push(g);
  }
  const oval = (bucket, color, pos, scale, rot) =>
    part(bucket, new THREE.SphereGeometry(1, 12, 8), color, pos, scale, rot);
  const box = (bucket, color, pos, scale, rot) =>
    part(bucket, new THREE.BoxGeometry(1, 1, 1), color, pos, scale, rot);
  const fur = 0x81736b;
  const dark = 0x39312c;
  const pale = 0xcfc4ae;
  oval(body, fur, [0, 1.07, -0.08], [0.39, 0.46, 0.72]);
  oval(body, 0x978779, [0, 1.38, 0.48], [0.27, 0.48, 0.31], [-0.35, 0, 0]);
  oval(body, fur, [0, 1.75, 0.64], [0.28, 0.34, 0.3]);
  oval(body, pale, [0, 1.55, 0.93], [0.28, 0.2, 0.24]);
  // Long narrow ears, dark tips and inset warm skin distinguish a donkey.
  for (const side of [-1, 1]) {
    oval(body, fur, [side * 0.17, 2.16, 0.57], [0.088, 0.38, 0.1], [0, 0, -side * 0.16]);
    oval(body, 0xbc9690, [side * 0.17, 2.18, 0.655], [0.045, 0.26, 0.025], [0, 0, -side * 0.16]);
    oval(body, dark, [side * 0.22, 1.81, 0.8], [0.048, 0.059, 0.034]);
    oval(body, 0xf7eee0, [side * 0.228, 1.83, 0.827], [0.012, 0.014, 0.008]);
    oval(body, dark, [side * 0.13, 1.59, 1.13], [0.045, 0.027, 0.01]);
    for (const z of [-0.51, 0.38]) {
      oval(body, fur, [side * 0.26, 0.6, z], [0.115, 0.37, 0.13], [0.16, 0, side * 0.08]);
      oval(body, dark, [side * 0.28, 0.28, z - 0.04], [0.12, 0.11, 0.15]);
    }
    // Saddlebags sit below the wing joints, fastened with broad brass buckles.
    box(body, 0x563e2b, [side * 0.43, 0.97, -0.15], [0.22, 0.47, 0.62]);
    box(body, 0x806143, [side * 0.44, 1.18, -0.15], [0.25, 0.12, 0.65]);
    box(body, 0xbd9450, [side * 0.56, 1.02, -0.1], [0.022, 0.13, 0.12]);
    box(body, 0x3e3027, [side * 0.575, 1.02, -0.1], [0.023, 0.072, 0.062]);
  }
  // A cropped dark mane, dorsal stripe and tufted tail keep the silhouette equine.
  for (let i = 0; i < 7; i++) {
    box(body, dark, [0, 1.8 - i * 0.095, 0.42 - i * 0.085], [0.12, 0.15, 0.14], [-0.35, 0, 0]);
  }
  oval(body, dark, [0, 1.475, -0.2], [0.045, 0.03, 0.5]);
  oval(body, fur, [0, 0.94, -0.88], [0.05, 0.3, 0.07], [-0.45, 0, 0]);
  oval(body, dark, [0, 0.69, -1.02], [0.095, 0.14, 0.095]);
  const finish = (name, geometries, parent) => {
    const geometry = mergeGeometries(geometries);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    parent.add(mesh);
  };
  finish('DonkeyBody', body, root);
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.name = side < 0 ? 'WingLeft' : 'WingRight';
    wing.position.set(side * 0.32, 1.43, -0.17);
    const feathers = [];
    oval(feathers, 0xd8cfb9, [side * 0.47, 0.07, 0], [0.62, 0.12, 0.3], [0, -side * 0.14, 0]);
    for (let i = 0; i < 9; i++) {
      const length = 0.64 - i * 0.022;
      oval(
        feathers,
        i % 2 ? 0xf1e7d0 : 0xe4d7bc,
        [side * (0.28 + i * 0.12), 0.025, -0.27 - i * 0.024],
        [0.095, 0.048, length],
        [0, -side * (0.25 + i * 0.045), 0],
      );
    }
    for (let i = 0; i < 7; i++) {
      oval(
        feathers,
        0xf5ecd8,
        [side * (0.23 + i * 0.14), 0.11, -0.15],
        [0.09, 0.05, 0.28],
        [0, -side * 0.35, 0],
      );
    }
    finish(`${wing.name}Feathers`, feathers, wing);
    root.add(wing);
  }
  root.userData.courierDonkey = { version: 1, original: true, articulatedWings: true };
  return root;
}
