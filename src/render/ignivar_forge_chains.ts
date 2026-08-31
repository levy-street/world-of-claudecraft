import * as THREE from 'three';
import {
  IGNIVAR_FORGE_CHAINS_ATTACH_GRACE_SECONDS,
  IGNIVAR_FORGE_CHAINS_AURA_ID,
  IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE,
  IGNIVAR_FORGE_CHAINS_WARNING_DISTANCE,
} from '../sim/ignivar_forge_chains';

export const IGNIVAR_FORGE_CHAIN_VISUAL_NAME = 'ignivarForgeChain';

const MAX_CHAIN_LINKS = 20;
const CHAIN_FLAME_COUNT = 10;
const CHAIN_LINK_SPACING = 0.72;
const CHAIN_BODY_HEIGHT = 1.25;
const FORWARD = new THREE.Vector3(0, 0, 1);
const direction = new THREE.Vector3();

export interface IgnivarForgeChainVisualEntity {
  id: number;
  kind: string;
  scale?: number;
  pos?: { x: number; y: number; z: number };
  auras: readonly { id: string; value2?: number; remaining?: number; duration?: number }[];
}

export interface IgnivarForgeChainVisualView {
  group: THREE.Group;
}

export interface IgnivarForgeChainVisualPosition {
  pos: { x: number; y: number; z: number };
}

function hdrMaterial(red: number, green: number, blue: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(red, green, blue),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

export function buildIgnivarForgeChainVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = IGNIVAR_FORGE_CHAIN_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';

  const outerBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 1, 8, 1, true),
    hdrMaterial(2.7, 0.12, 0.008, 0.32),
  );
  outerBeam.name = 'forgeChainOuterFire';
  outerBeam.rotation.x = Math.PI / 2;
  root.add(outerBeam);

  const coreBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.065, 1, 8, 1, true),
    hdrMaterial(4.5, 0.9, 0.08, 0.76),
  );
  coreBeam.name = 'forgeChainFireCore';
  coreBeam.rotation.x = Math.PI / 2;
  root.add(coreBeam);

  const linkGeometry = new THREE.TorusGeometry(0.27, 0.065, 6, 12);
  const linkMaterial = hdrMaterial(3.3, 0.38, 0.025, 0.92);
  for (let index = 0; index < MAX_CHAIN_LINKS; index++) {
    const link = new THREE.Mesh(linkGeometry, linkMaterial);
    link.userData.forgeChainLink = true;
    link.userData.chainLinkIndex = index;
    link.rotation.y = index % 2 === 0 ? 0 : Math.PI / 2;
    root.add(link);
  }

  const flameGeometry = new THREE.ConeGeometry(0.2, 0.78, 5, 1, true);
  const flameMaterial = hdrMaterial(4.2, 0.48, 0.018, 0.62);
  for (let index = 0; index < CHAIN_FLAME_COUNT; index++) {
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.userData.forgeChainFlame = true;
    flame.userData.chainFlameIndex = index;
    root.add(flame);
  }

  const warningAnchorMaterial = hdrMaterial(5.4, 0.24, 0.012, 0.86);
  const warningAnchorGeometry = new THREE.SphereGeometry(0.34, 10, 7);
  for (let index = 0; index < 2; index++) {
    const anchor = new THREE.Mesh(warningAnchorGeometry, warningAnchorMaterial);
    anchor.userData.forgeChainWarningAnchor = true;
    anchor.userData.chainWarningAnchorIndex = index;
    anchor.visible = false;
    root.add(anchor);
  }

  root.userData.outerBeam = outerBeam;
  root.userData.coreBeam = coreBeam;
  root.userData.linkMaterial = linkMaterial;
  root.userData.flameMaterial = flameMaterial;
  root.userData.warningAnchorMaterial = warningAnchorMaterial;
  root.userData.animationTime = 0;
  root.visible = false;
  return root;
}

export function disposeIgnivarForgeChainVisual(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) materials.add(material);
    } else materials.add(mesh.material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.removeFromParent();
}

export function syncIgnivarForgeChainVisual(
  owner: THREE.Group,
  entity: IgnivarForgeChainVisualEntity,
  views: ReadonlyMap<number, IgnivarForgeChainVisualView>,
  dt: number,
  entities?: ReadonlyMap<number, IgnivarForgeChainVisualPosition>,
  reducedMotion = false,
): void {
  const aura = entity.auras.find((entry) => entry.id === IGNIVAR_FORGE_CHAINS_AURA_ID);
  const partnerId = aura?.value2;
  let root = owner.getObjectByName(IGNIVAR_FORGE_CHAIN_VISUAL_NAME) as THREE.Group | undefined;
  if (!aura || partnerId === undefined || entity.id > partnerId) {
    if (root) root.visible = false;
    return;
  }
  const partnerGroup = views.get(partnerId)?.group;
  const partnerPosition = partnerGroup?.position ?? entities?.get(partnerId)?.pos;
  if (!partnerPosition) {
    if (root) root.visible = false;
    return;
  }
  if (!root) {
    root = buildIgnivarForgeChainVisual();
    owner.add(root);
  }

  const inverseScale = 1 / Math.max(0.01, entity.scale ?? 1);
  const dx = partnerPosition.x - owner.position.x;
  const dz = partnerPosition.z - owner.position.z;
  const cos = Math.cos(owner.rotation.y);
  const sin = Math.sin(owner.rotation.y);
  direction.set(cos * dx - sin * dz, partnerPosition.y - owner.position.y, sin * dx + cos * dz);
  const length = direction.length();
  const authoritativePartner = entities?.get(partnerId)?.pos;
  const authoritativeOwner = entity.pos;
  const horizontalLength =
    authoritativeOwner && authoritativePartner
      ? Math.hypot(
          authoritativePartner.x - authoritativeOwner.x,
          authoritativePartner.z - authoritativeOwner.z,
        )
      : Math.hypot(dx, dz);
  if (length <= 0.01) {
    root.visible = false;
    return;
  }

  root.visible = true;
  root.position.set(0, CHAIN_BODY_HEIGHT * inverseScale, 0);
  root.scale.setScalar(inverseScale);
  root.quaternion.setFromUnitVectors(FORWARD, direction.normalize());
  root.userData.chainLength = length;
  // Damage authority intentionally ignores vertical movement. Keep the full 3D
  // length for beam placement, but never turn a safe horizontal tether red just
  // because one endpoint is jumping or standing on uneven presentation terrain.
  const elapsed =
    aura.duration !== undefined && aura.remaining !== undefined
      ? Math.max(0, aura.duration - aura.remaining)
      : IGNIVAR_FORGE_CHAINS_ATTACH_GRACE_SECONDS;
  const graceComplete = elapsed + 1e-6 >= IGNIVAR_FORGE_CHAINS_ATTACH_GRACE_SECONDS;
  const strained = graceComplete && horizontalLength >= IGNIVAR_FORGE_CHAINS_BREAK_DISTANCE;
  const warning = graceComplete && horizontalLength >= IGNIVAR_FORGE_CHAINS_WARNING_DISTANCE;
  root.userData.warning = warning;
  root.userData.strained = strained;

  const animationTime = Number(root.userData.animationTime ?? 0) + Math.max(0, dt);
  root.userData.animationTime = animationTime;
  const motionTime = reducedMotion ? 0 : animationTime;
  const pulse = reducedMotion
    ? 0.88
    : 0.88 + Math.sin(motionTime * (strained ? 22 : warning ? 17 : 11) + entity.id) * 0.12;
  const outerBeam = root.userData.outerBeam as THREE.Mesh;
  const coreBeam = root.userData.coreBeam as THREE.Mesh;
  const outerMaterial = outerBeam.material as THREE.MeshBasicMaterial;
  const coreMaterial = coreBeam.material as THREE.MeshBasicMaterial;
  const linkMaterial = root.userData.linkMaterial as THREE.MeshBasicMaterial;
  const flameMaterial = root.userData.flameMaterial as THREE.MeshBasicMaterial;
  const warningAnchorMaterial = root.userData.warningAnchorMaterial as THREE.MeshBasicMaterial;
  outerMaterial.color.setRGB(
    strained ? 5.4 : warning ? 4.1 : 2.7,
    strained ? 0.035 : warning ? 0.08 : 0.12,
    0.008,
  );
  coreMaterial.color.setRGB(
    strained ? 6.8 : warning ? 5.8 : 4.5,
    strained ? 0.38 : warning ? 0.62 : 0.9,
    0.08,
  );
  linkMaterial.color.setRGB(
    strained ? 5.8 : warning ? 4.7 : 3.3,
    strained ? 0.12 : warning ? 0.22 : 0.38,
    0.025,
  );
  flameMaterial.color.setRGB(
    strained ? 6.2 : warning ? 5.2 : 4.2,
    strained ? 0.2 : warning ? 0.32 : 0.48,
    0.018,
  );
  outerBeam.position.z = length * 0.5;
  outerBeam.scale.set(1 + pulse * 0.16, length, 1 + pulse * 0.16);
  coreBeam.position.z = length * 0.5;
  coreBeam.scale.set(pulse, length, pulse);
  outerMaterial.opacity = (strained ? 0.38 : 0.24) + pulse * 0.12;
  coreMaterial.opacity = (strained ? 0.74 : 0.62) + pulse * 0.18;

  const visibleLinks = Math.min(
    MAX_CHAIN_LINKS,
    Math.max(2, Math.ceil(length / CHAIN_LINK_SPACING)),
  );
  root.userData.visibleLinks = visibleLinks;
  let linkIndex = 0;
  for (const child of root.children) {
    if (child.userData.forgeChainLink !== true) continue;
    child.visible = linkIndex < visibleLinks;
    if (child.visible) {
      const along = visibleLinks <= 1 ? 0 : linkIndex / (visibleLinks - 1);
      child.position.set(
        0,
        reducedMotion ? 0 : Math.sin(motionTime * 8 + linkIndex * 1.7) * 0.055,
        length * along,
      );
      child.scale.setScalar(0.88 + pulse * 0.14);
      child.rotation.z = reducedMotion ? 0 : motionTime * (linkIndex % 2 === 0 ? 0.7 : -0.7);
    }
    linkIndex++;
  }
  linkMaterial.opacity = (strained ? 0.88 : 0.78) + pulse * 0.18;

  let flameIndex = 0;
  for (const child of root.children) {
    if (child.userData.forgeChainFlame !== true) continue;
    const along = (flameIndex + 0.5) / CHAIN_FLAME_COUNT;
    const flicker = reducedMotion
      ? 0.72
      : 0.72 + Math.sin(motionTime * 13 + flameIndex * 2.1) * 0.2;
    child.position.set(
      reducedMotion ? 0 : Math.sin(motionTime * 7 + flameIndex) * 0.13,
      0.24 + flicker * 0.22,
      length * along,
    );
    child.rotation.y = reducedMotion ? flameIndex : motionTime * 1.8 + flameIndex;
    child.scale.set(0.7 + pulse * 0.2, 0.7 + flicker * 0.55, 0.7 + pulse * 0.2);
    flameIndex++;
  }
  flameMaterial.opacity = (strained ? 0.62 : 0.5) + pulse * 0.18;

  for (const child of root.children) {
    if (child.userData.forgeChainWarningAnchor !== true) continue;
    const anchorIndex = Number(child.userData.chainWarningAnchorIndex ?? 0);
    child.visible = warning;
    child.position.set(0, 0, anchorIndex === 0 ? 0 : length);
    child.scale.setScalar((strained ? 1.25 : 1) * (0.82 + pulse * 0.25));
  }
  warningAnchorMaterial.color.setRGB(strained ? 7.2 : 5.4, strained ? 0.08 : 0.24, 0.012);
  warningAnchorMaterial.opacity = warning
    ? Math.min(1, (strained ? 0.96 : 0.72) + pulse * 0.12)
    : 0;
}
