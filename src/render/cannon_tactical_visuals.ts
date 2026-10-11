import * as THREE from 'three';
import { CANNON_TACTICS } from '../sim/content/cannon_encounter';
import type { VehicleSession } from '../sim/types';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

export function cannonBarrelTemplate(source: THREE.Object3D): THREE.Group {
  const group = new THREE.Group();
  const model = source.clone(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -bounds.min.y, -center.z);
  group.add(model);
  group.scale.setScalar(1.8 / Math.max(size.y, 0.01));
  return group;
}

/** Bounded meshes compiled with the encounter, never allocated on impact. */
export class CannonTacticalVisuals {
  readonly root = new THREE.Group();
  private readonly ring = new THREE.RingGeometry(0.85, 1, 32);
  private readonly sphere = new THREE.SphereGeometry(1, 10, 6);
  private readonly barrels: { root: THREE.Group; marker: THREE.Mesh }[] = [];
  private readonly bursts: THREE.Mesh[] = [];
  private recoilModel: THREE.Object3D | null = null;
  private recoilBaseZ = 0;
  private stationId: string | null = null;

  constructor(
    template: THREE.Object3D,
    private readonly scene: THREE.Object3D,
  ) {
    this.root.name = 'cannon-tactics';
    const mats = worldQuestTraceMaterials();
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Group();
      root.add(template.clone(true));
      const marker = new THREE.Mesh(this.ring, mats.red);
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.15;
      marker.scale.setScalar(2.2);
      root.add(marker);
      this.root.add(root);
      this.barrels.push({ root, marker });
    }
    for (let i = 0; i < CANNON_TACTICS.feedbackLimit; i++) {
      const burst = new THREE.Mesh(this.sphere, mats.gold);
      this.root.add(burst);
      this.bursts.push(burst);
    }
  }

  update(
    session: VehicleSession | null | undefined,
    groundAt: (x: number, z: number) => number,
    reducedMotion: boolean,
  ): void {
    const state = session?.encounter;
    if (this.stationId !== (session?.stationId ?? null)) {
      this.restoreRecoil();
      this.stationId = session?.stationId ?? null;
    }
    this.root.visible = !!state;
    if (!state) {
      this.restoreRecoil();
      return;
    }
    if (!this.recoilModel)
      this.scene.traverse((node) => {
        if (node.userData.questObjectVisualItemId === this.stationId && node.children[0]) {
          this.recoilModel = node.children[0];
          this.recoilBaseZ = this.recoilModel.position.z;
        }
      });
    let shotAge = Infinity;
    for (const cue of state.feedback)
      if (cue.kind === 'shot') shotAge = Math.min(shotAge, state.tick - cue.tick);
    if (this.recoilModel)
      this.recoilModel.position.z =
        this.recoilBaseZ +
        (!reducedMotion && shotAge < 8 ? Math.sin((shotAge / 8) * Math.PI) * 0.45 : 0);
    for (let i = 0; i < this.barrels.length; i++) {
      const barrel = state.barrels[i],
        visual = this.barrels[i];
      visual.root.visible = !!barrel?.active;
      if (barrel) visual.root.position.set(barrel.x, groundAt(barrel.x, barrel.z), barrel.z);
    }
    for (let i = 0; i < this.bursts.length; i++) {
      const cue = state.feedback[i],
        mesh = this.bursts[i];
      const age = cue ? (state.tick - cue.tick) / 20 : 1;
      mesh.visible =
        !!cue &&
        (cue.kind === 'impact' || cue.kind === 'barrel' || cue.kind === 'armor') &&
        age < 0.65;
      if (!cue || !mesh.visible) continue;
      const radius =
        cue.kind === 'barrel' ? CANNON_TACTICS.barrelRadius : cue.kind === 'armor' ? 0.8 : 2;
      mesh.position.set(cue.x, groundAt(cue.x, cue.z) + 0.35, cue.z);
      const scale = radius * (reducedMotion ? 0.6 : 0.3 + age);
      mesh.scale.set(scale, reducedMotion ? 0.1 : Math.max(0.1, 1 - age * 1.5), scale);
    }
  }

  private restoreRecoil(): void {
    if (this.recoilModel) this.recoilModel.position.z = this.recoilBaseZ;
    this.recoilModel = null;
  }
  dispose(): void {
    this.restoreRecoil();
    this.root.removeFromParent();
    this.ring.dispose();
    this.sphere.dispose();
    // GLB geometry/materials and trace materials belong to their shared caches.
  }
}
