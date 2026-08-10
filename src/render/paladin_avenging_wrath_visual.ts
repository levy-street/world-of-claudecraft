import * as THREE from 'three';

const GOLD = 0xffd84a;

export interface PaladinAvengingWrathVisual {
  root: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  geometry: THREE.SphereGeometry;
  material: THREE.MeshBasicMaterial;
  elapsed: number;
  dispose(): void;
}

function buildWing(
  side: 'left' | 'right',
  geometry: THREE.SphereGeometry,
  material: THREE.MeshBasicMaterial,
): THREE.Group {
  const sign = side === 'left' ? -1 : 1;
  const wing = new THREE.Group();
  wing.name = `paladin-avenging-wrath-${side}-wing`;
  wing.position.set(sign * 0.16, 0, -0.12);
  wing.rotation.y = sign * 0.16;

  const feathers = new THREE.InstancedMesh(geometry, material, 6);
  feathers.name = `paladin-avenging-wrath-${side}-feathers`;
  const transform = new THREE.Object3D();
  for (let index = 0; index < feathers.count; index++) {
    const row = index < 3 ? 0 : 1;
    const column = index % 3;
    transform.position.set(sign * (0.26 + column * 0.23), 0.14 - row * 0.19 - column * 0.05, 0);
    transform.rotation.set(0, 0, sign * (-0.28 - column * 0.12 - row * 0.08));
    transform.scale.set(0.2, 0.68 - column * 0.08, 0.09);
    transform.updateMatrix();
    feathers.setMatrixAt(index, transform.matrix);
  }
  feathers.instanceMatrix.needsUpdate = true;
  wing.add(feathers);
  return wing;
}

function createPaladinAvengingWrathVisual(
  parent: THREE.Group,
  height: number,
): PaladinAvengingWrathVisual {
  const geometry = new THREE.SphereGeometry(0.5, 10, 6);
  const material = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const root = new THREE.Group();
  root.name = 'paladin-avenging-wrath';
  root.position.y = height * 0.62;
  const leftWing = buildWing('left', geometry, material);
  const rightWing = buildWing('right', geometry, material);
  leftWing.rotation.z = 0.3;
  rightWing.rotation.z = -0.3;
  root.add(leftWing, rightWing);
  parent.add(root);

  return {
    root,
    leftWing,
    rightWing,
    geometry,
    material,
    elapsed: 0,
    dispose() {
      parent.remove(root);
      geometry.dispose();
      material.dispose();
    },
  };
}

export function syncPaladinAvengingWrathVisual(
  current: PaladinAvengingWrathVisual | null,
  parent: THREE.Group,
  height: number,
  active: boolean,
  dt: number,
  reducedMotion: boolean,
): PaladinAvengingWrathVisual | null {
  if (!active) {
    current?.dispose();
    return null;
  }
  const visual = current ?? createPaladinAvengingWrathVisual(parent, height);
  visual.root.position.y = height * 0.62;
  if (reducedMotion) return visual;

  visual.elapsed += dt;
  const fold = Math.sin(visual.elapsed * 3.2) * 0.055;
  visual.leftWing.rotation.z = 0.3 + fold;
  visual.rightWing.rotation.z = -0.3 - fold;
  visual.material.opacity = 0.88 + Math.sin(visual.elapsed * 4.1) * 0.08;
  return visual;
}
