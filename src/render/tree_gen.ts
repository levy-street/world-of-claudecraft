// Procedural tree builder for the editor's Tree tool (placement path
// 'procedural://tree'). A tree is three layers that all key off ONE seed, so a
// placement regenerates byte-identically on reload:
//
//   TRUNK    one of the hand-modelled foundation trunks (tree_trunks.generated.ts,
//            built in Blender by scripts/assets/build_trunks.py). It streams in as a GLB;
//            everything else is built synchronously from the baked dimension and
//            SOCKET table, so the tree has its shape, canopy and collision the
//            instant it is placed and the bark simply appears when it arrives.
//   BRANCHES tapered tubes grown recursively out of the trunk's sockets, merged
//            into one flat-shaded mesh sharing the trunk's bark material.
//   LEAVES   flat painted cards (leaf_sets.generated.ts) scattered through the
//            CANOPY VOLUMES - a handful of ellipsoids the shape preset lays out
//            and the maker can then move, resize and add to. The volumes are the
//            authored "space where the leaves go"; the scatter is the modifier
//            that fills them. One InstancedMesh per tree, one draw call.
//
// Wind: the trunk gets the shipped placed-asset sway (tree_sway.ts), and the
// branch and leaf meshes run the same wave with their own height weighting, so
// a generated tree moves exactly like the game's other trees standing next to it.

import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import {
  MAX_TREE_LEAVES,
  MAX_TREE_VOLUMES,
  type ResolvedTreeParams,
  resolvedTreeParams,
  type TreeLeafOrient,
  type TreeParams,
  type TreeVolume,
} from '../sim/tree_params';
import { acquireTexture } from './assets/loader';
import { CANOPY_EMISSIVE_FLOOR } from './foliage_impostor_core';
import { configureMaskedDoubleSidedVegetationMaterial, GFX, sharedUniforms } from './gfx';
import {
  DEFAULT_LEAF_SET,
  LEAF_ATLAS_CELLS,
  LEAF_ATLAS_COLS,
  LEAF_ATLAS_ROWS,
  type LeafSet,
  leafSet,
  leafSetPath,
} from './leaf_sets.generated';
import { terrainTexturePath, terrainTextureSet } from './terrain_texture_sets';
import {
  LEAF_SHIMMER_YARDS,
  treeSwayLeafGlsl,
  treeSwayUniforms,
  treeSwayWaveGlsl,
} from './tree_sway';
import { DEFAULT_TRUNK, type TrunkDef, trunkDef } from './tree_trunks.generated';

// The parameter record, canopy shapes and leaf orientations now live in
// sim/tree_params.ts so the map document can sanitize them without importing
// the renderer. Re-exported here because callers of this module want them.
export type { TreeCanopyShape, TreeLeafOrient, TreeParams, TreeVolume } from '../sim/tree_params';

export interface TreeBuild {
  group: THREE.Group;
  /** Total height in source yards (the placement scale multiplies it). */
  height: number;
  /** Canopy half-width in source yards. */
  radius: number;
  /** Trunk collision radius in source yards. */
  collideRadius: number;
  /** The volumes actually used, for the editor's canopy overlay. */
  volumes: readonly TreeVolume[];
  leafCount: number;
  branchCount: number;
  /** Frees the geometries this tree owns (materials are shared and cached). */
  dispose(): void;
}

// ----------------------------------------------------------------- constants

/**
 * Albedo lift on the leaf cards (foliage.ts does the same to its bush sheets).
 * A leaf card is a vertical-ish plane, so its N.L against a high sun is around
 * half the ground's and its hemisphere term is a sky/ground mix rather than
 * full sky - a canopy painted at a believable leaf green therefore renders
 * about a quarter as bright as the grass under it and reads as a black clump.
 * Lifting the albedo above 1 is the cheap, art-directable answer; the dark and
 * arcane sets stay dark because their PAINT is dark, not because of this.
 */
const LEAF_ALBEDO_LIFT: readonly [number, number, number] = [1.5, 1.42, 1.2];
/** Multiplier on foliage.ts's shipped canopy ambient floor. See leafMaterial. */
const CARD_EMISSIVE_SCALE = 1.9;
/** Radial segments on a procedural branch tube. Branches are thin and mostly
 *  seen through leaves; 5 reads round enough and keeps a dense tree cheap. */
const BRANCH_SEGS = 5;
const BRANCH_STEPS = 4;
/** Yards per bark-texture repeat, matching the trunks' baked UVs. */
const BARK_UV_TILE = 1.15;

/** Deterministic default seed for a tree anchored at (x, z). */
export function treeSeed(x: number, z: number): number {
  return Math.round(hash2(Math.round(x * 10), Math.round(z * 10), 6151) * 1e9);
}

// Editor overlay: draw the canopy volumes as wireframe shells so the maker can
// see the space the leaves are being scattered into. Module state in the same
// idiom as foliage.ts's setFoliageBounds - the editor flips it and rebuilds the
// affected placements, so the shipped game compiles no overlay at all.
let volumeOverlay = false;
let volumeOverlayMat: THREE.LineBasicMaterial | null = null;

export function setTreeVolumeOverlay(on: boolean): void {
  volumeOverlay = on;
}

export function treeVolumeOverlayEnabled(): boolean {
  return volumeOverlay;
}

function buildVolumeOverlay(volumes: readonly TreeVolume[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tree-volumes';
  if (!volumeOverlayMat) {
    volumeOverlayMat = new THREE.LineBasicMaterial({
      color: 0x64d2ff,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
    });
  }
  for (const v of volumes) {
    const sphere = new THREE.SphereGeometry(1, 14, 10);
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(sphere), volumeOverlayMat);
    sphere.dispose();
    wire.position.set(v.x, v.y, v.z);
    wire.scale.set(v.r, v.r * v.sy, v.r);
    wire.renderOrder = 5;
    g.add(wire);
  }
  return g;
}

// -------------------------------------------------------------------- random
// A small counter-based generator: every draw is a pure function of the seed
// and the draw index, so inserting a parameter never reshuffles what came
// before it in an unrelated part of the tree.

function makeRng(seed: number): () => number {
  let i = 0;
  return () => hash2(i++, 0, (seed | 0) % 2147483647);
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------ material
// Bark and leaf materials are shared and cached: two trees with the same bark
// texture and the same leaf set share one program and one texture upload.

const barkMats = new Map<string, THREE.MeshStandardMaterial>();

function barkMaterial(texId: string, tile: number): THREE.MeshStandardMaterial {
  const set = terrainTextureSet(texId);
  const key = `${set ? set.key : 'bare'}|${tile.toFixed(2)}`;
  const cached = barkMats.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    // 'Bark' matters: tree_sway keys the leaf shimmer off the material NAME and
    // must leave a trunk stiff.
    name: 'Bark',
    color: set ? 0xffffff : 0x6b5340,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
  });
  if (set) {
    const assign = (
      slot: 'map' | 'normalMap' | 'roughnessMap' | 'aoMap',
      kind: 'color' | 'normal' | 'rough' | 'ao',
      srgb: boolean,
    ): void => {
      const path = terrainTexturePath(set.key, kind);
      if (!path) return;
      const { texture } = acquireTexture(`/${path}`, { srgb, repeat: true });
      void texture
        .then((tex) => {
          // The trunks' baked UVs are in yards; scale them to the maker's tile.
          const t = tex.clone();
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(BARK_UV_TILE / tile, BARK_UV_TILE / tile);
          t.needsUpdate = true;
          mat[slot] = t;
          mat.needsUpdate = true;
        })
        .catch(() => {});
    };
    assign('map', 'color', true);
    assign('normalMap', 'normal', false);
    assign('roughnessMap', 'rough', false);
    assign('aoMap', 'ao', false);
  }
  barkMats.set(key, mat);
  return mat;
}

const leafMats = new Map<string, THREE.MeshStandardMaterial>();
const leafDepthMats = new Map<string, THREE.MeshDepthMaterial>();

/** The per-instance atlas cell offset, and the UV patch that applies it. */
const LEAF_UV_CHUNK = `
  attribute vec2 aLeafCell;
  varying vec2 vLeafCell;
`;

function leafUvPatch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  // EVERY map slot the leaf materials use has to be moved into the cell, not
  // just `map`. Three gives each slot its own varying (vMapUv, vEmissiveMapUv,
  // ...), so patching vMapUv alone leaves the emissive map sampling the WHOLE
  // sheet across each card - and the sheet is transparent black between the
  // painted cards, so the ambient floor that keeps a self-shadowed canopy off
  // pure black evaluated to zero over most of every leaf. That is the black
  // blotching a crown shows; see leafMaterial for what the floor is for.
  const cell = `vec2(${(1 / LEAF_ATLAS_COLS).toFixed(6)}, ${(1 / LEAF_ATLAS_ROWS).toFixed(6)})`;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${LEAF_UV_CHUNK}`)
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vLeafCell = aLeafCell;
      #ifdef USE_MAP
        vMapUv = vMapUv * ${cell} + aLeafCell;
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = vEmissiveMapUv * ${cell} + aLeafCell;
      #endif
      #ifdef USE_ALPHAMAP
        vAlphaMapUv = vAlphaMapUv * ${cell} + aLeafCell;
      #endif`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    '#include <common>\nvarying vec2 vLeafCell;',
  );
}

/**
 * The vertex block every leaf mesh runs: wind, and the billboard override.
 *
 * Deliberately the SAME shape as foliage.ts's addWind, because the shipped
 * trees are the thing a generated tree stands next to. The phase comes from the
 * TREE's world origin, not from each card's, one phase per tree makes the
 * crown swing as one body, which is what reads as a tree moving in wind.
 * Phasing per leaf (an earlier version did) gives every card its own little
 * wobble and the canopy boils instead of sways.
 *
 * The height weight is the leaf's own height in the tree, since the quad's
 * local y is meaningless when the cards are instanced.
 */
function leafSwayGlsl(swayAmp: number, shimmer: number, treeHeight: number): string {
  if (swayAmp <= 0 && shimmer <= 0) return '';
  const h = Math.max(0.01, treeHeight);
  return `
    // ONE origin for the whole tree: the model matrix's translation.
    vec2 wocTreeBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
    float wocPhase = wocTreeBase.x * 0.15 + wocTreeBase.y * 0.17;
    // The shipped travelling gust, so a generated grove breathes with the
    // meadow and the kit canopies around it.
    float wocGust = 0.6 + 0.4 * sin(uTime * 0.6 + wocTreeBase.x * 0.05 + wocTreeBase.y * 0.04);
    float wocGate =
      1.0 - smoothstep(70.0, 130.0, distance(wocTreeBase, uSwayPlayer));
    float wocLeafH = clamp(instanceMatrix[3][1] / ${h.toFixed(3)}, 0.0, 1.0);
    float wocWeight = smoothstep(0.0, 1.0, wocLeafH);
    float wocAmt = (sin(uTime * 1.7 + wocPhase) + 0.5 * sin(uTime * 3.1 + wocPhase * 1.3))
      * wocGust * wocGate * ${swayAmp.toFixed(4)} * wocWeight;
    // A whisper of per-card flutter on top, so the crown is not a rigid slab.
    // Small on purpose: it is texture, not the motion.
    float wocFlutter = sin(uTime * 2.6 + instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 2.3)
      * ${shimmer.toFixed(4)} * wocGate * wocWeight;
    vec3 wocSwayOffset = vec3(wocAmt + wocFlutter, 0.0, (wocAmt + wocFlutter) * 0.6);
  `;
}

interface LeafMaterialOpts {
  setKey: string;
  glow: number;
  billboard: boolean;
  swayAmp: number;
  shimmer: number;
  treeHeight: number;
  /** Height of the canopy's centre, for the volume-normal bend below. */
  pivotY: number;
}

function leafMaterialKey(o: LeafMaterialOpts): string {
  return `${o.setKey}|${o.glow.toFixed(2)}|${o.billboard ? 'b' : 'f'}|${o.swayAmp.toFixed(3)}|${o.shimmer.toFixed(3)}|${o.treeHeight.toFixed(1)}|${o.pivotY.toFixed(1)}`;
}

/** How far a leaf card's normal bends toward the canopy-volume direction. Same
 *  value and the same reasoning as foliage.ts's LEAF_UP_NORMAL_BLEND: raw card
 *  normals give every leaf a random N·L, so a canopy reads as noise with a
 *  crushed-black shaded side. Bending them outward from the canopy centre makes
 *  the crown shade like the volume it is, lit side, shade side. */
const LEAF_VOLUME_NORMAL_BLEND = 0.7;

/** Bend the leaf normals outward from the canopy centre. The cards are
 *  INSTANCED, so the canopy direction is derived from the instance's own
 *  translation and then pushed back through the instance rotation, because
 *  three applies that rotation to objectNormal after this chunk. */
function leafNormalBendGlsl(pivotY: number): string {
  return `
    vec3 wocCanopyRad = vec3(
      instanceMatrix[3][0],
      (instanceMatrix[3][1] - ${pivotY.toFixed(3)}) * 0.75 + 0.55,
      instanceMatrix[3][2]
    );
    vec3 wocCanopyDir = wocCanopyRad / max(length(wocCanopyRad), 1e-4);
    // transpose(R*s) * v is s * (R^-1 * v) for a rotation-and-uniform-scale
    // instance matrix, so normalizing gives the direction in card space.
    vec3 wocLocalDir = normalize(transpose(mat3(instanceMatrix)) * wocCanopyDir);
    objectNormal = normalize(mix(objectNormal, wocLocalDir, ${LEAF_VOLUME_NORMAL_BLEND.toFixed(2)}));
  `;
}

/** Replaces three's project_vertex so a billboarded card faces the camera:
 *  the quad is rebuilt around the instance centre in VIEW space, where the
 *  camera basis is simply x and y. */
function billboardProjectGlsl(): string {
  return `
    vec4 wocInstCenter = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 wocWorldCenter = (modelMatrix * wocInstCenter).xyz + wocSwayOffset;
    float wocSx = length((modelMatrix * instanceMatrix[0]).xyz);
    float wocSy = length((modelMatrix * instanceMatrix[1]).xyz);
    vec4 wocViewCenter = viewMatrix * vec4(wocWorldCenter, 1.0);
    vec4 mvPosition = vec4(
      wocViewCenter.xyz + vec3(transformed.x * wocSx, transformed.y * wocSy, 0.0),
      1.0
    );
    gl_Position = projectionMatrix * mvPosition;
  `;
}

function configureLeafShader(mat: THREE.Material, o: LeafMaterialOpts, lit: boolean): void {
  const sway = leafSwayGlsl(o.swayAmp, o.shimmer, o.treeHeight);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uSwayPlayer = treeSwayUniforms.uSwayPlayer;
    leafUvPatch(shader);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uTime;
      uniform vec2 uSwayPlayer;`,
    );
    // Shade the crown as a volume, not as a thousand randomly-facing cards.
    // Billboarded leaves already face the camera, so bending their normals
    // would only fight the lighting the player sees.
    if (lit && !o.billboard) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>\n${leafNormalBendGlsl(o.pivotY)}`,
      );
      // The bent normal points OUT of the canopy, but the double-sided chunk
      // flips it for backfacing fragments - and about half the cards in any
      // crown are backfacing. Flipped, an outward normal points into the tree
      // and the card renders black, which is the mottled dark blotching a
      // canopy shows without this. foliage.ts undoes the same flip for the
      // same reason; see its normal_fragment_begin patch.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal = normal * faceDirection;
        #endif`,
      );
    }
    if (o.billboard) {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          ${sway || 'vec3 wocSwayOffset = vec3(0.0);'}`,
        )
        .replace('#include <project_vertex>', billboardProjectGlsl());
    } else if (sway) {
      // The offset is a WORLD-space displacement; the instance may be rotated,
      // so it is applied after instancing rather than to the local vertex.
      shader.vertexShader = shader.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${sway}`)
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          mvPosition = viewMatrix * vec4((modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz + wocSwayOffset, 1.0);
          gl_Position = projectionMatrix * mvPosition;`,
        );
    }
  };
  mat.customProgramCacheKey = () => `woc-leaf:${leafMaterialKey(o)}:${lit ? 'l' : 'd'}`;
}

function leafMaterial(o: LeafMaterialOpts): THREE.MeshStandardMaterial {
  const key = leafMaterialKey(o);
  const cached = leafMats.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    name: 'Leaves',
    roughness: 0.82,
    metalness: 0,
    alphaTest: 0.45,
    vertexColors: true,
    emissiveIntensity: 1,
  });
  mat.color.setRGB(...LEAF_ALBEDO_LIFT);
  // The texture-shaped ambient floor the shipped canopies use (foliage.ts,
  // where the rationale lives: a dense canopy shadow-maps itself into
  // darkness and no diffuse-side tweak survives full shadow). Scaled up from
  // the shipped constant because that value is tuned to the kit's leaf
  // sheets, and a flat painted card catches less of the sky term than the
  // kit's fanned leaf geometry does - measured side by side under one light.
  // The maker's glow rides the SAME emissive map, so an arcane or ember
  // canopy lights up through the painted card and its bright tips carry it.
  mat.emissive.setRGB(
    CANOPY_EMISSIVE_FLOOR[0] * CARD_EMISSIVE_SCALE + o.glow,
    CANOPY_EMISSIVE_FLOOR[1] * CARD_EMISSIVE_SCALE + o.glow,
    CANOPY_EMISSIVE_FLOOR[2] * CARD_EMISSIVE_SCALE + o.glow,
  );
  configureMaskedDoubleSidedVegetationMaterial(mat);
  void leafAtlas(o.setKey)
    .then((tex) => {
      mat.map = tex;
      mat.emissiveMap = tex;
      mat.needsUpdate = true;
    })
    .catch(() => {});
  configureLeafShader(mat, o, true);
  leafMats.set(key, mat);
  return mat;
}

// One shared load per leaf set, memoized, so a material, its depth twin and the
// visibility gate below all wait on the SAME texture instead of acquiring it
// three times.
const leafAtlases = new Map<string, Promise<THREE.Texture>>();

function leafAtlas(setKey: string): Promise<THREE.Texture> {
  const cached = leafAtlases.get(setKey);
  if (cached) return cached;
  const { texture } = acquireTexture(`/${leafSetPath(setKey)}`, { srgb: true });
  const p = texture.then((tex) => {
    // Cards live inside atlas cells: clamp so a card can never sample its
    // neighbour, and keep mips (the alpha bleed in the atlas makes them safe).
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
  leafAtlases.set(setKey, p);
  return p;
}

/** Depth material for the shadow pass, carrying the same atlas-cell UV patch,  *  without it every leaf casts the shadow of atlas cell 0. Sway is deliberately
 *  NOT applied: the shipped foliage leaves shadows still too. */
function leafDepthMaterial(o: LeafMaterialOpts): THREE.MeshDepthMaterial {
  const key = `${o.setKey}|${o.billboard ? 'b' : 'f'}`;
  const cached = leafDepthMats.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest: 0.45,
  });
  void leafAtlas(o.setKey)
    .then((tex) => {
      mat.map = tex;
      mat.needsUpdate = true;
    })
    .catch(() => {});
  mat.onBeforeCompile = (shader) => {
    leafUvPatch(shader);
  };
  mat.customProgramCacheKey = () => `woc-leaf-depth:${key}`;
  leafDepthMats.set(key, mat);
  return mat;
}

/** Free the cached bark/leaf materials nothing on the map still uses. Keys are
 *  the texture-set and leaf-set names currently placed. */
export function disposeUnusedTreeMats(
  usedBark: ReadonlySet<string>,
  usedLeaf: ReadonlySet<string>,
): void {
  for (const [key, mat] of [...barkMats]) {
    if (usedBark.has(key.split('|')[0])) continue;
    mat.dispose();
    barkMats.delete(key);
  }
  for (const [key, mat] of [...leafMats]) {
    if (usedLeaf.has(key.split('|')[0])) continue;
    mat.dispose();
    leafMats.delete(key);
  }
  for (const [key, mat] of [...leafDepthMats]) {
    if (usedLeaf.has(key.split('|')[0])) continue;
    mat.dispose();
    leafDepthMats.delete(key);
  }
}

// ------------------------------------------------------------------ branches

interface BranchTip {
  p: THREE.Vector3;
  d: THREE.Vector3;
  r: number;
  /** Recursion level: 0 = grown straight off a trunk socket. */
  level: number;
}

interface BranchGeoAccum {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

/** Loft one tapered tube and append it to the accumulator. */
function emitBranch(
  acc: BranchGeoAccum,
  from: THREE.Vector3,
  dir: THREE.Vector3,
  len: number,
  r0: number,
  r1: number,
  droop: number,
  twist: number,
  rng: () => number,
): THREE.Vector3 {
  const steps = BRANCH_STEPS;
  const up = Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const nrm = new THREE.Vector3().crossVectors(up, dir).normalize();
  const bin = new THREE.Vector3().crossVectors(dir, nrm).normalize();
  const p = from.clone();
  const d = dir.clone().normalize();
  const rings: number[][] = [];
  let arc = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    const ring: number[] = [];
    for (let k = 0; k < BRANCH_SEGS; k++) {
      const a = (k / BRANCH_SEGS) * Math.PI * 2;
      const radial = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      const v = p.clone().addScaledVector(radial, r);
      ring.push(acc.pos.length / 3);
      acc.pos.push(v.x, v.y, v.z);
      acc.nrm.push(radial.x, radial.y, radial.z);
      acc.uv.push(((k / BRANCH_SEGS) * (Math.PI * 2 * r)) / BARK_UV_TILE, arc / BARK_UV_TILE);
      // Branch bark reads a shade lighter than the trunk so limbs separate.
      const shade = 0.72 + 0.2 * t;
      acc.col.push(shade, shade, shade);
    }
    rings.push(ring);
    if (i === steps) break;
    const step = len / steps;
    p.addScaledVector(d, step);
    arc += step;
    // Gravity droops the branch as it goes; twist wanders it off-axis. Both
    // accumulate, which is what makes a limb read as grown rather than aimed.
    d.y -= droop * (0.35 + t) * 0.5;
    d.x += (rng() - 0.5) * twist * 0.6;
    d.z += (rng() - 0.5) * twist * 0.6;
    d.normalize();
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let k = 0; k < BRANCH_SEGS; k++) {
      const k2 = (k + 1) % BRANCH_SEGS;
      acc.idx.push(a[k], b[k], b[k2]);
      acc.idx.push(a[k], b[k2], a[k2]);
    }
  }
  return p; // the tip
}

/**
 * Longest a branch may be before its tip leaves the canopy. Marching the
 * drooped path and keeping the last sample still inside a volume is what stops
 * a tree growing bare black whiskers out past its own leaves - the single
 * ugliest thing a procedural tree does.
 *
 * A branch that never enters a volume keeps its full length: that is a limb
 * still reaching toward the crown, not one overshooting it.
 */
function trimToCanopy(
  from: THREE.Vector3,
  dir: THREE.Vector3,
  len: number,
  droop: number,
  volumes: readonly TreeVolume[],
): number {
  if (volumes.length === 0) return len;
  const SLACK = 0.45; // let a twig peek out by this much, as a real one does
  const steps = 10;
  const p = from.clone();
  const d = dir.clone().normalize();
  let lastInside = -1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    p.copy(from);
    const dd = d.clone();
    // Same integration as emitBranch, so the test follows the drawn path.
    for (let k = 0; k < i; k++) {
      const kt = k / steps;
      p.addScaledVector(dd, len / steps);
      dd.y -= droop * (0.35 + kt) * 0.5;
      dd.normalize();
    }
    for (const v of volumes) {
      const dx = (p.x - v.x) / (v.r + SLACK);
      const dy = (p.y - v.y) / (v.r * v.sy + SLACK);
      const dz = (p.z - v.z) / (v.r + SLACK);
      if (dx * dx + dy * dy + dz * dz <= 1) {
        lastInside = t;
        break;
      }
    }
  }
  return lastInside < 0 ? len : len * lastInside;
}

/** Grow the whole branch system off the trunk's sockets. */
function growBranches(
  trunk: TrunkDef,
  p: ResolvedTreeParams,
  rng: () => number,
  volumes: readonly TreeVolume[],
): { geometry: THREE.BufferGeometry | null; tips: BranchTip[]; count: number } {
  const acc: BranchGeoAccum = { pos: [], nrm: [], uv: [], col: [], idx: [] };
  const tips: BranchTip[] = [];
  const perSocket = Math.round(clamp(p.branches, 0, 6));
  const depth = Math.round(clamp(p.branchDepth, 1, 3));
  const scaleXZ = p.girth;
  const scaleY = p.height;

  // Seed the queue with the trunk's own limb tips, scaled the way the trunk is.
  const queue: BranchTip[] = trunk.sockets.map((s) => ({
    p: new THREE.Vector3(s.p[0] * scaleXZ, s.p[1] * scaleY, s.p[2] * scaleXZ),
    d: new THREE.Vector3(s.d[0], s.d[1], s.d[2]).normalize(),
    r: s.r * scaleXZ,
    level: -1,
  }));
  for (const q of queue) tips.push({ ...q, p: q.p.clone(), d: q.d.clone() });
  if (perSocket === 0) {
    return { geometry: null, tips, count: 0 };
  }

  let count = 0;
  let front = queue;
  for (let level = 0; level < depth; level++) {
    const next: BranchTip[] = [];
    for (const parent of front) {
      for (let i = 0; i < perSocket; i++) {
        // Fan the children around the parent's direction.
        const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
        const dir = parent.d.clone();
        const spread = p.branchAngle * (0.65 + rng() * 0.7);
        dir.applyAxisAngle(axis, spread).normalize();
        // Each level is shorter, thinner and droopier than its parent.
        const decay = 0.62 ** level;
        const raw = Math.max(0.25, 2.2 * p.branchLen * decay * (0.75 + rng() * 0.5) * scaleY);
        const droopAmt = p.branchDroop * (0.6 + level * 0.5);
        const len = Math.max(0.2, trimToCanopy(parent.p, dir, raw, droopAmt, volumes));
        const r0 = Math.max(0.015, parent.r * p.branchTaper);
        const r1 = Math.max(0.008, r0 * 0.45);
        const tip = emitBranch(acc, parent.p, dir, len, r0, r1, droopAmt, p.branchTwist, rng);
        count++;
        const child: BranchTip = { p: tip, d: dir, r: r1, level };
        tips.push(child);
        next.push(child);
      }
    }
    front = next;
    if (front.length > 400) break; // runaway guard on a deep, wide setting
  }

  if (acc.pos.length === 0) return { geometry: null, tips, count: 0 };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(acc.pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(acc.nrm), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(acc.uv), 2));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(acc.col), 3));
  geo.setIndex(acc.idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geometry: geo, tips, count };
}

// ----------------------------------------------------------- canopy volumes

/**
 * Lay out the canopy ellipsoids for a shape preset. THIS is the "few spheres"
 * the maker then edits: the scatter below treats them as the only space leaves
 * may occupy, so moving one moves that whole part of the canopy.
 */
export function resolveTreeVolumes(p: ResolvedTreeParams, trunk: TrunkDef): TreeVolume[] {
  if (p.volumes.length > 0) {
    return p.volumes.slice(0, MAX_TREE_VOLUMES).map((v) => ({ ...v }));
  }
  const rng = makeRng((p.seed | 0) + 7717);
  const n = Math.round(clamp(p.volumeCount, 1, MAX_TREE_VOLUMES));
  const crownY = trunk.crownY * p.height + p.volumeRise;
  const spread = trunk.crownRadius * p.volumeSpread;
  const baseR = trunk.crownRadius * 0.52 * p.volumeScale;
  const jitter = p.volumeJitter;
  const out: TreeVolume[] = [];
  const jit = (amount: number): number => (rng() - 0.5) * 2 * amount * jitter;

  switch (p.shape) {
    case 'sockets': {
      // One blob per outermost limb tip: the canopy then genuinely sits on the
      // branches instead of floating as a ball around them. Blobs sit ABOVE
      // their tip and a little inboard of it, because leaves grow along and
      // over a limb rather than only off its end - without that an oak whose
      // limbs all reach the same height reads as a flat plate.
      const socks = trunk.sockets.filter((s) => !s.crown);
      const picked = socks.length > 0 ? socks : trunk.sockets;
      const step = Math.max(1, Math.floor(picked.length / n));
      // One blob fills the middle so the crown is solid rather than a ring.
      const centre = n >= 4;
      const ring = centre ? n - 1 : n;
      for (let i = 0; i < ring; i++) {
        const s = picked[(i * step) % picked.length];
        const r = baseR * (0.78 + rng() * 0.44);
        const inboard = 0.82;
        out.push({
          x: s.p[0] * p.girth * p.volumeSpread * inboard + jit(r * 0.35),
          y: s.p[1] * p.height + p.volumeRise + jit(r * 0.25) + r * 0.55,
          z: s.p[2] * p.girth * p.volumeSpread * inboard + jit(r * 0.35),
          r,
          sy: 0.9,
        });
      }
      if (centre) {
        let cy = 0;
        for (const v of out) cy += v.y;
        out.push({
          x: jit(0.3),
          y: (out.length > 0 ? cy / out.length : crownY) + baseR * 0.35,
          z: jit(0.3),
          r: baseR * 1.15,
          sy: 0.95,
        });
      }
      break;
    }
    case 'sphere': {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng();
        const rad = i === 0 ? 0 : spread * 0.45 * (0.5 + rng() * 0.6);
        const r = baseR * (i === 0 ? 1.15 : 0.75 + rng() * 0.4);
        out.push({
          x: Math.cos(a) * rad + jit(0.5),
          y: crownY + jit(0.8) + (i === 0 ? 0 : (rng() - 0.5) * spread * 0.4),
          z: Math.sin(a) * rad + jit(0.5),
          r,
          sy: 0.92,
        });
      }
      break;
    }
    case 'dome': {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.6;
        const f = i === 0 ? 0 : 1;
        const rad = spread * 0.5 * f * (0.6 + rng() * 0.5);
        out.push({
          x: Math.cos(a) * rad + jit(0.4),
          y: crownY + (1 - f) * baseR * 0.5 + jit(0.5),
          z: Math.sin(a) * rad + jit(0.4),
          r: baseR * (f === 0 ? 1.1 : 0.8 + rng() * 0.3),
          sy: 0.62,
        });
      }
      break;
    }
    case 'cone': {
      // Stacked and shrinking: a conifer's skirt down at the bottom, a spire up
      // top. Uses the trunk's real height rather than its crown point.
      const bottom = trunk.height * p.height * 0.22 + p.volumeRise;
      const top = trunk.height * p.height * 0.98 + p.volumeRise;
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        out.push({
          x: jit(0.35),
          y: bottom + (top - bottom) * f,
          z: jit(0.35),
          r: baseR * 1.5 * (1 - f) ** 0.85 + baseR * 0.16,
          sy: 0.72,
        });
      }
      break;
    }
    case 'umbrella': {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.4;
        const rad = i === 0 ? 0 : spread * 0.62;
        out.push({
          x: Math.cos(a) * rad + jit(0.4),
          y: crownY + jit(0.25),
          z: Math.sin(a) * rad + jit(0.4),
          r: baseR * (i === 0 ? 1.0 : 0.85 + rng() * 0.3),
          sy: 0.34,
        });
      }
      break;
    }
    case 'column': {
      const bottom = trunk.height * p.height * 0.28 + p.volumeRise;
      const top = trunk.height * p.height * 1.05 + p.volumeRise;
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1);
        out.push({
          x: jit(0.3),
          y: bottom + (top - bottom) * f,
          z: jit(0.3),
          r: baseR * 0.66 * (1 - 0.3 * Math.abs(f - 0.45)),
          sy: 0.95,
        });
      }
      break;
    }
    case 'weeping': {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.5;
        const rad = i === 0 ? 0 : spread * 0.5 * (0.7 + rng() * 0.4);
        out.push({
          x: Math.cos(a) * rad + jit(0.4),
          y: crownY + jit(0.5),
          z: Math.sin(a) * rad + jit(0.4),
          // Stretched downward: the strands hang out of the bottom of it.
          r: baseR * (0.8 + rng() * 0.3),
          sy: 1.5,
        });
      }
      break;
    }
  }
  return out;
}

// --------------------------------------------------------------------- leaves

/** The leaf quad, pivoted at its stalk. `anchor` 'top' hangs it downward. */
function leafGeometry(anchor: 'bottom' | 'top', cross: boolean): THREE.BufferGeometry {
  // Only the POSITION moves: the pivot slides to the stalk end so the quad
  // hangs off it. The UVs stay identity.
  //
  // They must stay identity. Textures load flipY, so uv.y = 0 is the BOTTOM of
  // the image, which is where the atlas painter puts a bottom-anchored card's
  // stalk and where a top-anchored strand's tip hangs to. Inverting v here (an
  // earlier version did) mirrors every card vertically: the leaves stop
  // matching their PNG, and the dark stem-end colour lands out at the tip
  // where it shows against the sky as a black blotch.
  const y0 = anchor === 'top' ? -1 : 0;
  const y1 = anchor === 'top' ? 0 : 1;
  const make = (rot: number): THREE.BufferGeometry => {
    const g = new THREE.PlaneGeometry(1, 1);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i) + 0.5; // 0..1
      pos.setXYZ(i, x, y0 + (y1 - y0) * y, 0);
    }
    if (rot !== 0) g.rotateY(rot);
    return g;
  };
  if (!cross) return make(0);
  const a = make(0);
  const b = make(Math.PI / 2);
  // Two crossed quads: merge by hand (four verts each, one index list).
  const merged = new THREE.BufferGeometry();
  const posA = a.getAttribute('position') as THREE.BufferAttribute;
  const posB = b.getAttribute('position') as THREE.BufferAttribute;
  const uvA = a.getAttribute('uv') as THREE.BufferAttribute;
  const nA = a.getAttribute('normal') as THREE.BufferAttribute;
  const nB = b.getAttribute('normal') as THREE.BufferAttribute;
  const n = posA.count;
  const pos = new Float32Array(n * 2 * 3);
  const nrm = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    pos.set([posA.getX(i), posA.getY(i), posA.getZ(i)], i * 3);
    pos.set([posB.getX(i), posB.getY(i), posB.getZ(i)], (n + i) * 3);
    nrm.set([nA.getX(i), nA.getY(i), nA.getZ(i)], i * 3);
    nrm.set([nB.getX(i), nB.getY(i), nB.getZ(i)], (n + i) * 3);
    uv.set([uvA.getX(i), uvA.getY(i)], i * 2);
    uv.set([uvA.getX(i), uvA.getY(i)], (n + i) * 2);
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idxA = Array.from(a.getIndex()?.array ?? []);
  merged.setIndex([...idxA, ...idxA.map((i) => i + n)]);
  a.dispose();
  b.dispose();
  return merged;
}

/** Pick the orientation basis for one leaf and write it into `m`. */
function orientLeaf(
  m: THREE.Matrix4,
  orient: TreeLeafOrient,
  normal: THREE.Vector3,
  droop: number,
  jitter: number,
  rng: () => number,
  q: THREE.Quaternion,
  up: THREE.Vector3,
  tmp: THREE.Vector3,
): void {
  // The card's own +Y runs stalk to tip, so orienting a leaf means choosing
  // where its +Y points and then rolling it about that axis.
  let aim: THREE.Vector3;
  switch (orient) {
    case 'up':
      aim = tmp.set(0, 1, 0);
      break;
    case 'out':
      aim = tmp.set(normal.x, 0, normal.z);
      if (aim.lengthSq() < 1e-6) aim.set(1, 0, 0);
      aim.normalize();
      break;
    case 'random':
      aim = tmp.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      break;
    case 'billboard':
      // The shader rebuilds the quad every frame; only scale survives, but a
      // stable roll keeps the atlas cells from all reading the same way.
      aim = tmp.set(0, 1, 0);
      break;
    default:
      aim = tmp.copy(normal);
      break;
  }
  if (droop > 0 && orient !== 'up' && orient !== 'billboard') {
    // Pitch the tip downward under its own weight.
    aim.y -= droop * (0.6 + rng() * 0.8);
    if (aim.lengthSq() < 1e-6) aim.set(0, -1, 0);
    aim.normalize();
  }
  q.setFromUnitVectors(up, aim);
  if (jitter > 0) {
    const roll = new THREE.Quaternion().setFromAxisAngle(aim, (rng() - 0.5) * Math.PI * 2 * jitter);
    q.premultiply(roll);
    const tiltAxis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    const tilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, (rng() - 0.5) * jitter * 0.9);
    q.premultiply(tilt);
  }
  m.makeRotationFromQuaternion(q);
}

// ------------------------------------------------------------------- the tree

/** Trunk collision radius in SOURCE yards for these params. */
export function treeCollideRadius(params: TreeParams | undefined): number {
  const p = resolvedTreeParams(params);
  const trunk = trunkDef(p.trunk);
  if (!trunk) return 0.8;
  return Math.max(0, trunk.baseRadius * p.girth * p.collide);
}

/**
 * The canopy volumes these params resolve to, the preset's layout, or the
 * maker's own spheres once they have edited them. The Tree panel calls this to
 * turn "the shape preset" into editable spheres.
 */
export function treeVolumesFor(params: TreeParams | undefined): TreeVolume[] {
  const p = resolvedTreeParams(params);
  const trunk = trunkDef(p.trunk) ?? trunkDef(DEFAULT_TRUNK);
  return trunk ? resolveTreeVolumes(p, trunk) : [];
}

/** Total source height for these params (canopy included). */
export function treeHeight(params: TreeParams | undefined): number {
  const p = resolvedTreeParams(params);
  const trunk = trunkDef(p.trunk);
  if (!trunk) return 8;
  const volumes = resolveTreeVolumes(p, trunk);
  let top = trunk.height * p.height;
  for (const v of volumes) top = Math.max(top, v.y + v.r * v.sy);
  return top;
}

/** What buildLeafCanopy needs, and all it needs: the canopy is the half of
 *  the solver every plant kind shares, trunk or no trunk. */
export interface LeafCanopyOpts {
  params: ResolvedTreeParams;
  volumes: readonly TreeVolume[];
  /** Branch tips the scatter biases toward. Empty for a trunkless plant. */
  tips?: readonly BranchTip[];
  swayAmp: number;
  shimmer: number;
  /** The plant's total height, which the sway wave is weighted up. */
  totalHeight: number;
}

export interface LeafCanopy {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  count: number;
}

/**
 * The leaf-card canopy for a set of volumes: one InstancedMesh of painted
 * cards scattered through them, with the atlas, the sway and the normal bend
 * already wired. Split out of buildTreeModel so bushes, ferns and vines
 * (render/foliage_gen.ts) grow the SAME canopy off a different skeleton
 * instead of each re-implementing the scatter. Returns null when the plant
 * has no cards to draw.
 */
export function buildLeafCanopy(o: LeafCanopyOpts): LeafCanopy | null {
  const p = o.params;
  const set = leafSet(p.leafSet) ?? leafSet(DEFAULT_LEAF_SET);
  const count = Math.round(clamp(p.leaves, 0, MAX_TREE_LEAVES));
  if (!set || count <= 0 || o.volumes.length === 0) return null;
  const geometry = leafGeometry(set.anchor, p.leafCross);
  // Canopy centre: the size-weighted mean of the volumes, which is what the
  // leaf normals bend away from.
  let pw = 0;
  let py = 0;
  for (const v of o.volumes) {
    const w = v.r * v.r * v.r;
    pw += w;
    py += v.y * w;
  }
  const opts: LeafMaterialOpts = {
    setKey: set.key,
    glow: clamp(p.leafGlow, 0, 8),
    billboard: p.leafOrient === 'billboard',
    swayAmp: o.swayAmp,
    shimmer: o.shimmer,
    treeHeight: o.totalHeight,
    pivotY: pw > 0 ? py / pw : o.totalHeight * 0.6,
  };
  const mesh = new THREE.InstancedMesh(geometry, leafMaterial(opts), count);
  mesh.name = 'tree-leaves';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.customDepthMaterial = leafDepthMaterial(opts);
  scatterLeaves(mesh, p, set, o.volumes, o.tips ?? [], count, makeRng(p.seed + 4409));
  // Hidden until the atlas lands. Without this an unloaded (or failed) leaf
  // texture renders as a solid bright blob: the albedo is lifted above 1 and
  // there is no alpha to cut the quads out with, so a slow connection shows
  // white balls where the canopies should be, and a 404 leaves them there.
  mesh.visible = false;
  void leafAtlas(set.key)
    .then(() => {
      mesh.visible = true;
    })
    .catch(() => {});
  return { mesh, geometry, count };
}

/**
 * Build the tree. Returns immediately with branches, canopy and collision in
 * place; `onTrunk` fires later with the bark mesh so the caller can re-run any
 * work that needed the real geometry.
 */
export function buildTreeModel(
  params: TreeParams | undefined,
  loadTrunk?: (path: string) => Promise<THREE.Object3D | null>,
): TreeBuild {
  const p = resolvedTreeParams(params);
  const trunk = trunkDef(p.trunk) ?? trunkDef(DEFAULT_TRUNK);
  const group = new THREE.Group();
  group.name = 'generated-tree';
  const owned: THREE.BufferGeometry[] = [];
  if (!trunk) {
    return {
      group,
      height: 1,
      radius: 1,
      collideRadius: 0,
      volumes: [],
      leafCount: 0,
      branchCount: 0,
      dispose: () => undefined,
    };
  }

  const rng = makeRng(p.seed);
  const bark = barkMaterial(p.barkTexId, Math.max(0.2, p.barkTile));

  // ---- canopy volumes first: the branches are trimmed to them, and the leaf
  // scatter fills them.
  const volumes = resolveTreeVolumes(p, trunk);
  const grown = growBranches(trunk, p, rng, volumes);
  const totalHeight = treeHeight(p);
  // Sway amplitudes: the same lean fraction the shipped placed trees use, times
  // the maker's multiplier.
  const swayAmp = totalHeight * 0.038 * p.sway;
  const shimmer = LEAF_SHIMMER_YARDS * p.sway;

  if (grown.geometry) {
    owned.push(grown.geometry);
    const branchMesh = new THREE.Mesh(grown.geometry, bark);
    branchMesh.name = 'tree-branches';
    branchMesh.castShadow = true;
    branchMesh.receiveShadow = true;
    attachBranchSway(branchMesh, swayAmp, totalHeight);
    group.add(branchMesh);
  }

  // ---- the leaf scatter
  const canopy = buildLeafCanopy({
    params: p,
    volumes,
    tips: grown.tips,
    swayAmp,
    shimmer,
    totalHeight,
  });
  const leafMesh = canopy?.mesh ?? null;
  const leafCount = canopy?.count ?? 0;
  if (canopy) {
    owned.push(canopy.geometry);
    group.add(canopy.mesh);
  }

  // ---- the trunk GLB, whenever it lands
  if (loadTrunk) {
    void loadTrunk(trunkPathFor(trunk.key))
      .then((obj) => {
        if (!obj) return;
        obj.name = 'tree-trunk';
        obj.scale.set(p.girth, p.height, p.girth);
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = bark;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        });
        attachBranchSway(obj, swayAmp, totalHeight);
        group.add(obj);
      })
      .catch(() => {});
  }

  if (volumeOverlay && volumes.length > 0) {
    const overlay = buildVolumeOverlay(volumes);
    for (const child of overlay.children) {
      owned.push((child as THREE.LineSegments).geometry);
    }
    group.add(overlay);
  }

  let radius = trunk.baseRadius * p.girth;
  for (const v of volumes) {
    radius = Math.max(radius, Math.hypot(v.x, v.z) + v.r);
  }

  return {
    group,
    height: totalHeight,
    radius,
    collideRadius: treeCollideRadius(p),
    volumes,
    leafCount,
    branchCount: grown.count,
    dispose: () => {
      for (const g of owned) g.dispose();
    },
  };
}

function trunkPathFor(key: string): string {
  return `models/foliage/trunks/${key}.glb`;
}

/**
 * Wind for the solid parts (trunk GLB, branch mesh): the whole-plant lean,
 * weighted quadratically up the model's own height. Same wave as the shipped
 * placed-tree sway, so a generated tree and a placed oak lean together.
 */
function attachBranchSway(object: THREE.Object3D, amp: number, height: number): void {
  if (amp <= 0 || !GFX.windSway) return;
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat || mat.userData.wocTreeGenSway === amp) continue;
      mat.userData.wocTreeGenSway = amp;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = sharedUniforms.uTime;
        sh.uniforms.uSwayPlayer = treeSwayUniforms.uSwayPlayer;
        sh.vertexShader = sh.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            uniform vec2 uSwayPlayer;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vec2 wocSwayBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
            ${treeSwayWaveGlsl()}
            float wocBendW = clamp(transformed.y / ${Math.max(0.01, height).toFixed(3)}, 0.0, 1.0);
            float wocBend = wocSwayWave * ${amp.toFixed(4)} * wocBendW * wocBendW;
            transformed.x += wocBend;
            transformed.z += wocBend * 0.6;`,
          );
      };
      mat.customProgramCacheKey = () => `woc-treegen-sway:${amp.toFixed(4)}:${height.toFixed(2)}`;
      mat.needsUpdate = true;
    }
  });
}

/**
 * Fill the canopy volumes with leaf cards.
 *
 * Volumes are weighted by their own size so a big blob gets proportionally more
 * leaves than a small one; `leafFill` blends the sample from the shell of the
 * ellipsoid to solid through it; `leafClump` biases samples toward a handful of
 * bunch centres per volume; `leafBranchBias` pulls each card toward the nearest
 * branch tip, which is what stops a canopy floating free of the limbs holding
 * it up.
 */
function scatterLeaves(
  mesh: THREE.InstancedMesh,
  p: ResolvedTreeParams,
  set: LeafSet,
  volumes: readonly TreeVolume[],
  tips: readonly BranchTip[],
  count: number,
  rng: () => number,
): void {
  const weights = volumes.map((v) => Math.max(1e-4, v.r * v.r * v.r * v.sy));
  const total = weights.reduce((a, b) => a + b, 0);
  const cells = new Float32Array(count * 2);
  const color = new THREE.Color();
  const tint = new THREE.Color(p.leafTint);
  const m = new THREE.Matrix4();
  const rot = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const scaleV = new THREE.Vector3();
  // Clump centres: a few fixed directions per volume that leaves gather around.
  const clumpsPer = 5;
  const clumps: THREE.Vector3[][] = volumes.map(() => {
    const list: THREE.Vector3[] = [];
    for (let i = 0; i < clumpsPer; i++) {
      list.push(randomDirection(rng, new THREE.Vector3()));
    }
    return list;
  });
  const hsl = { h: 0, s: 0, l: 0 };
  tint.getHSL(hsl);

  for (let i = 0; i < count; i++) {
    // Pick a volume by weight.
    let pick = rng() * total;
    let vi = 0;
    while (vi < volumes.length - 1 && pick > weights[vi]) {
      pick -= weights[vi];
      vi++;
    }
    const v = volumes[vi];

    // Direction: uniform, or gathered around one of the volume's clump centres.
    randomDirection(rng, normal);
    if (p.leafClump > 0) {
      const c = clumps[vi][Math.floor(rng() * clumpsPer) % clumpsPer];
      normal.lerp(c, clamp(p.leafClump, 0, 1) * 0.85).normalize();
    }
    // Radius: shell at fill 0, solid at fill 1 (cube root keeps it even).
    const shell = 1;
    const solid = Math.cbrt(rng());
    const radial = shell + (solid - shell) * clamp(p.leafFill, 0, 1);
    point.set(
      v.x + normal.x * v.r * radial,
      v.y + normal.y * v.r * v.sy * radial,
      v.z + normal.z * v.r * radial,
    );

    // Pull toward the nearest branch tip so the canopy sits on the limbs.
    if (p.leafBranchBias > 0 && tips.length > 0) {
      let best = tips[0];
      let bestD = Infinity;
      for (const t of tips) {
        const d = t.p.distanceToSquared(point);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      point.lerp(best.p, clamp(p.leafBranchBias, 0, 1) * 0.55 * rng());
    }

    orientLeaf(rot, p.leafOrient, normal, p.leafDroop, p.leafJitter, rng, q, up, tmp);
    const size = p.leafSize * (1 + (rng() - 0.5) * 2 * clamp(p.leafSizeVar, 0, 1));
    scaleV.set(size, size, size);
    m.copy(rot);
    m.scale(scaleV);
    m.setPosition(point);
    mesh.setMatrixAt(i, m);

    // Atlas cell.
    const cell = Math.floor(rng() * LEAF_ATLAS_CELLS) % LEAF_ATLAS_CELLS;
    cells[i * 2] = (cell % LEAF_ATLAS_COLS) / LEAF_ATLAS_COLS;
    cells[i * 2 + 1] = Math.floor(cell / LEAF_ATLAS_COLS) / LEAF_ATLAS_ROWS;

    // Per-leaf colour: the tint, varied in hue and lightness, and shaded down
    // toward the inside of the canopy so the crown has depth.
    const varAmt = clamp(p.leafTintVar, 0, 1);
    const inner = 1 - 0.28 * (1 - radial) * (1 - varAmt * 0.4);
    color.setHSL(
      (hsl.h + (rng() - 0.5) * 0.09 * varAmt + 1) % 1,
      clamp(hsl.s * (1 + (rng() - 0.5) * 0.5 * varAmt), 0, 1),
      clamp(hsl.l * inner * (1 + (rng() - 0.5) * 0.55 * varAmt), 0, 1),
    );
    mesh.setColorAt(i, color);
  }
  mesh.geometry.setAttribute('aLeafCell', new THREE.InstancedBufferAttribute(cells, 2));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  // The anchor convention only matters here as a reminder: 'top' sets hang
  // downward from the pivot, which is why weeping shapes use those sets.
  void set;
}

/** A uniformly distributed unit vector. */
function randomDirection(rng: () => number, out: THREE.Vector3): THREE.Vector3 {
  const z = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

// ------------------------------------------------------------------- presets
// One entry per biome the world needs a tree for. These are the starting points
// the Tree panel offers; every field stays editable afterwards.

export interface TreePreset {
  key: string;
  label: string;
  /** Grouping in the picker. */
  biome: string;
  params: TreeParams;
}

export const TREE_PRESETS: readonly TreePreset[] = [
  {
    key: 'forest_oak',
    label: 'Forest Oak',
    biome: 'Forest',
    params: {
      trunk: 'oak',
      leafSet: 'broadleaf',
      shape: 'sockets',
      volumeCount: 6,
      leaves: 340,
      leafSize: 1.9,
      leafOrient: 'volume',
      leafDroop: 0.3,
    },
  },
  {
    key: 'forest_birch',
    label: 'Birch',
    biome: 'Forest',
    params: {
      trunk: 'oak',
      girth: 0.55,
      height: 1.15,
      leafSet: 'birch_spring',
      shape: 'dome',
      volumeCount: 5,
      volumeScale: 0.85,
      leaves: 420,
      leafSize: 0.7,
      branchLen: 0.8,
      barkTexId: 'Wood001',
    },
  },
  {
    key: 'forest_maple',
    label: 'Autumn Maple',
    biome: 'Forest',
    params: {
      trunk: 'oak',
      leafSet: 'maple_autumn',
      shape: 'sphere',
      volumeCount: 5,
      leaves: 460,
      leafSize: 1.05,
      leafTintVar: 0.26,
    },
  },
  {
    key: 'forest_pine',
    label: 'Pine',
    biome: 'Forest',
    params: {
      trunk: 'pine',
      leafSet: 'needle',
      shape: 'cone',
      volumeCount: 7,
      volumeScale: 1.5,
      volumeSpread: 1.2,
      leaves: 560,
      leafSize: 2.4,
      leafOrient: 'droop',
      leafDroop: 0.55,
      branches: 1,
      branchDepth: 1,
      branchLen: 0.5,
      barkTexId: 'Wood002',
    },
  },
  {
    key: 'forest_willow',
    label: 'Weeping Willow',
    biome: 'Forest',
    params: {
      trunk: 'oak',
      leafSet: 'willow',
      shape: 'weeping',
      volumeCount: 5,
      volumeScale: 1.15,
      leaves: 520,
      leafSize: 1.5,
      leafOrient: 'up',
      leafFill: 0.15,
      branchDroop: 0.75,
    },
  },
  {
    key: 'dark_pine',
    label: 'Blackwood Pine',
    biome: 'Dark forest',
    params: {
      trunk: 'pine',
      leafSet: 'needle_dark',
      shape: 'cone',
      volumeCount: 7,
      volumeScale: 1.45,
      volumeSpread: 1.15,
      leaves: 500,
      leafSize: 2.4,
      leafOrient: 'droop',
      leafDroop: 0.6,
      leafTint: 0xc8d2cc,
      branches: 1,
      branchDepth: 1,
      barkTexId: 'Wood003',
    },
  },
  {
    key: 'dark_twisted',
    label: 'Gallows Oak',
    biome: 'Dark forest',
    params: {
      trunk: 'twisted',
      leafSet: 'broadleaf_dark',
      shape: 'sockets',
      volumeCount: 4,
      volumeScale: 0.85,
      leaves: 260,
      leafSize: 0.9,
      leafFill: 0.1,
      leafClump: 0.65,
      branchTwist: 0.7,
      branchDroop: 0.45,
    },
  },
  {
    key: 'dark_oakdead',
    label: 'Hollow Oak',
    biome: 'Dark forest',
    params: {
      trunk: 'twisted',
      girth: 1.4,
      leafSet: 'oak_dark',
      shape: 'sockets',
      volumeCount: 5,
      leaves: 200,
      leafSize: 1,
      leafClump: 0.8,
      branchTwist: 0.6,
    },
  },
  {
    key: 'tropical_palm',
    label: 'Coconut Palm',
    biome: 'Tropical',
    params: {
      trunk: 'palm',
      leafSet: 'frond',
      shape: 'umbrella',
      volumeCount: 2,
      volumeScale: 0.45,
      volumeSpread: 0.5,
      leaves: 34,
      leafSize: 5.2,
      leafSizeVar: 0.14,
      leafOrient: 'out',
      leafDroop: 0.5,
      leafFill: 0,
      leafJitter: 0.1,
      leafClump: 0,
      leafBranchBias: 0,
      branches: 0,
      barkTexId: 'Wood004',
    },
  },
  {
    key: 'tropical_jungle',
    label: 'Jungle Giant',
    biome: 'Tropical',
    params: {
      trunk: 'ancient',
      girth: 0.7,
      height: 0.9,
      leafSet: 'jungle',
      shape: 'dome',
      volumeCount: 6,
      volumeScale: 1.2,
      leaves: 420,
      leafSize: 1.9,
      leafDroop: 0.45,
      barkTexId: 'Wood004',
    },
  },
  {
    key: 'desert_acacia',
    label: 'Acacia',
    biome: 'Desert',
    params: {
      trunk: 'acacia',
      leafSet: 'acacia',
      shape: 'umbrella',
      volumeCount: 5,
      volumeSpread: 1.15,
      leaves: 380,
      leafSize: 1.15,
      leafOrient: 'out',
      leafFill: 0.2,
      leafDroop: 0.1,
      branchDroop: 0.05,
      barkTexId: 'Wood003',
    },
  },
  {
    key: 'desert_palm',
    label: 'Date Palm',
    biome: 'Desert',
    params: {
      trunk: 'palm',
      height: 0.85,
      leafSet: 'frond_dry',
      shape: 'umbrella',
      volumeCount: 2,
      volumeScale: 0.42,
      volumeSpread: 0.45,
      leaves: 30,
      leafSize: 4.6,
      leafSizeVar: 0.14,
      leafOrient: 'out',
      leafDroop: 0.62,
      leafFill: 0,
      leafJitter: 0.1,
      leafClump: 0,
      leafBranchBias: 0,
      branches: 0,
    },
  },
  {
    key: 'magic_ancient',
    label: 'Elderbloom',
    biome: 'Magic',
    params: {
      trunk: 'ancient',
      leafSet: 'broadleaf_arcane',
      shape: 'sockets',
      volumeCount: 7,
      volumeScale: 1.15,
      leaves: 720,
      leafSize: 1.1,
      leafGlow: 1.6,
      leafTintVar: 0.3,
      barkTexId: 'Wood003',
    },
  },
  {
    key: 'magic_willow',
    label: 'Moonveil Willow',
    biome: 'Magic',
    params: {
      trunk: 'oak',
      leafSet: 'willow_arcane',
      shape: 'weeping',
      volumeCount: 5,
      leaves: 560,
      leafSize: 1.6,
      leafOrient: 'up',
      leafGlow: 2.2,
      leafFill: 0.12,
      branchDroop: 0.8,
    },
  },
  {
    key: 'fire_ember',
    label: 'Emberbough',
    biome: 'Fire',
    params: {
      trunk: 'twisted',
      leafSet: 'broadleaf_ember',
      shape: 'sockets',
      volumeCount: 5,
      leaves: 380,
      leafSize: 1,
      leafGlow: 2.6,
      leafClump: 0.5,
      leafTintVar: 0.3,
      branchTwist: 0.55,
      barkTexId: 'Wood003',
    },
  },
  {
    key: 'fire_maple',
    label: 'Cinderleaf',
    biome: 'Fire',
    params: {
      trunk: 'oak',
      leafSet: 'maple_ember',
      shape: 'sphere',
      volumeCount: 5,
      leaves: 440,
      leafSize: 1.15,
      leafGlow: 1.8,
    },
  },
];

export function treePreset(key: string): TreePreset | null {
  return TREE_PRESETS.find((t) => t.key === key) ?? null;
}
