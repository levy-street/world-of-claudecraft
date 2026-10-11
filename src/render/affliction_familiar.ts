import * as THREE from 'three';
import type { IWorld } from '../world_api';
import {
  type AfflictionFamiliarPose,
  afflictionFamiliarClass,
  afflictionFamiliarLookYaw,
  isAfflictionFamiliarPossessed,
  shouldShowAfflictionFamiliar,
  writeAfflictionFamiliarPose,
} from './affliction_familiar_core';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { attachSceneGroupGated } from './gated_scene_attach';

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

export type AfflictionFamiliarModelFactory = () => THREE.Object3D | null;
/** The renderer's world compile gate, read at attach time; undefined without
 *  parallel compile, where the attach is a plain add. */
export type AfflictionFamiliarCompileGate = () =>
  | ((target: THREE.Object3D) => Promise<unknown>)
  | undefined;

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
 * The familiar's boot prewarm stand-in, staged with the player archetypes for a
 * LOCAL warlock of any spec. It is the clone the live familiar draws, so it
 * wears the loader cache's materials: the program linked here is the one every
 * attach reuses, held for the session because those materials are never
 * disposed. Null for any other class (the familiar is local-only) and before
 * the deferred model has loaded, where the first attach's gate covers it.
 */
export function buildAfflictionFamiliarPrewarmStandIn(
  localClass: string,
  modelFactory: AfflictionFamiliarModelFactory = buildApprovedMaledictEye,
): THREE.Object3D | null {
  if (!afflictionFamiliarClass(localClass)) return null;
  const model = modelFactory();
  if (!model) return null;
  const root = new THREE.Group();
  root.name = 'affliction-familiar:prewarm';
  root.add(model);
  return root;
}

/**
 * Presentation-only companion for the local Affliction warlock.
 * It is deliberately not a sim entity, target, pet, collider, or gameplay actor.
 */
export class AfflictionFamiliar {
  // Built once and re-attached on every show: its clone shares the loader
  // cache's materials, so a re-attach after a spec switch links nothing, and
  // only the first attach rides the compile gate (a pending gate keeps the
  // root hidden across a re-attach too, since the gate owns its visibility).
  private root: THREE.Group | null = null;
  private host: THREE.Group | null = null;
  private gated = false;
  private readonly pose: AfflictionFamiliarPose = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
  };

  constructor(
    private readonly compileGate: AfflictionFamiliarCompileGate = () => undefined,
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

    if (this.host && (!visible || this.host !== host || this.root?.parent !== this.host)) {
      this.clear();
    }
    if (!visible || !owner || !host) return;

    if (!this.host) {
      const root = this.root ?? this.buildRoot();
      if (!root) return;
      this.host = host;
      if (this.gated) {
        host.add(root);
      } else {
        this.gated = true;
        void attachSceneGroupGated(host, root, this.compileGate());
      }
    }

    writeAfflictionFamiliarPose(this.pose, timeSeconds, owner.id, reducedMotion);
    const possessed = isAfflictionFamiliarPossessed(owner);
    const root = this.root as THREE.Group;
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
    this.root?.removeFromParent();
    this.host = null;
  }

  private buildRoot(): THREE.Group | null {
    const model = this.modelFactory();
    if (!model) return null;
    const root = new THREE.Group();
    root.name = 'affliction-familiar';
    root.add(model);
    this.root = root;
    return root;
  }
}
