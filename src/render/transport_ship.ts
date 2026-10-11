// Transport ships (the Eastbrook ferry): the Blender-authored GLB made into a live,
// idle-animated, level-of-detail view. A decorProps row moors one for good; a
// scheduled route (transport_ferry_ships.ts) builds one and moves it with setPose. The pure decisions (which LOD, whether
// the clip runs, whether a sail blocks the camera) live in transport_ship_core.ts;
// this is the Three.js painter props.ts composes for every decorProps row whose key
// names a ship model. Collision is not here: the sim moors the ship's simple deck
// volumes (src/sim/transport_ship.ts) on the same row.
//
// GPU work: the view is built into the props root at world build, so its materials
// are linked by the world-entry scene compile like every other prop (the hidden
// LODs share the visible LOD's materials and attributes, so they add no program).
// The one runtime program change, a sail fading while it stands between the eye and
// the camera, rides the occluder-fade gate (occluder_fade.ts) exactly like a
// building's ghost fade, prefetched once the camera comes within reach.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadGltf, releaseGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { dequantizeAttribute } from './characters/dequantize_attribute';
import { GFX, surfaceMat } from './gfx';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  advanceOccluderFade,
  type OccluderFadeMat,
  occluderFadeRecordFor,
  prefetchOccluderFadeWithin,
} from './occluder_fade';
import {
  type ShipLocalBox,
  segmentHitsShipBox,
  toShipLocal,
  transportShipAnimates,
  transportShipLod,
  transportShipVisible,
} from './transport_ship_core';

/** decorProps key -> model. The sim's hull layouts use the same keys
 *  (src/sim/content/transport_ships.ts). */
const TRANSPORT_SHIP_MODELS: Readonly<Record<string, string>> = {
  eastbrookFerry: '/models/props/eastbrook_ferry.glb',
};

const LOD_NAMES = ['LOD0', 'LOD1', 'LOD2', 'LOD3'] as const;
/** Nodes that fade out of the camera's way: the sails, and the masts (a chase
 *  camera behind a player on the waist sits right on the mizzen's line). They
 *  stay live (never merged) so each can fade on its own. */
const SAIL_NAMES = [
  'MainSail',
  'MainTopsail',
  'SecondarySail',
  'SecondaryTopsail',
  'MizzenSail',
  'JibSail',
];
const MAST_NAMES = ['MainMast', 'SecondaryMast', 'MizzenMast'];
/** The stern ensign flies over the quarterdeck at a chase camera's height; its
 *  chain root carries the whole flag. */
const FLAG_FADE_NAMES = ['Ensign_1'];
/** A mast fades only when the view line passes this close to its axis (yards):
 *  its box is the pole, not the yards braced across the ship. */
const MAST_BOX_HALF = 1.1;
/** How far a sail's box is padded for its breathing and the hull's bob (yards). */
const SAIL_BOX_PAD = 0.6;
/** Warm stern windows and lanterns: a soft glow that reads at night, not a lamp. */
const GLOW_EMISSIVE = 0xff9a3c;

export function isTransportShipKey(key: string): boolean {
  return key in TRANSPORT_SHIP_MODELS;
}

const loaded = new Map<string, GLTF>();
/** Prepared templates by `url|tier`: the Standard and Lambert tiers convert the
 *  materials differently, so a graphics rebuild never reuses the other tier's. */
const templates = new Map<string, ShipTemplate>();

function templateKey(url: string): string {
  return `${url}|${GFX.standardMaterials ? 's' : 'l'}`;
}

export function prepareTransportShipAssets(): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const url of new Set(Object.values(TRANSPORT_SHIP_MODELS))) {
    // Only the parsed source counts: a graphics-profile rebuild resets the
    // templates after this runs, so an existing template must not skip the load.
    if (loaded.has(url)) continue;
    pending.push(
      loadGltf(url).then((gltf) => {
        loaded.set(url, gltf);
      }),
    );
  }
  return Promise.all(pending).then(() => undefined);
}

if (typeof window !== 'undefined') {
  registerDeferredPreload(prepareTransportShipAssets);
}

/** Drop the prepared templates (graphics-profile rebuilds convert materials
 *  anew; `prepareTransportShipAssets`, a graphics-profile preparer, reloads the
 *  source). Registered in assets/graphics_profile.ts. */
export function resetTransportShipCaches(): void {
  templates.clear();
  convertedMaterials.clear();
}

interface ShipTemplate {
  root: THREE.Object3D;
  /** One (geometry, material) per distinct program the ship draws: the props
   *  material prewarm stages these so a ship first seen after the curtain
   *  links nothing in a live frame. */
  prewarmParts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  clip: THREE.AnimationClip | null;
  /** Each fading sail's box in the ship frame. */
  sailBoxes: Map<string, ShipLocalBox>;
  /** The wake and bow-splash attachment points, in the ship frame. */
  sockets: ShipSockets;
}

/** Where a sailing ship's wake and bow splash leave the hull (ship frame:
 *  x port, y above the waterline, z bow): the GLB's Socket_Wake and
 *  Socket_BowSplash, or the hull's stern and stem when a model lacks them. */
export interface ShipSockets {
  wake: { x: number; y: number; z: number };
  bow: { x: number; y: number; z: number };
}

function readSocket(
  root: THREE.Object3D,
  rootInverse: THREE.Matrix4,
  name: string,
  fallback: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const node = root.getObjectByName(name);
  if (!node) return { ...fallback };
  const v = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(rootInverse);
  return { x: v.x, y: v.y, z: v.z };
}

const convertedMaterials = new Map<string, THREE.Material>();
/** Converted materials that glow (the shared surfaceMat instances carry no name). */
const glowMaterials = new WeakSet<THREE.Material>();

function convertMaterial(source: THREE.Material): THREE.Material {
  const std = source as THREE.MeshStandardMaterial;
  const glow = /glow/i.test(source.name);
  const key = `${source.name}|${GFX.standardMaterials ? 's' : 'l'}`;
  const cached = convertedMaterials.get(key);
  if (cached) return cached;
  const mat = surfaceMat({
    color: 0xffffff,
    vertexColors: true,
    roughness: std.roughness ?? 0.85,
    metalness: std.metalness ?? 0,
    emissive: glow ? GLOW_EMISSIVE : 0x000000,
    emissiveIntensity: glow ? (GFX.standardMaterials ? 1.9 : 1.0) : 1,
    side: source.side,
  });
  convertedMaterials.set(key, mat);
  if (glow) glowMaterials.add(mat);
  return mat;
}

function floatGeometry(mesh: THREE.Mesh, toAnchor: THREE.Matrix4): THREE.BufferGeometry {
  const src = mesh.geometry;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color'] as const) {
    const attr = src.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (attr) out.setAttribute(name, dequantizeAttribute(attr));
  }
  if (src.index) out.setIndex(src.index.clone());
  out.applyMatrix4(toAnchor);
  return out;
}

/**
 * Merge every static mesh under `anchor` into one mesh per material in the
 * anchor's frame, leaving the subtrees rooted at `live` nodes (the animated
 * sails and flags) untouched.
 */
function mergeStatic(anchor: THREE.Object3D, live: ReadonlySet<THREE.Object3D>): void {
  anchor.updateMatrixWorld(true);
  const inverse = anchor.matrixWorld.clone().invert();
  // one bucket per (material, attribute layout): mergeGeometries needs matching sets
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const merged: THREE.Mesh[] = [];
  const walk = (node: THREE.Object3D): void => {
    for (const child of [...node.children]) {
      if (live.has(child)) continue;
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.Material;
        const toAnchor = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        const geo = floatGeometry(mesh, toAnchor);
        const layout = Object.keys(geo.attributes)
          .sort()
          .map((n) => `${n}${geo.getAttribute(n).itemSize}`)
          .join(',');
        const key = `${mat.uuid}|${layout}|${geo.index ? 'i' : 'n'}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = { material: mat, geos: [] };
          buckets.set(key, bucket);
        }
        bucket.geos.push(geo);
        merged.push(mesh);
      }
      walk(child);
    }
  };
  walk(anchor);
  for (const mesh of merged) mesh.removeFromParent();
  for (const { material, geos } of buckets.values()) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geometry) continue;
    for (const g of geos) if (g !== geometry) g.dispose();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${anchor.name}_${material.name || 'merged'}`;
    anchor.add(mesh);
  }
}

function buildTemplate(gltf: GLTF): ShipTemplate {
  const root = gltf.scene.clone(true);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const converted = mats.map((m) => convertMaterial(m));
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
  });
  const clip = gltf.animations[0] ?? null;
  const animated = new Set<THREE.Object3D>();
  if (clip) {
    for (const track of clip.tracks) {
      const node = root.getObjectByName(track.name.split('.')[0]);
      if (node) animated.add(node);
    }
  }
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const sockets: ShipSockets = {
    wake: readSocket(root, rootInverse, 'Socket_Wake', { x: 0, y: 0, z: -15.3 }),
    bow: readSocket(root, rootInverse, 'Socket_BowSplash', { x: 0, y: 0, z: 15.4 }),
  };
  const sailBoxes = new Map<string, ShipLocalBox>();
  for (const name of [...SAIL_NAMES, ...MAST_NAMES, ...FLAG_FADE_NAMES]) {
    const sail = root.getObjectByName(name);
    if (!sail) continue;
    const box = new THREE.Box3();
    sail.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      const b = (mesh.geometry.boundingBox as THREE.Box3).clone();
      b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rootInverse, mesh.matrixWorld));
      box.union(b);
    });
    if (box.isEmpty()) continue;
    if (MAST_NAMES.includes(name)) {
      const cx = (box.min.x + box.max.x) / 2;
      const cz = (box.min.z + box.max.z) / 2;
      box.min.x = cx - MAST_BOX_HALF;
      box.max.x = cx + MAST_BOX_HALF;
      box.min.z = cz - MAST_BOX_HALF;
      box.max.z = cz + MAST_BOX_HALF;
    }
    sailBoxes.set(name, {
      minX: box.min.x - SAIL_BOX_PAD,
      minY: box.min.y - SAIL_BOX_PAD,
      minZ: box.min.z - SAIL_BOX_PAD,
      maxX: box.max.x + SAIL_BOX_PAD,
      maxY: box.max.y + SAIL_BOX_PAD,
      maxZ: box.max.z + SAIL_BOX_PAD,
    });
  }
  // the fading masts stay live beside the animated sails and flags
  const live = new Set(animated);
  for (const name of MAST_NAMES) {
    const mast = root.getObjectByName(name);
    if (mast) live.add(mast);
  }
  for (const name of [...LOD_NAMES, 'Gangplank']) {
    const anchor = root.getObjectByName(name);
    if (anchor) mergeStatic(anchor, live);
  }
  const prewarmParts: ShipTemplate['prewarmParts'] = [];
  const seenParts = new Set<string>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    const layout = Object.keys(mesh.geometry.attributes)
      .sort()
      .map((n) => `${n}${mesh.geometry.getAttribute(n).itemSize}`)
      .join(',');
    const key = `${material.uuid}|${layout}`;
    if (seenParts.has(key)) return;
    seenParts.add(key);
    prewarmParts.push({ geometry: mesh.geometry, material });
  });
  return { root, clip, sailBoxes, prewarmParts, sockets };
}

/** The prepared ships' distinct (geometry, material) programs at the live tier,
 *  for the props material prewarm (props.ts buildPropMaterialPrewarmGroup).
 *  Empty until buildProps has placed a ship. */
export function transportShipPrewarmParts(): readonly {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}[] {
  const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  for (const url of new Set(Object.values(TRANSPORT_SHIP_MODELS))) {
    const template = templates.get(templateKey(url));
    if (template) out.push(...template.prewarmParts);
  }
  return out;
}

function templateFor(key: string): ShipTemplate {
  const url = TRANSPORT_SHIP_MODELS[key];
  const tkey = templateKey(url);
  let template = templates.get(tkey);
  if (!template) {
    const gltf = loaded.get(url);
    if (!gltf) throw new Error(`transport ship model was not preloaded: ${url}`);
    template = buildTemplate(gltf);
    templates.set(tkey, template);
    loaded.delete(url);
    releaseGltf(url);
  }
  return template;
}

interface SailFade {
  box: ShipLocalBox;
  mats: OccluderFadeMat[];
  alpha: number;
}

export interface TransportShipPlacement {
  key: string;
  x: number;
  z: number;
  rot: number;
  /** world Y of the ship frame's origin (its waterline) */
  baseY: number;
}

export interface TransportShipView {
  group: THREE.Group;
  /** The level of detail drawn last frame (-1 before the first update). */
  readonly lod: number;
  /** World Y of the ship frame's origin (its waterline). */
  readonly baseY: number;
  /** The wake and bow-splash attachment points (ship frame). */
  readonly sockets: ShipSockets;
  /**
   * Move a SCHEDULED ship (the ferry's timetable, props.ts) to a new pose.
   * Under way its gangplank is stowed (hidden). The props tree is
   * matrix-frozen after build, so this recomposes the ship root's own matrix;
   * its children follow through the scene's world-matrix pass. A moored ship
   * never calls it.
   */
  setPose(x: number, z: number, rot: number, underWay: boolean): void;
  update(
    camX: number,
    camY: number,
    camZ: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    fogFar: number,
    dt: number,
    reducedMotion: boolean,
  ): void;
}

/** Build one moored ship view, or null when the key names no ship model. */
export function buildTransportShipView(
  placement: TransportShipPlacement,
): TransportShipView | null {
  if (!isTransportShipKey(placement.key)) return null;
  const template = templateFor(placement.key);
  const root = template.root.clone(true);
  const group = new THREE.Group();
  group.name = `transportShip:${placement.key}`;
  group.userData.decorative = false;
  group.position.set(placement.x, placement.baseY, placement.z);
  group.rotation.y = placement.rot;
  group.add(root);
  // the live pose (a scheduled ship moves it through setPose)
  const pose = { x: placement.x, z: placement.z, rot: placement.rot, baseY: placement.baseY };

  const lods = LOD_NAMES.map((name) => root.getObjectByName(name) ?? null);
  lods.forEach((lod, i) => {
    if (!lod) return;
    lod.visible = i === 0;
    lod.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const glow = glowMaterials.has(mesh.material as THREE.Material);
      const flag =
        /^(Pennant|Ensign)/.test(mesh.parent?.name ?? '') || /^(Pennant|Ensign)/.test(mesh.name);
      mesh.castShadow = i <= 1 && !glow && !flag;
      mesh.receiveShadow = i <= 1;
    });
  });
  const plank = root.getObjectByName('Gangplank');
  plank?.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  // Every sail wears its own clone of the cloth material, so one sail fades
  // without ghosting the others (the clone keeps the source's program).
  const sails: SailFade[] = [];
  for (const [name, box] of template.sailBoxes) {
    const sail = root.getObjectByName(name);
    if (!sail) continue;
    const mats: OccluderFadeMat[] = [];
    const clones = new Map<THREE.Material, THREE.Material>();
    sail.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material;
      let clone = clones.get(src);
      if (!clone) {
        clone = cloneMaterialWithHooks(src);
        clones.set(src, clone);
      }
      mesh.material = clone;
      occluderFadeRecordFor(mats, clone, mesh);
    });
    sails.push({ box, mats, alpha: 1 });
  }

  const mixer = template.clip ? new THREE.AnimationMixer(root) : null;
  // The renderer freezes the whole props tree after build (freezeStaticMatrices:
  // matrixAutoUpdate false on every node), so the clip's targets re-compose
  // their own matrices after each mixer step instead of relying on auto-update.
  const animatedNodes: THREE.Object3D[] = [];
  if (mixer && template.clip) {
    mixer.clipAction(template.clip).play();
    mixer.update(0);
    const seen = new Set<THREE.Object3D>();
    for (const track of template.clip.tracks) {
      const node = root.getObjectByName(track.name.split('.')[0]);
      if (node && !seen.has(node)) {
        seen.add(node);
        animatedNodes.push(node);
      }
    }
  }

  const eye = { x: 0, y: 0, z: 0 };
  const cam = { x: 0, y: 0, z: 0 };
  let current = -1;
  const lowTier = !GFX.standardMaterials;

  return {
    group,
    get lod() {
      return current;
    },
    baseY: placement.baseY,
    sockets: template.sockets,
    setPose(x, z, rot, underWay) {
      if (plank && plank.visible === underWay) {
        plank.visible = !underWay;
      }
      if (pose.x === x && pose.z === z && pose.rot === rot) return;
      pose.x = x;
      pose.z = z;
      pose.rot = rot;
      group.position.set(x, pose.baseY, z);
      group.rotation.y = rot;
      group.updateMatrix();
    },
    update(camX, camY, camZ, eyeX, eyeY, eyeZ, fogFar, dt, reducedMotion) {
      const distance = Math.hypot(camX - pose.x, camZ - pose.z);
      if (!transportShipVisible(distance, fogFar)) {
        group.visible = false;
        return;
      }
      group.visible = true;
      const lod = transportShipLod(distance, current, lowTier);
      if (lod !== current) {
        for (let i = 0; i < lods.length; i++) {
          const node = lods[i];
          if (node) node.visible = i === lod;
        }
        current = lod;
      }
      if (mixer && transportShipAnimates(lod, distance, reducedMotion)) {
        mixer.update(dt);
        for (let i = 0; i < animatedNodes.length; i++) animatedNodes[i].updateMatrix();
      }
      if (sails.length === 0) return;
      if (lod === 0) {
        for (let i = 0; i < sails.length; i++) {
          prefetchOccluderFadeWithin(sails[i].mats, pose.x, pose.z, camX, camZ);
        }
        toShipLocal(eyeX, eyeY, eyeZ, pose.x, pose.baseY, pose.z, pose.rot, eye);
        toShipLocal(camX, camY, camZ, pose.x, pose.baseY, pose.z, pose.rot, cam);
      }
      for (let i = 0; i < sails.length; i++) {
        const sail = sails[i];
        const occluded =
          lod === 0 && segmentHitsShipBox(eye.x, eye.y, eye.z, cam.x, cam.y, cam.z, sail.box);
        if (!occluded && sail.alpha === 1) continue;
        sail.alpha = advanceOccluderFade(sail.mats, sail.alpha, occluded, dt, reducedMotion);
      }
    },
  };
}

/** Test-only access to the preload, template and view contract. */
export const transportShipInternalsForTest = {
  models: TRANSPORT_SHIP_MODELS,
  lodNames: LOD_NAMES,
  sailNames: SAIL_NAMES,
  mastNames: MAST_NAMES,
  flagFadeNames: FLAG_FADE_NAMES,
  buildTemplate,
  mergeStatic,
  /** Hand a parsed GLB to the preload map (Node tests have no fetch path). */
  setLoadedGltfForTest(url: string, gltf: GLTF | null): void {
    templates.delete(templateKey(url));
    if (gltf) loaded.set(url, gltf);
    else loaded.delete(url);
  },
  isGlowMaterial(material: THREE.Material): boolean {
    return glowMaterials.has(material);
  },
};
