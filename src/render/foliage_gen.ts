// The Foliage Generator: one entry point that grows any parameterised plant,
// not only trees.
//
// The split it makes is the one FoliageParams describes. Trees keep the whole
// v1 path (trunk GLB, branch chain, canopy volumes, leaf scatter) by calling
// buildTreeModel unchanged. Everything else skips the trunk half and swaps in
// its own SKELETON, then grows the same leaf canopy over it through
// tree_gen.ts's buildLeafCanopy, so a bush is lit, swayed, atlased and batched
// exactly like a tree's crown rather than being a second art pipeline.
//
// Grass is the one kind with no leaf cards at all: it is blade geometry, and
// it reuses clusterGeometry from blade_grass.ts, which the shipped carpet, the
// mid-band and the ground bake already share. That is deliberate. A generated
// grass clump that drew its own blades would read as a different plant
// standing in the same field.

import * as THREE from 'three';
import {
  type FoliageKind,
  type FoliageParams,
  foliageKindOf,
  type ResolvedFoliageParams,
  resolvedFoliageParams,
} from '../sim/foliage_params';
import type { TreeVolume } from '../sim/tree_params';
import { clusterGeometry, mulberry32 } from './blade_grass';
import { patchConstantUpNormalVertexShader } from './foliage_shader_core';
import { buildLeafCanopy, buildTreeModel, type TreeBuild, treeSeed } from './tree_gen';

export type { FoliageKind, FoliageParams } from '../sim/foliage_params';
export { treeSeed as foliageSeed };

/** The same shape buildTreeModel returns, so every consumer of a generated
 *  tree (placements, the editor preview, the GLB bake) takes a generated bush
 *  with no branching. */
export type FoliageBuild = TreeBuild;

/** Blade-cluster geometry is shared across a whole clump, so a grass plant is
 *  one InstancedMesh however many clusters it scatters. */
const GRASS_CLUSTER_COLOR = 0x6f8f4a;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Grow the plant these params describe. Trees take the trunk path verbatim;
 * every other kind builds its skeleton here and shares the canopy solver.
 *
 * `loadTrunk` is only ever used by the tree path, so a caller that never
 * generates trees can leave it off.
 */
export function buildFoliageModel(
  params: FoliageParams | undefined,
  loadTrunk?: (path: string) => Promise<THREE.Object3D | null>,
): FoliageBuild {
  const kind = foliageKindOf(params);
  if (kind === 'tree') return buildTreeModel(params, loadTrunk);
  const p = resolvedFoliageParams(params);
  return kind === 'grass' ? buildGrassClump(p) : buildLeafPlant(kind, p);
}

// ---------------------------------------------------------------------------
// The trunkless leaf plants: bush, fern, vine
// ---------------------------------------------------------------------------

/**
 * Canopy volumes for a plant with no trunk to hang them off. Each kind lays
 * them out from its own footprint and height rather than from a trunk's crown,
 * which is the whole reason the volume solver had to be swappable.
 */
export function foliageVolumes(kind: FoliageKind, p: ResolvedFoliageParams): TreeVolume[] {
  const rng = mulberry32((p.seed | 0) + 7717);
  const jit = (amount: number): number => (rng() - 0.5) * 2 * amount * p.volumeJitter;
  const n = Math.max(1, Math.round(p.volumeCount));
  const foot = p.footprint;
  const tall = p.plantHeight;
  const out: TreeVolume[] = [];
  switch (kind) {
    case 'bush': {
      // A squat dome: one core blob plus a ring of smaller ones leaning out by
      // `splay`, so the silhouette breaks up instead of reading as one ball.
      const coreR = foot * 0.62 * p.volumeScale;
      // The core blob stretches to the plant's height, but stays inside the
      // TreeVolume sy range the leaf scatter and the sanitizer both assume:
      // a tall thin bush must not author an ellipsoid nothing else can read.
      const coreSy = clamp(tall / Math.max(0.05, coreR * 2), 0.1, 4);
      out.push({ x: jit(0.1), y: tall * 0.45, z: jit(0.1), r: coreR, sy: coreSy });
      for (let i = 1; i < n; i++) {
        const a = (i / Math.max(1, n - 1)) * Math.PI * 2 + rng();
        const rad = foot * 0.5 * p.splay * (0.6 + rng() * 0.6);
        const r = coreR * (0.5 + rng() * 0.35);
        out.push({
          x: Math.cos(a) * rad + jit(0.15),
          y: tall * (0.3 + rng() * 0.35),
          z: Math.sin(a) * rad + jit(0.15),
          r,
          sy: 0.8,
        });
      }
      return out;
    }
    case 'fern': {
      // A spray: one volume per frond arc, tilted out and up from the root.
      const strands = Math.max(1, Math.round(p.strands));
      const r = foot * 0.42 * p.volumeScale;
      for (let i = 0; i < strands; i++) {
        const a = (i / strands) * Math.PI * 2 + rng() * 0.5;
        const reach = foot * (0.45 + rng() * 0.4) * (0.4 + p.splay);
        out.push({
          x: Math.cos(a) * reach + jit(0.1),
          y: tall * (0.55 + rng() * 0.35),
          z: Math.sin(a) * reach + jit(0.1),
          r: r * (0.7 + rng() * 0.5),
          sy: 0.55,
        });
      }
      return out;
    }
    default: {
      // vine: volumes strung DOWN the hang, so the leaves cover the strands
      // rather than bunching at the anchor.
      const strands = Math.max(1, Math.round(p.strands));
      const r = foot * 0.42 * p.volumeScale;
      const steps = Math.max(2, Math.min(6, n));
      for (let i = 0; i < strands; i++) {
        const a = (i / strands) * Math.PI * 2 + rng() * 0.4;
        const rad = foot * (0.3 + rng() * 0.7) * (0.3 + p.splay);
        for (let k = 0; k < steps; k++) {
          const t = steps === 1 ? 0 : k / (steps - 1);
          out.push({
            x: Math.cos(a) * rad + jit(0.12),
            y: tall - t * p.hang,
            z: Math.sin(a) * rad + jit(0.12),
            r: r * (0.75 + rng() * 0.4) * (1 - t * 0.35),
            sy: 0.7,
          });
        }
      }
      return out;
    }
  }
}

function buildLeafPlant(kind: FoliageKind, p: ResolvedFoliageParams): FoliageBuild {
  const group = new THREE.Group();
  group.name = `generated-${kind}`;
  const owned: THREE.BufferGeometry[] = [];
  const volumes = p.volumes.length > 0 ? p.volumes.map((v) => ({ ...v })) : foliageVolumes(kind, p);
  let top = 0;
  let radius = 0.2;
  for (const v of volumes) {
    top = Math.max(top, v.y + v.r * v.sy);
    radius = Math.max(radius, Math.hypot(v.x, v.z) + v.r);
  }
  const totalHeight = Math.max(0.2, top);
  // The shipped trees lean by this fraction of their own height; a knee-high
  // bush that leant like an oak would read as being in a gale.
  const swayAmp = totalHeight * 0.038 * p.sway;
  const canopy = buildLeafCanopy({
    params: p,
    volumes,
    swayAmp,
    shimmer: swayAmp * 0.5,
    totalHeight,
  });
  if (canopy) {
    owned.push(canopy.geometry);
    group.add(canopy.mesh);
  }
  return {
    group,
    height: totalHeight,
    radius,
    // A knee-high plant you cannot walk through is worse than no plant, so
    // collision is off unless the maker asked: `collide` scales the footprint
    // rather than a trunk's girth here.
    collideRadius: p.collide > 0 ? p.footprint * 0.35 * p.collide : 0,
    volumes,
    leafCount: canopy?.count ?? 0,
    branchCount: 0,
    dispose: () => {
      for (const g of owned) g.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Grass: blades, not cards
// ---------------------------------------------------------------------------

function buildGrassClump(p: ResolvedFoliageParams): FoliageBuild {
  const group = new THREE.Group();
  group.name = 'generated-grass';
  const rng = mulberry32((p.seed | 0) + 991);
  const geometry = clusterGeometry(rng);
  const count = Math.max(1, Math.round(p.clumps));
  const mat = new THREE.MeshLambertMaterial({
    color: GRASS_CLUSTER_COLOR,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  // clusterGeometry ships position and colour only - NO normal attribute, on
  // purpose: every shipped user of it forces the all-up normal in the shader so
  // a flat blade strip takes the ground's lighting response instead of its own.
  // Without the patch the attribute falls back to WebGL's default (0,0,0), the
  // normalize in the lighting chunk goes to NaN, and a whole clump renders
  // solid black. blade_grass.ts and blade_grass_band.ts do exactly this.
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = patchConstantUpNormalVertexShader(sh.vertexShader);
    // ...and the double-sided chunk then flips that up normal to a DOWN one on
    // every backfacing blade, which is half of them on a fan: those went black
    // even once the vertex stage was right. Undoing the flip keeps up pointing
    // up on both faces - the same pair of patches the shipped grass carries
    // (patchGrassFragmentShader) and the leaf cards carry in tree_gen.
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `#include <normal_fragment_begin>
      #ifdef DOUBLE_SIDED
        normal *= faceDirection;
      #endif`,
    );
  };
  mat.customProgramCacheKey = () => 'woc-grass-clump-upnormal';
  const mesh = new THREE.InstancedMesh(geometry, mat, count);
  mesh.name = 'grass-blades';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const lean = new THREE.Vector3();
  // clusterGeometry builds a tuft roughly one yard tall, so plantHeight is a
  // straight multiplier on it.
  const heightScale = p.plantHeight / 1;
  for (let i = 0; i < count; i++) {
    // Even-ish disc coverage: sqrt keeps the scatter from bunching at the
    // centre the way a raw uniform radius would.
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * p.footprint;
    pos.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    const s = heightScale * (0.7 + rng() * 0.6);
    scale.set(s, s, s);
    // splay tips each tuft outward from the clump centre, so a dense clump
    // domes rather than standing as a flat brush.
    const tilt = p.splay * 0.5 * (rad / Math.max(0.001, p.footprint));
    lean.set(Math.cos(a), 0, Math.sin(a)).normalize();
    q.setFromAxisAngle(new THREE.Vector3(-lean.z, 0, lean.x), tilt);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rng() * Math.PI * 2));
    m.compose(pos, q, scale);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return {
    group,
    height: p.plantHeight * 1.3,
    radius: p.footprint,
    collideRadius: 0, // you walk through grass
    volumes: [],
    leafCount: 0,
    branchCount: 0,
    dispose: () => {
      geometry.dispose();
      mat.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** The i18n key suffixes under editor.foliage.presets. A literal union rather
 *  than a bare string so the panel's `t()` call stays type-checked against the
 *  catalogue: a preset added without its label is a build error, not a key
 *  showing through in the UI. */
export type FoliagePresetLabel =
  | 'bushRound'
  | 'bushBerry'
  | 'bushDry'
  | 'grassTuft'
  | 'grassMeadow'
  | 'fernForest'
  | 'vineHanging';

export interface FoliagePreset {
  key: string;
  kind: FoliageKind;
  label: FoliagePresetLabel;
  params: FoliageParams;
}

/**
 * A starting point per kind. Deliberately few: the point of the generator is
 * that every dial stays editable afterwards, and TREE_PRESETS already carries
 * the deep tree library.
 */
export const FOLIAGE_PRESETS: readonly FoliagePreset[] = [
  {
    key: 'bush_round',
    kind: 'bush',
    label: 'bushRound',
    params: { kind: 'bush', leafSet: 'broadleaf', footprint: 1.6, plantHeight: 1.4 },
  },
  {
    key: 'bush_berry',
    kind: 'bush',
    label: 'bushBerry',
    params: {
      kind: 'bush',
      leafSet: 'broadleaf',
      footprint: 1.2,
      plantHeight: 1.0,
      leaves: 210,
      leafSize: 0.55,
      leafTint: 0xc8e0a0,
    },
  },
  {
    key: 'bush_dry',
    kind: 'bush',
    label: 'bushDry',
    params: {
      kind: 'bush',
      leafSet: 'broadleaf',
      footprint: 1.4,
      plantHeight: 0.9,
      leaves: 90,
      leafSize: 0.5,
      leafTint: 0xc9b98a,
      splay: 0.8,
    },
  },
  {
    key: 'grass_tuft',
    kind: 'grass',
    label: 'grassTuft',
    params: { kind: 'grass', footprint: 0.8, plantHeight: 0.5, clumps: 9 },
  },
  {
    key: 'grass_meadow',
    kind: 'grass',
    label: 'grassMeadow',
    params: { kind: 'grass', footprint: 2.2, plantHeight: 0.7, clumps: 40, splay: 0.7 },
  },
  {
    key: 'fern_forest',
    kind: 'fern',
    label: 'fernForest',
    params: { kind: 'fern', leafSet: 'broadleaf', footprint: 1.3, plantHeight: 1.1, strands: 7 },
  },
  {
    key: 'vine_hanging',
    kind: 'vine',
    label: 'vineHanging',
    params: { kind: 'vine', leafSet: 'broadleaf', footprint: 1.0, plantHeight: 0.4, hang: 5 },
  },
];

export function foliagePreset(key: string): FoliagePreset | null {
  return FOLIAGE_PRESETS.find((p) => p.key === key) ?? null;
}
