import * as THREE from 'three';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  type CourierVisualInfo,
  courierFacing,
  courierVisualPoseInto,
} from './courier_visual_core';
import { attachSceneGroupGated } from './gated_scene_attach';
import { surfaceMat } from './gfx';

const COURIER_MODEL_URL = '/models/creatures/courier_donkey.glb';
let source: THREE.Group | null = null;
if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(COURIER_MODEL_URL).then((gltf) => {
      source = gltf.scene;
    }),
  );
}

/** One self-owned decorative courier, outside the combat-entity and targeting maps.
 * The HUD's journey state stays visible while this cosmetic model compiles. */
export class CourierVisual {
  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private left: THREE.Object3D | undefined;
  private right: THREE.Object3D | undefined;
  private disposed = false;
  private elapsed = 0;
  private previousX = 0;
  private previousZ = 0;
  private hasPosition = false;
  private readonly pose = { lift: 2, wing: 0, pitch: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly compileGate: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'courier:self';
  }

  update(info: CourierVisualInfo | null, dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    if (!info) {
      if (this.model) this.model.visible = false;
      this.hasPosition = false;
      return;
    }
    if (!this.model) {
      if (!source) return;
      // Clone transforms only: the loader's geometry and materials are immutable.
      this.model = source.clone(true);
      this.model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = surfaceMat({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.9,
          metalness: 0,
        });
        mesh.castShadow = false;
        mesh.receiveShadow = true;
      });
      this.left = this.model.getObjectByName('WingLeft');
      this.right = this.model.getObjectByName('WingRight');
      this.root.add(this.model);
      // The inner visibility remains authoritative even if a late gate resolves
      // after cancellation of a journey. Disposal cancels the outer reveal too.
      void attachSceneGroupGated(
        this.scene,
        this.root,
        this.compileGate,
        () => this.disposed,
      ).catch(() => {});
    }
    this.model.visible = true;
    this.elapsed += Math.max(0, Math.min(dt, 0.1));
    courierVisualPoseInto(this.pose, info.phase, this.elapsed, reducedMotion);
    if (this.hasPosition) {
      this.root.rotation.y = courierFacing(
        this.previousX,
        this.previousZ,
        info.x,
        info.z,
        this.root.rotation.y,
      );
    }
    this.previousX = info.x;
    this.previousZ = info.z;
    this.hasPosition = true;
    this.root.position.set(info.x, this.groundAt(info.x, info.z) + this.pose.lift, info.z);
    this.model.rotation.x = this.pose.pitch;
    if (this.left) {
      this.left.rotation.z = -this.pose.wing;
      this.left.updateMatrix();
    }
    if (this.right) {
      this.right.rotation.z = this.pose.wing;
      this.right.updateMatrix();
    }
    this.model.updateMatrix();
    this.root.updateMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    this.root.clear();
    this.model = null;
    this.left = undefined;
    this.right = undefined;
    // Geometry belongs to the loader cache; materials belong to surfaceMat.
  }
}

export const courierPreloadInternalsForTest = {
  modelUrl: COURIER_MODEL_URL,
  setSourceForTest(value: THREE.Group | null): void {
    source = value;
  },
};
