// Flying arrows for physical ranged shots (the hunter's Auto Shot / Long
// Draw): a real arrow mesh homing at the target instead of the generic magic
// comet, spawned by the renderer's 'ranged-shot' projectile arm. Flight
// mechanics mirror src/sim/projectile_travel.ts EXACTLY (same speed, reach,
// and max flight) so the visual lands the same tick the sim resolves the hit;
// those constants are imported, never restated.
import * as THREE from 'three';
import {
  PROJECTILE_MAX_FLIGHT,
  PROJECTILE_REACH,
  PROJECTILE_SPEED,
} from '../sim/projectile_travel';
import { buildArrowMesh } from './arrow_mesh';
import type { EntityAnchor } from './vfx';

interface FlyingArrow {
  mesh: THREE.Group;
  targetId: number;
  ttl: number;
}

const LAUNCH_LIFT = 0.62; // launch anchor height fraction (the vfx comet's)
const IMPACT_LIFT = 0.55;
const V_STEP = new THREE.Vector3();
const V_STEP2 = new THREE.Vector3();
const V_UP = new THREE.Vector3(0, 1, 0);

export class ArrowProjectiles {
  private readonly pool: THREE.Group[] = [];
  private readonly live: FlyingArrow[] = [];

  constructor(
    private scene: THREE.Scene,
    private anchor: EntityAnchor,
  ) {}

  spawn(sourceId: number, targetId: number): void {
    const from = this.anchor(sourceId, LAUNCH_LIFT);
    if (!from) return;
    const mesh = this.pool.pop() ?? buildArrowMesh();
    mesh.name = 'flying_arrow';
    mesh.position.copy(from);
    mesh.visible = true;
    this.scene.add(mesh);
    this.live.push({ mesh, targetId, ttl: PROJECTILE_MAX_FLIGHT });
    // face the target immediately so the first frame is not tip-up
    const to = this.anchor(targetId, IMPACT_LIFT);
    if (to) this.orient(mesh, V_STEP.copy(to).sub(from));
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const arrow = this.live[i];
      arrow.ttl -= dt;
      const to = this.anchor(arrow.targetId, IMPACT_LIFT);
      if (!to || arrow.ttl <= 0) {
        this.despawn(i);
        continue;
      }
      V_STEP.copy(to).sub(arrow.mesh.position);
      const dist = V_STEP.length();
      const step = PROJECTILE_SPEED * dt;
      if (dist <= PROJECTILE_REACH + step) {
        this.despawn(i);
        continue;
      }
      this.orient(arrow.mesh, V_STEP);
      arrow.mesh.position.addScaledVector(V_STEP, step / dist);
    }
  }

  /** Shaft (+Y authored) along the velocity. The group's origin is the NOCK,
   *  so the homing point is the tail and the tip leads by ARROW_LENGTH: with
   *  PROJECTILE_REACH just past the arrow's length, the tip visually meets the
   *  target on the same frame the sim resolves the hit. */
  private orient(mesh: THREE.Group, dir: THREE.Vector3): void {
    if (dir.lengthSq() < 1e-8) return;
    mesh.quaternion.setFromUnitVectors(V_UP, V_STEP2.copy(dir).normalize());
  }

  private despawn(i: number): void {
    const arrow = this.live[i];
    arrow.mesh.visible = false;
    this.scene.remove(arrow.mesh);
    this.pool.push(arrow.mesh);
    this.live.splice(i, 1);
  }

  dispose(): void {
    while (this.live.length) this.despawn(this.live.length - 1);
    this.pool.length = 0;
  }
}
