// The Fire and Fly arena's scenery: a sunlit meadow clearing ringed by the
// open world's own oaks and pines, the forested hills beyond the invisible
// wall, and pollen hanging in the low sun. Every placement comes from the pure
// plan (fire_and_fly_arena_core.ts), itself read from the sim's field leaf, so
// the trunks and rocks drawn here are the colliders the thrown bodies meet.
// The cannon tower is not drawn here: the turret visual owns it (its head
// pivots), at the field leaf's shared scale.
//
// Programs: the trees, rocks, ferns and bushes wear the open world's foliage
// materials (foliage.ts extractParts), so they link as cache hits; the ground,
// the grass cards, the hills' canopy and the motes are the arena's own, one
// named page-lifetime material each whatever the slot, linked behind the
// interior's compile gate. The ground is its own gated root, revealed on its
// one program ahead of the rest (open_field_interiors.ts): it stands in for the
// arena while the trees and the cover link. No light of its own: the golden
// hour is the `fireAndFly` state of interior_light_rig.ts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROCK_SINK_UNITS } from '../sim/decoration_dims';
import {
  FIRE_AND_FLY_ROCKS,
  FIRE_AND_FLY_TREES,
  type FireAndFlyTree,
} from '../sim/fire_and_fly_field';
import {
  type ArenaCoverSpot,
  type ArenaGrassSpot,
  arenaHash,
  createArenaGroundPaint,
  FIRE_AND_FLY_GROUND_SEGMENTS,
  FIRE_AND_FLY_SKY_ANCHOR,
  fireAndFlyBackdropCrowns,
  fireAndFlyFlowerSpots,
  fireAndFlyGrassSpots,
  fireAndFlyGroundPaint,
  fireAndFlyGroundRings,
  fireAndFlyLeafTone,
  fireAndFlyMotes,
  fireAndFlyRenderHeight,
  fireAndFlyRockPlacement,
  fireAndFlyTreeCastsIntoClearing,
  fireAndFlyTreePlacement,
  fireAndFlyUnderstorySpots,
} from './fire_and_fly_arena_core';
import { createGrassTuftMaterial, extractParts, type ModelPart } from './foliage';
import { applyInstanceCollapse } from './foliage_collapse';
import { FOLIAGE_MODEL_DIR, treeUrl } from './foliage_field_models';
import { GFX, sharedUniforms } from './gfx';
import { GRASS_CARDS_FULL, GRASS_CARDS_MID, grassTuftCards } from './grass_tuft_cards_core';
import { ghostHideGeometry } from './instanced_dither_fade';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { ensureSkyAssetsAt } from './sky';
import { ROUGH_GRASS, terrainSplatTexture } from './terrain';
import { flowerTuftTexture, radialGlowTexture } from './textures';

export interface FireAndFlyArenaDeps {
  lowGfx: boolean;
  /** The slot origin the caller seats the arena group at. */
  origin: { x: number; z: number };
}

type Origin = FireAndFlyArenaDeps['origin'];

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);

/** The open world's tree-shadow rule (foliage.ts): no shadow pass for foliage
 *  on the lean tiers, where the weak GPUs are. */
function castsShadows(lowGfx: boolean): boolean {
  return !lowGfx && GFX.standardMaterials && !GFX.leanFoliage;
}

// One material per role and material class for the whole page: every slot
// draws the same programs, and none is ever released with a slot.
const materials = new Map<string, THREE.Material>();

function sharedMaterial(key: string, make: () => THREE.Material): THREE.Material {
  const cached = materials.get(key);
  if (cached) return cached;
  const material = make();
  material.name = `fireAndFly:${key.split('|')[0]}`;
  materials.set(key, markSharedMaterial(material));
  return material;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

// Absolute colours for the vertex-paint ground (no splat photos on this tier).
const PLAIN_GRASS = new THREE.Color(0x6f8c3c);
const PLAIN_DRY = new THREE.Color(0xa39a52);
const PLAIN_LUSH = new THREE.Color(0x4d7a33);
const PLAIN_SHADE = new THREE.Color(0x3d3c28);
const PLAIN_SOIL = new THREE.Color(0x7a6143);
// Multipliers over the grass photo on the splat tier: the photo carries the hue,
// the paint only shifts it (straw in the dry patches, deeper green in the lush
// ones, the dim litter under the ring).
const SPLAT_BASE = new THREE.Color().setRGB(1.12, 1.03, 0.8);
const SPLAT_DRY = new THREE.Color().setRGB(1.26, 1.08, 0.66);
const SPLAT_LUSH = new THREE.Color().setRGB(0.9, 1, 0.76);
const SPLAT_SHADE = new THREE.Color().setRGB(0.58, 0.54, 0.45);

/** True when the ground can wear the open world's grass and earth photos. */
function usesSplatGround(lowGfx: boolean): boolean {
  return (
    !lowGfx &&
    GFX.standardMaterials &&
    Boolean(
      terrainSplatTexture('grassC') &&
        terrainSplatTexture('grassN') &&
        terrainSplatTexture('dirtC'),
    )
  );
}

const groundGeometries = new Map<boolean, THREE.BufferGeometry>();

// The perimeter ring hangs below the hill crest, so a ray grazing the last
// crowns still lands on ground rather than the dome's below-horizon slice.
const SKIRT_DROP = -30;
// World yards to texture repeats: the open world's splat density (terrain.ts).
const SPLAT_UV_PER_YARD = 0.22;

function groundGeometry(splat: boolean): THREE.BufferGeometry {
  const cached = groundGeometries.get(splat);
  if (cached) return cached;
  const rings = fireAndFlyGroundRings();
  const segments = FIRE_AND_FLY_GROUND_SEGMENTS;
  const count = 1 + (rings.length - 1) * segments;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const dirt = new Float32Array(count);
  const paint = createArenaGroundPaint();
  const color = new THREE.Color();
  const write = (index: number, x: number, z: number, skirt: boolean): void => {
    positions[index * 3] = x;
    positions[index * 3 + 1] = skirt ? SKIRT_DROP : fireAndFlyRenderHeight(x, z);
    positions[index * 3 + 2] = z;
    uvs[index * 2] = x * SPLAT_UV_PER_YARD;
    uvs[index * 2 + 1] = z * SPLAT_UV_PER_YARD;
    fireAndFlyGroundPaint(x, z, paint);
    if (splat) {
      color.copy(SPLAT_BASE).lerp(SPLAT_DRY, paint.dry).lerp(SPLAT_LUSH, paint.lush);
      color.lerp(SPLAT_SHADE, paint.shade);
      dirt[index] = paint.dirt;
    } else {
      color.copy(PLAIN_GRASS).lerp(PLAIN_DRY, paint.dry).lerp(PLAIN_LUSH, paint.lush);
      color.lerp(PLAIN_SOIL, paint.dirt * 0.85).lerp(PLAIN_SHADE, paint.shade * 0.7);
    }
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  };
  write(0, 0, 0, false);
  for (let k = 1; k < rings.length; k++) {
    const skirt = k === rings.length - 1;
    // A half-step twist per ring breaks the radial spokes a polar grid shows.
    const twist = (k % 2) * 0.5;
    for (let s = 0; s < segments; s++) {
      const angle = ((s + twist) / segments) * Math.PI * 2;
      write(
        1 + (k - 1) * segments + s,
        Math.sin(angle) * rings[k],
        Math.cos(angle) * rings[k],
        skirt,
      );
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < segments; s++) indices.push(0, 1 + s, 1 + ((s + 1) % segments));
  for (let k = 1; k < rings.length - 1; k++) {
    const inner = 1 + (k - 1) * segments;
    const outer = inner + segments;
    for (let s = 0; s < segments; s++) {
      const a = inner + s;
      const b = inner + ((s + 1) % segments);
      const c = outer + s;
      const d = outer + ((s + 1) % segments);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (splat) geometry.setAttribute('aDirt', new THREE.BufferAttribute(dirt, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  markSharedGeometry(geometry);
  groundGeometries.set(splat, geometry);
  return geometry;
}

// The splat ground blends the open world's earth photo in by the painted dirt
// weight, with the earth's own brightness as a height so the edge breaks up
// into pebbles and clods instead of a soft smear; a second, slower grass tap
// hides the photo's tiling across the open clearing.
function makeSplatGroundMaterial(): THREE.Material {
  const grassC = terrainSplatTexture('grassC');
  const grassN = terrainSplatTexture('grassN');
  const dirtC = terrainSplatTexture('dirtC');
  const material = new THREE.MeshStandardMaterial({
    map: grassC,
    normalMap: grassN,
    normalScale: new THREE.Vector2(0.9, 0.9),
    vertexColors: true,
    roughness: ROUGH_GRASS,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uArenaDirt = { value: dirtC };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aDirt;
        varying float vArenaDirt;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vArenaDirt = aDirt;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uArenaDirt;
        varying float vArenaDirt;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 arenaGrass = mix(
            texture2D(map, vMapUv),
            texture2D(map, vMapUv * 0.231 + vec2(0.37, 0.61)),
            0.38
          );
          vec4 arenaEarth = texture2D(uArenaDirt, vMapUv * 0.73);
          float arenaRelief = dot(arenaEarth.rgb, vec3(0.3333)) - 0.3;
          float arenaMix = clamp((vArenaDirt - 0.5) * 3.2 + arenaRelief * 1.6 + 0.5, 0.0, 1.0);
          diffuseColor *= mix(arenaGrass, arenaEarth, arenaMix);
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'fire-and-fly-ground-v1';
  return material;
}

function groundMaterial(lowGfx: boolean, splat: boolean): THREE.Material {
  if (splat) return sharedMaterial('ground|splat', makeSplatGroundMaterial);
  if (lowGfx || !GFX.standardMaterials) {
    return sharedMaterial(
      'groundPlain|lambert',
      () => new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
  }
  return sharedMaterial(
    'groundPlain|standard',
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: terrainSplatTexture('grassC'),
        roughness: 0.95,
        metalness: 0,
      }),
  );
}

function buildGround(lowGfx: boolean): THREE.Mesh {
  const splat = usesSplatGround(lowGfx);
  const ground = new THREE.Mesh(groundGeometry(splat), groundMaterial(lowGfx, splat));
  ground.name = 'fireAndFlyGround';
  ground.receiveShadow = true;
  return ground;
}

// ---------------------------------------------------------------------------
// Grass and wildflowers (the open world's tuft card, one draw each)
// ---------------------------------------------------------------------------

const tuftGeometries = new Map<number, THREE.BufferGeometry>();

// The open world's tuft card plan (grass_tuft_cards_core.ts). The camera here
// always looks down from the tower roof, so every tier above lean keeps the
// sky-facing cap card that stops the meadow reading as a field of crosses.
function tuftCard(cards: number): THREE.BufferGeometry {
  const cached = tuftGeometries.get(cards);
  if (cached) return cached;
  const parts = grassTuftCards(cards, true).map((card) => {
    const part = new THREE.PlaneGeometry(card.width, card.height);
    if (card.preRotX !== 0) part.rotateX(card.preRotX);
    part.translate(0, card.liftY, 0);
    if (card.rotZ !== 0) part.rotateZ(card.rotZ);
    if (card.rotY !== 0) part.rotateY(card.rotY);
    return part;
  });
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Fire and Fly tuft geometry merge failed');
  const geometry = markSharedGeometry(merged);
  tuftGeometries.set(cards, geometry);
  return geometry;
}

const GRASS_BASE = new THREE.Color(0xa2ad6c);
const GRASS_DRY = new THREE.Color(0xc4b36e);
const GRASS_LUSH = new THREE.Color(0x88a462);

function coverMesh<Spot extends ArenaCoverSpot>(
  spots: readonly Spot[],
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  tint: (spot: Spot, out: THREE.Color) => void,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
  mesh.userData.renderCategory = 'grass';
  mesh.receiveShadow = true;
  const color = new THREE.Color();
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    quaternion.setFromAxisAngle(UP, spot.yaw);
    matrix.compose(
      position.set(spot.x, spot.y, spot.z),
      quaternion,
      scale.set(spot.scale, spot.scale, spot.scale),
    );
    mesh.setMatrixAt(i, matrix);
    tint(spot, color);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function buildGrass(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fireAndFlyGrass';
  const medium = GFX.tier === 'medium';
  group.add(
    coverMesh<ArenaGrassSpot>(
      fireAndFlyGrassSpots(medium ? 1.8 : 1.2),
      tuftCard(medium ? GRASS_CARDS_MID : GRASS_CARDS_FULL),
      sharedMaterial('grass', createGrassTuftMaterial),
      (s, c) => {
        c.copy(GRASS_BASE).lerp(GRASS_DRY, s.dry).lerp(GRASS_LUSH, s.lush);
        c.offsetHSL((s.h1 - 0.5) * 0.04, (s.h2 - 0.5) * 0.1, (s.h3 - 0.5) * 0.1);
      },
    ),
  );
  // Same card program as the grass: only the map differs.
  const flowerMaterial = sharedMaterial('flowers', () => {
    const material = createGrassTuftMaterial() as THREE.MeshStandardMaterial;
    material.map?.dispose();
    material.map = flowerTuftTexture();
    return material;
  });
  group.add(
    coverMesh(fireAndFlyFlowerSpots(), tuftCard(2), flowerMaterial, (s, c) => {
      c.copy(WHITE).offsetHSL((s.h1 - 0.5) * 0.03, 0, (s.h3 - 0.5) * 0.08);
    }),
  );
  return group;
}

// ---------------------------------------------------------------------------
// Trees, rocks, understory: the open world's kit models and materials
// ---------------------------------------------------------------------------

/** The part set of one foliage model, or null when it never loaded. */
function partsOf(url: string): readonly ModelPart[] | null {
  try {
    return extractParts(url);
  } catch {
    return null;
  }
}

function treeUrls(kind: FireAndFlyTree['kind']): string[] {
  if (GFX.leanFoliage) return [treeUrl(kind, 1)];
  // pine_3 is shipped but unused by the open world (its canopy reads as a pole).
  return (kind === 'pine' ? [1, 2, 4, 5] : [1, 2, 3, 4, 5]).map((i) => treeUrl(kind, i));
}

// The vale's tints (foliage.ts PINE_TINT / OAK_TINT), softened the same way,
// plus a few oaks already turning gold.
const LEAF_TINT = { pine: 0x9bb48d, oak: 0xa7b886, goldenOak: 0xd3a54c } as const;
const LEAF_SOFTEN = { pine: 0.6, oak: 0.6, goldenOak: 0.4 } as const;
const BARK_TINT = 0xf2e6d4;

function softTint(hex: number, soften: number, x: number, z: number, jitter: number): THREE.Color {
  const out = new THREE.Color(hex).lerp(WHITE, soften);
  out.offsetHSL(
    (arenaHash(x, z, 1) - 0.5) * 0.05 * jitter,
    (arenaHash(x, z, 2) - 0.5) * 0.12 * jitter,
    (arenaHash(x, z, 3) - 0.5) * 0.1 * jitter,
  );
  return out;
}

function instancedPart(
  part: ModelPart,
  trees: readonly FireAndFlyTree[],
  castShadow: boolean,
  origin: Origin,
): THREE.InstancedMesh {
  // A shell over the open world's shared part (instanced_dither_fade.ts): the
  // same buffers, flagged renderer-owned, so no teardown of this group can
  // release geometry the open-world forest still draws.
  const mesh = new THREE.InstancedMesh(
    ghostHideGeometry(part.geometry, trees.length),
    part.material,
    trees.length,
  );
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const at = fireAndFlyTreePlacement(tree);
    quaternion.setFromAxisAngle(UP, at.yaw);
    matrix.compose(
      position.set(origin.x + at.x, at.y, origin.z + at.z),
      quaternion,
      scale.set(at.scale, at.scale * at.heightJitter, at.scale),
    );
    mesh.setMatrixAt(i, matrix);
    const tone = fireAndFlyLeafTone(tree);
    mesh.setColorAt(
      i,
      part.isLeaf
        ? softTint(LEAF_TINT[tone], LEAF_SOFTEN[tone], tree.x, tree.z, 1)
        : softTint(BARK_TINT, 0.85, tree.x, tree.z, 0.5),
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function buildTrees(lowGfx: boolean, origin: Origin): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fireAndFlyTrees';
  const shadows = castsShadows(lowGfx);
  for (const kind of ['oak', 'pine'] as const) {
    const urls = treeUrls(kind);
    const byUrl = urls.map(() => [] as FireAndFlyTree[]);
    for (const tree of FIRE_AND_FLY_TREES) {
      if (tree.kind === kind) byUrl[(tree.variant - 1) % urls.length].push(tree);
    }
    urls.forEach((url, u) => {
      const trees = byUrl[u];
      const parts = partsOf(url);
      if (!parts || trees.length === 0) return;
      // The canopies on the sun side throw their shadows across the clearing;
      // the rest would only shade the forest floor, so they skip the pass.
      const casting = shadows ? trees.filter(fireAndFlyTreeCastsIntoClearing) : [];
      const quiet = shadows ? trees.filter((t) => !fireAndFlyTreeCastsIntoClearing(t)) : trees;
      for (const part of parts) {
        if (!part.isLeaf) {
          group.add(instancedPart(part, trees, false, origin));
          continue;
        }
        if (casting.length > 0) group.add(instancedPart(part, casting, true, origin));
        if (quiet.length > 0) group.add(instancedPart(part, quiet, false, origin));
      }
    });
  }
  return group;
}

const rockGeometries = new Map<string, { geometry: THREE.BufferGeometry; top: number }>();
const MOSS = new THREE.Color(0.62, 0.82, 0.45);

// The open world's mossy boulder colourway (foliage.ts bakeTopTint): up-facing
// faces take the moss, the underside a little baked occlusion.
function mossyRock(url: string, part: ModelPart): { geometry: THREE.BufferGeometry; top: number } {
  const cached = rockGeometries.get(url);
  if (cached) return cached;
  const geometry = part.geometry.clone();
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const upness = normals.getY(i);
    const t = THREE.MathUtils.smoothstep(upness, 0.25, 0.85);
    const occlusion = 1 + Math.min(0, upness) * 0.25;
    colors[i * 3] = (1 + (MOSS.r - 1) * t) * occlusion;
    colors[i * 3 + 1] = (1 + (MOSS.g - 1) * t) * occlusion;
    colors[i * 3 + 2] = (1 + (MOSS.b - 1) * t) * occlusion;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  const baked = { geometry: markSharedGeometry(geometry), top: geometry.boundingBox?.max.y ?? 1 };
  rockGeometries.set(url, baked);
  return baked;
}

function buildRocks(lowGfx: boolean, origin: Origin): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fireAndFlyRocks';
  const urls = (GFX.leanFoliage ? [1] : [1, 2, 3]).map((i) => `${FOLIAGE_MODEL_DIR}rock_${i}.glb`);
  const firstParts = partsOf(urls[0]);
  if (!firstParts) return group;
  // The open world's rock program, by foliage.ts's own recipe: the rock_1
  // material cloned with vertex colours on, its collapse window re-taken
  // (clone() drops shader hooks). The open world's clone is local to its
  // build, so this one mirrors it rather than borrowing it.
  const material = sharedMaterial('rock', () => {
    const rock = (firstParts[0].material as THREE.MeshStandardMaterial).clone();
    rock.vertexColors = true;
    applyInstanceCollapse(rock, 'rock');
    return rock;
  });
  const shadows = castsShadows(lowGfx);
  const tint = new THREE.Color();
  urls.forEach((url, u) => {
    const rocks = FIRE_AND_FLY_ROCKS.filter((rock) => (rock.variant - 1) % urls.length === u);
    const parts = partsOf(url);
    if (!parts || rocks.length === 0) return;
    const { geometry, top } = mossyRock(url, parts[0]);
    const mesh = new THREE.InstancedMesh(geometry, material, rocks.length);
    rocks.forEach((rock, i) => {
      const at = fireAndFlyRockPlacement(rock);
      const sy = rock.height / Math.max(0.1, top - ROCK_SINK_UNITS);
      quaternion.setFromEuler(euler.set(at.tiltX, at.yaw, at.tiltZ));
      matrix.compose(
        position.set(origin.x + at.x, at.ground - ROCK_SINK_UNITS * sy, origin.z + at.z),
        quaternion,
        scale.set(at.sx, sy, at.sz),
      );
      mesh.setMatrixAt(i, matrix);
      tint.setHex(0x928f84).lerp(WHITE, 0.45);
      tint.offsetHSL(0, 0, (arenaHash(rock.x, rock.z, 3) - 0.5) * 0.08);
      mesh.setColorAt(i, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

function buildUnderstory(origin: Origin): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fireAndFlyUnderstory';
  const spots = fireAndFlyUnderstorySpots();
  const kinds = [
    { kind: 'fern', url: `${FOLIAGE_MODEL_DIR}fern.glb`, tint: 0xc9dca8 },
    { kind: 'bush', url: `${FOLIAGE_MODEL_DIR}bush_flowers.glb`, tint: 0xe6ecd0 },
  ] as const;
  const color = new THREE.Color();
  for (const { kind, url, tint } of kinds) {
    const list = spots.filter((spot) => spot.kind === kind);
    const parts = partsOf(url);
    if (!parts || list.length === 0) continue;
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(
        ghostHideGeometry(part.geometry, list.length),
        part.material,
        list.length,
      );
      list.forEach((spot, i) => {
        quaternion.setFromAxisAngle(UP, spot.yaw);
        matrix.compose(
          position.set(origin.x + spot.x, spot.y - 0.05, origin.z + spot.z),
          quaternion,
          scale.set(spot.scale, spot.scale, spot.scale),
        );
        mesh.setMatrixAt(i, matrix);
        color.setHex(tint).offsetHSL((spot.h1 - 0.5) * 0.04, (spot.h2 - 0.5) * 0.1, 0);
        mesh.setColorAt(i, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

// ---------------------------------------------------------------------------
// The hills' forest beyond the wall
// ---------------------------------------------------------------------------

const backdropGeometries = new Map<string, THREE.BufferGeometry>();
const CANOPY_DARK = new THREE.Color(0x2c4424);
const CANOPY_LIGHT = new THREE.Color(0x4d6a30);
const CONIFER_DARK = new THREE.Color(0x223a26);
const CONIFER_LIGHT = new THREE.Color(0x35543a);
const CANOPY_GOLD = new THREE.Color(0x7a7430);

function backdropGeometry(near: boolean, detail: 0 | 1): THREE.BufferGeometry {
  const key = `${near}:${detail}`;
  const cached = backdropGeometries.get(key);
  if (cached) return cached;
  const pieces: THREE.BufferGeometry[] = [];
  const color = new THREE.Color();
  for (const crown of fireAndFlyBackdropCrowns()) {
    if (crown.near !== near) continue;
    // Conifers read as tall narrow ovals, not cones: in the haze a spire's
    // hard point is what gives a primitive away.
    const piece = new THREE.IcosahedronGeometry(1, detail);
    // Sphere normals at every detail: the lean twenty-face crown then shades
    // as one soft mass instead of a faceted boulder.
    piece.setAttribute('normal', piece.getAttribute('position').clone());
    piece.normalizeNormals();
    piece.translate(0, 1, 0).scale(1, 0.5, 1);
    const positions = piece.getAttribute('position');
    // Lumpy, not a primitive: each vertex pushed along a hashed amount.
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i);
      const py = positions.getY(i);
      const pz = positions.getZ(i);
      const bump = 1 + (arenaHash(px * 7 + crown.x, pz * 7 + crown.z, py * 5) - 0.5) * 0.26;
      positions.setXYZ(i, px * bump, py, pz * bump);
    }
    piece.scale(crown.radius, crown.height, crown.radius);
    piece.rotateY(crown.tone * Math.PI * 2);
    piece.translate(crown.x, crown.y, crown.z);
    const tones = piece.getAttribute('position');
    const paint = new Float32Array(tones.count * 3);
    const base = crown.conifer
      ? color.copy(CONIFER_DARK).lerp(CONIFER_LIGHT, crown.tone)
      : color.copy(CANOPY_DARK).lerp(CANOPY_LIGHT, crown.tone);
    if (!crown.conifer && crown.tone > 0.86) base.lerp(CANOPY_GOLD, 0.55);
    for (let i = 0; i < tones.count; i++) {
      const lift = Math.min(1, Math.max(0, (tones.getY(i) - crown.y) / crown.height));
      const shade = 0.55 + 0.45 * lift;
      paint[i * 3] = base.r * shade;
      paint[i * 3 + 1] = base.g * shade;
      paint[i * 3 + 2] = base.b * shade;
    }
    piece.setAttribute('color', new THREE.BufferAttribute(paint, 3));
    piece.deleteAttribute('uv');
    pieces.push(piece);
  }
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error('Fire and Fly backdrop merge failed');
  merged.computeBoundingSphere();
  markSharedGeometry(merged);
  backdropGeometries.set(key, merged);
  return merged;
}

function buildBackdrop(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fireAndFlyBackdrop';
  const material =
    lowGfx || !GFX.standardMaterials
      ? sharedMaterial('hills|lambert', () => new THREE.MeshLambertMaterial({ vertexColors: true }))
      : sharedMaterial(
          'hills|standard',
          () =>
            new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
        );
  for (const near of [true, false]) {
    const mesh = new THREE.Mesh(backdropGeometry(near, lowGfx ? 0 : 1), material);
    mesh.receiveShadow = near && !lowGfx;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------------------
// Pollen in the low sun
// ---------------------------------------------------------------------------

const moteGeometries = new Map<number, THREE.BufferGeometry>();

function moteGeometry(count: number): THREE.BufferGeometry {
  const cached = moteGeometries.get(count);
  if (cached) return cached;
  const motes = fireAndFlyMotes(count);
  const positions = new Float32Array(motes.length * 3);
  motes.forEach((mote, i) => {
    positions[i * 3] = mote.x;
    positions[i * 3 + 1] = mote.y;
    positions[i * 3 + 2] = mote.z;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  moteGeometries.set(count, markSharedGeometry(geometry));
  return geometry;
}

function makeMoteMaterial(): THREE.Material {
  const material = new THREE.PointsMaterial({
    map: radialGlowTexture(),
    color: 0xffdf9e,
    size: 0.34,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // A slow drift on the shared clock: each mote wanders a yard or so around
  // its anchor, never in step with its neighbours.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.x += sin(uTime * 0.23 + position.z * 0.71) * 0.9;
        transformed.y += sin(uTime * 0.31 + position.x * 0.53) * 0.45;
        transformed.z += cos(uTime * 0.19 + position.y * 1.31) * 0.9;`,
      );
  };
  material.customProgramCacheKey = () => 'fire-and-fly-motes-v1';
  return material;
}

function buildMotes(): THREE.Points {
  const points = new THREE.Points(
    moteGeometry(GFX.tier === 'medium' ? 220 : 420),
    sharedMaterial('motes', makeMoteMaterial),
  );
  points.name = 'fireAndFlyMotes';
  return points;
}

/**
 * The whole arena, instance-local (the caller seats it at the slot origin), as
 * two roots the attach gates one after the other: the ground first, standing
 * in for the arena on its one program, then everything else.
 */
export function buildFireAndFlyArenaInterior(deps: FireAndFlyArenaDeps): THREE.Group {
  // The dome holds the golden-hour sky here (hoard_valley_frame.ts
  // setSkyCamera); its HDRI is fetched with the scenery, the dome cross-fades
  // to it once resident.
  if (!deps.lowGfx && GFX.standardMaterials) {
    void ensureSkyAssetsAt(FIRE_AND_FLY_SKY_ANCHOR.x, FIRE_AND_FLY_SKY_ANCHOR.z).catch(() => {});
  }
  const group = new THREE.Group();
  group.name = 'fireAndFlyArena';
  group.add(buildGround(deps.lowGfx));
  const dressing = new THREE.Group();
  dressing.name = 'fireAndFlyDressing';
  dressing.add(buildBackdrop(deps.lowGfx));
  // The open world's foliage materials cull each instance by its distance from
  // the camera, read off the instance matrix as a WORLD position
  // (foliage_collapse.ts): their instances carry the slot origin, under a
  // holder that cancels the group's own seat.
  const kit = new THREE.Group();
  kit.name = 'fireAndFlyFoliageKit';
  kit.position.set(-deps.origin.x, 0, -deps.origin.z);
  kit.add(buildTrees(deps.lowGfx, deps.origin));
  kit.add(buildRocks(deps.lowGfx, deps.origin));
  if (!deps.lowGfx) kit.add(buildUnderstory(deps.origin));
  dressing.add(kit);
  if (!deps.lowGfx) {
    dressing.add(buildGrass());
    dressing.add(buildMotes());
  }
  group.add(dressing);
  return group;
}
