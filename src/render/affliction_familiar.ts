import * as THREE from 'three';
import type { IWorld } from '../world_api';
import {
  type AfflictionFamiliarPose,
  afflictionFamiliarLookYaw,
  isAfflictionFamiliarPossessed,
  shouldShowAfflictionFamiliar,
  writeAfflictionFamiliarPose,
} from './affliction_familiar_core';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';

const MODEL_HEIGHT = 0.65;
const MODEL_FORWARD_YAW = -Math.PI / 2;
const MODEL_URL = '/models/props/maledict_eye.glb';

let loadedMaledictEye: THREE.Group | null = null;

if (typeof window !== 'undefined') {
  // Deferred, never eager: a module-import registerPreload joins the launch
  // fetch burst and re-opens the WKWebView OOM lane the deferred gate exists
  // to prevent (tests/defer_launcher_preloads.test.ts pins the sanctioned set).
  registerDeferredPreload(() =>
    loadGltf(MODEL_URL).then((gltf) => {
      loadedMaledictEye = gltf.scene;
    }),
  );
}

interface AfflictionFamiliarHostView {
  group: THREE.Group;
}

interface FamiliarEntry {
  host: THREE.Group;
  root: THREE.Group;
}

export type AfflictionFamiliarModelFactory = () => THREE.Object3D | null;

function buildApprovedMaledictEye(): THREE.Object3D | null {
  if (!loadedMaledictEye) return null;
  // The loader cache is immutable. The familiar owns only this cloned transform
  // graph; geometry, textures, and materials remain shared and untouched.
  const model = loadedMaledictEye.clone(true);
  model.name = 'approved-maledict-eye-model';
  model.position.y = -MODEL_HEIGHT / 2;
  // Turn the approved mesh's iris toward the owner's local +Z, its forward axis.
  model.rotation.y = MODEL_FORWARD_YAW;
  return model;
}

/**
 * Presentation-only companion for the local Affliction warlock.
 * It is deliberately not a sim entity, target, pet, collider, or gameplay actor.
 */
export class AfflictionFamiliar {
  private entry: FamiliarEntry | null = null;
  private readonly pose: AfflictionFamiliarPose = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
  };

  constructor(
    private readonly modelFactory: AfflictionFamiliarModelFactory = buildApprovedMaledictEye,
  ) {}

  update(
    world: IWorld,
    views: ReadonlyMap<number, AfflictionFamiliarHostView>,
    reducedMotion = false,
    timeSeconds = performance.now() / 1000,
  ): void {
    const owner = world.entities.get(world.playerId);
    const host = views.get(world.playerId)?.group;
    const visible =
      !!owner && !!host && shouldShowAfflictionFamiliar(owner, world.playerId, world.talentSpec);

    if (
      this.entry &&
      (!visible || this.entry.host !== host || this.entry.root.parent !== this.entry.host)
    ) {
      this.clear();
    }
    if (!visible || !owner || !host) return;

    if (!this.entry) {
      const model = this.modelFactory();
      if (!model) return;
      const root = new THREE.Group();
      root.name = 'affliction-familiar';
      root.add(model);
      host.add(root);
      this.entry = { host, root };
    }

    writeAfflictionFamiliarPose(this.pose, timeSeconds, owner.id, reducedMotion);
    const possessed = isAfflictionFamiliarPossessed(owner);
    const root = this.entry.root;
    root.position.set(this.pose.x, this.pose.y, this.pose.z);
    const targetView = views.get(owner.castTargetId ?? owner.targetId ?? -1);
    const yaw =
      possessed && targetView
        ? afflictionFamiliarLookYaw(
            host.position.x,
            host.position.z,
            host.rotation.y,
            targetView.group.position.x,
            targetView.group.position.z,
          )
        : this.pose.yaw;
    root.rotation.set(this.pose.pitch, yaw, this.pose.roll);
    root.scale.setScalar((possessed ? 1.15 : 1) / Math.max(0.01, owner.scale));
  }

  clear(): void {
    this.entry?.root.removeFromParent();
    this.entry = null;
  }
}
