// The Gravewyrm Sanctum's Blender kit (docs/design/dungeon-rework/kit/
// build_gravewyrm_sanctum_kit.py, shipped as public/models/props/
// gravewyrm_sanctum_kit.glb): every Kit_* node baked once into shared
// geometry split by material slot (KitStone: rock, ice, snow, iron, hide and
// the figures, told apart by the vertex colour; KitGlow: runes, coals,
// soulfire, crack light and the shard; KitGlass: the clear ice shells and the
// meltwater), then instanced per piece over the sim layout's props and the
// render-only scenery. Placements come from the pure plan
// (sanctum_kit_plan_core.ts).
//
// A kit that fails to load (or has not landed yet) costs the Sanctum its
// detail, never the player the dungeon: every piece has a procedural stand-in
// registered by the module that draws it (registerSanctumFallback), and a kit
// that lands late swaps in under the same group. GPU preparation: the
// dressing is part of the interior group the renderer attaches through its
// compile gate; the stand-ins draw every slot material so a late swap links
// no new program. No lights here (sanctum_lights.ts owns them).

import * as THREE from 'three';
import { loadGltf, releaseGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { GFX } from '../gfx';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import type { SanctumKitPlacement } from './sanctum_kit_plan_core';
import { sanctumGround } from './sanctum_plan_core';

export const GRAVEWYRM_SANCTUM_KIT_URL = '/models/props/gravewyrm_sanctum_kit.glb';

export type SanctumSlot = 'stone' | 'glow' | 'glass';
export type SanctumBakedPiece = Partial<Record<SanctumSlot, THREE.BufferGeometry>>;
export const SANCTUM_SLOTS: readonly SanctumSlot[] = ['stone', 'glow', 'glass'];

const KIT_WAIT_MS = 8000;

const baked = new Map<string, SanctumBakedPiece>();
let loading: Promise<void> | null = null;
let loaded = false;

function slotOf(materialName: string): SanctumSlot {
  if (/glow/i.test(materialName)) return 'glow';
  if (/glass/i.test(materialName)) return 'glass';
  return 'stone';
}

/** Merge geometries into ONE indexed geometry (position, normal, colour).
 *  The kit's own indices are kept; a part without an index gets the trivial
 *  one. */
export function mergeSanctumParts(list: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  let indices = 0;
  for (const g of list) {
    count += g.attributes.position.count;
    indices += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3).fill(1);
  const index = count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let o = 0;
  let io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array as Float32Array, o * 3);
    const c = g.attributes.color?.array as Float32Array | undefined;
    if (c && g.attributes.color.itemSize === 3) col.set(c, o * 3);
    if (g.index) {
      const src = g.index.array;
      for (let k = 0; k < src.length; k++) index[io++] = src[k] + o;
    } else {
      for (let k = 0; k < n; k++) index[io++] = o + k;
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

function bakeNode(node: THREE.Object3D): SanctumBakedPiece {
  node.updateWorldMatrix(true, true);
  // Every piece is exported at the kit's origin (the pilot's contract): its
  // world matrix carries the glTF axes, so the bake keeps it whole.
  const parts: Record<SanctumSlot, THREE.BufferGeometry[]> = { stone: [], glow: [], glass: [] };
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
      const attr = child.geometry.getAttribute(name);
      if (!attr) continue;
      const size = name === 'color' ? 3 : attr.itemSize;
      const values = new Float32Array(attr.count * size);
      for (let i = 0; i < attr.count; i++)
        for (let j = 0; j < size; j++) values[i * size + j] = attr.getComponent(i, j);
      geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    if (child.geometry.index) geometry.setIndex(child.geometry.index.clone());
    geometry.applyMatrix4(child.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const material = Array.isArray(child.material) ? child.material[0] : child.material;
    parts[slotOf(material?.name ?? '')].push(geometry);
  });
  const out: SanctumBakedPiece = {};
  for (const slot of SANCTUM_SLOTS) {
    if (parts[slot].length === 0) continue;
    out[slot] = markSharedGeometry(mergeSanctumParts(parts[slot]));
    for (const g of parts[slot]) g.dispose();
  }
  return out;
}

function startKitLoad(): Promise<void> {
  loading ??= loadGltf(GRAVEWYRM_SANCTUM_KIT_URL)
    .then((gltf) => {
      gltf.scene.traverse((node) => {
        if (node.name.startsWith('Kit_') && !baked.has(node.name))
          baked.set(node.name, bakeNode(node));
      });
      releaseGltf(GRAVEWYRM_SANCTUM_KIT_URL);
    })
    .catch(() => undefined)
    .then(() => {
      loaded = true;
    });
  return loading;
}

// World content: fetched on the deferred lane once the game starts.
if (typeof window !== 'undefined') registerDeferredPreload(() => startKitLoad());

/** Fetch and bake the kit once. Never rejects; resolves within the wait cap
 *  (a later arrival upgrades the stand-ins in place: upgradeWhenSanctumKitLands). */
export function ensureSanctumKit(): Promise<void> {
  if (loaded || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([
    startKitLoad(),
    new Promise<void>((resolve) => setTimeout(resolve, KIT_WAIT_MS)),
  ]);
}

/** Has the real kit landed (not the stand-in shapes)? */
export function sanctumKitLoaded(): boolean {
  return loaded && baked.size > 0;
}

/** A baked kit piece by node name (Kit_*), or null until the real kit has
 *  landed (or when the kit carries no such piece). */
export function sanctumKitPiece(piece: string): SanctumBakedPiece | null {
  return baked.get(piece) ?? null;
}

/** The first of `names` the kit carries (the kit's own spellings drift: a
 *  piece named in the brief may ship under a sibling's name). */
export function sanctumKitFirst(names: readonly string[]): string | null {
  for (const n of names) if (baked.has(n)) return n;
  return null;
}

// ---- materials --------------------------------------------------------------------

const slotMats = new Map<SanctumSlot, THREE.Material>();

/** The shared material of a slot (one program per slot for the whole kit). */
export function sanctumSlotMaterial(slot: SanctumSlot): THREE.Material {
  let m = slotMats.get(slot);
  if (m) return m;
  if (slot === 'stone') {
    // Ice, snow and slate share it, told apart by the vertex paint: a
    // moderate roughness lets the cold sky glint off the ice without the
    // snow turning to plastic.
    m = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          vertexColors: true,
          metalness: 0.02,
          roughness: 0.62,
          name: 'SanctumKitStone',
        })
      : new THREE.MeshLambertMaterial({ vertexColors: true, name: 'SanctumKitStone' });
  } else if (slot === 'glow') {
    m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      name: 'SanctumKitGlow',
      toneMapped: false,
    });
  } else {
    m = GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.3,
          roughness: 0.08,
          metalness: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          name: 'SanctumKitGlass',
        })
      : new THREE.MeshLambertMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          side: THREE.DoubleSide,
          name: 'SanctumKitGlass',
        });
  }
  markSharedMaterial(m);
  slotMats.set(slot, m);
  return m;
}

// ---- procedural stand-ins --------------------------------------------------------------

export type Rgb = readonly [number, number, number];

/** One part of a stand-in: a geometry in the piece's own frame, its slot,
 *  and a flat colour unless the geometry already carries a colour attribute. */
export interface SanctumPart {
  slot: SanctumSlot;
  g: THREE.BufferGeometry;
  rgb?: Rgb;
}

const fallbackBuilders = new Map<string, () => SanctumPart[]>();
const fallbacks = new Map<string, SanctumBakedPiece>();

/** Register the stand-in a piece draws while the kit is missing (the module
 *  that places the piece owns its stand-in). */
export function registerSanctumFallback(piece: string, build: () => SanctumPart[]): void {
  if (!fallbackBuilders.has(piece)) fallbackBuilders.set(piece, build);
}

function tinted(g: THREE.BufferGeometry, rgb: Rgb | undefined): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  if (!n.getAttribute('normal')) n.computeVertexNormals();
  if (n.getAttribute('color') && !rgb) return n;
  const c = rgb ?? [0.7, 0.75, 0.8];
  const col = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set(c, i);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

function bakeFallback(piece: string): SanctumBakedPiece {
  const build = fallbackBuilders.get(piece);
  const list = build ? build() : [];
  const parts: Record<SanctumSlot, THREE.BufferGeometry[]> = { stone: [], glow: [], glass: [] };
  for (const part of list) parts[part.slot].push(tinted(part.g, part.rgb));
  const out: SanctumBakedPiece = {};
  for (const slot of SANCTUM_SLOTS) {
    if (parts[slot].length > 0) out[slot] = markSharedGeometry(mergeSanctumParts(parts[slot]));
  }
  return out;
}

/** A piece's geometry: the baked kit node, else its stand-in. */
export function sanctumPieceGeometry(piece: string): SanctumBakedPiece {
  const got = baked.get(piece);
  if (got) return got;
  let fb = fallbacks.get(piece);
  if (!fb) {
    fb = bakeFallback(piece);
    fallbacks.set(piece, fb);
  }
  return fb;
}

// ---- the painter ------------------------------------------------------------------------

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScl = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

/** A placement's instance matrix. */
export function sanctumPlacementMatrix(
  p: SanctumKitPlacement,
  out: THREE.Matrix4,
  ground: (x: number, z: number) => number = sanctumGround,
): THREE.Matrix4 {
  tmpE.set(p.tilt ?? 0, p.rot, p.roll ?? 0, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpPos.set(p.x, p.y ?? ground(p.x, p.z) + (p.lift ?? 0), p.z);
  tmpScl.set(p.scale * (p.stretch ?? 1), p.scale * (p.scaleY ?? 1), p.scale * (p.depth ?? 1));
  return out.compose(tmpPos, tmpQ, tmpScl);
}

/** The side of a culling cell (yards): the field is 230 by 480 yd, so one
 *  InstancedMesh per piece over the whole plan would never leave either the
 *  camera's frustum or the shadow box. */
const CULL_CELL = 100;

/** Pieces that never cast a shadow: the scenery out in the crevasses and on
 *  the rim, and the flat floor dressing. (They still receive.) */
const NO_SHADOW_PREFIXES = [
  'Kit_GlacierWall',
  'Kit_IceFall',
  'Kit_CrevasseEdge',
  'Kit_RockCliff',
  'Kit_FrozenFall',
  'Kit_Sastrugi',
  'Kit_SnowDrift',
  'Kit_ThornpeakCrag',
  'Kit_PressureRidge',
  'Kit_IcePlate',
  'Kit_MeltChannel',
  'Kit_RitualCircle',
  'Kit_HaulRoadKerb',
];

/** Pieces whose glow slot is a MODELLED flame (static geometry, it reads as
 *  a paper cone): their fire is the Sanctum's own instanced flame
 *  (sanctum_fire.ts), so the slot is not drawn. */
const FLAME_GLOW_PIECES: ReadonlySet<string> = new Set([
  'Kit_ThawPyre',
  'Kit_Pyre',
  'Kit_SoulBrazier',
]);

/** Whether a piece's slot is drawn (the modelled flames are not). */
export function sanctumSlotDrawn(piece: string, slot: SanctumSlot): boolean {
  return !(slot === 'glow' && FLAME_GLOW_PIECES.has(piece));
}

function castsShadow(piece: string): boolean {
  return !NO_SHADOW_PREFIXES.some((p) => piece.startsWith(p));
}

/** Instance a list of placements (one InstancedMesh per piece, culling cell,
 *  shadow class and slot). A placement without `y` stands on the field's
 *  ground. `density` (0..1, the effects tier's) sheds the placements whose
 *  `shed` lies above it. */
export function instanceSanctumPlacements(
  list: readonly SanctumKitPlacement[],
  lowGfx: boolean,
  name: string,
  density = 1,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const byPiece = new Map<string, SanctumKitPlacement[]>();
  for (const p of list) {
    if (lowGfx && p.cosmetic) continue;
    if (p.shed !== undefined && p.shed > density) continue;
    const key = `${p.piece}|${Math.floor(p.x / CULL_CELL)}|${Math.floor(p.z / CULL_CELL)}|${p.noShadow ? 1 : 0}`;
    const bucket = byPiece.get(key) ?? [];
    bucket.push(p);
    byPiece.set(key, bucket);
  }
  for (const bucket of byPiece.values()) {
    const piece = bucket[0].piece;
    const geo = sanctumPieceGeometry(piece);
    const casts = !lowGfx && castsShadow(piece) && !bucket[0].noShadow;
    for (const slot of SANCTUM_SLOTS) {
      const g = geo[slot];
      if (!g || !sanctumSlotDrawn(piece, slot)) continue;
      const mesh = new THREE.InstancedMesh(g, sanctumSlotMaterial(slot), bucket.length);
      mesh.name = `${piece}:${slot}`;
      for (const [i, p] of bucket.entries()) mesh.setMatrixAt(i, sanctumPlacementMatrix(p, tmpM));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = casts && slot === 'stone';
      mesh.receiveShadow = slot === 'stone';
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  group.add(slotProgramWarmers());
  return group;
}

let warmGeometry: THREE.BufferGeometry | null = null;

/**
 * Hidden carriers of every slot material in both of its variants (instanced
 * and plain, casting a shadow), built with every kit group: the stand-ins
 * draw almost only the stone slot, so without these a kit that lands late
 * would link the glow and glass programs inside a live frame. The compile
 * gate walks hidden nodes (three's compile traverses the whole root for
 * materials), so the programs link behind the gate with the interior.
 */
export function slotProgramWarmers(): THREE.Group {
  if (!warmGeometry) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    warmGeometry = markSharedGeometry(g);
  }
  const group = new THREE.Group();
  group.name = 'sanctumSlotWarmers';
  for (const slot of SANCTUM_SLOTS) {
    const inst = new THREE.InstancedMesh(warmGeometry, sanctumSlotMaterial(slot), 1);
    inst.castShadow = slot === 'stone';
    inst.receiveShadow = slot === 'stone';
    const plain = new THREE.Mesh(warmGeometry, sanctumSlotMaterial(slot));
    plain.castShadow = slot === 'stone';
    plain.receiveShadow = slot === 'stone';
    for (const m of [inst, plain]) {
      m.visible = false;
      m.frustumCulled = false;
      m.name = `sanctumSlotWarmer:${slot}`;
      group.add(m);
    }
  }
  return group;
}

/** Swap a group built from stand-ins for the real kit the moment it lands
 *  (same materials, so no new program). `build` rebuilds it. */
export function upgradeWhenSanctumKitLands(
  group: THREE.Object3D,
  build: () => THREE.Object3D,
): void {
  if (loaded || !loading) return;
  void loading.then(() => {
    const parent = group.parent;
    if (!parent || baked.size === 0) return;
    parent.add(build());
    group.removeFromParent();
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  });
}

/** One plain Mesh per slot of a kit piece under a group (for the painters
 *  that move a single piece: the gates, the face's falling plates).
 *  `transform` bakes a matrix into a private copy of the geometry. */
export function sanctumKitMeshes(piece: string, transform?: THREE.Matrix4): THREE.Group {
  const group = new THREE.Group();
  group.name = piece;
  const geo = sanctumPieceGeometry(piece);
  for (const slot of SANCTUM_SLOTS) {
    const g = geo[slot];
    if (!g) continue;
    const mesh = new THREE.Mesh(
      transform ? g.clone().applyMatrix4(transform) : g,
      sanctumSlotMaterial(slot),
    );
    mesh.name = `${piece}:${slot}`;
    mesh.castShadow = slot === 'stone';
    mesh.receiveShadow = slot === 'stone';
    group.add(mesh);
  }
  return group;
}
