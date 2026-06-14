// Character asset preparation: preloads manifest glbs, assembles per-key
// model clones (accessory show/hide + weapon attachments), caches tinted
// material variants, and bakes a single static idle-pose geometry per key for
// the far-LOD / shadow-proxy path.
//
// Loading contract: fetches kick off at module import and register with the
// preload registry; main.ts awaits assetsReady() before the Renderer exists,
// so everything here can assume resolved GLTFs synchronously afterwards.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadGltf } from '../assets/loader';
import { registerPreload } from '../assets/preload';
import { GFX, addRimGlow } from '../gfx';
import { manifestUrls, VISUALS, VisualDef } from './manifest';

const DEFAULT_TINT_STRENGTH = 0.4;

const LOW_URL_ALIAS: Record<string, string> = {
  'models/chars/skeleton_warrior.glb': 'models/chars/skeleton_minion.glb',
  'models/chars/skeleton_rogue.glb': 'models/chars/skeleton_minion.glb',
  'models/chars/skeleton_mage.glb': 'models/chars/skeleton_minion.glb',
  'models/chars/rogue_hooded.glb': 'models/chars/rogue.glb',
};

// ---------------------------------------------------------------------------
// Preload
// ---------------------------------------------------------------------------

const gltfByUrl = new Map<string, GLTF>();

function assetUrl(url: string): string {
  return GFX.standardMaterials ? url : (LOW_URL_ALIAS[url] ?? url);
}

const preloadUrls = GFX.standardMaterials
  ? manifestUrls()
  : [...new Set(manifestUrls()
    .filter((url) => !url.startsWith('models/weapons/'))
    .map(assetUrl))];

for (const url of preloadUrls) {
  registerPreload(loadGltf(url).then((g) => { gltfByUrl.set(url, g); }));
}

function resolvedGltf(url: string): GLTF {
  const resolvedUrl = assetUrl(url);
  const g = gltfByUrl.get(resolvedUrl);
  if (!g) throw new Error(`character asset not preloaded: ${resolvedUrl}`);
  return g;
}

// ---------------------------------------------------------------------------
// Per-url source optimization: KayKit characters ship six skinned body parts
// sharing one skeleton and one material — merge them into a single SkinnedMesh
// once per asset so every instance costs ~1 body draw instead of ~6.
// ---------------------------------------------------------------------------

const optimizedSceneCache = new Map<string, THREE.Object3D>();

function optimizedScene(url: string): THREE.Object3D {
  const hit = optimizedSceneCache.get(url);
  if (hit) return hit;
  const root = cloneSkinned(resolvedGltf(url).scene);
  mergeSkinnedParts(root);
  optimizedSceneCache.set(url, root);
  return root;
}

const BIND_EPS = 1e-3;

function sameBindData(a: THREE.SkinnedMesh, b: THREE.SkinnedMesh): boolean {
  const ia = a.skeleton.boneInverses, ib = b.skeleton.boneInverses;
  if (ia.length !== ib.length) return false;
  for (let m = 0; m < ia.length; m++) {
    const ea = ia[m].elements, eb = ib[m].elements;
    for (let i = 0; i < 16; i++) if (Math.abs(ea[i] - eb[i]) > BIND_EPS) return false;
  }
  const ba = a.bindMatrix.elements, bb = b.bindMatrix.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(ba[i] - bb[i]) > BIND_EPS) return false;
  return true;
}

function mergeSkinnedParts(root: THREE.Object3D): void {
  // bucket by bone set / material / parent / local transform, then split
  // buckets by approximate bind-data equality (float noise must not block a
  // merge, while genuinely different bind poses must never share vertices —
  // the skeleton pack's parts carry per-part bind data)
  const groups = new Map<string, THREE.SkinnedMesh[][]>();
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.visible) return;
    const mat = sm.material as THREE.Material;
    if (Array.isArray(sm.material)) return; // never happens via GLTFLoader
    const bones = sm.skeleton.bones.map((b) => b.uuid).join(',');
    const key = `${bones}|${mat.uuid}|${sm.parent?.uuid}|${sm.matrix.elements.join(',')}`;
    let buckets = groups.get(key);
    if (!buckets) {
      buckets = [];
      groups.set(key, buckets);
    }
    const bucket = buckets.find((b) => sameBindData(b[0], sm));
    if (bucket) bucket.push(sm);
    else buckets.push([sm]);
  });
  for (const parts of [...groups.values()].flat()) {
    if (parts.length < 2) continue;
    const names = new Set(parts.flatMap((p) => Object.keys(p.geometry.attributes)));
    if (![...names].every((n) => parts.every((p) => p.geometry.getAttribute(n)))) continue;
    const geo = mergeGeometries(parts.map((p) => p.geometry), false);
    if (!geo) continue;
    const first = parts[0];
    const merged = new THREE.SkinnedMesh(geo, first.material);
    merged.name = `${first.name}_bodymerged`;
    merged.position.copy(first.position);
    merged.quaternion.copy(first.quaternion);
    merged.scale.copy(first.scale);
    merged.bind(first.skeleton, first.bindMatrix);
    first.parent!.add(merged);
    for (const p of parts) p.removeFromParent();
  }
}

// ---------------------------------------------------------------------------
// Clone assembly: accessory visibility + weapon attachments
// ---------------------------------------------------------------------------

/** Fresh SkeletonUtils clone of a manifest entry with its kit applied.
 *  Pure model space — normalization (scale/yaw/feet offset) happens upstream. */
export function assembleModel(def: VisualDef): THREE.Object3D {
  const root = cloneSkinned(optimizedScene(def.url));
  // KayKit characters ship every accessory mesh visible; keep only the kit
  if (def.show) {
    const keep = new Set(def.show);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !keep.has(o.name)) {
        o.visible = false;
      }
    });
  }
  const attachments = GFX.standardMaterials ? (def.attach ?? []) : [];
  for (const att of attachments) {
    // GLTFLoader sanitizes node names (PropertyBinding strips [].:/ chars),
    // so the authored "handslot.r" arrives as "handslotr" — try both
    const bone = root.getObjectByName(att.bone)
      ?? root.getObjectByName(att.bone.replace(/[[\].:/]/g, ''));
    if (!bone) continue; // manifest/bone mismatch — ship without the prop
    const prop = cloneSkinned(resolvedGltf(att.url).scene);
    if (att.position) prop.position.set(...att.position);
    if (att.rotationY) prop.rotation.y = att.rotationY;
    bone.add(prop);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Tinted material cache (shared across all instances; never disposed)
// ---------------------------------------------------------------------------

const matCache = new Map<string, THREE.Material>();
const tintScratch = new THREE.Color();

export function tintedMaterial(src: THREE.Material, tint: number | null, strength: number): THREE.Material {
  const key = `${src.uuid}|${tint ?? 'n'}|${tint === null ? 0 : strength}|${GFX.standardMaterials ? 's' : 'l'}`;
  const cached = matCache.get(key);
  if (cached) return cached;

  const s = src as THREE.MeshStandardMaterial;
  let mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  if (GFX.standardMaterials) {
    mat = s.clone();
    addRimGlow(mat); // dungeon silhouette rim (uRimBoost contract)
  } else {
    // low tier: Lambert with the same texture map — no PBR, no rim
    mat = new THREE.MeshLambertMaterial({
      map: s.map ?? null,
      color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
      transparent: s.transparent,
      opacity: s.opacity,
      side: s.side,
    });
  }
  if (tint !== null) {
    // subtle pull toward the template color — hard multiplies turn the
    // hand-painted textures muddy
    mat.color.lerp(tintScratch.set(tint), strength);
  }
  matCache.set(key, mat);
  return mat;
}

function tintFor(def: VisualDef, entityColor: number): number | null {
  if (def.tint === undefined) return null;
  return def.tint === 'entity' ? entityColor : def.tint;
}

/** Swap every mesh material in an assembled clone for the shared tinted
 *  (and tier-appropriate) variant. Returns nothing — mutates the clone. */
export function applyMaterials(root: THREE.Object3D, def: VisualDef, entityColor: number): void {
  const tint = tintFor(def, entityColor);
  const strength = def.tintStrength ?? DEFAULT_TINT_STRENGTH;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => tintedMaterial(m, tint, strength));
    } else {
      mesh.material = tintedMaterial(mesh.material, tint, strength);
    }
  });
}

export function tintedFarMaterials(def: VisualDef, entityColor: number, srcMats: THREE.Material[]): THREE.Material[] {
  const tint = tintFor(def, entityColor);
  const strength = def.tintStrength ?? DEFAULT_TINT_STRENGTH;
  return srcMats.map((m) => tintedMaterial(m, tint, strength));
}

// ---------------------------------------------------------------------------
// Per-key prepared data: normalization transform + baked idle-pose geometry
// ---------------------------------------------------------------------------

export interface PreparedVisual {
  key: string;
  def: VisualDef;
  /** uniform scale that brings the asset to def.height world units */
  normScale: number;
  /** lifts feet (or hover gap) onto the pivot plane, post-scale */
  yOffset: number;
  /** clip name -> clip, resolved from the source gltf */
  clips: Map<string, THREE.AnimationClip>;
  /** static idle-pose geometry in normalized space (far LOD + shadow proxy) */
  idleGeo: THREE.BufferGeometry | null;
  /** source materials aligned with idleGeo groups */
  idleSrcMats: THREE.Material[];
  /** click-capsule radius in world units (from measured XZ body extents —
   *  long/wide creatures like wolves need far more than a humanoid sliver) */
  clickRadius: number;
}

const prepared = new Map<string, PreparedVisual>();

export function prepareVisual(key: string): PreparedVisual {
  const hit = prepared.get(key);
  if (hit) return hit;
  const def = VISUALS[key];
  if (!def) throw new Error(`unknown visual key: ${key}`);
  const gltf = resolvedGltf(def.url);

  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations) clips.set(clip.name, clip);

  // Pose a throwaway clone mid-idle, measure it, and bake the static mesh.
  const temp = assembleModel(def);
  const idle = clips.get(def.clips.idle);
  if (idle) {
    const mixer = new THREE.AnimationMixer(temp);
    mixer.clipAction(idle).play();
    mixer.update(Math.min(0.5, idle.duration * 0.5));
    temp.updateMatrixWorld(true);
    temp.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.skeleton.update();
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(temp);
  } else {
    temp.updateMatrixWorld(true);
  }

  // body bounds from the skinned meshes only (weapons would skew the height)
  const bounds = new THREE.Box3();
  const v = new THREE.Vector3();
  temp.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !meshChainVisible(sm, temp)) return;
    const pos = sm.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos as THREE.BufferAttribute, i);
      sm.applyBoneTransform(i, v);
      v.applyMatrix4(sm.matrixWorld);
      bounds.expandByPoint(v);
    }
  });
  const rawHeight = Math.max(1e-3, bounds.max.y - bounds.min.y);
  const normScale = def.height / rawHeight;
  const yOffset = (def.hover ?? 0) - bounds.min.y * normScale;
  const clickRadius = Math.min(2.2, Math.max(0.5,
    Math.max(bounds.max.x, -bounds.min.x, bounds.max.z, -bounds.min.z) * normScale * 0.9));

  const norm = new THREE.Matrix4()
    .makeTranslation(0, yOffset, 0)
    .multiply(new THREE.Matrix4().makeRotationY(def.yaw ?? 0))
    .multiply(new THREE.Matrix4().makeScale(normScale, normScale, normScale));

  const { geo, mats } = bakeStaticPose(temp, norm);

  const prep: PreparedVisual = { key, def, normScale, yOffset, clips, idleGeo: geo, idleSrcMats: mats, clickRadius };
  prepared.set(key, prep);
  return prep;
}

function meshChainVisible(o: THREE.Object3D, stopAt: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    if (cur === stopAt) return true;
    cur = cur.parent;
  }
  return true;
}

/** Bake every visible mesh of a posed clone into one static BufferGeometry
 *  (skinned verts via applyBoneTransform), normalized into world units. */
function bakeStaticPose(root: THREE.Object3D, norm: THREE.Matrix4): { geo: THREE.BufferGeometry | null; mats: THREE.Material[] } {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const v = new THREE.Vector3();
  const full = new THREE.Matrix4();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !meshChainVisible(mesh, root)) return;
    const srcGeo = mesh.geometry;
    const srcPos = srcGeo.getAttribute('position') as THREE.BufferAttribute;
    if (!srcPos) return;
    const out = new THREE.BufferGeometry();
    const baked = new Float32Array(srcPos.count * 3);
    const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh
      ? (mesh as unknown as THREE.SkinnedMesh) : null;
    full.multiplyMatrices(norm, mesh.matrixWorld);
    for (let i = 0; i < srcPos.count; i++) {
      v.fromBufferAttribute(srcPos, i);
      if (skinned) {
        skinned.applyBoneTransform(i, v);
        v.applyMatrix4(skinned.matrixWorld).applyMatrix4(norm);
      } else {
        v.applyMatrix4(full);
      }
      baked[i * 3] = v.x;
      baked[i * 3 + 1] = v.y;
      baked[i * 3 + 2] = v.z;
    }
    out.setAttribute('position', new THREE.BufferAttribute(baked, 3));
    const uv = srcGeo.getAttribute('uv');
    if (uv) out.setAttribute('uv', uv.clone());
    if (srcGeo.index) out.setIndex(srcGeo.index.clone());
    out.computeVertexNormals();
    geos.push(out);
    // GLTFLoader emits one Mesh per primitive — materials are never arrays here
    mats.push(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
  });

  if (geos.length === 0) return { geo: null, mats: [] };
  // uv presence must agree for merging — drop uvs entirely if any geo lacks them
  const allHaveUv = geos.every((g) => g.getAttribute('uv'));
  if (!allHaveUv) for (const g of geos) g.deleteAttribute('uv');
  const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
  if (geos.length === 1) {
    geo.clearGroups();
    geo.addGroup(0, geo.index ? geo.index.count : geo.getAttribute('position').count, 0);
  }
  return { geo, mats };
}
