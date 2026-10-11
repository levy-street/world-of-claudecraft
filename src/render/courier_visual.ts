import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  type CourierVisualInfo,
  type CourierVisualPose,
  courierFacing,
  courierVisualPoseInto,
} from './courier_visual_core';
import { attachSceneGroupGated } from './gated_scene_attach';

const COURIER_MODEL_URL = '/models/creatures/courier_donkey.glb';
/** Horse buddy's grounded height in PR #4240: base 0.75 times buddy scale 1.701. */
export const COURIER_HEIGHT = 1.27575;
let source: THREE.Group | null = null;
let sourceClips: THREE.AnimationClip[] = [];
if (typeof window !== 'undefined') {
  registerDeferredPreload(() =>
    loadGltf(COURIER_MODEL_URL).then((gltf) => {
      source = gltf.scene;
      sourceClips = gltf.animations;
    }),
  );
}

/** Clone before removing the authored hover: game travel owns all altitude. */
export function courierAnimationClips(
  clips: readonly THREE.AnimationClip[],
): THREE.AnimationClip[] {
  return clips.map((original) => {
    const clip = original.clone();
    if (clip.name === 'Fly')
      clip.tracks = clip.tracks.filter((track) => track.name !== 'root.position');
    return clip;
  });
}

/** One self-owned decorative courier, outside the combat and targeting maps. */
export class CourierVisual {
  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private disposed = false;
  private previousX = 0;
  private previousZ = 0;
  private hasPosition = false;
  private movingHold = 0;
  private readonly pose: CourierVisualPose = { lift: 0, flight: 0, moving: false };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly compileGate: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'courier:self';
  }

  private createModel(): boolean {
    if (!source) return false;
    const model = clone(source) as THREE.Group;
    this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of courierAnimationClips(sourceClips)) {
      const action = this.mixer.clipAction(clip).play();
      action.setEffectiveWeight(clip.name === 'Idle' ? 1 : 0);
      this.actions.set(clip.name, action);
    }
    // Match the existing character adapter's posed bounds, not the rig's bind pose.
    this.mixer.update(0.5);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const skin = mesh as THREE.SkinnedMesh;
      if (skin.isSkinnedMesh) skin.skeleton.update();
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i);
        if (skin.isSkinnedMesh) skin.applyBoneTransform(i, point);
        bounds.expandByPoint(point.applyMatrix4(mesh.matrixWorld));
      }
      // Animated wings can extend beyond the bind-pose box. This is one mesh.
      mesh.frustumCulled = false;
    });
    const scale = COURIER_HEIGHT / Math.max(0.001, bounds.max.y - bounds.min.y);
    model.scale.multiplyScalar(scale);
    model.position.y -= bounds.min.y * scale;
    this.root.add(model);
    void attachSceneGroupGated(this.scene, this.root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
    return true;
  }

  update(info: CourierVisualInfo | null, dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    if (!info) {
      if (this.model) this.model.visible = false;
      this.hasPosition = false;
      this.movingHold = 0;
      return;
    }
    if (!this.model && !this.createModel()) return;
    this.model!.visible = true;
    const elapsed = Math.max(0, Math.min(dt, 0.1));
    const moved =
      this.hasPosition && Math.hypot(info.x - this.previousX, info.z - this.previousZ) > 0.001;
    // Snapshots arrive slower than render frames; keep the follow-owner run between samples.
    this.movingHold = moved ? 0.15 : Math.max(0, this.movingHold - elapsed);
    courierVisualPoseInto(this.pose, info, this.movingHold > 0);
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
    this.actions.get('Idle')?.setEffectiveWeight(this.pose.moving ? 0 : 1);
    this.actions.get('Run')?.setEffectiveWeight(this.pose.moving ? 1 - this.pose.flight : 0);
    this.actions.get('Fly')?.setEffectiveWeight(this.pose.moving ? this.pose.flight : 0);
    // Reduced motion freezes the clip cycle, while weights still convey ground/flight state.
    this.mixer?.update(reducedMotion ? 0 : elapsed);
    this.model!.updateMatrix();
    this.root.updateMatrix();
  }

  dispose(): void {
    this.disposed = true;
    if (this.model) {
      this.mixer?.stopAllAction();
      this.mixer?.uncacheRoot(this.model);
      const skeletons = new Set<THREE.Skeleton>();
      this.model.traverse((node) => {
        const mesh = node as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
      });
      for (const skeleton of skeletons) skeleton.dispose();
    }
    this.actions.clear();
    this.mixer = null;
    this.root.removeFromParent();
    this.root.clear();
    this.model = null;
    // Geometry, materials and compressed textures remain owned by the immutable loader cache.
  }
}

export const courierPreloadInternalsForTest = {
  modelUrl: COURIER_MODEL_URL,
  setSourceForTest(value: THREE.Group | null, clips: THREE.AnimationClip[] = []): void {
    source = value;
    sourceClips = clips;
  },
};
