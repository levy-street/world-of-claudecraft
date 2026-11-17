// The ring crystal's painter (ring_crystal_core.ts plans it, ring_crystal_material.ts is
// its one material): the heart seal at the Ring's centre, ONE crystal of the four elements
// (public/models/props/smith_heart_ring_crystal.glb, the Tripo build of the owner's
// ChatGPT sheet, docs/design/raid/kit/ring_crystal_src/README.md).
//
// The model is a heap of pieces (the Blender build cut it along the Tripo shells:
// `Piece_NN_<plinth|body|heart>`). Whole, it draws as ONE merged mesh in the crystal's
// own frame (y up, its plinth centred on the origin); at the shatter the whole hides and
// the pieces take its place and fly (each its own mesh on one shared material, the matrix
// written by hand about the piece's centre, since the geometry stays in the crystal's frame
// for the shader's height and weights). Fetched with the raid's kits on the deferred lane
// (never at boot); a crystal that has not landed when the seal is built lands under the
// same group through the live compile gate, and a model that fails to load costs the seal
// its centrepiece, never the player the raid (the portal and the rivers stand).
//
// GPU preparation: the material is the slot's (built with the interior, its programs and
// its painting linked and uploaded by the interior's gate; the pieces share its program).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGltf, releaseGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { sharedUniforms } from '../gfx';
import { markSharedGeometry } from '../shared_resource';
import { heartKitCompileGate } from './heart_kit';
import {
  newRingCrystalPiecePose,
  newRingCrystalState,
  type RingCrystalPieceKind,
  type RingCrystalState,
  ringCrystalKey,
  ringCrystalPieceKind,
  ringCrystalPiecePose,
  ringCrystalTremble,
} from './ring_crystal_core';
import { ringCrystalMaterial } from './ring_crystal_material';

export const SMITH_HEART_RING_CRYSTAL_URL = '/models/props/smith_heart_ring_crystal.glb';

/** How long the interior waits for the model before it builds without it. */
const WAIT_MS = 8000;

interface CrystalPiece {
  kind: RingCrystalPieceKind;
  centre: THREE.Vector3;
  geometry: THREE.BufferGeometry;
}

interface CrystalModel {
  pieces: CrystalPiece[];
  whole: THREE.BufferGeometry;
  map: THREE.Texture;
}

let model: CrystalModel | null = null;
let loading: Promise<void> | null = null;
let loaded = false;

/** A copy of a loaded geometry with exactly the attributes the crystal reads, as plain
 *  floats (the file's are quantized), carried into the crystal's frame. */
function bakePiece(mesh: THREE.Mesh): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['uv', 2],
    ['_weights', 4],
    ['_path', 1],
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
  return out;
}

function bakeModel(scene: THREE.Object3D): CrystalModel | null {
  scene.updateMatrixWorld(true);
  const pieces: CrystalPiece[] = [];
  let map: THREE.Texture | null = null;
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const kind = ringCrystalPieceKind(node.name);
    if (!kind) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    map ??= (material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
    const geometry = markSharedGeometry(bakePiece(node));
    const pos = geometry.getAttribute('position');
    const centre = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) centre.add(new THREE.Vector3().fromBufferAttribute(pos, i));
    centre.divideScalar(Math.max(1, pos.count));
    pieces.push({ kind, centre, geometry });
  });
  if (!map || pieces.length === 0) return null;
  // The pieces in their node order (a piece's index seeds its flight).
  const whole = markSharedGeometry(
    mergeGeometries(
      pieces.map((p) => p.geometry),
      false,
    ),
  );
  return { pieces, whole, map };
}

function startLoad(): Promise<void> {
  loading ??= loadGltf(SMITH_HEART_RING_CRYSTAL_URL)
    .then((gltf) => {
      model = bakeModel(gltf.scene);
      releaseGltf(SMITH_HEART_RING_CRYSTAL_URL);
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

/** Fetch and bake the crystal once. Never rejects; resolves within the wait cap (a later
 *  arrival lands under the seal's group: `buildRingCrystal`). */
export function ensureRingCrystal(): Promise<void> {
  if (loaded || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([startLoad(), new Promise<void>((resolve) => setTimeout(resolve, WAIT_MS))]);
}

export function ringCrystalLoaded(): boolean {
  return loaded && model !== null;
}

export interface RingCrystal {
  group: THREE.Group;
  /** Write the crystal's state (the seal's lit elements, the ready swell, the burst). */
  update(state: RingCrystalState): void;
}

interface Built {
  root: THREE.Group;
  material: THREE.ShaderMaterial;
  whole: THREE.Mesh;
  pieces: { mesh: THREE.Mesh; piece: CrystalPiece }[];
}

function buildMeshes(m: CrystalModel): Built {
  const material = ringCrystalMaterial(m.map);
  const root = new THREE.Group();
  root.name = 'ringCrystal';
  const whole = new THREE.Mesh(m.whole, material);
  whole.name = 'ringCrystal:whole';
  whole.frustumCulled = false;
  root.add(whole);
  const pieces = m.pieces.map((piece, i) => {
    const mesh = new THREE.Mesh(piece.geometry, material);
    mesh.name = `ringCrystal:piece${i}`;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.visible = false;
    root.add(mesh);
    return { mesh, piece };
  });
  return { root, material, whole, pieces };
}

/** The crystal of one slot (the seal's group places it on the dais). */
export function buildRingCrystal(): RingCrystal {
  const group = new THREE.Group();
  group.name = 'smithHeartRingCrystal';
  let built: Built | null = null;
  let want: RingCrystalState = newRingCrystalState();
  let lastKey = -1;
  let lastBurst = -2;
  const pose = newRingCrystalPiecePose();
  const m4 = new THREE.Matrix4();
  const t4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const e4 = new THREE.Euler();
  const p4 = new THREE.Vector3();
  const s4 = new THREE.Vector3();

  const adopt = (b: Built): void => {
    built = b;
    lastKey = -1;
    lastBurst = -2;
  };
  if (model) {
    const b = buildMeshes(model);
    group.add(b.root);
    adopt(b);
  } else if (!loaded) {
    // Not landed yet: the crystal arrives under this group, linked behind the live gate.
    void startLoad().then(() => {
      if (!model || !group.parent || built) return;
      const b = buildMeshes(model);
      b.root.visible = false;
      group.add(b.root);
      adopt(b);
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
    update(state) {
      want = state;
      const b = built;
      if (!b) return;
      const burst = want.burstT >= 0;
      const keyed = ringCrystalKey(want);
      if (keyed !== lastKey) {
        lastKey = keyed;
        const u = b.material.uniforms;
        u.uFill.value.set(want.fill[0], want.fill[1], want.fill[2], want.fill[3]);
        u.uLevel.value.set(want.level[0], want.level[1], want.level[2], want.level[3]);
        u.uCrown.value = want.crown;
        u.uReady.value = want.ready;
        u.uCharge.value = want.charge;
      }
      if (!burst) {
        if (lastBurst !== -1) {
          lastBurst = -1;
          b.whole.visible = true;
          for (const p of b.pieces) p.mesh.visible = false;
        }
        // The overload's tremble: the whole crystal shakes (the sway grows with the charge).
        const sway = ringCrystalTremble(want.charge);
        const now = sharedUniforms.uTime.value;
        b.whole.position.set(
          sway > 0 ? Math.sin(now * 61) * sway : 0,
          0,
          sway > 0 ? Math.cos(now * 53) * sway : 0,
        );
        return;
      }
      // The pieces fly: every frame while any is on the move (the orbit never rests).
      lastBurst = want.burstT;
      b.whole.visible = false;
      b.whole.position.set(0, 0, 0);
      for (let i = 0; i < b.pieces.length; i++) {
        const { mesh, piece } = b.pieces[i];
        ringCrystalPiecePose(i, piece.kind, piece.centre, want.burstT, pose);
        mesh.visible = pose.visible;
        if (!pose.visible) continue;
        p4.set(piece.centre.x + pose.dx, piece.centre.y + pose.dy, piece.centre.z + pose.dz);
        q4.setFromEuler(e4.set(pose.rx, pose.ry, pose.rz));
        s4.setScalar(pose.scale);
        m4.compose(p4, q4, s4);
        t4.makeTranslation(-piece.centre.x, -piece.centre.y, -piece.centre.z);
        m4.multiply(t4);
        mesh.matrix.copy(m4);
        mesh.matrixWorldNeedsUpdate = true;
      }
    },
  };
}
