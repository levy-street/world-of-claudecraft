// The vein crystals' painter (plan: vein_crystal_core.ts): at the head of each vein's light
// river, in its guardian's arena, a low collar of dark slabs over the ribbon's bare end, and
// the small crystal of that vein's element that grows out of it when the guardian dies
// (public/models/props/smith_heart_vein_crystals.glb: the Tripo builds of the owner's four
// ChatGPT sheets, docs/design/raid/kit/vein_crystals_src/README.md).
//
// One GLB, one painting: per vein a `<Vein>_Collar` and a `<Vein>_Crystal` node. Each part is
// one mesh on its own clone of the file's material, the painting doubling as its glow map, so
// a vein's light is one number per part (the collar's seam dim while its guardian lives, the
// crystal's flare as it is born) and all eight share one program. The crystal grows by its
// own scale from the collar's floor, its foot inside the slabs. Presentation only, read from
// the seal's view; whole for a late arrival; every tier (which guardians have fallen is the
// raid's progress). No collider (see the core).
//
// GPU preparation: built with the interior, under its group, so the interior's gate links the
// one program and uploads the one painting whether a crystal is shown yet or not (the walk
// takes hidden meshes too); a crystal showing at its guardian's death flips `visible` and
// changes no program key. A model that lands after the interior joins hidden behind the live
// gate (`heartKitCompileGate`), as the ring crystal does. Fetched on the deferred lane, never
// at boot. Stand-in: none needed: a model that never lands leaves the river's head as it was.

import * as THREE from 'three';
import {
  SMITH_HEART_FIELD,
  SMITH_HEART_VEINS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { loadGltf, releaseGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { heartKitCompileGate } from './heart_kit';
import type { HeartSealView } from './heart_seal_core';
import {
  newVeinCrystalPose,
  planVeinCrystals,
  SMITH_HEART_VEIN_CRYSTALS_URL,
  VEIN_CRYSTAL,
  veinCrystalNodes,
  veinCrystalPoseInto,
  veinCrystalSettled,
} from './vein_crystal_core';

/** How long the interior waits for the model before it builds without it. */
const WAIT_MS = 8000;

/** How strongly each part's painting glows at level 1: the crystal lit from within, the
 *  collar's stone barely (its seam is the bright paint, so it carries the light). */
export const VEIN_CRYSTAL_GLOW = { crystal: 0.62, collar: 0.5 } as const;

interface VeinParts {
  collar: THREE.BufferGeometry;
  crystal: THREE.BufferGeometry;
}

export interface VeinCrystalModel {
  parts: Partial<Record<SmithHeartVein, VeinParts>>;
  material: THREE.MeshStandardMaterial;
}

let model: VeinCrystalModel | null = null;
let loaded = false;
let loading: Promise<void> | null = null;

function meshOf(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (found || o.name !== name) return;
    const direct = o as THREE.Mesh;
    if (direct.isMesh) found = direct;
    else found = (o.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh) ?? null;
  });
  return found;
}

/** A part's geometry in the model's own frame: the shipped file quantizes its vertex data
 *  and leaves the way back on the node, so the values are read out as plain floats and the
 *  node's transform is baked in (the cached parse is never touched). */
function bakePart(mesh: THREE.Mesh): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
  ] as const) {
    const attr = mesh.geometry.getAttribute(name);
    if (!attr) continue;
    const values = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++)
      for (let j = 0; j < size; j++) values[i * size + j] = attr.getComponent(i, j);
    out.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  if (mesh.geometry.index) out.setIndex(mesh.geometry.index.clone());
  out.applyMatrix4(mesh.matrixWorld);
  out.computeBoundingSphere();
  return out;
}

/** The model's parts read off a loaded scene (the GLB's, or a test's own): every vein's
 *  collar and crystal by node name, and the one material they share. Null when the scene
 *  holds no vein's pair. */
export function bakeVeinCrystalModel(scene: THREE.Object3D): VeinCrystalModel | null {
  scene.updateMatrixWorld(true);
  const parts: Partial<Record<SmithHeartVein, VeinParts>> = {};
  let material: THREE.MeshStandardMaterial | null = null;
  for (const vein of SMITH_HEART_VEINS) {
    const names = veinCrystalNodes(vein);
    const collar = meshOf(scene, names.collar);
    const crystal = meshOf(scene, names.crystal);
    if (!collar || !crystal) continue;
    parts[vein] = { collar: bakePart(collar), crystal: bakePart(crystal) };
    material ??= (
      Array.isArray(collar.material) ? collar.material[0] : collar.material
    ) as THREE.MeshStandardMaterial | null;
  }
  return material ? { parts, material } : null;
}

function startLoad(): Promise<void> {
  loading ??= loadGltf(`/${SMITH_HEART_VEIN_CRYSTALS_URL}`)
    .then((gltf) => {
      model = bakeVeinCrystalModel(gltf.scene);
      releaseGltf(`/${SMITH_HEART_VEIN_CRYSTALS_URL}`);
    })
    .catch(() => undefined)
    .then(() => {
      loaded = true;
    });
  return loading;
}

// World content: fetched on the deferred lane once the game starts.
if (typeof window !== 'undefined') {
  registerDeferredPreload(() => startLoad());
}

/** Fetch the crystals once. Never rejects; resolves within the wait cap (a later arrival
 *  lands under the group: `buildVeinCrystals`). */
export function ensureVeinCrystals(): Promise<void> {
  if (loaded || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([startLoad(), new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS))]);
}

export interface VeinCrystals {
  group: THREE.Group;
  /** Write each vein's crystal from the seal's view (seconds since each vein lit). */
  update(view: HeartSealView): void;
}

interface Built {
  vein: number;
  crystal: THREE.Mesh;
  collarMat: THREE.MeshStandardMaterial;
  crystalMat: THREE.MeshStandardMaterial;
  /** The last written state, quantized (NaN: never written). */
  key: number;
}

/** One part's material: the file's own, its painting lit from within by `level`. */
function partMaterial(base: THREE.MeshStandardMaterial, name: string): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = name;
  m.emissiveMap = base.map;
  m.emissive.setRGB(1, 1, 1);
  m.emissiveIntensity = 0;
  return m;
}

/** Build every vein's collar and (hidden) crystal from a baked model, each on its river's
 *  head in the interior's own frame. */
export function buildVeinCrystalMeshes(m: VeinCrystalModel): { root: THREE.Group; built: Built[] } {
  const root = new THREE.Group();
  root.name = 'veinCrystals';
  const built: Built[] = [];
  for (const spot of planVeinCrystals()) {
    const parts = m.parts[spot.vein];
    if (!parts) continue;
    const holder = new THREE.Group();
    holder.name = `veinCrystal:${spot.vein}`;
    const y = authoredFieldHeight(SMITH_HEART_FIELD, spot.x, spot.z);
    holder.position.set(spot.x, y - VEIN_CRYSTAL.sink, spot.z);
    holder.rotation.y = spot.yaw;
    holder.scale.setScalar(VEIN_CRYSTAL.collarR);
    const collarMat = partMaterial(m.material, `smithHeartVeinCollar:${spot.vein}`);
    const crystalMat = partMaterial(m.material, `smithHeartVeinCrystal:${spot.vein}`);
    const collar = new THREE.Mesh(parts.collar, collarMat);
    collar.name = `veinCrystal:${spot.vein}:collar`;
    const crystal = new THREE.Mesh(parts.crystal, crystalMat);
    crystal.name = `veinCrystal:${spot.vein}:crystal`;
    crystal.visible = false;
    for (const mesh of [collar, crystal]) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      holder.add(mesh);
    }
    root.add(holder);
    built.push({
      vein: SMITH_HEART_VEINS.indexOf(spot.vein),
      crystal,
      collarMat,
      crystalMat,
      key: Number.NaN,
    });
  }
  return { root, built };
}

/** Write one vein's state (skipped while nothing about it changes). */
function paint(b: Built, since: number, pose = newVeinCrystalPose()): void {
  veinCrystalPoseInto(since, pose);
  // Quantized: at rest (asleep, or settled) the key holds and nothing is written. While it
  // grows every written value has its own field of the key, so none can change unseen.
  const key = pose.shown
    ? veinCrystalSettled(since)
      ? -1
      : ((Math.round(pose.rise * 256) * 512 + Math.round(pose.glow * 64)) * 256 +
          Math.round(pose.collar * 64)) *
          128 +
        Math.round(pose.girth * 64) +
        1
    : 0;
  if (key === b.key) return;
  b.key = key;
  b.crystal.visible = pose.shown;
  b.crystal.scale.set(pose.girth, pose.rise, pose.girth);
  b.crystalMat.emissiveIntensity = VEIN_CRYSTAL_GLOW.crystal * pose.glow;
  b.collarMat.emissiveIntensity = VEIN_CRYSTAL_GLOW.collar * pose.collar;
}

/** The slot's vein crystals (the interior adds the group and drives `update`). */
export function buildVeinCrystals(from: VeinCrystalModel | null = model): VeinCrystals {
  const group = new THREE.Group();
  group.name = 'smithHeartVeinCrystals';
  let built: Built[] = [];
  const pose = newVeinCrystalPose();
  if (from) {
    const b = buildVeinCrystalMeshes(from);
    group.add(b.root);
    built = b.built;
  } else if (!loaded) {
    // Not landed yet: the crystals arrive under this group, linked behind the live gate.
    void startLoad().then(() => {
      if (!model || !group.parent || built.length > 0) return;
      const b = buildVeinCrystalMeshes(model);
      b.root.visible = false;
      group.add(b.root);
      built = b.built;
      const gate = heartKitCompileGate();
      if (!gate) {
        b.root.visible = true;
        return;
      }
      void gate(b.root)
        .catch(() => {})
        .then(() => {
          b.root.visible = true;
        });
    });
  }
  return {
    group,
    update(view) {
      for (const b of built) paint(b, view.since[b.vein] ?? -1, pose);
    },
  };
}
