// The Wildheart Basin's Blender kit (docs/design/dungeon-rework/kit/
// build_wildheart_basin_kit.py, shipped as public/models/props/wildheart_basin_kit.glb):
// every Kit_* node baked once into shared geometry split by material slot (lit
// stone, wood, bone and foliage; emissive glow; translucent wet sheen), then
// instanced per piece over the sim layout's props, the cliff-edge lips and the
// render-only dressing (the caldera ring, the gorge jungle, the stepped
// pyramid, the jaguar head, the Sunken Idol's maw). Placements come from the
// pure plan (basin_kit_plan_core.ts).
//
// A kit that fails to load costs the basin its detail, never the player the
// dungeon: every piece has a plain procedural stand-in, and a kit that lands
// late swaps in under the same group. GPU preparation: the dressing is part of
// the interior group the renderer attaches through its compile gate; the
// stand-ins draw every slot material (stone, glow, glass and the jaguar's
// eyes) so a late swap links no new program. No lights here: braziers, coals,
// glyph inlay and the eyes are emissive; the render's light sink owns lights.

import * as THREE from 'three';
import { WILDHEART_BASIN_FIELD } from '../../sim/content/wildheart_basin_layout';
import { authoredFieldHeight } from '../../sim/instances/authored_field';
import { loadGltf, releaseGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { GFX } from '../gfx';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { type BasinKitPlacement, planBasinKitPlacements } from './basin_kit_plan_core';

export const WILDHEART_BASIN_KIT_URL = '/models/props/wildheart_basin_kit.glb';

export type BasinSlot = 'stone' | 'glow' | 'glass';
export type BasinBakedPiece = Partial<Record<BasinSlot, THREE.BufferGeometry>>;

const SLOTS: readonly BasinSlot[] = ['stone', 'glow', 'glass'];
/** The eyes draw with their own emissive material (the render drives its burn). */
const EYES = 'Kit_JaguarEyes';
const KIT_WAIT_MS = 8000;

const baked = new Map<string, BasinBakedPiece>();
let loading: Promise<void> | null = null;
let loaded = false;

function bakeNode(node: THREE.Object3D): BasinBakedPiece {
  node.updateWorldMatrix(true, true);
  const parts: Record<BasinSlot, THREE.BufferGeometry[]> = { stone: [], glow: [], glass: [] };
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
    const name = material?.name ?? '';
    const slot: BasinSlot = /glow/i.test(name)
      ? 'glow'
      : /glass|water/i.test(name)
        ? 'glass'
        : 'stone';
    parts[slot].push(geometry.index ? geometry.toNonIndexed() : geometry);
  });
  const out: BasinBakedPiece = {};
  for (const slot of SLOTS) {
    if (parts[slot].length === 0) continue;
    out[slot] = markSharedGeometry(mergeNonIndexed(parts[slot]));
  }
  return out;
}

function mergeNonIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3).fill(1);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    const c = g.attributes.color?.array as Float32Array | undefined;
    if (c) col.set(c, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function startKitLoad(): Promise<void> {
  loading ??= loadGltf(WILDHEART_BASIN_KIT_URL)
    .then((gltf) => {
      gltf.scene.traverse((node) => {
        if (node.name.startsWith('Kit_') && !baked.has(node.name))
          baked.set(node.name, bakeNode(node));
      });
      releaseGltf(WILDHEART_BASIN_KIT_URL);
    })
    .catch(() => undefined)
    .then(() => {
      loaded = true;
    });
  return loading;
}

// World content: fetched on the deferred lane once the game starts, so the
// first walk into the Idol's maw usually finds the kit already baked.
if (typeof window !== 'undefined') registerDeferredPreload(() => startKitLoad());

/** Fetch and bake the kit once. Never rejects; resolves within the wait cap
 *  (a later arrival upgrades the stand-ins in place, see buildBasinKitDressing). */
export function ensureBasinKit(): Promise<void> {
  if (loaded || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([
    startKitLoad(),
    new Promise<void>((resolve) => setTimeout(resolve, KIT_WAIT_MS)),
  ]);
}

/** Has the real kit landed (not the stand-in shapes)? */
export function basinKitReady(): boolean {
  return loaded && baked.size > 0;
}

/** A baked kit piece by node name (Kit_*), split by slot; the stand-in until
 *  the kit lands. For the painters that instance their own (the gates). */
export function basinKitPiece(piece: string): BasinBakedPiece {
  return pieceGeometry(piece);
}

// ---- materials --------------------------------------------------------------------

let stoneMat: THREE.Material | null = null;
let glowMat: THREE.MeshBasicMaterial | null = null;
let glassMat: THREE.Material | null = null;
let eyesMat: THREE.MeshBasicMaterial | null = null;

/** The shared material of a slot (one program per slot for the whole kit). */
export function basinSlotMaterial(slot: BasinSlot): THREE.Material {
  if (slot === 'stone') {
    stoneMat ??= GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.82,
          metalness: 0.02,
          name: 'WildheartBasinKitStone',
        })
      : new THREE.MeshLambertMaterial({ vertexColors: true, name: 'WildheartBasinKitStone' });
    markSharedMaterial(stoneMat);
    return stoneMat;
  }
  if (slot === 'glow') {
    glowMat ??= new THREE.MeshBasicMaterial({
      vertexColors: true,
      name: 'WildheartBasinKitGlow',
      toneMapped: false,
    });
    markSharedMaterial(glowMat);
    return glowMat;
  }
  glassMat ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide,
    name: 'WildheartBasinKitGlass',
  });
  markSharedMaterial(glassMat);
  return glassMat;
}

/** Resting burn of the jaguar's eyes (a dim jade gleam in the sockets). */
export const JAGUAR_EYES_REST = 0.22;

/** The jaguar head's eyes: the glow slot's program with its own colour, so the
 *  render can make them burn during the hunt without a new link. */
export function basinJaguarEyesMaterial(): THREE.MeshBasicMaterial {
  eyesMat ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    name: 'WildheartBasinJaguarEyes',
    toneMapped: false,
  });
  eyesMat.color.setScalar(JAGUAR_EYES_REST);
  markSharedMaterial(eyesMat);
  return eyesMat;
}

/** Drive the eyes' burn: 0 is the resting gleam, 1 full spirit fire. A colour
 *  write only (never a program change). */
export function setBasinJaguarEyesBurn(k: number): void {
  const t = Math.max(0, Math.min(1, k));
  basinJaguarEyesMaterial().color.setScalar(JAGUAR_EYES_REST + (1.35 - JAGUAR_EYES_REST) * t);
}

function materialFor(piece: string, slot: BasinSlot): THREE.Material {
  return piece === EYES && slot === 'glow' ? basinJaguarEyesMaterial() : basinSlotMaterial(slot);
}

// ---- procedural stand-ins --------------------------------------------------------------

function tinted(
  g: THREE.BufferGeometry,
  rgb: readonly [number, number, number],
): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const col = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set(rgb, i);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

function joined(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  return mergeNonIndexed([a, b]);
}

const STONE: readonly [number, number, number] = [0.2, 0.2, 0.18];
const LEAF: readonly [number, number, number] = [0.06, 0.16, 0.08];
const EMBER: readonly [number, number, number] = [1.0, 0.25, 0.04];
const JADE: readonly [number, number, number] = [0.13, 0.74, 0.35];
const SHEEN: readonly [number, number, number] = [0.72, 0.9, 0.9];

/** A plain shape per piece (stone slot), plus the glow or glass parts a piece
 *  carries, so the stand-ins exercise every slot material. */
function fallbackPiece(piece: string): BasinBakedPiece {
  const box = (w: number, h: number, d: number, y = h / 2) =>
    new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
  const cyl = (r0: number, r1: number, h: number, y = h / 2, sides = 8) =>
    new THREE.CylinderGeometry(r1, r0, h, sides).translate(0, y, 0);
  const stone = (g: THREE.BufferGeometry, rgb = STONE): BasinBakedPiece => ({
    stone: tinted(g, rgb),
  });
  switch (piece) {
    case 'Kit_JaguarHead':
      return stone(box(56, 76, 50, 26));
    case EYES:
      return {
        glow: joined(
          tinted(new THREE.BoxGeometry(9, 4.5, 1).translate(-12, 49.5, 13.5), JADE),
          tinted(new THREE.BoxGeometry(9, 4.5, 1).translate(12, 49.5, 13.5), JADE),
        ),
      };
    case 'Kit_IdolMaw':
      return stone(box(60, 8, 26, 19).translate(0, 0, -2));
    case 'Kit_MawPylon':
      return stone(box(3.4, 14, 3.4));
    case 'Kit_PyramidTier':
      return stone(box(8, 12, 6).translate(0, 0, -3));
    case 'Kit_PyramidCorner':
      return stone(box(2.3, 12, 2.3).translate(1.1, 0, -1.1));
    case 'Kit_BasaltCliff':
      return stone(box(32, 120, 24).translate(0, 0, -11));
    case 'Kit_BasaltEdge':
      return stone(box(4, 8, 0.9, -3.9));
    case 'Kit_MasonryEdge':
      return stone(box(4, 3.4, 0.8, -1.3));
    case 'Kit_BoneEdge':
      return stone(box(4, 1.2, 0.3), [0.7, 0.66, 0.55]);
    case 'Kit_WaterfallLip':
      return stone(box(20, 6, 14, -1).translate(0, 0, -6));
    case 'Kit_RiverStones':
    case 'Kit_PoolRim': {
      const flat = piece === 'Kit_RiverStones';
      return {
        stone: tinted(flat ? cyl(2.2, 1.8, 0.5) : cyl(1.6, 1.2, 2), STONE),
        glass: tinted(
          new THREE.CircleGeometry(flat ? 2.6 : 1.9, 12)
            .rotateX(-Math.PI / 2)
            .translate(0, 0.08, 0),
          SHEEN,
        ),
      };
    }
    case 'Kit_JungleTree':
    case 'Kit_JungleTreeTall': {
      const h = piece === 'Kit_JungleTree' ? 18 : 28;
      return {
        stone: joined(
          tinted(cyl(1.6, 1.0, h * 0.75), [0.3, 0.26, 0.21]),
          tinted(cyl(8, 6, h * 0.3, h * 0.85), LEAF),
        ),
      };
    }
    case 'Kit_CanopyClump':
      return stone(new THREE.SphereGeometry(7, 7, 4).scale(1, 0.55, 1).translate(0, 3, 0), LEAF);
    case 'Kit_Palm':
    case 'Kit_GiantFern':
      return stone(new THREE.ConeGeometry(2.6, 2.4, 6).translate(0, 1.2, 0), LEAF);
    case 'Kit_PalmTall':
      return stone(cyl(0.6, 0.4, 16), LEAF);
    case 'Kit_HangingVines':
      return stone(box(4, 9, 0.3, -4.5), LEAF);
    case 'Kit_Brazier':
      return {
        stone: tinted(cyl(0.7, 0.5, 1.5), STONE),
        glow: tinted(cyl(0.55, 0.55, 0.2, 1.62, 8), EMBER),
      };
    case 'Kit_SunGlyph':
      return {
        stone: tinted(cyl(3, 3, 0.16, -0.04, 24), [0.4, 0.37, 0.3]),
        glow: tinted(cyl(0.7, 0.7, 0.03, 0.05, 12), [0.5, 0.38, 0.18]),
      };
    case 'Kit_ShrineAltar':
      return stone(box(8, 3, 3.2));
    case 'Kit_RuinArch':
      return stone(box(10, 9, 2));
    case 'Kit_RuinWall':
      return stone(box(12, 4, 1.6));
    case 'Kit_BoneFence':
      return stone(box(8, 2.4, 0.4), [0.7, 0.66, 0.55]);
    case 'Kit_BeastCage':
    case 'Kit_HideRack':
      return stone(box(4, 3.2, piece === 'Kit_BeastCage' ? 4 : 1.2), [0.42, 0.33, 0.22]);
    case 'Kit_JudgingStone':
      return stone(cyl(2.2, 1.9, 2.8));
    case 'Kit_VineBridge':
      return stone(box(4, 0.3, 8, -0.15), LEAF);
    case 'Kit_ThornWall':
      return stone(box(4, 4.6, 2), [0.05, 0.04, 0.04]);
    default:
      return stone(cyl(0.9, 0.7, 6));
  }
}

const fallbacks = new Map<string, BasinBakedPiece>();

function pieceGeometry(piece: string): BasinBakedPiece {
  const got = baked.get(piece);
  if (got) return got;
  let fb = fallbacks.get(piece);
  if (!fb) {
    fb = fallbackPiece(piece);
    for (const slot of SLOTS) {
      const g = fb[slot];
      if (g) fb[slot] = markSharedGeometry(g);
    }
    fallbacks.set(piece, fb);
  }
  return fb;
}

// ---- the painter ------------------------------------------------------------------------

const fieldGround = (x: number, z: number): number =>
  authoredFieldHeight(WILDHEART_BASIN_FIELD, x, z);

/** Instance a list of placements (one InstancedMesh per piece and slot). A
 *  placement without `y` stands on the field's ground. Shared with the gate
 *  painters, which instance Kit_VineBridge and Kit_ThornWall along their runs. */
export function instanceBasinPlacements(
  list: readonly BasinKitPlacement[],
  lowGfx: boolean,
  name: string,
  ground: (x: number, z: number) => number = fieldGround,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const byPiece = new Map<string, BasinKitPlacement[]>();
  for (const p of list) {
    if (lowGfx && p.cosmetic) continue;
    const bucket = byPiece.get(p.piece) ?? [];
    bucket.push(p);
    byPiece.set(p.piece, bucket);
  }
  const m = new THREE.Matrix4();
  const shearM = new THREE.Matrix4();
  const scaleM = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (const [piece, bucket] of byPiece) {
    const geo = pieceGeometry(piece);
    for (const slot of SLOTS) {
      const g = geo[slot];
      if (!g) continue;
      const mesh = new THREE.InstancedMesh(g, materialFor(piece, slot), bucket.length);
      mesh.name = `${piece}:${slot}`;
      bucket.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        pos.set(p.x, p.y ?? ground(p.x, p.z) + (p.lift ?? 0), p.z);
        scl.set(p.scale * (p.stretch ?? 1), p.scale, p.scale);
        if (p.shear) {
          m.compose(pos, q, one);
          shearM.set(1, 0, 0, 0, p.shear, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
          m.multiply(shearM).multiply(scaleM.makeScale(scl.x, scl.y, scl.z));
        } else {
          m.compose(pos, q, scl);
        }
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = slot === 'stone' && !lowGfx;
      mesh.receiveShadow = slot === 'stone';
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

function buildDressingGroup(lowGfx: boolean): THREE.Group {
  return instanceBasinPlacements(planBasinKitPlacements(), lowGfx, 'wildheartBasinKit');
}

/** Instance the whole kit over the layout (instance-local frame): the props,
 *  the cliff lips, the caldera ring, the gorge jungle, the pyramid, the jaguar
 *  head and its eyes. A kit still loading when this runs is swapped in the
 *  moment it lands (same materials, so no new program). */
export function buildBasinKitDressing(lowGfx: boolean): THREE.Group {
  const group = buildDressingGroup(lowGfx);
  if (!loaded && loading) {
    void loading.then(() => {
      const parent = group.parent;
      if (!parent || baked.size === 0) return;
      const fresh = buildDressingGroup(lowGfx);
      parent.add(fresh);
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    });
  }
  return group;
}
