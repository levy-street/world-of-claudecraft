// Marsh-ruin dressing for The Drowned Litany (render-only). Replaces the
// Collapsed Reliquary ossuary/coffin/bone kit on delve_marsh variants.

import * as THREE from 'three';
import type { DelveModuleId } from '../sim/delve_layout';
import {
  type LitanyDressingAnchor,
  type LitanyModuleId,
  litanyModuleDressing,
  litanyModuleGeometry,
} from '../sim/delve_litany_layout';
import type { DungeonLayout } from '../sim/dungeon_layout';
import { polygonXAtZ } from '../sim/geometry2d';
import { hash2 } from '../sim/rng';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX, surfaceMat } from './gfx';

// Stable seed for all hash2 calls in this module (render-only dressing, no sim state).
const MARSH_SEED = 0x4c69746e; // 'Litn' in ASCII

// GLB-backed anchor kinds (Tripo-generated, see public/models/props). Each has
// a procedural fallback (kept below, used only for pre-load races / headless
// test hosts) that draws the SAME representative shape the GLB replaced.
// 'dead_tree'/'reed_cluster'/'sluice_post'/'root_wall' lose their per-instance
// hash2-driven branch/stalk/rope/root variety when the GLB is loaded (one
// fixed model instead of many procedural variants); acceptable per-instance
// trade for real art.
type MarshGlbAnchorKind =
  | 'plank_bridge'
  | 'shrine_fragment'
  | 'corpse_candle'
  | 'broken_bell_frame'
  | 'sluice_post'
  | 'dead_tree'
  | 'reed_cluster'
  | 'root_wall';

const MARSH_ASSET_URL: Record<MarshGlbAnchorKind, string> = {
  plank_bridge: '/models/props/marsh_plank_bridge.glb',
  shrine_fragment: '/models/props/marsh_shrine_fragment.glb',
  corpse_candle: '/models/props/marsh_corpse_candle.glb',
  broken_bell_frame: '/models/props/marsh_bell_gallows.glb',
  sluice_post: '/models/props/marsh_sluice_post.glb',
  dead_tree: '/models/props/marsh_dead_tree.glb',
  reed_cluster: '/models/props/marsh_reed_cluster.glb',
  root_wall: '/models/props/marsh_root_wall.glb',
};

// Uniform-rescale target per kind, matched to the footprint the procedural
// fallback it replaces was authored against (mirrors delve_props.ts
// buildStandaloneGlb, which normalizes to the procedural prop's original
// target height via a Box3 measure/rescale). 'span' measures the model's
// local-X extent (its longest authored axis before any placement rotation);
// 'height' measures local-Y. Without this every GLB here landed at whatever
// size Tripo normalized it to, not the size its layout was authored against.
const MARSH_ASSET_SCALE: Record<MarshGlbAnchorKind, { axis: 'x' | 'y'; target: number }> = {
  // addPlankBridge's three BoxGeometry(2.4, 0.12, 0.45) planks span x
  // [-1.75, 1.75]: a 3.5 yd deck, not the GLB's 0.45 yd bounding box.
  plank_bridge: { axis: 'x', target: 3.5 },
  // addShrineFragment's BoxGeometry(1.4, 0.9, 0.35) slab.
  shrine_fragment: { axis: 'x', target: 1.4 },
  // addCorpseCandleProp's wax cylinder (0.55 tall) plus its flame sphere
  // (0.14 radius, seated to y 0.62) tops out around 0.76.
  corpse_candle: { axis: 'y', target: 0.76 },
  // addBrokenBellFrame's two BoxGeometry(0.25, 2.8, 0.25) posts.
  broken_bell_frame: { axis: 'y', target: 2.8 },
  // addSluicePost's tapered CylinderGeometry post, height 2.0-2.4.
  sluice_post: { axis: 'y', target: 2.2 },
  // addDeadTree's trunk CylinderGeometry, height 3.2-4.8.
  dead_tree: { axis: 'y', target: 4.0 },
  // addReedCluster's tallest stalk, height 1.2-2.6.
  reed_cluster: { axis: 'y', target: 1.9 },
  // addRootWall's arced root limbs, vertical projection up to ~1.5 (len 2.5
  // at max tilt, scaled by cos(tilt)*0.6).
  root_wall: { axis: 'y', target: 1.5 },
};

const loadedMarshGltf = new Map<MarshGlbAnchorKind, THREE.Group>();

if (typeof window !== 'undefined') {
  for (const [kind, url] of Object.entries(MARSH_ASSET_URL) as [MarshGlbAnchorKind, string][]) {
    registerPreload(
      loadGltf(url).then((gltf) => {
        loadedMarshGltf.set(kind, gltf.scene);
      }),
    );
  }
}

function placeLoadedMarshAsset(
  group: THREE.Group,
  kind: MarshGlbAnchorKind,
  x: number,
  z: number,
  rot: number,
): boolean {
  const loaded = loadedMarshGltf.get(kind);
  if (!loaded) return false;
  const inst = loaded.clone(true);
  inst.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  // Rescale before rotating: the target dimension is measured on the
  // authored (unrotated) local axes, so a placement yaw must not be applied
  // until after the Box3 measure below.
  const scaleSpec = MARSH_ASSET_SCALE[kind];
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(inst).getSize(size);
  const measured = scaleSpec.axis === 'x' ? size.x : size.y;
  if (measured > 1e-3) inst.scale.setScalar(scaleSpec.target / measured);
  const seated = new THREE.Box3().setFromObject(inst);
  inst.position.y -= seated.min.y;
  inst.position.x += x;
  inst.position.z += z;
  inst.rotation.y = rot;
  group.add(inst);
  return true;
}

/** Test-only window into the preload asset set (mirrors gather_nodes.ts). */
export const marshDressingPreloadInternalsForTest = {
  marshAssetUrl: MARSH_ASSET_URL,
};

/** Minimal sink matching dungeon Placements.add (kit prop names). */
export interface MarshPlacementSink {
  add(kind: string, x: number, y: number, z: number, rot: number, scale?: number | number[]): void;
}

/** Wall-side tombs: shrine fragments and corpse-candles, not coffins. */
export function placeMarshTombs(p: MarshPlacementSink, layout: DungeonLayout): void {
  for (const t of layout.tombs) {
    const r = hash2(t.x * 3.7, t.z, MARSH_SEED);
    const face = t.x < 0 ? -Math.PI / 2 : Math.PI / 2;
    p.add('plaque_candles', t.x, 0, t.z, face, 1.35);
    if (r > 0.4) {
      p.add('skull_candle', t.x, 0, t.z + 1.5, hash2(t.z, t.x, MARSH_SEED) * Math.PI, 1.2);
    }
    if (r < 0.35) {
      p.add(
        'rubble_half',
        t.x + (t.x < 0 ? 1.4 : -1.4),
        0,
        t.z - 0.8,
        hash2(t.x, t.z, MARSH_SEED) * 0.5,
        1.0,
      );
    }
  }
}

/** Aisle scatter: rotted planks and reed tangles instead of ribcages. */
export function placeMarshClutter(p: MarshPlacementSink, layout: DungeonLayout): void {
  for (const c of layout.clutter ?? []) {
    const r = hash2(c.x, c.z, MARSH_SEED);
    if (r < 0.45) {
      p.add('rubble_half', c.x, 0.04, c.z, r * Math.PI * 2, 1.15);
      p.add('bone_B', c.x + 1.1, 0.06, c.z + 0.7, r * 7, 1.6);
    } else if (r < 0.75) {
      p.add('skull_candle', c.x, 0, c.z, r * Math.PI, 1.15);
    } else {
      p.add('gravemarker_A', c.x, 0, c.z, r * Math.PI * 2, 1.25);
    }
  }
}

/** Wall-hugging x at height z for the given side, honoring the polygon shell
 * when present (falls back to the constant wallX band otherwise, or if the
 * polygon lookup misses at that z). */
function wallEdgeAt(layout: DungeonLayout, z: number, side: -1 | 1): number {
  const constEdge = (layout.wallX ?? 25) - 1.6;
  if (!layout.shellPolygon) return side * constEdge;
  const x = polygonXAtZ(layout.shellPolygon, z, side);
  return x === null ? side * constEdge : x - side * 1.6;
}

/** Marsh wall dressing: reed posts, broken bells, no grave shelves. */
export function placeMarshWallDressing(p: MarshPlacementSink, layout: DungeonLayout): void {
  for (let z = layout.zMin + 22; z < layout.zMax - 10; z += 17) {
    for (const side of [-1, 1] as const) {
      const wx = wallEdgeAt(layout, z, side);
      const r = hash2(side * 5.1, z, MARSH_SEED);
      if (r < 0.45) {
        p.add('rubble_half', wx, 0, z, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.2);
      } else if (r < 0.75) {
        p.add('gravemarker_A', wx, 0, z, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.45);
      } else {
        p.add('plaque_candles', wx, 0, z + 1.5, side < 0 ? Math.PI / 2 : -Math.PI / 2, 1.3);
      }
      if (r > 0.55) {
        const wx2 = wallEdgeAt(layout, z + 2.2, side) - side * 1.3;
        p.add('skull_candle', wx2, 0, z + 2.2, r * 6, 1.1);
      }
    }
  }
  const startZ = layout.zMin + 4;
  const endZ = layout.zMax - 5;
  p.add('shrine_candles', wallEdgeAt(layout, startZ, -1), 0, startZ, Math.PI / 4, 1.45);
  p.add('gravestone', wallEdgeAt(layout, endZ, 1), 0, endZ, -Math.PI * 0.75, 1.55);
}

function addReedCluster(group: THREE.Group, x: number, z: number, rot = 0): void {
  const mat = surfaceMat({
    color: 0x3a5a32,
    roughness: 0.95,
    emissive: 0x1a3020,
    emissiveIntensity: 0.35,
    flatShading: !GFX.standardMaterials,
  });
  for (let i = 0; i < 5; i++) {
    const h = 1.2 + hash2(x + i, z, MARSH_SEED) * 1.4;
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, h, 5), mat);
    stalk.position.set(
      x + (hash2(z, i, MARSH_SEED) - 0.5) * 0.8,
      h / 2,
      z + (hash2(x, i, MARSH_SEED) - 0.5) * 0.8,
    );
    stalk.rotation.y = rot + hash2(i, x, MARSH_SEED) * 0.4;
    stalk.rotation.z = (hash2(z, i, MARSH_SEED) - 0.5) * 0.25;
    group.add(stalk);
  }
}

function addPlankBridge(group: THREE.Group, x: number, z: number, rot = 0): void {
  const wood = surfaceMat({
    color: 0x4a3c28,
    roughness: 0.92,
    flatShading: !GFX.standardMaterials,
  });
  for (let i = -1; i <= 1; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.45), wood);
    plank.position.set(x + i * 0.55, 0.08, z);
    plank.rotation.y = rot;
    group.add(plank);
  }
}

function addShrineSlab(group: THREE.Group, x: number, z: number, rot = 0): void {
  const stone = surfaceMat({
    color: 0x5a6058,
    roughness: 0.9,
    flatShading: !GFX.standardMaterials,
  });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.35), stone);
  slab.position.set(x, 0.45, z);
  slab.rotation.y = rot;
  group.add(slab);
}

// The additive glow: kept outside the GLB/procedural branch (like
// yumi_maze.ts's flames and door_portal.ts's swirl) so the GLB shrine
// fragment still reads as lit in a pitch-dark delve instead of going dark.
function addShrineGlow(group: THREE.Group, x: number, z: number): void {
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({
      color: 0x6aff9a,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(x, 0.92, z);
  group.add(glow);
}

function addCorpseCandleWax(group: THREE.Group, x: number, z: number, rot = 0): void {
  const wax = surfaceMat({
    color: 0xc8e8d0,
    emissive: 0x3a8a5a,
    emissiveIntensity: 0.9,
    roughness: 0.6,
    flatShading: !GFX.standardMaterials,
  });
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 8), wax);
  candle.position.set(x, 0.28, z);
  candle.rotation.y = rot;
  group.add(candle);
}

// The additive flame: kept outside the GLB/procedural branch (see
// addShrineGlow above) so the corpse candle keeps its glow with the GLB body.
function addCorpseCandleFlame(group: THREE.Group, x: number, z: number): void {
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x7fe6b0, transparent: true, opacity: 0.85 }),
  );
  flame.position.set(x, 0.62, z);
  group.add(flame);
}

function addBellFragment(group: THREE.Group, x: number, z: number, rot = 0): void {
  const metal = surfaceMat({
    color: 0x3a4440,
    metalness: 0.55,
    roughness: 0.7,
    flatShading: !GFX.standardMaterials,
  });
  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.72),
    metal,
  );
  bell.position.set(x, 0.35, z);
  bell.rotation.y = rot;
  bell.rotation.z = 0.4;
  group.add(bell);
}

function addDeadTree(group: THREE.Group, x: number, z: number, rot = 0): void {
  const bark = surfaceMat({
    color: 0x1e1a14,
    roughness: 0.97,
    flatShading: !GFX.standardMaterials,
  });
  // Trunk
  const trunkH = 3.2 + hash2(x, z, MARSH_SEED) * 1.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, trunkH, 7), bark);
  trunk.position.set(x, trunkH / 2, z);
  trunk.rotation.y = rot;
  group.add(trunk);
  // Primary branches (2-3 bare limbs radiating at mid and upper trunk)
  const branchCount = 2 + Math.floor(hash2(z, x, MARSH_SEED) * 1.5);
  for (let i = 0; i < branchCount; i++) {
    const frac = 0.55 + hash2(x + i, z + i, MARSH_SEED) * 0.35;
    const bLen = 1.1 + hash2(x, z + i * 3.7, MARSH_SEED) * 0.9;
    const bAngle = hash2(z + i, x, MARSH_SEED) * Math.PI * 2 + rot;
    const bTilt = 0.55 + hash2(x + i * 2, z, MARSH_SEED) * 0.4;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.1, bLen, 5), bark);
    // Place branch origin at its attachment point on the trunk, angled outward.
    branch.position.set(
      x + Math.sin(bAngle) * 0.22,
      trunkH * frac + (bLen / 2) * Math.cos(bTilt),
      z + Math.cos(bAngle) * 0.22,
    );
    branch.rotation.set(bTilt, bAngle, 0, 'YXZ');
    group.add(branch);
  }
}

function addSluicePost(group: THREE.Group, x: number, z: number, rot = 0): void {
  const wood = surfaceMat({
    color: 0x3a3028,
    roughness: 0.96,
    flatShading: !GFX.standardMaterials,
  });
  // Weathered post, tapered so the waterline base reads thicker than the top.
  const postH = 2.0 + hash2(x, z, MARSH_SEED) * 0.4;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, postH, 6), wood);
  post.position.set(x, postH / 2, z);
  post.rotation.y = rot;
  post.rotation.z = (hash2(z, x, MARSH_SEED) - 0.5) * 0.08;
  group.add(post);
  // Horizontal crossbeam lashed near the top.
  const beamLen = 1.5 + hash2(x * 1.7, z, MARSH_SEED) * 0.4;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(beamLen, 0.14, 0.14), wood);
  beam.position.set(x, postH - 0.3, z);
  beam.rotation.y = rot + (hash2(z, x * 2.3, MARSH_SEED) - 0.5) * 0.3;
  group.add(beam);
  // Slack rope hint: a thin cylinder angled down from the crossbeam end.
  const rope = surfaceMat({
    color: 0x4a4030,
    roughness: 0.98,
    flatShading: !GFX.standardMaterials,
  });
  const ropeLen = 0.9 + hash2(z * 1.3, x, MARSH_SEED) * 0.5;
  // Small hashed radian offset for the slack-rope skew (beamLen is a length in
  // world units, not an angle).
  const ropeAngle = rot + (hash2(x * 1.9, z, MARSH_SEED) - 0.5) * 0.8;
  const ropeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, ropeLen, 4), rope);
  ropeMesh.position.set(
    x + Math.sin(rot) * (beamLen / 2 - 0.1),
    postH - 0.3 - ropeLen / 2 + 0.15,
    z + Math.cos(rot) * (beamLen / 2 - 0.1),
  );
  ropeMesh.rotation.set(0.35, ropeAngle, 0.5, 'YXZ');
  group.add(ropeMesh);
}

function addRootWall(group: THREE.Group, x: number, z: number, rot = 0): void {
  const bark = surfaceMat({
    color: 0x201a12,
    roughness: 0.97,
    flatShading: !GFX.standardMaterials,
  });
  const mossyBark = surfaceMat({
    color: 0x201a12,
    roughness: 0.95,
    emissive: 0x1a3020,
    emissiveIntensity: 0.4,
    flatShading: !GFX.standardMaterials,
  });
  const rootCount = 3 + Math.floor(hash2(x, z, MARSH_SEED) * 3); // 3..5
  for (let i = 0; i < rootCount; i++) {
    const len = 1.5 + hash2(x + i * 2.1, z - i, MARSH_SEED) * 1.0;
    const fan = (i - (rootCount - 1) / 2) * 0.5; // spread the arcs across the fan
    const angle = rot + fan + (hash2(z, x + i, MARSH_SEED) - 0.5) * 0.3;
    const tilt = 0.5 + hash2(x + i, z + i, MARSH_SEED) * 0.5; // bent up and outward
    const mossy = hash2(i, x - z, MARSH_SEED) > 0.6;
    const root = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.14, len, 6),
      mossy ? mossyBark : bark,
    );
    root.position.set(
      x + Math.sin(angle) * 0.3,
      (len / 2) * Math.cos(tilt) * 0.6,
      z + Math.cos(angle) * 0.3,
    );
    root.rotation.set(tilt, angle, 0, 'YXZ');
    group.add(root);
  }
}

function addBrokenBellFrame(group: THREE.Group, x: number, z: number, rot = 0): void {
  const wood = surfaceMat({
    color: 0x3a3028,
    roughness: 0.95,
    flatShading: !GFX.standardMaterials,
  });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.8, 0.25), wood);
    post.position.set(x + side * 1.1, 1.4, z);
    post.rotation.y = rot;
    group.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.2), wood);
  beam.position.set(x, 2.6, z);
  beam.rotation.y = rot;
  beam.rotation.z = 0.15;
  group.add(beam);
  addBellFragment(group, x, z + 0.3, rot);
}

function placeDressingAnchor(group: THREE.Group, anchor: LitanyDressingAnchor): void {
  const rot = anchor.rot ?? 0;
  switch (anchor.kind) {
    case 'reed_cluster':
      if (!placeLoadedMarshAsset(group, 'reed_cluster', anchor.x, anchor.z, rot)) {
        addReedCluster(group, anchor.x, anchor.z, rot);
      }
      break;
    case 'plank_bridge':
      if (!placeLoadedMarshAsset(group, 'plank_bridge', anchor.x, anchor.z, rot)) {
        addPlankBridge(group, anchor.x, anchor.z, rot);
      }
      break;
    case 'shrine_fragment':
      if (!placeLoadedMarshAsset(group, 'shrine_fragment', anchor.x, anchor.z, rot)) {
        addShrineSlab(group, anchor.x, anchor.z, rot);
      }
      addShrineGlow(group, anchor.x, anchor.z);
      break;
    case 'corpse_candle':
      if (!placeLoadedMarshAsset(group, 'corpse_candle', anchor.x, anchor.z, rot)) {
        addCorpseCandleWax(group, anchor.x, anchor.z, rot);
      }
      addCorpseCandleFlame(group, anchor.x, anchor.z);
      break;
    case 'bell_fragment':
      // No dressing module ever authors a 'bell_fragment' anchor (the bell
      // now lives inside marsh_bell_gallows.glb / addBrokenBellFrame); no GLB
      // preload for it, procedural-only so this branch is dead in practice
      // but stays for LitanyDressingAnchor exhaustiveness.
      addBellFragment(group, anchor.x, anchor.z, rot);
      break;
    case 'broken_bell_frame':
      // The GLB (marsh_bell_gallows.glb) already includes the bell, so it
      // fully replaces frame + addBellFragment composition; the fallback
      // keeps drawing them separately.
      if (!placeLoadedMarshAsset(group, 'broken_bell_frame', anchor.x, anchor.z, rot)) {
        addBrokenBellFrame(group, anchor.x, anchor.z, rot);
      }
      break;
    case 'dead_tree':
      if (!placeLoadedMarshAsset(group, 'dead_tree', anchor.x, anchor.z, rot)) {
        addDeadTree(group, anchor.x, anchor.z, rot);
      }
      break;
    case 'sluice_post':
      if (!placeLoadedMarshAsset(group, 'sluice_post', anchor.x, anchor.z, rot)) {
        addSluicePost(group, anchor.x, anchor.z, rot);
      }
      break;
    case 'root_wall':
      if (!placeLoadedMarshAsset(group, 'root_wall', anchor.x, anchor.z, rot)) {
        addRootWall(group, anchor.x, anchor.z, rot);
      }
      break;
    case 'bone_pile':
      // Bones come from the KayKit props via the placement sink in
      // placeLitanyMarshDressing (both marsh variants); no procedural mesh here.
      break;
  }
}

/** Authored dressing anchors from the litany layout (procedural props). */
export function placeMarshDressingAnchors(
  group: THREE.Group,
  moduleId: DelveModuleId | undefined,
): void {
  if (!moduleId) return;
  for (const anchor of litanyModuleDressing(moduleId as LitanyModuleId)) {
    placeDressingAnchor(group, anchor);
  }
}

/** Marsh ruin kit: anchor props plus optional KayKit bone piles at tomb slots. */
export function placeLitanyMarshDressing(
  p: MarshPlacementSink,
  group: THREE.Group,
  moduleId: LitanyModuleId,
  _layout: DungeonLayout,
  variant: string,
): void {
  if (variant !== 'delve_marsh' && variant !== 'delve_marsh_apse') return;
  placeMarshDressingAnchors(group, moduleId);
  // Bone piles are real KayKit bones in BOTH marsh variants (the apse included);
  // they used to render as glowing shrine slabs there.
  for (const anchor of litanyModuleDressing(moduleId)) {
    if (anchor.kind !== 'bone_pile') continue;
    p.add('bone_A', anchor.x, 0.06, anchor.z, anchor.rot ?? 0, 1.5);
    p.add('bone_B', anchor.x + 0.8, 0.04, anchor.z + 0.5, (anchor.rot ?? 0) * 2, 1.4);
  }
}

/** Dry stepping-stone islands drawn ABOVE the Blackwater pool overlays so the
 * sim's dry-ground exemption (standingOnLitanyDryGround skips the damage tick on
 * any island rect) is readable: safe ground must not read as lethal water. One
 * flat opaque mud-stone platform per authored island rect, instance-local. */
export function placeMarshDryIslands(group: THREE.Group, moduleId: LitanyModuleId): void {
  const islands = litanyModuleGeometry(moduleId)?.islands ?? [];
  if (!islands.length) return;
  const stone = surfaceMat({
    color: 0x574e3e,
    roughness: 0.96,
    flatShading: !GFX.standardMaterials,
  });
  for (const isle of islands) {
    // Top face at y 0.2: above every pool overlay (max y 0.16) so the platform
    // occludes the water exactly where the sim exempts the player, but low
    // enough that entities standing at y 0 do not read sunk into the stone.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(isle.hw * 2, 0.2, isle.hd * 2), stone);
    mesh.position.set(isle.x, 0.1, isle.z);
    group.add(mesh);
  }
}

/** Larger, scarier Blackwater pools with distinct shallow vs deep visuals.
 *  shallow (tier:'shallow') = lighter translucent teal, reads as wadeable.
 *  deep    (tier:'deep' or no tier) = dark near-opaque navy/black, reads as drowning.
 */
export function placeMarshBlackwaterPools(
  group: THREE.Group,
  hazards: Array<{
    x: number;
    z: number;
    r: number;
    rx?: number;
    rz?: number;
    tier?: 'shallow' | 'deep';
  }>,
  addGlow: (x: number, z: number, color: number, y?: number, scale?: number) => void,
): void {
  for (const h of hazards) {
    const isShallow = h.tier === 'shallow';
    const r = h.r * 1.08;
    // An authored ellipse (rx/rz, e.g. the apse moat) squashes every ring/circle
    // by axis, applied to the local (pre-rotateX) geometry so it lands as a
    // world-space X/Z squash after rotateX maps local Y onto world Z.
    const sxr = (h.rx ?? h.r) / h.r;
    const szr = (h.rz ?? h.r) / h.r;
    if (isShallow) {
      // Shallow: teal, but opaque enough to read as a damaging pool, not clear
      // floor. Shallow Blackwater still hurts, so the fill and the warning rim
      // carry real contrast (a faint teal wash was read as safe wading water).
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(r, 36)
          .scale(sxr, szr, 1)
          .rotateX(-Math.PI / 2)
          .translate(h.x, 0.1, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x123f4c,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }),
      );
      pool.renderOrder = 1;
      group.add(pool);
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.8, r * 1.04, 40)
          .scale(sxr, szr, 1)
          .rotateX(-Math.PI / 2)
          .translate(h.x, 0.13, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x4adaaa,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      rim.renderOrder = 2;
      group.add(rim);
      // A defined outer boundary ring so the pool edge (where the damage starts)
      // reads at a glance, the same telegraph the deep pool gets.
      const edge = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.98, r * 1.06, 40)
          .scale(sxr, szr, 1)
          .rotateX(-Math.PI / 2)
          .translate(h.x, 0.15, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x6fe8c4,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      edge.renderOrder = 3;
      group.add(edge);
      addGlow(h.x, h.z, 0x3abcaa, 0.06, r * 0.8);
    } else {
      // Deep (default): dark near-opaque navy/black - reads as drowning danger.
      const core = new THREE.Mesh(
        new THREE.CircleGeometry(r * 0.72, 32)
          .scale(sxr, szr, 1)
          .rotateX(-Math.PI / 2)
          .translate(h.x, 0.1, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x020a06,
          transparent: true,
          opacity: 0.94,
          depthWrite: false,
        }),
      );
      core.renderOrder = 1;
      group.add(core);
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(r, 36)
          .scale(sxr, szr, 1)
          .rotateX(-Math.PI / 2)
          .translate(h.x, 0.14, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x061812,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
        }),
      );
      pool.renderOrder = 2;
      group.add(pool);
      const rim = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.78, r * 1.02, 40)
          .scale(sxr, szr, 1)
          .rotateX(-Math.PI / 2)
          .translate(h.x, 0.16, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x5fd47a,
          transparent: true,
          opacity: 0.62,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      rim.renderOrder = 3;
      group.add(rim);
      const outer = new THREE.Mesh(
        new THREE.RingGeometry(r * 1.02, r * 1.18, 36)
          .scale(sxr, szr, 1)
          .rotateX(-Math.PI / 2)
          .translate(h.x, 0.13, h.z),
        new THREE.MeshBasicMaterial({
          color: 0x1a4a32,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      outer.renderOrder = 2;
      group.add(outer);
      addGlow(h.x, h.z, 0x3fae6a, 0.08, r * 0.85);
    }
  }
}
