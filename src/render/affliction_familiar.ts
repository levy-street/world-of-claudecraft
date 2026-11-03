import * as THREE from 'three';
import type { IWorld } from '../world_api';
import {
  AFFLICTION_FAMILIAR_HEAD_LIFT,
  type AfflictionFamiliarPose,
  afflictionFamiliarClass,
  afflictionFamiliarHoverY,
  afflictionFamiliarLookYaw,
  isAfflictionFamiliarHeadBone,
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
  /** Unscaled model height (the renderer's view height); the eye hovers at
   *  its owner's head from it. */
  height?: number;
  /** The rider body inside the group. A mount lifts it onto the saddle (and a
   *  moving seat shifts it), so the eye follows its offset to stay by the head. */
  visual?: { root: THREE.Object3D } | null;
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
 * disposed. Null for any other class and before the deferred model has loaded:
 * there, a remote Hexcraft warlock's first eye rides the first attach's gate.
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

/** One eye: its built root (kept across hides so a re-show links nothing) and
 *  the view group it currently sits on. */
interface FamiliarSlot {
  root: THREE.Group;
  host: THREE.Group | null;
  /** The owner's head bone, resolved once per rider body (`headOf`), so the
   *  eye follows the real head standing, seated on a mount, or mid-animation. */
  head: THREE.Object3D | null;
  headOf: THREE.Object3D | null;
}

const headScratch = new THREE.Vector3();

/**
 * Presentation-only companion for every Affliction warlock in view, the local
 * player and everyone else alike. It is deliberately not a sim entity, target,
 * pet, collider, or gameplay actor.
 */
export class AfflictionFamiliar {
  // One slot per warlock, kept across hides: each clone shares the loader
  // cache's materials, so a re-attach after a spec switch links nothing, and
  // only the very first attach rides the compile gate (a pending gate keeps
  // that root hidden across a re-attach too, since the gate owns its visibility).
  private readonly slots = new Map<number, FamiliarSlot>();
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
    for (const [id, slot] of this.slots) {
      const owner = world.entities.get(id);
      const view = views.get(id);
      const visible =
        !!owner && !!view && shouldShowAfflictionFamiliar(owner, world.playerId, world.talentSpec);
      if (!visible || slot.host !== view.group || slot.root.parent !== slot.host) {
        this.hide(slot);
      }
      if (!owner) this.slots.delete(id);
    }
    for (const owner of world.entities.values()) {
      if (owner.kind !== 'player') continue;
      const view = views.get(owner.id);
      if (!view || !shouldShowAfflictionFamiliar(owner, world.playerId, world.talentSpec)) continue;
      const slot = this.slots.get(owner.id) ?? this.buildSlot(owner.id);
      if (!slot) continue;
      if (!slot.host) this.attach(slot, view.group);
      this.pose3d(slot, owner, view, views, reducedMotion, timeSeconds);
    }
  }

  clear(): void {
    for (const slot of this.slots.values()) this.hide(slot);
  }

  private attach(slot: FamiliarSlot, host: THREE.Group): void {
    slot.host = host;
    if (this.gated) {
      host.add(slot.root);
    } else {
      this.gated = true;
      void attachSceneGroupGated(host, slot.root, this.compileGate());
    }
  }

  private hide(slot: FamiliarSlot): void {
    slot.root.removeFromParent();
    slot.host = null;
  }

  private pose3d(
    slot: FamiliarSlot,
    owner: NonNullable<ReturnType<IWorld['entities']['get']>>,
    view: AfflictionFamiliarHostView,
    views: ReadonlyMap<number, AfflictionFamiliarHostView>,
    reducedMotion: boolean,
    timeSeconds: number,
  ): void {
    const host = view.group;
    const head = this.headOf(slot, view);
    // Beside the head bone, in the owner's local space: it already carries a
    // mount's seat lift and a seated rider's lower head. Without a head bone,
    // fall back to head height from the model height plus the seat offset.
    let offX = 0;
    let offZ = 0;
    let baseY: number;
    if (head) {
      head.getWorldPosition(headScratch);
      host.worldToLocal(headScratch);
      offX = headScratch.x;
      offZ = headScratch.z;
      baseY = headScratch.y + AFFLICTION_FAMILIAR_HEAD_LIFT;
    } else {
      const seat = view.visual?.root.position;
      offX = seat?.x ?? 0;
      offZ = seat?.z ?? 0;
      baseY = afflictionFamiliarHoverY(view.height) + (seat?.y ?? 0);
    }
    writeAfflictionFamiliarPose(this.pose, timeSeconds, owner.id, reducedMotion, baseY);
    const possessed = isAfflictionFamiliarPossessed(owner);
    const root = slot.root;
    root.position.set(this.pose.x + offX, this.pose.y, this.pose.z + offZ);
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

  /** The owner's head bone, re-resolved only when the rider body changes. */
  private headOf(slot: FamiliarSlot, view: AfflictionFamiliarHostView): THREE.Object3D | null {
    const body = view.visual?.root ?? null;
    if (body !== slot.headOf) {
      slot.headOf = body;
      slot.head = null;
      body?.traverse((node) => {
        if (!slot.head && (node as THREE.Bone).isBone && isAfflictionFamiliarHeadBone(node)) {
          slot.head = node;
        }
      });
    }
    return slot.head;
  }

  private buildSlot(id: number): FamiliarSlot | null {
    const model = this.modelFactory();
    if (!model) return null;
    const root = new THREE.Group();
    root.name = 'affliction-familiar';
    root.add(model);
    const slot: FamiliarSlot = { root, host: null, head: null, headOf: null };
    this.slots.set(id, slot);
    return slot;
  }
}
