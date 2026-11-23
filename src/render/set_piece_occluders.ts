// Camera occlusion for built set pieces (the dungeon entrances): the engine
// has no general camera collision, every structure fades ITSELF when it stands
// between the chase camera and the character (the occluder-fade family,
// occluder_fade.ts). Buildings, the Duskfall gates and the dungeons each own
// such a pass; a static world feature had none, so a camera turned sideways in
// a gatehouse sat inside its tower. This is the one registry they share:
//
//   - a set piece's painter calls registerSetPieceOccluders(solids, roots) at
//     build and keeps the handle: `solids` are its collider rows in world
//     coordinates (one occluder box each, set_piece_occluders_core.ts),
//     `roots` the models that fade together when any of them blocks. Every
//     mesh under the roots gets its own clone of its material (the family
//     fades per structure, never a shared material), made here, at build, so
//     the clones link behind the feature's gated attach with the rest of it.
//     `onFade` tells the painter the alpha its set is drawn at, for the parts
//     of it that are not plain models (a shader window, a light);
//   - the renderer calls updateSetPieceOccluders(cam, eye, dt) once a frame,
//     beside the other fade passes. A set the eye-to-camera segment stays
//     clear of (its centre and radius, stored at registration) costs one
//     distance test and nothing else. A blocking set fades through
//     advanceOccluderFade (the family's own alpha, gate consult and
//     reduced-motion rule), and its fade programs are asked for ahead of the
//     first occlusion (prefetchOccluderFadeWithin);
//   - the renderer's teardown clears the registry beside the fade gate
//     (renderer_resource_lifecycle.ts), and buildStaticWorldFeatures clears
//     it before it builds, so no set outlives the renderer that drew it.
//
// THE VEIL. A set piece is masonry with real depth: every block is modelled,
// and a camera turned into a tower looks through a hundred of their faces. The
// family's blended ghost writes depth, but inside ONE mesh the triangles draw
// in index order, so each pixel blends however many faces happen to arrive
// nearer than the last: a patchwork of stacked panes, not a ghost. So a
// ghosted set first lays its own depth, colourless (a twin of each mesh on one
// shared depth-only material), and then draws: only its nearest surface
// passes, and the whole gatehouse reads as one even veil. Both draws move to
// the end of the transparent pass for as long as the set DRAWS ghosted, so
// the veil never hides the water or the fog behind it; everything a player
// acts on draws below SET_PIECE_VEIL_ORDER (pinned by the registry's test).
// The veil's program goes through the fade gate like the fade's own twin, and
// the ghost waits for it. The dithered ghost (the low and medium tiers) stays
// opaque and needs none.
//
// Nothing here knows which set piece it serves. Cosmetic only, on every tier.
import * as THREE from 'three';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import { ditherFadeEnabled } from './occluder_dither_fade';
import {
  advanceOccluderFade,
  applyOccluderFade,
  type OccluderFadeMat,
  occluderFadeRecordFor,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import { withinOccluderFadePrefetch } from './occluder_fade_core';
import { type OccluderFadeConsult, occluderFadeTwinReady } from './occluder_fade_gate';
import { occluderGhostMeshVariant, occluderGhostTargetOf } from './occluder_ghost_variant_key';
import {
  type SetPieceOccluderBox,
  type SetPieceSolid,
  setPieceBoxesBlock,
  setPieceBoxesCentre,
  setPieceBoxesRadius,
  setPieceOccluderBox,
  setPieceSegmentWithin,
} from './set_piece_occluders_core';
import { markOwnedMaterial, markSharedMaterial } from './shared_resource';

/** Where a ghosted set draws: after the world's own transparents (the water,
 *  the fog, the floor VFX ladder), its veil first. */
export const SET_PIECE_VEIL_ORDER = 900;
export const SET_PIECE_GHOST_ORDER = SET_PIECE_VEIL_ORDER + 1;

/** One mesh of a set with the depth twin that draws just before it. */
interface SetPieceVeil {
  mesh: THREE.Mesh;
  twin: THREE.Mesh;
  /** The mesh's authored renderOrder, restored when the ghost ends. */
  order: number;
}

/** One veil program the fade gate links before the set's first ghost. */
interface SetPieceVeilProbe {
  key: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface SetPieceOccluderSet {
  boxes: SetPieceOccluderBox[];
  mats: OccluderFadeMat[];
  veil: SetPieceVeil[];
  probes: SetPieceVeilProbe[];
  /** Every veil program is linked (true from the start with no veil). */
  veilLinked: boolean;
  /** The set is DRAWN ghosted: its veil shows and its meshes draw last. */
  ghosted: boolean;
  /** The fade as stepped (the gate may still hold the materials at 1). */
  alpha: number;
  /** The alpha last handed to onFade: what the materials draw at. */
  drawn: number;
  onFade: ((alpha: number) => void) | null;
  x: number;
  z: number;
  radius: number;
}

const sets: SetPieceOccluderSet[] = [];
/** Occluder boxes tested since the page loaded, for the early-out's test. */
let boxTests = 0;

// One depth-only material per face culling, shared by every set for the life
// of the page: it carries no colour, so it has nothing of a set piece in it.
const veilMaterials = new Map<THREE.Side, THREE.Material>();

function veilMaterial(side: THREE.Side): THREE.Material {
  let material = veilMaterials.get(side);
  if (!material) {
    material = markSharedMaterial(
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        // in the transparent pass, where renderOrder places it just before the ghost
        transparent: true,
        depthWrite: true,
        side,
        fog: false,
        toneMapped: false,
        // a hair behind the surface it stands for, so that surface always passes
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    material.forceSinglePass = true;
    material.name = `setPieceGhostVeil:${side}`;
    veilMaterials.set(side, material);
  }
  return material;
}

/** The fade gate's mint for a veil program: a hidden mesh on that program. */
function veilProbeRoot(probe: SetPieceVeilProbe): THREE.Object3D {
  const root = new THREE.Mesh(probe.geometry, probe.material);
  root.name = probe.key;
  root.visible = false;
  root.frustumCulled = false;
  return root;
}

function veilReady(set: SetPieceOccluderSet, consult: OccluderFadeConsult): boolean {
  let ready = true;
  // never short-circuits: the whole program set is asked for in one frame
  for (let i = 0; i < set.probes.length; i++) {
    const probe = set.probes[i];
    if (!occluderFadeTwinReady(probe.key, consult, veilProbeRoot, probe)) ready = false;
  }
  return ready;
}

/** Follow what the materials DRAW at (never the stepped alpha: while the fade
 *  gate holds the transparent programs the set still draws solid, and a veil
 *  laid then would be a draw for nothing). */
function syncDrawn(set: SetPieceOccluderSet): void {
  const drawn = set.mats.length > 0 ? set.mats[0].applied : 1;
  const ghosted = drawn < 1;
  if (set.ghosted !== ghosted) {
    set.ghosted = ghosted;
    for (let i = 0; i < set.veil.length; i++) {
      const v = set.veil[i];
      v.twin.visible = ghosted;
      v.mesh.renderOrder = ghosted ? SET_PIECE_GHOST_ORDER : v.order;
    }
  }
  if (set.drawn !== drawn) {
    set.drawn = drawn;
    if (set.onFade) set.onFade(drawn);
  }
}

function disposeSet(set: SetPieceOccluderSet): void {
  const i = sets.indexOf(set);
  if (i < 0) return;
  sets.splice(i, 1);
  set.alpha = 1;
  applyOccluderFade(set.mats, 1);
  syncDrawn(set);
  for (const v of set.veil) v.mesh.remove(v.twin);
  set.veil.length = 0;
  set.probes.length = 0;
  set.onFade = null;
}

function noRaycast(): void {}

export interface SetPieceOccluderOptions {
  /** Called with the alpha the set is drawn at whenever it changes (1 =
   *  solid): for the parts of a set piece that are not plain models. */
  onFade?: (alpha: number) => void;
}

export interface SetPieceOccluderHandle {
  /** The boxes this set is tested with (one per solid handed in). */
  readonly boxes: readonly SetPieceOccluderBox[];
  /** The fade last stepped for the set (1 = solid). */
  alpha(): number;
  /** Stop testing and fading this set: it is left solid, as authored, with
   *  its veil twins taken off its meshes (which keep their own material
   *  clones, theirs to free with the model). */
  dispose(): void;
}

/**
 * Register one fading unit of a set piece: `solids` block, `roots` fade. Call
 * it once per group of models that should ghost together (a gatehouse and the
 * growth on it; its outlying ruins as a second set).
 */
export function registerSetPieceOccluders(
  solids: readonly SetPieceSolid[],
  roots: readonly THREE.Object3D[],
  options: SetPieceOccluderOptions = {},
): SetPieceOccluderHandle {
  const meshes: THREE.Mesh[] = [];
  for (const root of roots) {
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
  }
  const mats: OccluderFadeMat[] = [];
  const veil: SetPieceVeil[] = [];
  const probes: SetPieceVeilProbe[] = [];
  const seen = new Map<THREE.Material, OccluderFadeMat>();
  const veiled = !ditherFadeEnabled();
  for (const mesh of meshes) {
    const own = (src: THREE.Material): THREE.Material => {
      let fade = seen.get(src);
      if (!fade) {
        // the clone is this set's own: a shared source's tag must not follow it
        const clone = markOwnedMaterial(cloneMaterialWithHooks(src));
        fade = occluderFadeRecordFor(mats, clone, mesh);
        seen.set(src, fade);
      } else {
        occluderFadeRecordFor(mats, fade.mat, mesh);
      }
      return fade.mat;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    if (!veiled || (mesh as THREE.InstancedMesh).isInstancedMesh) continue;
    const material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => veilMaterial(m.side))
      : veilMaterial(mesh.material.side);
    const twin = new THREE.Mesh(mesh.geometry, material);
    twin.name = `${mesh.name}:veil`;
    twin.visible = false;
    twin.castShadow = false;
    twin.receiveShadow = false;
    twin.renderOrder = SET_PIECE_VEIL_ORDER;
    twin.raycast = noRaycast;
    mesh.add(twin);
    veil.push({ mesh, twin, order: mesh.renderOrder });
    for (const m of Array.isArray(material) ? material : [material]) {
      const key = `set-piece-veil|${m.side}|${occluderGhostMeshVariant(occluderGhostTargetOf(m, twin))}`;
      if (!probes.some((p) => p.key === key)) {
        probes.push({ key, geometry: mesh.geometry, material: m });
      }
    }
  }
  const boxes = solids.map(setPieceOccluderBox);
  const centre = setPieceBoxesCentre(boxes, { x: 0, z: 0 });
  const set: SetPieceOccluderSet = {
    boxes,
    mats,
    veil,
    probes,
    veilLinked: probes.length === 0,
    ghosted: false,
    alpha: 1,
    drawn: 1,
    onFade: options.onFade ?? null,
    x: centre.x,
    z: centre.z,
    radius: setPieceBoxesRadius(boxes, centre),
  };
  sets.push(set);
  return {
    boxes,
    alpha: () => set.alpha,
    dispose: () => disposeSet(set),
  };
}

/** The per-frame pass: fade every registered set that stands between the eye
 *  and the camera, restore every one that does not. */
export function updateSetPieceOccluders(
  camX: number,
  camY: number,
  camZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  dt: number,
  reducedMotion = false,
): void {
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    if (set.mats.length === 0) continue;
    // Solid, and the eye-to-camera segment nowhere near: no box can be hit,
    // so none is tested. A set still easing back keeps its restore running.
    const idle =
      set.alpha === 1 &&
      set.drawn === 1 &&
      !setPieceSegmentWithin(set.x, set.z, set.radius, eyeX, eyeZ, camX, camZ);
    let hide = false;
    if (!idle) {
      boxTests += set.boxes.length;
      hide = setPieceBoxesBlock(set.boxes, eyeX, eyeY, eyeZ, camX, camY, camZ);
    }
    // The fade's own programs and the veil's are asked for as the camera comes
    // within the family's reach, ahead of the first occlusion (each latches).
    prefetchOccluderFadeWithin(set.mats, set.x, set.z, camX, camZ);
    if (!set.veilLinked && (hide || withinOccluderFadePrefetch(set.x, set.z, camX, camZ))) {
      set.veilLinked = veilReady(set, hide ? 'edge' : 'prefetch');
    }
    if (idle) continue;
    // The ghost waits for its veil: never a frame of stacked panes.
    if (!set.veilLinked) hide = false;
    set.alpha = advanceOccluderFade(set.mats, set.alpha, hide, dt, reducedMotion);
    syncDrawn(set);
  }
}

/** Dispose every set (a renderer's teardown; a new one builds its own). */
export function clearSetPieceOccluders(): void {
  while (sets.length > 0) disposeSet(sets[sets.length - 1]);
}

export const setPieceOccludersInternalsForTest = {
  setCount: (): number => sets.length,
  boxCount: (): number => sets.reduce((n, s) => n + s.boxes.length, 0),
  veilCount: (): number => sets.reduce((n, s) => n + s.veil.length, 0),
  veilProgramKeys: (): string[] => sets.flatMap((s) => s.probes.map((p) => p.key)),
  boxTests: (): number => boxTests,
};
