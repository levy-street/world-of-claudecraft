// Persistent presentation for Tempering Ray. The authoritative snapshot owns
// both moving endpoints and the current first-body interception; this painter
// only turns that contract into an unmistakable raid signal on every tier.

import * as THREE from 'three';
import type { ActiveVarkhulAssembly } from '../sim/varkhul_assembly';
import {
  type ActiveVarkhulInterceptBeam,
  VARKHUL_INTERCEPT_BEAM_CAST_SECONDS,
  VARKHUL_INTERCEPT_BEAM_HALF_WIDTH,
} from '../sim/varkhul_intercept_beam';

export const VARKHUL_INTERCEPT_BEAM_VISUAL_NAME = 'varkhul-tempering-ray';

const GROUND_LIFT = 0.11;
const SOURCE_HEIGHT = 3.1;
const TARGET_HEIGHT = 1.15;
const CORE_RADIUS = 0.16;
const SHEATH_RADIUS = 0.42;
const UP = new THREE.Vector3(0, 1, 0);

interface InterceptBeamVisual {
  root: THREE.Group;
  corridor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  sheath: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  interceptedSheath: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  interceptedCore: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  target: THREE.Group;
  targetOuter: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  targetInner: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  targetSpire: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  blocker: THREE.Group;
  blockerRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  blockerShield: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  remaining: number;
  duration: number;
  phase: number;
  blocked: boolean;
}

function material(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function lineMesh(
  name: string,
  radius: number,
  color: number,
  opacity: number,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 12, 1, true),
    material(color, opacity),
  );
  mesh.name = name;
  mesh.scale.set(radius, 0.001, radius);
  mesh.renderOrder = 15;
  return mesh;
}

function setLineBetween(
  mesh: THREE.Mesh,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  direction: THREE.Vector3,
): void {
  direction.subVectors(to, from);
  const length = direction.length();
  if (length <= 1e-4) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(from).addScaledVector(direction, 0.5);
  mesh.scale.set(radius, length, radius);
  mesh.quaternion.setFromUnitVectors(UP, direction.multiplyScalar(1 / length));
}

function createVisual(bossId: number): InterceptBeamVisual {
  const root = new THREE.Group();
  root.name = `${VARKHUL_INTERCEPT_BEAM_VISUAL_NAME}-${bossId}`;
  root.userData.renderCategory = 'ui3d';
  root.userData.actionable = true;
  root.userData.bossId = bossId;

  const corridor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    material(0xff4a0c, 0.22),
  );
  corridor.name = 'varkhul-tempering-ray-corridor';
  corridor.renderOrder = 12;

  const sheath = lineMesh('varkhul-tempering-ray-sheath', SHEATH_RADIUS, 0xff4d0a, 0.58);
  const core = lineMesh('varkhul-tempering-ray-core', CORE_RADIUS, 0xffe08a, 0.94);
  const interceptedSheath = lineMesh(
    'varkhul-tempering-ray-intercept-sheath',
    SHEATH_RADIUS * 1.35,
    0x00bde8,
    0.86,
  );
  const interceptedCore = lineMesh(
    'varkhul-tempering-ray-intercept-core',
    CORE_RADIUS * 1.45,
    0xa2fbff,
    1,
  );
  interceptedSheath.material.blending = THREE.NormalBlending;
  interceptedCore.material.blending = THREE.NormalBlending;
  interceptedSheath.renderOrder = 18;
  interceptedCore.renderOrder = 19;
  interceptedSheath.visible = false;
  interceptedCore.visible = false;

  const target = new THREE.Group();
  target.name = 'varkhul-tempering-ray-target';
  const targetOuter = new THREE.Mesh(
    new THREE.RingGeometry(1.65, 1.94, 48).rotateX(-Math.PI / 2),
    material(0xff3514, 0.92),
  );
  targetOuter.name = 'varkhul-tempering-ray-target-outer';
  targetOuter.position.y = GROUND_LIFT;
  const targetInner = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.82, 32).rotateX(-Math.PI / 2),
    material(0xffca55, 0.94),
  );
  targetInner.name = 'varkhul-tempering-ray-target-inner';
  targetInner.position.y = GROUND_LIFT + 0.025;
  const targetSpire = new THREE.Mesh(
    new THREE.ConeGeometry(0.52, 2.6, 8, 1, true),
    material(0xff5b12, 0.6),
  );
  targetSpire.name = 'varkhul-tempering-ray-target-spire';
  targetSpire.position.y = 1.5;
  targetSpire.rotation.x = Math.PI;
  target.add(targetOuter, targetInner, targetSpire);

  const blocker = new THREE.Group();
  blocker.name = 'varkhul-tempering-ray-blocker';
  blocker.visible = false;
  const blockerRing = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.52, 40).rotateX(-Math.PI / 2),
    material(0x61efff, 0.98),
  );
  blockerRing.name = 'varkhul-tempering-ray-blocker-ring';
  blockerRing.position.y = GROUND_LIFT + 0.04;
  const blockerShield = new THREE.Mesh(
    new THREE.CircleGeometry(0.78, 28),
    material(0xc8ffff, 0.46),
  );
  blockerShield.name = 'varkhul-tempering-ray-blocker-shield';
  blockerShield.position.y = 1.25;
  blocker.add(blockerRing, blockerShield);

  root.add(corridor, sheath, core, interceptedSheath, interceptedCore, target, blocker);
  return {
    root,
    corridor,
    sheath,
    core,
    interceptedSheath,
    interceptedCore,
    target,
    targetOuter,
    targetInner,
    targetSpire,
    blocker,
    blockerRing,
    blockerShield,
    remaining: 0,
    duration: 1,
    phase: 0,
    blocked: false,
  };
}

function disposeVisual(visual: InterceptBeamVisual): void {
  visual.root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const entry of materials) entry.dispose();
  });
  visual.root.removeFromParent();
}

function syncVisual(
  visual: InterceptBeamVisual,
  beam: ActiveVarkhulInterceptBeam,
  groundY: (x: number, z: number) => number,
  direction: THREE.Vector3,
  source: THREE.Vector3,
  target: THREE.Vector3,
  blocker: THREE.Vector3,
): void {
  const sourceGround = groundY(beam.sourceX, beam.sourceZ);
  const targetGround = groundY(beam.targetX, beam.targetZ);
  source.set(beam.sourceX, sourceGround + SOURCE_HEIGHT, beam.sourceZ);
  target.set(beam.targetX, targetGround + TARGET_HEIGHT, beam.targetZ);
  setLineBetween(visual.sheath, source, target, SHEATH_RADIUS, direction);
  setLineBetween(visual.core, source, target, CORE_RADIUS, direction);

  const dx = beam.targetX - beam.sourceX;
  const dz = beam.targetZ - beam.sourceZ;
  const groundLength = Math.hypot(dx, dz);
  visual.corridor.visible = groundLength > 1e-4;
  if (visual.corridor.visible) {
    visual.corridor.position.set(
      (beam.sourceX + beam.targetX) * 0.5,
      Math.max(sourceGround, targetGround) + GROUND_LIFT,
      (beam.sourceZ + beam.targetZ) * 0.5,
    );
    visual.corridor.rotation.y = Math.atan2(dx, dz);
    visual.corridor.scale.set(beam.width * 2, 1, groundLength);
  }
  visual.target.position.set(beam.targetX, targetGround, beam.targetZ);

  visual.blocked = beam.blockerId !== null && beam.blockerX !== null && beam.blockerZ !== null;
  visual.blocker.visible = visual.blocked;
  visual.interceptedSheath.visible = visual.blocked;
  visual.interceptedCore.visible = visual.blocked;
  if (visual.blocked && beam.blockerX !== null && beam.blockerZ !== null) {
    const blockerGround = groundY(beam.blockerX, beam.blockerZ);
    blocker.set(beam.blockerX, blockerGround + TARGET_HEIGHT, beam.blockerZ);
    setLineBetween(visual.interceptedSheath, source, blocker, SHEATH_RADIUS * 1.35, direction);
    setLineBetween(visual.interceptedCore, source, blocker, CORE_RADIUS * 1.45, direction);
    visual.blocker.position.set(beam.blockerX, blockerGround, beam.blockerZ);
    visual.blockerShield.rotation.y = Math.atan2(
      beam.sourceX - beam.blockerX,
      beam.sourceZ - beam.blockerZ,
    );
  }
  visual.remaining = beam.remaining;
  visual.duration = beam.duration;
  visual.root.userData.targetId = beam.targetId;
  visual.root.userData.blockerId = beam.blockerId;
  visual.root.userData.blocked = visual.blocked;
  visual.root.userData.width = beam.width;
  visual.root.userData.remaining = beam.remaining;
}

export function buildVarkhulInterceptBeamPrewarmVisual(): THREE.Group {
  const visual = createVisual(0);
  visual.root.name = 'varkhul-tempering-ray-prewarm';
  const beam: ActiveVarkhulInterceptBeam = {
    sourceId: 0,
    targetId: 1,
    blockerId: 2,
    sourceX: -4,
    sourceZ: 0,
    targetX: 4,
    targetZ: 0,
    blockerX: 0,
    blockerZ: 0,
    width: VARKHUL_INTERCEPT_BEAM_HALF_WIDTH,
    duration: VARKHUL_INTERCEPT_BEAM_CAST_SECONDS,
    remaining: VARKHUL_INTERCEPT_BEAM_CAST_SECONDS * 0.5,
  };
  syncVisual(
    visual,
    beam,
    () => 0,
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  );
  return visual.root;
}

export class VarkhulInterceptBeamVisuals {
  private readonly visuals = new Map<number, InterceptBeamVisual>();
  private readonly activeIds = new Set<number>();
  private readonly direction = new THREE.Vector3();
  private readonly source = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly blocker = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(assemblies: readonly ActiveVarkhulAssembly[]): void {
    this.activeIds.clear();
    for (const state of assemblies) {
      const beam = state.interceptBeam;
      if (!beam) continue;
      this.activeIds.add(state.bossId);
      let visual = this.visuals.get(state.bossId);
      if (!visual) {
        visual = createVisual(state.bossId);
        this.scene.add(visual.root);
        this.visuals.set(state.bossId, visual);
      }
      syncVisual(
        visual,
        beam,
        this.groundY,
        this.direction,
        this.source,
        this.target,
        this.blocker,
      );
    }
    for (const [bossId, visual] of this.visuals) {
      if (this.activeIds.has(bossId)) continue;
      disposeVisual(visual);
      this.visuals.delete(bossId);
    }
  }

  update(dt: number, reducedMotion = false): void {
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) visual.phase = (visual.phase + Math.max(0, dt) * 5.5) % (Math.PI * 2);
      const progress = THREE.MathUtils.clamp(
        1 - visual.remaining / Math.max(0.05, visual.duration),
        0,
        1,
      );
      const pulse = reducedMotion ? 0.65 : 0.5 + 0.5 * Math.sin(visual.phase);
      visual.corridor.material.opacity = 0.15 + progress * 0.18;
      visual.sheath.material.opacity = 0.42 + progress * 0.26;
      visual.core.material.opacity = 0.82 + progress * 0.18;
      visual.targetOuter.material.opacity = 0.74 + progress * 0.2;
      visual.targetInner.material.opacity = 0.78 + pulse * 0.18;
      visual.targetSpire.material.opacity = 0.4 + progress * 0.26;
      visual.targetOuter.scale.setScalar(reducedMotion ? 1 : 0.94 + pulse * 0.1);
      visual.targetInner.rotation.y = reducedMotion ? 0 : visual.phase;
      if (visual.blocked) {
        visual.interceptedSheath.material.opacity = 0.62 + progress * 0.2;
        visual.interceptedCore.material.opacity = 0.9 + progress * 0.1;
        visual.blockerRing.material.opacity = 0.82 + pulse * 0.16;
        visual.blockerRing.scale.setScalar(reducedMotion ? 1 : 0.96 + pulse * 0.08);
        visual.blockerShield.material.opacity = 0.38 + progress * 0.18;
      }
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
    this.activeIds.clear();
  }
}
