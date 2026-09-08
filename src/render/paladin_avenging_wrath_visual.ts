import * as THREE from 'three';

const GOLD = 0xffd84a;

export interface PaladinAvengingWrathVisual {
  root: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  geometry: THREE.SphereGeometry;
  material: THREE.MeshBasicMaterial;
  elapsed: number;
  opening: number;
  ground: THREE.Mesh;
  bulwark: THREE.Mesh;
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
    transform.position.set(sign * (0.34 + column * 0.42), 0.38 - row * 0.28 - column * 0.12, 0);
    transform.rotation.set(0, 0, sign * (-0.28 - column * 0.12 - row * 0.08));
    transform.scale.set(0.22, 1.8 - column * 0.2 - row * 0.2, 0.055);
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
  const groundGeometry = new THREE.RingGeometry(0.9, 1.15, 48, 1, 0.15, Math.PI * 1.8);
  const ground = new THREE.Mesh(groundGeometry, material);
  ground.name = 'paladin-hallowed-wall-ground';
  ground.rotation.x = -Math.PI / 2;
  const bulwarkGeometry = new THREE.OctahedronGeometry(0.85, 0);
  const bulwark = new THREE.Mesh(bulwarkGeometry, material);
  bulwark.name = 'paladin-bastion-backplate';
  bulwark.scale.set(0.7, 1.4, 0.12);
  bulwark.position.z = -0.48;
  root.add(ground, bulwark);
  parent.add(root);

  return {
    root,
    leftWing,
    rightWing,
    geometry,
    material,
    elapsed: 0,
    opening: Number.NaN,
    ground,
    bulwark,
    dispose() {
      parent.remove(root);
      geometry.dispose();
      groundGeometry.dispose();
      bulwarkGeometry.dispose();
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
  auras?: ReadonlyArray<{ id: string; kind: string }>,
): PaladinAvengingWrathVisual | null {
  let wrath = !auras && active,
    covenant = false,
    wall = false,
    bastion = false,
    flight = false;
  if (active && auras)
    for (const aura of auras) {
      if (aura.id === 'avenging_wrath') wrath = true;
      if (aura.id === 'guardian_covenant' || aura.id === 'life_covenant') covenant = true;
      if (aura.id === 'holy_shield' || aura.id === 'holy_shield_absorb') wall = true;
      if (aura.id === 'bastion_rite') bastion = true;
      if (aura.id === 'valkyrs_calling_flight') flight = true;
    }
  if (!active || !(wrath || covenant || wall || bastion || flight)) {
    current?.dispose();
    return null;
  }
  const visual = current ?? createPaladinAvengingWrathVisual(parent, height);
  visual.root.position.y = height * 0.62;
  visual.leftWing.visible = visual.rightWing.visible = wrath || covenant || flight;
  visual.leftWing.scale.setScalar(wrath || flight ? 1.55 : 1.2);
  visual.rightWing.scale.copy(visual.leftWing.scale);
  visual.ground.visible = wall;
  visual.ground.position.y = -height * 0.62 + 0.06;
  visual.bulwark.visible = bastion;
  visual.material.color.setHex(wrath ? GOLD : covenant ? 0xfff1cb : 0xf9c878);
  const opening = wrath || flight ? 0.55 : -0.35;
  if (!current || visual.opening !== opening) {
    visual.leftWing.rotation.z = opening;
    visual.rightWing.rotation.z = -opening;
    visual.opening = opening;
  }
  if (reducedMotion) return visual;

  visual.elapsed += dt;
  const fold = Math.sin(visual.elapsed * 3.2) * 0.055;
  visual.leftWing.rotation.z = opening + fold;
  visual.rightWing.rotation.z = -opening - fold;
  visual.material.opacity = 0.88 + Math.sin(visual.elapsed * 4.1) * 0.08;
  return visual;
}
