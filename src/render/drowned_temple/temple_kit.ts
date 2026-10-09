// The Drowned Temple's Blender kit (docs/design/dungeon-rework/kit/
// build_drowned_temple_kit.py, shipped as public/models/props/drowned_temple_kit.glb):
// every Kit_* node baked once into shared geometry split by material slot (lit
// pearl stone, emissive glow, translucent glass), then instanced per piece over
// the sim layout's props, the edge balustrades and the render-only dressing in
// the lagoon (the drowned choir, the columns, the Great Conch, the temple).
//
// A kit that fails to load costs the temple its detail, never the player the
// dungeon: every piece has a plain procedural stand-in. The loader and the
// instancing painter follow the Sunken Bastion's kit loader.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from '../assets/loader';
import { registerDeferredPreload } from '../assets/preload';
import { GFX } from '../gfx';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { planTempleKitPlacements, type TempleKitPlacement } from './temple_kit_plan_core';

export const DROWNED_TEMPLE_KIT_URL = '/models/props/drowned_temple_kit.glb';

type Slot = 'stone' | 'glow' | 'glass';
type BakedPiece = Partial<Record<Slot, THREE.BufferGeometry>>;

const baked = new Map<string, BakedPiece>();
let loading: Promise<void> | null = null;
let loaded = false;

function bakeNode(node: THREE.Object3D): BakedPiece {
  node.updateWorldMatrix(true, true);
  const parts: Record<Slot, THREE.BufferGeometry[]> = { stone: [], glow: [], glass: [] };
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
    const slot: Slot = /glow/i.test(name) ? 'glow' : /glass|water/i.test(name) ? 'glass' : 'stone';
    parts[slot].push(geometry.index ? geometry.toNonIndexed() : geometry);
  });
  const out: BakedPiece = {};
  for (const slot of ['stone', 'glow', 'glass'] as Slot[]) {
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
  loading ??= loadGltf(DROWNED_TEMPLE_KIT_URL)
    .then((gltf) => {
      gltf.scene.traverse((node) => {
        if (node.name.startsWith('Kit_') && !baked.has(node.name))
          baked.set(node.name, bakeNode(node));
      });
      releaseGltf(DROWNED_TEMPLE_KIT_URL);
    })
    .catch(() => undefined)
    .then(() => {
      loaded = true;
    });
  return loading;
}

// World content: fetched on the deferred lane once the game starts, so the
// first approach to the Temple usually finds the kit already baked.
if (typeof window !== 'undefined') registerDeferredPreload(() => startKitLoad());

/** Fetch and bake the kit once. Never rejects; resolves within the wait cap
 *  (a later arrival upgrades the stand-ins in place, see buildTempleKit). */
export function ensureTempleKit(): Promise<void> {
  if (loaded || typeof window === 'undefined') return Promise.resolve();
  return Promise.race([startKitLoad(), new Promise<void>((r) => setTimeout(r, 8000))]);
}

/** Has the real kit landed (not the stand-in boxes)? */
export function templeKitReady(): boolean {
  return loaded && baked.size > 0;
}

/** A baked kit piece (for the encounter visuals that instance their own). */
export function templeKitPiece(piece: string): BakedPiece {
  return pieceGeometry(piece);
}

// ---- materials --------------------------------------------------------------------

let stoneMat: THREE.Material | null = null;
let glowMat: THREE.Material | null = null;
let glassMat: THREE.Material | null = null;

export function templeSlotMaterial(slot: Slot): THREE.Material {
  if (slot === 'stone') {
    stoneMat ??= GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.72,
          metalness: 0.04,
          name: 'DrownedTempleKitStone',
        })
      : new THREE.MeshLambertMaterial({ vertexColors: true, name: 'DrownedTempleKitStone' });
    markSharedMaterial(stoneMat);
    return stoneMat;
  }
  if (slot === 'glow') {
    glowMat ??= new THREE.MeshBasicMaterial({
      vertexColors: true,
      name: 'DrownedTempleKitGlow',
      toneMapped: false,
    });
    markSharedMaterial(glowMat);
    return glowMat;
  }
  glassMat ??= new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    name: 'DrownedTempleKitGlass',
  });
  markSharedMaterial(glassMat);
  return glassMat;
}

// ---- procedural stand-ins ----------------------------------------------------------------

function fallbackGeometry(piece: string): THREE.BufferGeometry {
  const g = (() => {
    if (/SunkenTemple/.test(piece)) return new THREE.BoxGeometry(64, 30, 40).translate(0, 15, 0);
    if (/PrismTower/.test(piece))
      return new THREE.CylinderGeometry(2.2, 4.6, 46, 10).translate(0, 23, 0);
    if (/GreatConch/.test(piece)) return new THREE.ConeGeometry(9, 30, 10).rotateX(Math.PI / 2);
    if (/Moongate/.test(piece)) return new THREE.TorusGeometry(5.2, 0.8, 8, 24).translate(0, 6, 0);
    if (/ColumnFallen/.test(piece))
      return new THREE.CylinderGeometry(1, 1, 8, 12).rotateZ(Math.PI / 2).translate(0, 1, 0);
    if (/ColumnBroken/.test(piece))
      return new THREE.CylinderGeometry(1, 1, 5, 12).translate(0, 2.5, 0);
    if (/Column/.test(piece)) return new THREE.CylinderGeometry(1, 1, 11, 12).translate(0, 5.5, 0);
    if (/Statue/.test(piece))
      return new THREE.CylinderGeometry(0.8, 1.2, 7, 10).translate(0, 3.5, 0);
    if (/Arch/.test(piece)) return new THREE.BoxGeometry(16, 14, 2.4).translate(0, 7, 0);
    if (/AmphiTier/.test(piece)) return new THREE.BoxGeometry(16, 5, 9).translate(0, 1.5, -5);
    if (/MoonAltar/.test(piece))
      return new THREE.CylinderGeometry(2.2, 3.2, 2.8, 16).translate(0, 1.4, 0);
    if (/StandingStone|Obelisk/.test(piece))
      return new THREE.BoxGeometry(1.7, 7, 1.1).translate(0, 3.5, 0);
    if (/LampPillar/.test(piece))
      return new THREE.CylinderGeometry(0.45, 0.6, 7, 10).translate(0, 3.5, 0);
    if (/Balustrade/.test(piece)) return new THREE.BoxGeometry(4, 1.3, 0.6).translate(0, 0.65, 0);
    if (/Kerb/.test(piece)) return new THREE.BoxGeometry(4, 0.4, 0.8).translate(0, 0.2, 0);
    if (/CraterSpire/.test(piece)) return new THREE.ConeGeometry(6, 18, 7).translate(0, 9, 0);
    if (/Plinth/.test(piece))
      return new THREE.CylinderGeometry(4.8, 4.8, 0.4, 24).translate(0, 0.2, 0);
    return new THREE.BoxGeometry(2, 1.2, 1.4).translate(0, 0.6, 0);
  })();
  const n = g.index ? g.toNonIndexed() : g;
  const col = new Float32Array(n.attributes.position.count * 3).fill(0.45);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

const fallbacks = new Map<string, BakedPiece>();

function pieceGeometry(piece: string): BakedPiece {
  const got = baked.get(piece);
  if (got) return got;
  let fb = fallbacks.get(piece);
  if (!fb) {
    fb = { stone: markSharedGeometry(fallbackGeometry(piece)) };
    fallbacks.set(piece, fb);
  }
  return fb;
}

/** Instance the whole kit over the layout (instance-local frame). A kit still
 *  loading when this runs is swapped in the moment it lands. */
export function buildTempleKit(
  ground: (x: number, z: number) => number,
  lowGfx: boolean,
): THREE.Group {
  const group = buildKitGroup(ground, lowGfx);
  if (!loaded && loading) {
    void loading.then(() => {
      const parent = group.parent;
      if (!parent || baked.size === 0) return;
      const fresh = buildKitGroup(ground, lowGfx);
      parent.add(fresh);
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    });
  }
  return group;
}

/** Instance a list of placements (the kit painter, shared with the encounter
 *  visuals that swap pieces by state). */
export function instancePlacements(
  list: readonly TempleKitPlacement[],
  ground: (x: number, z: number) => number,
  lowGfx: boolean,
  name: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const byPiece = new Map<string, TempleKitPlacement[]>();
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
    for (const slot of ['stone', 'glow', 'glass'] as Slot[]) {
      const g = geo[slot];
      if (!g) continue;
      const mesh = new THREE.InstancedMesh(g, templeSlotMaterial(slot), bucket.length);
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

function buildKitGroup(ground: (x: number, z: number) => number, lowGfx: boolean): THREE.Group {
  return instancePlacements(planTempleKitPlacements(), ground, lowGfx, 'drownedTempleKit');
}
