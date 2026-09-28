// The Mirefen tavern on screen: the one Blender-authored model
// (public/models/props/mirefen_tavern.glb, scripts/assets/mirefen_tavern/) placed on its
// ground floor at the tavern's origin (sim/content/mirefen_tavern.ts), turned so its door
// faces the road, its shell parts (walls, roofs, the porch, the bar's pillar) kept apart so
// each can fade for the camera, and its fires, lanterns and candles lit.
//
// Which parts a graphics tier keeps and which shell parts the camera cuts away are the pure
// core's calls (mirefen_tavern_core.ts): the structure, furniture, shell and lights on every
// tier, the trim from medium, the clutter from high; indoors the camera stays in the air
// and only the bar's pillar, standing in it, cuts away, outdoors (or while the camera
// follows the player in through the door) the shell ghosts. The tier is the static
// effects tier (GFX.effectsTier), never the frame-rate governor, and a graphics-profile
// change rebuilds the props (the resetter below, registered in assets/graphics_profile.ts).
//
// GPU work: the tavern is built into the props root at world build (props.ts), so the
// world-entry compile links it with the rest of the props, and its distinct (geometry,
// material) programs join the props material prewarm (mirefenTavernPrewarmParts), so a
// tavern first seen after the curtain links nothing in a live frame. The kept parts merge
// into one mesh per material (the surface family's vertex-coloured standard/lambert,
// vertex_colour_glb_parts.ts: the harbors' programs); each shell part draws with per-part
// CLONES of those materials (cloneMaterialWithHooks: the same opaque programs), and their
// transparent twins are asked for through the occluder fade gate before the first fade
// (prefetchOccluderFadeWithin); a fade that would draw a twin still cold waits for the link
// (occluderFadeReady). A part cut away keeps drawing its shadow (colour and depth writes
// off), so the room stays roofed in light. The fires and lanterns are point lights for the
// fire-light budget (props.ts pushes them with the campfires': they never change the visible
// point-light count). The per-frame work is the cutaway's segment tests and the fade steps.
// A build registers the tavern's air with the indoor camera clamp (interior_camera.ts), and
// the teardown drops it, so a world without the tavern clamps nothing.
//
// Life round it: the dog asleep on the porch is its own mesh (TAVERN_DOG_PART), breathing round
// the spot where it lies (mirefen_tavern_dog_core.ts: a scale, no program change); the chimney
// smoke (mirefen_tavern_smoke.ts) is built with the tavern at world build from medium effects up
// (cosmetic), its program in the same props prewarm; the terrace's lantern strings throw two
// warm lights into the fire-light budget like the rest (content TAVERN_TERRACE_LIGHTS).

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  TAVERN_CHANDELIER,
  TAVERN_FLOOR_Y,
  TAVERN_LANTERNS,
  TAVERN_ORIGIN,
  TAVERN_PIT,
  TAVERN_PROPS,
  TAVERN_STAGE,
  TAVERN_TOWER,
  TAVERN_YAW,
  tavernToWorld,
} from '../sim/content/mirefen_tavern';
import { TAVERN_TERRACE_LIGHTS } from '../sim/content/mirefen_tavern_grounds';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX } from './gfx';
import {
  activeCameraInterior,
  interiorCameraRunning,
  interiorLensInAir,
  registerCameraInterior,
  unregisterCameraInterior,
} from './interior_camera';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  mirefenTavernParts,
  newTavernShellState,
  TAVERN_DOG_PART,
  TAVERN_SHELL_PARTS,
  type TavernShellPart,
  tavernShellOcclusion,
} from './mirefen_tavern_core';
import { DOG_BREATH_RANGE, type DogBreath, dogBreathInto } from './mirefen_tavern_dog_core';
import { mirefenTavernCameraInterior } from './mirefen_tavern_interior_core';
import {
  buildMirefenTavernSmoke,
  mirefenTavernSmokePrewarmPart,
  type TavernSmokeView,
} from './mirefen_tavern_smoke';
import { buildMirefenTavernWallFire, type TavernWallFireView } from './mirefen_tavern_wall_fire';
import { TAVERN_WALL_FIRE_FLAMES, TAVERN_WALL_FIRE_LIGHT } from './mirefen_tavern_wall_fire_core';
import { ditherFadeUniform } from './occluder_dither_fade';
import {
  applyOccluderFade,
  type OccluderFadeMat,
  occluderFadeApplied,
  occluderFadeReady,
  occluderFadeRecordFor,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import { occluderFadeSettled, stepOccluderFade } from './occluder_fade_core';
import {
  addToBucket,
  mergeVertexColourBuckets,
  type VertexColourPart,
  vertexColourMaterialConverter,
  vertexColourMeshGeometry,
} from './vertex_colour_glb_parts';

const TAVERN_URL = '/models/props/mirefen_tavern.glb';

let loaded: GLTF | null = null;
let loadTask: Promise<void> | null = null;

export function prepareMirefenTavernAssets(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadTask) return loadTask;
  loadTask = loadGltf(TAVERN_URL)
    .then((gltf) => {
      loaded = gltf;
      loadTask = null;
    })
    .catch((err) => {
      loadTask = null;
      throw err;
    });
  return loadTask;
}

if (typeof window !== 'undefined') registerDeferredPreload(prepareMirefenTavernAssets);

interface TavernTemplate {
  /** The kept non-shell parts merged into one geometry per material, in the model's frame. */
  parts: VertexColourPart[];
  /** Each shell part merged per material on its own, in the model's frame. */
  shell: Map<TavernShellPart, VertexColourPart[]>;
  /** The dog, merged per material round its own origin (`dogAt`, in the model's frame). */
  dog: VertexColourPart[];
  dogAt: THREE.Vector3;
}

/** Templates by `effectsTier|standard`: a preset change converts anew. */
const templates = new Map<string, TavernTemplate>();
const materials = vertexColourMaterialConverter();
let lastParts: VertexColourPart[] = [];

/** One shell part on screen: its meshes, their fade records, and its fade alpha. */
interface ShellRecord {
  part: TavernShellPart;
  meshes: THREE.Mesh[];
  mats: OccluderFadeMat[];
  alpha: number;
}

let shell: ShellRecord[] = [];
let shellGroup: THREE.Group | null = null;
/** The dog's breathing group, the chimney smoke and the wall fire (null when not built). */
let dogGroup: THREE.Group | null = null;
let smoke: TavernSmokeView | null = null;
let wallFire: TavernWallFireView | null = null;
let lifeClock = 0;
const breath: DogBreath = { y: 1, xz: 1 };
/** Where the dog lies (world), for its breathing range. */
let dogWorld = { x: 0, z: 0 };
let allMats: OccluderFadeMat[] = [];
const state = newTavernShellState();
/** Shell parts inside the building: they cast no shadow (the outer shell shades the room). */
const INNER_SHELL = new Set<TavernShellPart>(['BarPillar']);
/** The tavern's air for the indoor camera (registered while the tavern is built). */
const TAVERN_CAMERA_INTERIOR = mirefenTavernCameraInterior();
/** Where the tavern stands: the prefetch reach and the fog cull are measured from here. */
const ANCHOR = tavernToWorld(0, -6);

function buildTemplate(gltf: GLTF, keep: readonly string[]): TavernTemplate {
  // loader cache results are immutable: read a clone
  const root = gltf.scene.clone(true);
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const shellBuckets = new Map<TavernShellPart, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const shellNames = new Set<string>(TAVERN_SHELL_PARTS);
  const dogBucket = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const dogAt = new THREE.Vector3();
  for (const name of keep) {
    const part = root.getObjectByName(name);
    if (!part) continue;
    let into = buckets;
    if (shellNames.has(name)) {
      into = new Map();
      shellBuckets.set(name as TavernShellPart, into);
    } else if (name === TAVERN_DOG_PART) {
      into = dogBucket;
      dogAt.setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(inverse, part.matrixWorld));
    }
    part.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const frame = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
      addToBucket(
        into,
        materials.convert(mesh.material as THREE.Material),
        vertexColourMeshGeometry(mesh, frame),
      );
    });
  }
  const shellParts = new Map<TavernShellPart, VertexColourPart[]>();
  for (const [name, b] of shellBuckets) shellParts.set(name, mergeVertexColourBuckets(b));
  // the dog round its own origin, so its breathing scales it where it lies
  const dog = mergeVertexColourBuckets(dogBucket);
  for (const d of dog) d.geometry.translate(-dogAt.x, -dogAt.y, -dogAt.z);
  return { parts: mergeVertexColourBuckets(buckets), shell: shellParts, dog, dogAt };
}

function templateFor(): TavernTemplate {
  const key = `${GFX.effectsTier}|${GFX.standardMaterials ? 's' : 'l'}`;
  let template = templates.get(key);
  if (!template) {
    if (!loaded) throw new Error(`mirefen tavern model was not preloaded: ${TAVERN_URL}`);
    template = buildTemplate(loaded, mirefenTavernParts(GFX.effectsTier));
    templates.set(key, template);
  }
  return template;
}

/** Build the shell meshes from the template (parented under the model, so they share its
 *  frame), one material clone per material per part, so a part fades alone. */
function buildShell(parts: ReadonlyMap<TavernShellPart, readonly VertexColourPart[]>): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mirefenTavernShell';
  shellGroup = group;
  shell = [];
  allMats = [];
  for (const part of TAVERN_SHELL_PARTS) {
    const record: ShellRecord = { part, meshes: [], mats: [], alpha: 1 };
    const clones = new Map<THREE.Material, THREE.Material>();
    for (const p of parts.get(part) ?? []) {
      let mat = clones.get(p.material);
      if (!mat) {
        mat = cloneMaterialWithHooks(p.material);
        clones.set(p.material, mat);
      }
      const mesh = new THREE.Mesh(p.geometry, mat);
      mesh.name = part;
      // the outer walls and roofs roof the room in shade even when cut away; the bar's pillar
      // stands inside it, so its shadow pass is spared
      mesh.castShadow = !INNER_SHELL.has(part);
      mesh.receiveShadow = true;
      occluderFadeRecordFor(record.mats, mat, mesh);
      record.meshes.push(mesh);
      group.add(mesh);
    }
    shell.push(record);
  }
  allMats = shell.flatMap((r) => r.mats);
  return group;
}

/** The wall fire over the model's own materials: its plain vertex-coloured one for the logs
 *  and its glow for the embers (none when the model carries no glow). */
function buildTavernWallFire(parts: readonly VertexColourPart[]): TavernWallFireView | null {
  const glows = (p: VertexColourPart) =>
    ((p.material as THREE.MeshLambertMaterial).emissive?.getHex() ?? 0) !== 0;
  const wood = parts.find((p) => !glows(p));
  const glow = parts.find(glows);
  if (!wood || !glow) return null;
  const colour = wood.geometry.getAttribute('color');
  return buildMirefenTavernWallFire(wood.material, glow.material, colour?.itemSize ?? 3);
}

/** The tavern, built once into the props root (built-in world only). */
export function buildMirefenTavern(): THREE.Group {
  // a second build (a world swap, an editor rebuild) disposes the last build's clones first
  clearMirefenTavernShell();
  const group = new THREE.Group();
  group.name = 'mirefenTavern';
  if (!loaded) {
    console.warn(`mirefen tavern skipped: ${TAVERN_URL} was not preloaded`);
    clearMirefenTavernShell();
    return group;
  }
  const template = templateFor();
  const model = new THREE.Group();
  model.name = 'mirefenTavernModel';
  for (const part of template.parts) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    model.add(mesh);
  }
  model.add(buildShell(template.shell));
  // the dog asleep on the porch, breathing round where it lies
  dogGroup = new THREE.Group();
  dogGroup.name = 'mirefenTavernDog';
  dogGroup.position.copy(template.dogAt);
  for (const part of template.dog) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    dogGroup.add(mesh);
  }
  model.add(dogGroup);
  dogWorld = tavernToWorld(template.dogAt.x, template.dogAt.z);
  // the wall fire's logs, embers and glow in the fireplace's mouth, in the model's own
  // vertex-coloured and glow materials (mirefen_tavern_wall_fire.ts)
  wallFire = buildTavernWallFire(template.parts);
  if (wallFire) model.add(wallFire.group);
  lastParts = [
    ...template.parts,
    ...template.dog,
    ...shell.flatMap((r) =>
      r.meshes.map((m) => ({ geometry: m.geometry, material: m.material as THREE.Material })),
    ),
  ];
  if (wallFire) lastParts.push(...wallFire.parts);
  // the chimney smoke: cosmetic, from medium effects up
  smoke = GFX.effectsTier === 'low' ? null : buildMirefenTavernSmoke();
  if (smoke) {
    group.add(smoke.mesh);
    lastParts.push(mirefenTavernSmokePrewarmPart());
  }
  model.position.set(TAVERN_ORIGIN.x, TAVERN_FLOOR_Y, TAVERN_ORIGIN.z);
  model.rotation.y = TAVERN_YAW;
  model.userData.assetUrl = TAVERN_URL;
  group.add(model);
  // the indoor camera keeps to the tavern's air while the player is inside it
  registerCameraInterior(TAVERN_CAMERA_INTERIOR);
  return group;
}

/** The tavern's firelight: the round hearth's glow, the wall fire, the wheel chandelier and
 *  the lit lanterns high under the hammer beams (content TAVERN_LANTERNS, where the model hangs
 *  them, so they throw their light down a long way), the stage's footlights, the candles
 *  along the bar and the nook's crown of candles. */
export const MIREFEN_TAVERN_LIGHTS = {
  hearth: { color: 0xffa458, intensity: 34, distance: 24, decay: 2 },
  wallFire: { color: 0xffa050, intensity: 14, distance: 13, decay: 2 },
  chandelier: { color: 0xffcc88, intensity: 26, distance: 20, decay: 2 },
  lantern: { color: 0xffc27a, intensity: 30, distance: 20, decay: 2 },
  stage: { color: 0xffb466, intensity: 12, distance: 10, decay: 2 },
  bar: { color: 0xffc070, intensity: 10, distance: 10, decay: 2 },
  nook: { color: 0xffb870, intensity: 14, distance: 11, decay: 2 },
  terrace: { color: 0xffbe72, intensity: 16, distance: 12, decay: 2 },
} as const;

function light(
  spec: (typeof MIREFEN_TAVERN_LIGHTS)[keyof typeof MIREFEN_TAVERN_LIGHTS],
  name: string,
  lx: number,
  ly: number,
  lz: number,
): THREE.PointLight {
  const l = new THREE.PointLight(spec.color, spec.intensity, spec.distance, spec.decay);
  l.name = name;
  const w = tavernToWorld(lx, lz);
  l.position.set(w.x, TAVERN_FLOOR_Y + ly, w.z);
  // the budget's flicker pass drives every contributing fire light from this base
  l.userData.baseIntensity = spec.intensity;
  return l;
}

/** One live flame (world yards): the base of the flame, its size, and an optional squash of
 *  its depth along world z (the wall fire's tongues hug the fireplace's back). */
export interface TavernFlameSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
  depthZ?: number;
}

/** Where the live flames burn: three tongues over the round hearth's logs and three in the
 *  wall fireplace's mouth (mirefen_tavern_wall_fire_core.ts; props.ts builds them with the
 *  campfires' flame, so they flicker and throw embers like any campfire). */
export const MIREFEN_TAVERN_FLAMES: readonly TavernFlameSpot[] = (() => {
  const at = (lx: number, ly: number, lz: number, scale: number, depthZ?: number) => {
    const w = tavernToWorld(lx, lz);
    return { x: w.x, y: TAVERN_FLOOR_Y + ly, z: w.z, scale, ...(depthZ ? { depthZ } : {}) };
  };
  const base = -TAVERN_PIT.depth + 0.5;
  return [
    at(TAVERN_PIT.x, base, TAVERN_PIT.z, 2.1),
    at(TAVERN_PIT.x + 0.45, base, TAVERN_PIT.z + 0.25, 1.4),
    at(TAVERN_PIT.x - 0.4, base, TAVERN_PIT.z - 0.3, 1.5),
    // the local x axis (across the mouth's depth) is the world z axis (TAVERN_YAW)
    ...TAVERN_WALL_FIRE_FLAMES.map((f) => at(f.x, f.y, f.z, f.scale, f.depth)),
  ];
})();

/** The live flames to build: none when the model never loaded (no fire without its hearth). */
export function mirefenTavernFlameSpots(): typeof MIREFEN_TAVERN_FLAMES {
  return loaded ? MIREFEN_TAVERN_FLAMES : [];
}

/** The tavern's point lights, world-positioned (props.ts adds them to the props root and the
 *  fire-light budget, like a campfire's). Empty until the model is loaded. */
export function mirefenTavernLights(): THREE.PointLight[] {
  if (!loaded) return [];
  const L = MIREFEN_TAVERN_LIGHTS;
  const out = [light(L.hearth, 'tavernHearth', TAVERN_PIT.x, 1.4, TAVERN_PIT.z)];
  const wf = TAVERN_WALL_FIRE_LIGHT;
  out.push(light(L.wallFire, 'tavernWallFire', wf.x, wf.y, wf.z));
  const c = TAVERN_CHANDELIER;
  out.push(light(L.chandelier, 'tavernChandelier', c.x, c.y - 0.4, c.z));
  for (const spot of TAVERN_LANTERNS) {
    if (spot.lit) out.push(light(L.lantern, 'tavernLantern', spot.x, spot.y - 0.3, spot.z));
  }
  // the stage's footlights, a warm wash up the curtain
  const st = TAVERN_STAGE;
  out.push(light(L.stage, 'tavernStage', (st.x0 + st.x1) / 2, st.lift + 1.2, st.z1 - 0.2));
  // the candles along the bar's long counter
  const counter = TAVERN_PROPS.find((p) => p.kind === 'counter' && (p.hw ?? 0) > (p.hd ?? 0));
  if (counter) out.push(light(L.bar, 'tavernBar', counter.x, 3.0, counter.z));
  // the nook's crown of candles, its light pooled on the nook's tables
  out.push(light(L.nook, 'tavernNook', TAVERN_TOWER.x, 4.0, TAVERN_TOWER.z));
  // the terrace's lantern strings, a warm pool over each side's tables
  for (const [x, y, z] of TAVERN_TERRACE_LIGHTS)
    out.push(light(L.terrace, 'tavernTerrace', x, y, z));
  return out;
}

/** The tavern's distinct (geometry, material) programs at the live tier, for the props
 *  material prewarm (props.ts). Empty until buildProps has built the tavern. */
export function mirefenTavernPrewarmParts(): readonly VertexColourPart[] {
  return lastParts;
}

/** Every shell mesh (the props merge must leave them alone: they fade one by one). */
export function mirefenTavernShellMeshes(): readonly THREE.Mesh[] {
  return shell.flatMap((r) => r.meshes);
}

/** One part's fade step toward `occluded ? floor : 1`, gated like advanceOccluderFade: the
 *  flip to transparent waits for its linked program. At rest cut away (alpha 0) it stops
 *  writing depth and colour (neither is a program key, and the shadow pass reads neither),
 *  so the room behind it shows, it costs no blending, and its shadow stays. */
function stepPart(
  r: ShellRecord,
  occluded: boolean,
  floor: number,
  dt: number,
  reducedMotion: boolean,
): void {
  if (occluderFadeSettled(r.alpha, occluded, floor) && occluderFadeApplied(r.mats, r.alpha)) return;
  const next = stepOccluderFade(r.alpha, occluded, dt, reducedMotion, floor);
  if (next < 1) {
    if (!occluded && occluderFadeApplied(r.mats, 1)) {
      r.alpha = next;
      return;
    }
    if (!occluderFadeReady(r.mats, occluded ? 'edge' : 'prefetch')) {
      r.alpha = next;
      return;
    }
  }
  r.alpha = next;
  applyOccluderFade(r.mats, next);
  const cut = next === 0;
  for (const m of r.mats) {
    m.mat.colorWrite = !cut;
    if (cut) m.mat.depthWrite = false;
    // the dithered arm keeps the material opaque and never touches its depth writes
    // (applyOccluderFade), so the cut's drop is undone here once the part draws again
    else if (ditherFadeUniform(m.mat)) m.mat.depthWrite = m.depthWrite;
  }
}

/** Past the fog the shell stops drawing (and deciding): the tavern's reach from its anchor. */
export const MIREFEN_TAVERN_SHELL_CULL_SLACK = 40;

/** Advance the shell one frame (props.ts update, with the frame's camera and eye). */
export function updateMirefenTavernShell(
  camX: number,
  camY: number,
  camZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  dt: number,
  reducedMotion = false,
  fogFar = Number.POSITIVE_INFINITY,
): void {
  if (shell.length === 0) return;
  updateMirefenTavernLife(camX, camZ, dt, reducedMotion);
  const reach = fogFar + MIREFEN_TAVERN_SHELL_CULL_SLACK;
  const far = (camX - ANCHOR.x) ** 2 + (camZ - ANCHOR.z) ** 2 > reach * reach;
  if (shellGroup && shellGroup.visible === far) shellGroup.visible = !far;
  if (far) return;
  // warm the fade twins once the camera comes within reach of the tavern
  prefetchOccluderFadeWithin(allMats, ANCHOR.x, ANCHOR.z, camX, camZ);
  // indoors is the camera clamp's verdict (the avatar's eye, and the lens in the air), so the
  // shell never ghosts or holds apart from where the clamp keeps the camera; a lens still
  // following through the doorway (or gliding in past a wall) takes the outdoor cutaway
  const indoors = interiorCameraRunning()
    ? activeCameraInterior()?.id === TAVERN_CAMERA_INTERIOR.id && interiorLensInAir()
    : undefined;
  tavernShellOcclusion(eyeX, eyeY, eyeZ, camX, camY, camZ, state, indoors);
  for (let i = 0; i < shell.length; i++) {
    stepPart(shell[i], state.occluded[i], state.floor, dt, reducedMotion);
  }
}

/** The life round the tavern this frame: the dog's breath and the chimney smoke. */
function updateMirefenTavernLife(
  camX: number,
  camZ: number,
  dt: number,
  reducedMotion: boolean,
): void {
  lifeClock += dt;
  smoke?.update(camX, camZ, dt);
  wallFire?.update(lifeClock, reducedMotion);
  if (!dogGroup) return;
  const near =
    (camX - dogWorld.x) ** 2 + (camZ - dogWorld.z) ** 2 < DOG_BREATH_RANGE * DOG_BREATH_RANGE;
  dogBreathInto(lifeClock, reducedMotion || !near, breath);
  if (dogGroup.scale.y !== breath.y) dogGroup.scale.set(breath.xz, breath.y, breath.xz);
}

/** Drop the shell records and dispose their material clones (a graphics-profile rebuild
 *  tears the old props down; a world without the tavern builds none). */
export function clearMirefenTavernShell(): void {
  const disposed = new Set<THREE.Material>();
  for (const r of shell) {
    for (const m of r.mats) {
      if (disposed.has(m.mat)) continue;
      disposed.add(m.mat);
      m.mat.dispose();
    }
  }
  shell = [];
  allMats = [];
  shellGroup = null;
  dogGroup = null;
  smoke = null;
  wallFire?.dispose();
  wallFire = null;
  unregisterCameraInterior(TAVERN_CAMERA_INTERIOR.id);
}

/** Drop the prepared templates (graphics-profile rebuilds convert materials anew; the
 *  parsed source survives). Registered in assets/graphics_profile.ts. */
export function resetMirefenTavernCaches(): void {
  templates.clear();
  materials.clear();
  lastParts = [];
  clearMirefenTavernShell();
}

export const mirefenTavernInternalsForTest = {
  assetUrl: TAVERN_URL,
  shell: (): readonly ShellRecord[] => shell,
  state: () => state,
  dog: (): THREE.Group | null => dogGroup,
  smoke: (): TavernSmokeView | null => smoke,
  /** Hand a parsed GLB to the preload slot (Node tests have no fetch path). */
  setLoadedGltfForTest(gltf: GLTF | null): void {
    loaded = gltf;
    resetMirefenTavernCaches();
  },
};
