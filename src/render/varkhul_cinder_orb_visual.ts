// POWERFUL VFX prompt:
// Three marked raiders become separated forge vents. On release each vent
// scars the floor with permanent living fire while six oversized cinder orbs
// burst outward in a radial fan, crossing the arena with white-hot cores,
// translucent flame shells, and long directional tails. The floor hazards stay
// unmistakable; the moving silhouettes remain readable through bloom and smoke.

import * as THREE from 'three';
import type {
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
} from '../sim/varkhul_cinder_orbs';
import { fireballMaterials } from './fireball_travel_visual';
import { createGroundFireAoe, type GroundFireAoeHandle } from './ignivar_fire_vfx';

const SEGMENTS = 48;
const GROUND_LIFT = 0.09;
const PROJECTILE_HEIGHT = 1.05;
const CORE_GEOMETRY = new THREE.IcosahedronGeometry(0.76, 1);
// The flame shell is the actionable collision silhouette at the base 1.1-yard radius.
const SHELL_GEOMETRY = new THREE.IcosahedronGeometry(1.1, 1);
const TAIL_GEOMETRY = new THREE.ConeGeometry(0.34, 1.5, 7);

interface CinderFireVisual {
  group: THREE.Group;
  fire: GroundFireAoeHandle;
  fillMaterial: THREE.MeshBasicMaterial;
  edgeMaterial: THREE.MeshBasicMaterial;
}

interface CinderProjectileVisual {
  group: THREE.Group;
  shell: THREE.Mesh;
  tail: THREE.Group;
  phase: number;
}

function warningMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function buildVarkhulCinderFire(
  fireState: ActiveVarkhulCinderFire,
  groundY: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'varkhul-cinder-fire';
  group.position.set(fireState.x, groundY + GROUND_LIFT, fireState.z);
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.fireId = fireState.id;
  group.userData.sourceId = fireState.sourceId;
  group.userData.radius = fireState.radius;
  group.userData.permanent = true;

  const fillMaterial = warningMaterial(0xff2808, 0.24);
  const edgeMaterial = warningMaterial(0xffa329, 0.92);
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(fireState.radius * 0.82, SEGMENTS).rotateX(-Math.PI / 2),
    fillMaterial,
  );
  fill.name = 'varkhul-cinder-fire-fill';
  fill.renderOrder = 10;
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(fireState.radius * 0.82, fireState.radius, SEGMENTS).rotateX(
      -Math.PI / 2,
    ),
    edgeMaterial,
  );
  edge.name = 'varkhul-cinder-fire-edge';
  edge.position.y = 0.025;
  edge.renderOrder = 11;
  group.add(fill, edge);

  const fire = createGroundFireAoe({ radius: fireState.radius, count: 32 });
  fire.group.name = 'varkhul-cinder-fire-flames';
  fire.erupt();
  group.add(fire.group);

  group.userData.fire = fire;
  group.userData.fillMaterial = fillMaterial;
  group.userData.edgeMaterial = edgeMaterial;
  return group;
}

export function buildVarkhulCinderOrbProjectile(
  projectile: ActiveVarkhulCinderOrbProjectile,
  groundY: number,
): THREE.Group {
  const materials = fireballMaterials();
  const group = new THREE.Group();
  group.name = 'varkhul-cinder-orb-projectile';
  group.position.set(
    projectile.x,
    groundY + Math.max(PROJECTILE_HEIGHT, projectile.radius * 0.9),
    projectile.z,
  );
  group.rotation.y = Math.atan2(projectile.dirX, projectile.dirZ);
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.projectileId = projectile.id;
  group.userData.sourceId = projectile.sourceId;
  group.userData.radius = projectile.radius;
  group.userData.dirX = projectile.dirX;
  group.userData.dirZ = projectile.dirZ;
  group.scale.setScalar(projectile.radius / 1.1);

  const core = new THREE.Mesh(CORE_GEOMETRY, materials.ember);
  core.name = 'varkhul-cinder-orb-core';
  core.renderOrder = 14;
  const shell = new THREE.Mesh(SHELL_GEOMETRY, materials.flame);
  shell.name = 'varkhul-cinder-orb-shell';
  shell.renderOrder = 13;
  group.add(core, shell);

  const tail = new THREE.Group();
  tail.name = 'varkhul-cinder-orb-tail';
  tail.position.z = -0.65;
  for (let index = 0; index < 3; index++) {
    const flame = new THREE.Mesh(TAIL_GEOMETRY, materials.flame);
    flame.name = `varkhul-cinder-orb-tail-flame-${index}`;
    flame.rotation.x = -Math.PI / 2;
    const angle = (index * Math.PI * 2) / 3;
    flame.position.set(Math.cos(angle) * 0.25, Math.sin(angle) * 0.25, -0.3);
    flame.scale.setScalar(index === 0 ? 1 : 0.72);
    tail.add(flame);
  }
  group.add(tail);
  group.userData.shell = shell;
  group.userData.tail = tail;
  return group;
}

function disposeFire(visual: CinderFireVisual): void {
  visual.fire.dispose();
  for (const child of visual.group.children) {
    if (child === visual.fire.group) continue;
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  }
  visual.fillMaterial.dispose();
  visual.edgeMaterial.dispose();
  visual.group.removeFromParent();
}

export class VarkhulCinderOrbVisuals {
  private readonly fires = new Map<string, CinderFireVisual>();
  private readonly projectiles = new Map<string, CinderProjectileVisual>();
  private readonly activeFireIds = new Set<string>();
  private readonly activeProjectileIds = new Set<string>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(
    fires: readonly ActiveVarkhulCinderFire[],
    projectiles: readonly ActiveVarkhulCinderOrbProjectile[],
  ): void {
    this.activeFireIds.clear();
    for (const fireState of fires) {
      this.activeFireIds.add(fireState.id);
      if (this.fires.has(fireState.id)) continue;
      const group = buildVarkhulCinderFire(fireState, this.groundY(fireState.x, fireState.z));
      this.scene.add(group);
      this.fires.set(fireState.id, {
        group,
        fire: group.userData.fire as GroundFireAoeHandle,
        fillMaterial: group.userData.fillMaterial as THREE.MeshBasicMaterial,
        edgeMaterial: group.userData.edgeMaterial as THREE.MeshBasicMaterial,
      });
    }
    for (const [id, visual] of this.fires) {
      if (this.activeFireIds.has(id)) continue;
      disposeFire(visual);
      this.fires.delete(id);
    }

    this.activeProjectileIds.clear();
    for (const projectile of projectiles) {
      this.activeProjectileIds.add(projectile.id);
      let visual = this.projectiles.get(projectile.id);
      if (!visual) {
        const group = buildVarkhulCinderOrbProjectile(
          projectile,
          this.groundY(projectile.x, projectile.z),
        );
        visual = {
          group,
          shell: group.userData.shell as THREE.Mesh,
          tail: group.userData.tail as THREE.Group,
          phase: 0,
        };
        this.scene.add(group);
        this.projectiles.set(projectile.id, visual);
      }
      visual.group.position.set(
        projectile.x,
        this.groundY(projectile.x, projectile.z) +
          Math.max(PROJECTILE_HEIGHT, projectile.radius * 0.9),
        projectile.z,
      );
      visual.group.rotation.y = Math.atan2(projectile.dirX, projectile.dirZ);
      visual.group.scale.setScalar(projectile.radius / 1.1);
    }
    for (const [id, visual] of this.projectiles) {
      if (this.activeProjectileIds.has(id)) continue;
      visual.group.removeFromParent();
      this.projectiles.delete(id);
    }
  }

  update(dt: number, reducedMotion = false): void {
    const safeDt = Math.max(0, dt);
    for (const visual of this.fires.values()) visual.fire.update(safeDt);
    for (const visual of this.projectiles.values()) {
      if (!reducedMotion) visual.phase += safeDt * 7;
      // Never shrink the actionable flame shell inside the authoritative hit radius.
      const pulse = reducedMotion ? 1 : 1.05 + Math.sin(visual.phase) * 0.05;
      visual.shell.scale.setScalar(pulse);
      visual.shell.rotation.y = reducedMotion ? 0 : visual.phase * 0.65;
      visual.tail.scale.set(1, 1, reducedMotion ? 1.2 : 1.2 + pulse * 0.7);
    }
  }

  dispose(): void {
    for (const visual of this.fires.values()) disposeFire(visual);
    for (const visual of this.projectiles.values()) visual.group.removeFromParent();
    this.fires.clear();
    this.projectiles.clear();
    this.activeFireIds.clear();
    this.activeProjectileIds.clear();
  }
}
