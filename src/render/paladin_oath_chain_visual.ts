import * as THREE from 'three';

const CHAIN_GOLD = 0xffc928;
const MAX_LINK_COUNT = 96;
const MIN_LINK_COUNT = 8;
const LINK_SPACING = 0.34;
const LINK_AXIS = new THREE.Vector3(1, 0, 0);

export interface PaladinOathChainEndpoint {
  x: number;
  y: number;
  z: number;
}

export interface PaladinOathChainVisual {
  root: THREE.Group;
  links: THREE.InstancedMesh;
  geometry: THREE.TorusGeometry;
  material: THREE.MeshBasicMaterial;
  elapsed: number;
  transform: THREE.Object3D;
  direction: THREE.Vector3;
  alignQuaternion: THREE.Quaternion;
  twistQuaternion: THREE.Quaternion;
  dispose(): void;
}

function createPaladinOathChainVisual(parent: THREE.Object3D): PaladinOathChainVisual {
  const root = new THREE.Group();
  root.name = 'paladin-oath-chain';

  const geometry = new THREE.TorusGeometry(0.16, 0.045, 6, 12);
  const material = new THREE.MeshBasicMaterial({
    color: CHAIN_GOLD,
    transparent: true,
    opacity: 0.94,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const links = new THREE.InstancedMesh(geometry, material, MAX_LINK_COUNT);
  links.name = 'paladin-oath-chain-links';
  links.renderOrder = 11;
  root.add(links);
  parent.add(root);

  return {
    root,
    links,
    geometry,
    material,
    elapsed: 0,
    transform: new THREE.Object3D(),
    direction: new THREE.Vector3(),
    alignQuaternion: new THREE.Quaternion(),
    twistQuaternion: new THREE.Quaternion(),
    dispose() {
      parent.remove(root);
      geometry.dispose();
      material.dispose();
    },
  };
}

function placeChainLinks(
  visual: PaladinOathChainVisual,
  sourcePos: PaladinOathChainEndpoint,
  targetPos: PaladinOathChainEndpoint,
  sourceHeight: number,
  targetHeight: number,
): void {
  const sourceY = sourcePos.y + sourceHeight * 0.56;
  const targetY = targetPos.y + targetHeight * 0.56;
  const dx = targetPos.x - sourcePos.x;
  const dy = targetY - sourceY;
  const dz = targetPos.z - sourcePos.z;
  const distance = Math.hypot(dx, dy, dz);
  const count = Math.max(
    MIN_LINK_COUNT,
    Math.min(MAX_LINK_COUNT, Math.ceil(distance / LINK_SPACING) + 1),
  );
  const sag = Math.min(1.2, distance * 0.04);

  visual.links.count = count;
  visual.direction.set(dx, dy, dz);
  if (visual.direction.lengthSq() < 1e-6) visual.direction.copy(LINK_AXIS);
  else visual.direction.normalize();
  visual.alignQuaternion.setFromUnitVectors(LINK_AXIS, visual.direction);

  for (let index = 0; index < count; index++) {
    const t = count === 1 ? 1 : index / (count - 1);
    visual.transform.position.set(
      sourcePos.x + dx * t,
      sourceY + dy * t - Math.sin(Math.PI * t) * sag,
      sourcePos.z + dz * t,
    );
    visual.twistQuaternion.setFromAxisAngle(LINK_AXIS, index % 2 === 0 ? 0 : Math.PI * 0.5);
    visual.transform.quaternion.copy(visual.alignQuaternion).multiply(visual.twistQuaternion);
    visual.transform.scale.set(1.45, 1, 1);
    visual.transform.updateMatrix();
    visual.links.setMatrixAt(index, visual.transform.matrix);
  }
  visual.links.instanceMatrix.needsUpdate = true;
}

export function syncPaladinOathChainVisual(
  current: PaladinOathChainVisual | null,
  parent: THREE.Object3D,
  sourcePos: PaladinOathChainEndpoint | null,
  targetPos: PaladinOathChainEndpoint,
  sourceHeight: number,
  targetHeight: number,
  active: boolean,
  dt: number,
  reducedMotion: boolean,
): PaladinOathChainVisual | null {
  if (!active || !sourcePos) {
    current?.dispose();
    return null;
  }
  const visual = current ?? createPaladinOathChainVisual(parent);
  placeChainLinks(visual, sourcePos, targetPos, sourceHeight, targetHeight);
  if (reducedMotion) return visual;

  visual.elapsed += dt;
  visual.material.opacity = 0.86 + Math.sin(visual.elapsed * 5) * 0.1;
  return visual;
}
