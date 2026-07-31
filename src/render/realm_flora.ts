// Glowing flora, crystal formations, and realm-only trees for the Veiled
// Hollow: the magical dressing layered over the regular biome foliage.
//
// - Glowing mushrooms reuse the bundled mushroom prop GLBs WITH their painted
//   materials (spots and caps stay readable), lifted by a soft emissive
//   rather than a flat neon re-material. Giants rise over the Gleaming Deep
//   and the Duskfall path, each seeding a ring of small "spore" mushrooms;
//   per-area instance tints shift the hue (teal deep, rose path, violet
//   elsewhere).
// - Crystal outcrops are pure procedural clusters rooted INTO the ground:
//   bases buried, leaned with the terrain gradient so hillside crystals jut
//   from the slope. A dim faceted outer shell carries the depth; a small
//   bright core carries the glow; low roughness picks up env glints.
// - Duskbell flowers, weeping willows (lakeshores), blossom trees (roadsides
//   and the town fringe), and mossy boulders are procedural or reuse bundled
//   rocks: no new asset files anywhere.
// - Placement is a deterministic hash grid from the world seed (no rng
//   stream), skipping the hub plateau, roads, and water, so every client
//   grows the same realm.
// - A handful of glow point lights ride the campfire light budget (the
//   renderer rank-culls and flickers them via userData.baseIntensity).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REALM_PROPS, REALM_ZONE } from '../sim/content/realm';
import { hash2 } from '../sim/rng';
import {
  HOLLOW_FALLS,
  hollowLandness,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
} from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { GFX, surfaceMat } from './gfx';
import { MIST_DRIFT_AMPLITUDE, SEA_LIGHT_RAYS, SEA_MIST_BANKS } from './sea_mist_core';

const MUSHROOM_URLS = ['/models/props/mushroom_red.glb', '/models/props/mushroom_tan.glb'];
const BOULDER_URL = '/models/props/rock_large_d.glb';
// The rugged coast reuses the bundled rock kit: two broad fallen-boulder
// shapes and two tall shards for offshore stacks and crest teeth.
const SEA_ROCK_URLS = [
  '/models/props/rock_large_d.glb',
  '/models/props/rock_large_f.glb',
  '/models/props/rock_tall_a.glb',
  '/models/props/rock_tall_h.glb',
];
// The great tree of Eldergleam: one hand-placed giant of the twisted elder
// model the realm's forests already use, kept with its own materials (the
// loader cache is immutable, so the scene is cloned before use).
const GREAT_TREE_URL = '/models/foliage/twisted_1.glb';
let greatTreeScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(GREAT_TREE_URL).then((gltf) => {
    greatTreeScene = gltf.scene;
  }),
);

// Per-material parts of a GLB, world-baked, with the SOURCE material kept so
// painted detail (cap spots) survives. Cache entries are immutable; clone
// materials before mutating.
interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
const loadedParts = new Map<string, ModelPart[]>();
for (const url of new Set([...MUSHROOM_URLS, BOULDER_URL, ...SEA_ROCK_URLS])) {
  registerDeferredPreload(() =>
    loadGltf(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const parts: ModelPart[] = [];
      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.geometry;
        const geo = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const attr = src.getAttribute(name);
          if (attr) geo.setAttribute(name, attr.clone());
        }
        if (src.index) geo.setIndex(src.index.clone());
        geo.applyMatrix4(mesh.matrixWorld);
        parts.push({ geometry: geo, material: mesh.material as THREE.Material });
      });
      loadedParts.set(url, parts);
    }),
  );
}

// Placement regions (see the ZoneDef POIs in sim/content/realm.ts).
const GLEAMING_DEEP = { x: -70, z: 1155, r: 58 };
const SHALLOWS = { x: 75, z: 1165, r: 48 };
const SUNKEN_COURT = { x: 125, z: 1085, r: 42 };
const STARFALL_RIM = { x: 110, z: 985, r: 36 };
const STARFALL_LAKE = { x: 110, z: 985, r: 22 };
const SHALLOWS_LAKE = { x: 75, z: 1165, r: 18 };
const ELDER_GROVE = { x: 30, z: 955, r: 40 };
const DUSKFALL_Z_MAX = 1012; // the arrival path corridor (roadside giants)

const GRID_STEP = 8;
const GLOW_LIGHT_COUNT = 12;

function within(x: number, z: number, c: { x: number; z: number; r: number }): boolean {
  const dx = x - c.x,
    dz = z - c.z;
  return dx * dx + dz * dz < c.r * c.r;
}

// Terrain gradient at a point (for leaning growth into hillsides).
function terrainGradient(x: number, z: number, seed: number): { gx: number; gz: number } {
  const e = 0.75;
  const gx = (terrainHeight(x + e, z, seed) - terrainHeight(x - e, z, seed)) / (2 * e);
  const gz = (terrainHeight(x, z + e, seed) - terrainHeight(x, z - e, seed)) / (2 * e);
  return { gx, gz };
}

// Per-area hue families. Instance colors multiply the painted materials, so
// they read as regional varieties rather than flat repaints.
type Area = 'deep' | 'path' | 'shallows' | 'court' | 'glade';
function areaAt(x: number, z: number, dRoad: number): Area {
  if (within(x, z, GLEAMING_DEEP)) return 'deep';
  if (z < DUSKFALL_Z_MAX && x < -55 && dRoad < 15) return 'path';
  if (within(x, z, SHALLOWS) || within(x, z, STARFALL_RIM)) return 'shallows';
  if (within(x, z, SUNKEN_COURT)) return 'court';
  return 'glade';
}

const MUSHROOM_AREA_TINTS: Record<Area, number[]> = {
  deep: [0x9fd8e8, 0x8fe8c8, 0xbde8f2], // spirit teals
  path: [0xf2b8d8, 0xe8a8c0, 0xf2d0e0], // rose lantern
  shallows: [0xc8b8f2, 0xb8d0f2, 0xd8c8f2], // amethyst-blue
  court: [0xd8cfa8, 0xc8bfa0, 0xe0d8b8], // old-gold ruin
  glade: [0xd8c8e8, 0xc8d8d0, 0xe8d8e0], // soft violet-sage
};

const CRYSTAL_AREA_TINTS: Record<Area, number[]> = {
  deep: [0x8fe8d8, 0xa8e8e0],
  path: [0xe8a8d0, 0xf2c0dc],
  shallows: [0xb392e8, 0xc4a8f2, 0x9fb8f2],
  court: [0xd8c890, 0xe8d8a8],
  glade: [0xc0a8e8, 0xd0b8e8],
};

interface Spot {
  x: number;
  z: number;
  y: number;
  scale: number;
  rot: number;
  variant: number; // model/colorway pick within the family
  tint: number;
  lean?: { gx: number; gz: number }; // terrain gradient for rooted growth
}

interface Placements {
  mushrooms: Spot[];
  crystals: Spot[];
  flowers: Spot[];
  starbuds: Spot[];
  willows: Spot[];
  blossoms: Spot[];
  boulders: Spot[];
  seaRocks: Spot[];
  seaStacks: Spot[];
}

function placeFlora(seed: number): Placements {
  const out: Placements = {
    mushrooms: [],
    crystals: [],
    flowers: [],
    starbuds: [],
    willows: [],
    blossoms: [],
    boulders: [],
    seaRocks: [],
    seaStacks: [],
  };
  const hub = REALM_ZONE.hub;

  const usable = (x: number, z: number, minRoad: number, hubPad = 6): number | null => {
    const dHub = Math.hypot(x - hub.x, z - hub.z);
    if (dHub < hub.radius + hubPad) return null;
    if (roadDistance(x, z) < minRoad) return null;
    const y = terrainHeight(x, z, seed);
    if (y < WATER_LEVEL + 1) return null;
    return y;
  };

  const pickTint = (table: number[], r: number): number =>
    table[Math.floor(r * 997) % table.length];

  // --- mushrooms + crystals + flowers on the main hash grid ---
  for (let gx = -172; gx <= 172; gx += GRID_STEP) {
    for (let gz = REALM_ZONE.zMin + 8; gz <= REALM_ZONE.zMax - 10; gz += GRID_STEP) {
      const r = hash2(gx, gz, seed + 201);
      const ox = (hash2(gx, gz, seed + 211) - 0.5) * GRID_STEP;
      const oz = (hash2(gx, gz, seed + 221) - 0.5) * GRID_STEP;
      const x = gx + ox,
        z = gz + oz;
      const dRoad = roadDistance(x, z);
      const y = usable(x, z, 4.5);
      if (y === null) continue;

      const rot = hash2(gx, gz, seed + 231) * Math.PI * 2;
      const variant = hash2(gx, gz, seed + 241) < 0.5 ? 0 : 1;
      const area = areaAt(x, z, dRoad);
      const shroomTint = pickTint(MUSHROOM_AREA_TINTS[area], r);
      // giants read washed-out under pale tints: deepen theirs toward the hue
      const giantTint = (() => {
        const col = new THREE.Color(shroomTint);
        const hsl = { h: 0, s: 0, l: 0 };
        col.getHSL(hsl);
        col.setHSL(hsl.h, Math.min(1, hsl.s * 1.9 + 0.12), Math.max(0.42, hsl.l * 0.82));
        return col.getHex();
      })();
      const inShroomCountry = area === 'deep' || area === 'path';
      const inCrystalCountry = area === 'shallows' || area === 'court';

      const pushShroom = (scale: number) => {
        // spore rings retired with the other small mushrooms (user pass,
        // 2026-07): giants stand alone now
        out.mushrooms.push({
          x,
          z,
          y,
          scale,
          rot,
          variant,
          tint: scale >= 3.2 ? giantTint : shroomTint,
        });
      };

      // Mushroom scatter fully retired (user pass, 2026-07): the hand-placed
      // village giants carry the mushroom identity now.

      // (duskbell flowers and starbuds retired in the same pass: the sprig
      // silhouettes read as unfinished next to the modeled flora set)
    }
  }

  // (crystal formations: replaced by generated crystal assets, see decorProps)

  // (willows retired: user pass, 2026-07-14)

  // (blossom trees retired: user pass, 2026-07)

  // --- boulders: natural stone scatter across the valley floor ---
  {
    const STONE_TINTS = [0x9aa0a6, 0x8b9096, 0xa8adb2, 0x7f8489];
    for (let gx = -168; gx <= 168; gx += 10) {
      for (let gz = REALM_ZONE.zMin + 16; gz <= REALM_ZONE.zMax - 20; gz += 10) {
        const r = hash2(gx, gz, seed + 491);
        if (r > 0.06) continue;
        const x = gx + (hash2(gx, gz, seed + 501) - 0.5) * 8;
        const z = gz + (hash2(gx, gz, seed + 511) - 0.5) * 8;
        const y = usable(x, z, 4);
        if (y === null) continue;
        const tint = STONE_TINTS[Math.floor(hash2(gx, gz, seed + 531) * 97) % STONE_TINTS.length];
        out.boulders.push({
          x,
          z,
          y,
          scale: 0.9 + hash2(gx, gz, seed + 521) * 2.2,
          rot: r * Math.PI * 33,
          variant: 0,
          tint,
        });
        // some boulders come in pairs: a smaller companion stone
        if (hash2(gx, gz, seed + 541) < 0.35) {
          const ang = hash2(gx, gz, seed + 551) * Math.PI * 2;
          const bx = x + Math.sin(ang) * 2.2;
          const bz = z + Math.cos(ang) * 2.2;
          const by = usable(bx, bz, 4);
          if (by !== null) {
            out.boulders.push({
              x: bx,
              z: bz,
              y: by,
              scale: 0.6 + hash2(gx, gz, seed + 561) * 0.9,
              rot: ang * 5,
              variant: 0,
              tint,
            });
          }
        }
      }
    }
  }

  // --- the rugged coast: where cliffs meet the open sea, fallen boulders
  // pile half-sunk at the waterline, stacks stand just offshore, and crest
  // teeth break the smooth silhouette. Beaches (gentle gradient) stay clean.
  for (let gx = -176; gx <= 176; gx += 5) {
    for (let gz = 948; gz <= 1436; gz += 5) {
      const x = gx + (hash2(gx, gz, seed + 1601) - 0.5) * 4;
      const z = gz + (hash2(gx, gz, seed + 1611) - 0.5) * 4;
      if (hollowLandness(x, z) > 0.3) continue; // the open-coast ring only
      const h = terrainHeight(x, z, seed);
      if (h > WATER_LEVEL + 1.4 || h < WATER_LEVEL - 2.2) continue; // waterline
      const g = terrainGradient(x, z, seed);
      const mag = Math.hypot(g.gx, g.gz);
      if (mag < 0.5) continue; // cliffy shores only
      const pick = hash2(gx, gz, seed + 1621);
      if (pick > 0.62) continue;
      const dirX = g.gx / mag,
        dirZ = g.gz / mag; // uphill, into the face
      const n = 1 + Math.floor(hash2(gx, gz, seed + 1631) * 2.4);
      for (let k = 0; k < n && out.seaRocks.length < 520; k++) {
        const bx = x + (hash2(gx + k, gz, seed + 1641) - 0.5) * 4.5;
        const bz = z + (hash2(gx, gz + k, seed + 1651) - 0.5) * 4.5;
        const by = terrainHeight(bx, bz, seed);
        if (by > WATER_LEVEL + 1.6) continue;
        const variant = Math.floor(hash2(gx - k, gz + k, seed + 1681) * SEA_ROCK_URLS.length);
        // broad slabs run big, shards stay lean; lift each so its crown
        // clears the surface instead of drowning the whole rock
        const scale =
          variant < 2
            ? 2.2 + hash2(gx + 3 * k, gz, seed + 1661) * 2.6
            : 0.9 + hash2(gx + 3 * k, gz, seed + 1661) * 1.7;
        out.seaRocks.push({
          x: bx,
          z: bz,
          y: Math.max(
            Math.max(by, WATER_LEVEL - 1.3),
            WATER_LEVEL + 0.6 - SEA_ROCK_MODEL_H[variant] * scale,
          ),
          scale,
          rot: hash2(gx, gz + 3 * k, seed + 1671) * Math.PI * 2,
          variant,
          tint: SEA_ROCK_TINTS[
            Math.floor(hash2(gx + k, gz - k, seed + 1691) * SEA_ROCK_TINTS.length)
          ],
          lean: g,
        });
      }
      // an offshore stack with surf at its foot, open sea only
      if (pick < 0.09 && out.seaStacks.length < 44 && hollowLandness(x, z) < 0.08) {
        out.seaStacks.push({
          x: x - dirX * (4 + hash2(gx, gz, seed + 1701) * 6),
          z: z - dirZ * (4 + hash2(gz, gx, seed + 1711) * 6),
          y: WATER_LEVEL - 1.6,
          scale: 2.2 + hash2(gx, gz, seed + 1721) * 2.2,
          rot: hash2(gz, gx, seed + 1731) * Math.PI * 2,
          variant: 2 + Math.floor(hash2(gx + 1, gz, seed + 1741) * 2), // tall shards
          tint: SEA_ROCK_TINTS[Math.floor(hash2(gx, gz + 1, seed + 1746) * SEA_ROCK_TINTS.length)],
        });
      }
      // a crest tooth up the face, breaking the smooth edge line
      if (pick < 0.3 && out.seaRocks.length < 520) {
        let cx = x,
          cz = z,
          cy = h;
        for (let stp = 0; stp < 5 && cy < WATER_LEVEL + 7; stp++) {
          cx += dirX * 3;
          cz += dirZ * 3;
          cy = terrainHeight(cx, cz, seed);
        }
        if (cy > WATER_LEVEL + 4) {
          out.seaRocks.push({
            x: cx,
            z: cz,
            y: cy - 0.4,
            // tall shards only: a 0.5-unit slab vanishes atop a 20yd face
            scale: 1.2 + hash2(gz, gx, seed + 1751) * 1.5,
            rot: hash2(gx * 2, gz, seed + 1761) * Math.PI * 2,
            variant: 2 + Math.floor(hash2(gx, gz * 2, seed + 1771) * 2),
            tint: SEA_ROCK_TINTS[
              Math.floor(hash2(gz, gx * 2, seed + 1781) * SEA_ROCK_TINTS.length)
            ],
            lean: terrainGradient(cx, cz, seed),
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Procedural geometry: crystals, duskbell flowers, willows, blossom trees.
// All low-poly primitives in the game's flat-shaded style.
// ---------------------------------------------------------------------------

function crystalShellGeo(): THREE.BufferGeometry {
  const shard = (
    sx: number,
    sy: number,
    sz: number,
    tilt: number,
    leanY: number,
    ox: number,
    oz: number,
  ): THREE.BufferGeometry => {
    const g = new THREE.OctahedronGeometry(0.5, 0);
    g.applyMatrix4(new THREE.Matrix4().makeScale(sx, sy, sz));
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(tilt));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(leanY));
    // bases sit BELOW the origin so the cluster reads as rooted once the
    // instance origin is sunk into the ground
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(ox, sy * 0.22, oz));
    return g;
  };
  return mergeGeometries([
    shard(0.55, 1.8, 0.55, 0.14, 0.3, 0, 0),
    shard(0.38, 1.1, 0.38, -0.42, 1.9, 0.48, 0.12),
    shard(0.3, 0.75, 0.3, 0.5, 4.1, -0.4, 0.3),
    shard(0.22, 0.5, 0.22, -0.25, 5.2, 0.1, -0.42),
  ]);
}

function crystalCoreGeo(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(0.5, 0);
  g.applyMatrix4(new THREE.Matrix4().makeScale(0.3, 1.15, 0.3));
  g.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.14));
  g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.35, 0));
  return g;
}

// A ring of cupped petals around a bright center: the shape everyone reads
// as "flower" even at four triangles a petal.
function petalHead(
  petals: number,
  petalLen: number,
  petalWide: number,
  cup: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < petals; k++) {
    const ang = (k / petals) * Math.PI * 2;
    const petal = new THREE.ConeGeometry(petalWide, petalLen, 3);
    petal.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 0.35)); // flatten
    petal.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2 - cup)); // lay out, cup up
    petal.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, petalLen * 0.42));
    petal.applyMatrix4(new THREE.Matrix4().makeRotationY(ang));
    parts.push(petal.toNonIndexed());
  }
  const center = new THREE.IcosahedronGeometry(petalWide * 0.75, 0);
  center.applyMatrix4(new THREE.Matrix4().makeScale(1, 0.6, 1));
  parts.push(center);
  return mergeGeometries(parts);
}

function duskbellGeo(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.015, 0.025, 0.42, 4).toNonIndexed();
  stem.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.21, 0));
  const head = petalHead(5, 0.14, 0.05, 0.5);
  head.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.25)); // a gentle nod
  head.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.44, 0));
  const leaf = new THREE.ConeGeometry(0.05, 0.16, 3).toNonIndexed();
  leaf.applyMatrix4(new THREE.Matrix4().makeRotationZ(1.2));
  leaf.applyMatrix4(new THREE.Matrix4().makeTranslation(0.07, 0.12, 0));
  return mergeGeometries([stem, head, leaf]);
}

// Per-face brightness variance: converts to non-indexed and paints one flat
// shade per triangle, the classic low-poly "confetti" detail. amp is the
// +/- brightness range; hueShift nudges the red/blue balance per face for a
// petal-like two-tone.
function perFaceShade(
  src: THREE.BufferGeometry,
  amp: number,
  seed: number,
  hueShift = 0,
): THREE.BufferGeometry {
  const geo = src.toNonIndexed();
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < pos.count; f += 3) {
    const r = hash2(
      Math.round(pos.getX(f) * 53 + pos.getY(f) * 131),
      Math.round(pos.getZ(f) * 71 + pos.getY(f) * 17),
      seed,
    );
    const shade = 1 - amp + r * amp * 2;
    const warm =
      (hash2(Math.round(pos.getY(f) * 97), Math.round(pos.getX(f) * 43), seed + 1) - 0.5) *
      hueShift;
    for (let v = 0; v < 3; v++) {
      colors[(f + v) * 3] = shade + warm;
      colors[(f + v) * 3 + 1] = shade - Math.abs(warm) * 0.4;
      colors[(f + v) * 3 + 2] = shade - warm;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Per-vertex mottling for indexed GLB geometry (mushroom caps): a soft
// weathered blotching that multiplies the painted texture.
function addVertexMottle(
  src: THREE.BufferGeometry,
  amp: number,
  seed: number,
): THREE.BufferGeometry {
  const geo = src.clone();
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n =
      hash2(Math.round(pos.getX(i) * 21), Math.round(pos.getZ(i) * 23 + pos.getY(i) * 9), seed) *
        0.5 +
      hash2(Math.round(pos.getX(i) * 7), Math.round(pos.getY(i) * 11), seed + 5) * 0.5;
    const shade = 1 - amp + n * amp * 2;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade;
    colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function starbudGeo(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.01, 0.016, 0.2, 3).toNonIndexed();
  stem.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.1, 0));
  const head = petalHead(4, 0.07, 0.03, 0.35); // four tiny petals, up-facing
  head.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.21, 0));
  return mergeGeometries([stem, head]);
}

function willowGeo(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 3.2, 6);
  trunk.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.12));
  trunk.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 1.6, 0));
  const parts: THREE.BufferGeometry[] = [];
  const dome = new THREE.SphereGeometry(1.9, 8, 5);
  dome.applyMatrix4(new THREE.Matrix4().makeScale(1.15, 0.62, 1.15));
  dome.applyMatrix4(new THREE.Matrix4().makeTranslation(0.35, 3.5, 0));
  parts.push(dome);
  // hanging strands around the canopy rim: the weeping silhouette
  for (let k = 0; k < 10; k++) {
    const ang = (k / 10) * Math.PI * 2;
    const strand = new THREE.ConeGeometry(0.16, 2.4 + (k % 3) * 0.5, 4);
    strand.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI)); // point down
    strand.applyMatrix4(
      new THREE.Matrix4().makeTranslation(
        0.35 + Math.sin(ang) * 1.75,
        2.5 - (k % 3) * 0.22,
        Math.cos(ang) * 1.75,
      ),
    );
    parts.push(strand);
  }
  return { trunk, canopy: mergeGeometries(parts) };
}

function blossomGeo(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  // a real branch skeleton: a leaning trunk splitting into three boughs, each
  // carrying blossom clusters at its tip, so the silhouette reads TREE
  // (trunk, then branches, then clouds of bloom) instead of blob-on-a-stick
  const wood: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.13, 0.3, 2.4, 5);
  trunk.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.14));
  trunk.applyMatrix4(new THREE.Matrix4().makeTranslation(0.05, 1.2, 0));
  wood.push(trunk);
  const boughSpecs = [
    { yaw: 0.3, lean: 0.75, len: 1.5, tipY: 3.3 },
    { yaw: 2.4, lean: 0.95, len: 1.3, tipY: 3.0 },
    { yaw: 4.5, lean: 0.55, len: 1.2, tipY: 3.4 },
  ];
  const tips: { x: number; y: number; z: number }[] = [];
  for (const bs of boughSpecs) {
    const bough = new THREE.CylinderGeometry(0.05, 0.11, bs.len, 4);
    bough.applyMatrix4(new THREE.Matrix4().makeTranslation(0, bs.len / 2, 0));
    bough.applyMatrix4(new THREE.Matrix4().makeRotationZ(bs.lean));
    bough.applyMatrix4(new THREE.Matrix4().makeRotationY(bs.yaw));
    bough.applyMatrix4(new THREE.Matrix4().makeTranslation(0.05, 2.25, 0));
    wood.push(bough);
    const tx = 0.05 + Math.cos(bs.yaw) * Math.sin(bs.lean) * bs.len;
    const tz = -Math.sin(bs.yaw) * Math.sin(bs.lean) * bs.len;
    tips.push({ x: tx, y: bs.tipY - 0.4, z: tz });
  }
  const trunkAll = mergeGeometries(wood.map((g) => g.toNonIndexed()));
  const puff = (s2: number, x: number, y: number, z: number): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(s2, 0);
    g.applyMatrix4(new THREE.Matrix4().makeScale(1.15, 0.85, 1.15)); // wind-spread
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
    return g;
  };
  const puffs: THREE.BufferGeometry[] = [];
  tips.forEach((tip, i) => {
    puffs.push(puff(0.55 + (i % 2) * 0.1, tip.x, tip.y, tip.z));
    puffs.push(puff(0.4, tip.x * 1.25, tip.y + 0.32, tip.z * 1.25));
    puffs.push(puff(0.3, tip.x * 0.8, tip.y - 0.28, tip.z * 0.8 + 0.15));
  });
  puffs.push(puff(0.45, 0.05, 3.5, 0)); // crown
  const canopy = mergeGeometries(puffs);
  return { trunk: trunkAll, canopy };
}

export interface RealmFloraView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  /**
   * Meshes update(time) moves via their OBJECT transform (foam rings, mist
   * banks). The renderer freezes the whole group after attach, so it must
   * re-enable matrixAutoUpdate on exactly these (the props.flames idiom), or
   * the swell and drift are silently inert. The flock is absent on purpose:
   * it animates through instanceMatrix, which the freeze never touches.
   */
  animated: THREE.Object3D[];
  update(time: number): void;
}

const GLOW_LIGHT_COLOR = 0xdf9fe0;
const WILLOW_LEAF = 0x9fb8a8; // silver-sage, unlike any existing canopy
const WILLOW_BARK = 0x8a7a90;
const BLOSSOM_PINKS = [0xf2b8cc, 0xf8e0ea]; // cherry pink / near-white
const BLOSSOM_BARK = 0x6e5a66;
const FLOWER_TINTS = [
  0xf2a8c8, // rose
  0xe8e0f8, // moon white
  0xa8d8e8, // rainwater blue
  0xd8b8f2, // lilac
  0xf2e0a0, // butter
  0xf2a88f, // coral
  0x9a7fd8, // deep violet
]; // duskbell colorways
const STARBUD_TINTS = [0xf8f0ff, 0xf2d8a8, 0xf2b8c8]; // tiny understory flowers
const SEA_STONE = 0x6f6570; // dusk basalt multiply over the painted rock kit
const SEA_ROCK_TINTS = [0xfff2ea, 0xd8d2dc, 0xb4aab4, 0xe8d8c8]; // weathering
// Approximate unscaled heights of the kit (the large rocks are broad low
// slabs, the tall ones are shards): sizing and surf placement key off these
// so every waterline rock actually breaks the surface.
const SEA_ROCK_MODEL_H = [0.52, 0.52, 3.4, 3.8];

// One-off flora materials that need vertexColors: built directly (surfaceMat
// caches and shares by key, so flipping vertexColors on a cached material
// would leak into unrelated users).
function floraMat(opts: {
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  vertexColors?: boolean;
}): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color: opts.color,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 1,
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0,
        flatShading: opts.flatShading ?? false,
        vertexColors: opts.vertexColors ?? false,
      })
    : new THREE.MeshLambertMaterial({
        color: opts.color,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 1,
        flatShading: opts.flatShading ?? false,
        vertexColors: opts.vertexColors ?? false,
      });
}

export function buildRealmFlora(seed: number): RealmFloraView {
  const group = new THREE.Group();
  group.name = 'realm-flora';
  const glowLights: THREE.PointLight[] = [];
  const spots = placeFlora(seed);
  const pulsing: { mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial; base: number }[] =
    [];

  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const leanAxis = new THREE.Vector3();

  const instance = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    list: Spot[],
    opts: { sink?: number; castShadow?: boolean; tinted?: boolean; leanInto?: boolean } = {},
  ): THREE.InstancedMesh | null => {
    if (list.length === 0) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((spot, i) => {
      q.setFromAxisAngle(up, spot.rot);
      if (opts.leanInto && spot.lean) {
        // lean the growth axis against the slope so it juts from the face
        const g = spot.lean;
        const mag = Math.hypot(g.gx, g.gz);
        if (mag > 0.15) {
          leanAxis.set(g.gz, 0, -g.gx).normalize(); // perpendicular to gradient
          qLean.setFromAxisAngle(leanAxis, Math.min(0.9, mag * 0.55));
          q.premultiply(qLean);
        }
      }
      const sink = (opts.sink ?? 0) * spot.scale;
      v.set(spot.x, spot.y - sink, spot.z);
      s.set(spot.scale, spot.scale, spot.scale);
      mesh.setMatrixAt(i, m.compose(v, q, s));
      if (opts.tinted) mesh.setColorAt(i, new THREE.Color(spot.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = opts.castShadow ?? false;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };

  // --- mushrooms: painted GLB materials + a soft emissive lift, per-area
  // instance tints, and giants casting real shadows for depth ---
  for (const variant of [0, 1]) {
    const parts = loadedParts.get(MUSHROOM_URLS[variant]);
    if (!parts) continue;
    const list = spots.mushrooms.filter((sp) => sp.variant === variant);
    for (const part of parts) {
      const mat = part.material.clone() as THREE.MeshStandardMaterial;
      if ('emissive' in mat) {
        mat.emissive = new THREE.Color(variant === 0 ? 0xff8fca : 0x8fe8d8);
        mat.emissiveIntensity = GFX.composer ? 0.28 : 0.18;
      }
      // weathered mottling multiplies the painted texture
      mat.vertexColors = true;
      pulsing.push({ mat, base: (mat as THREE.MeshStandardMaterial).emissiveIntensity ?? 0 });
      instance(addVertexMottle(part.geometry, 0.13, seed + 601), mat, list, {
        castShadow: true,
        tinted: true,
      });
    }
  }

  // giant caps get a dark radial gill skirt under the cap: the depth cue that
  // sells scale up close (small mushrooms skip it, it would just be noise)
  {
    const giants = spots.mushrooms.filter((sp) => sp.scale >= 3.2);
    if (giants.length > 0) {
      const anyParts = loadedParts.get(MUSHROOM_URLS[0]);
      const bbox = new THREE.Box3();
      if (anyParts)
        for (const part of anyParts)
          bbox.union(
            new THREE.Box3().setFromBufferAttribute(
              part.geometry.getAttribute('position') as THREE.BufferAttribute,
            ),
          );
      const capY = bbox.max.y * 0.55;
      const capR = Math.max(bbox.max.x, -bbox.min.x) * 0.62;
      const gillGeo = perFaceShade(
        new THREE.CylinderGeometry(
          capR,
          capR * 0.35,
          bbox.max.y * 0.14,
          12,
          1,
          true,
        ).toNonIndexed(),
        0.3,
        seed + 641,
      );
      gillGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, capY, 0));
      const gillMat = floraMat({
        color: 0x5e4a66,
        roughness: 0.9,
        flatShading: true,
        vertexColors: true,
      });
      (gillMat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      instance(gillGeo, gillMat, giants, { tinted: true });
    }
  }

  // --- crystals: dim faceted shell for depth, bright core for the glow,
  // both rooted into the ground and leaned with the slope ---
  const shellGeo = perFaceShade(crystalShellGeo(), 0.28, seed + 611);
  const coreGeo = crystalCoreGeo();
  const shellMat = floraMat({
    color: 0x8a76a8,
    emissive: 0x7a5fa0,
    emissiveIntensity: GFX.composer ? 0.3 : 0.2,
    roughness: 0.16,
    metalness: 0.18, // env glints off the facets
    flatShading: true,
    vertexColors: true, // per-face depth variance
  }) as THREE.MeshStandardMaterial;
  const coreMat = surfaceMat({
    color: 0xd8c8f2,
    emissive: 0xc9a8f2,
    emissiveIntensity: GFX.composer ? 1.1 : 0.7,
    roughness: 0.3,
    flatShading: true,
  }) as THREE.MeshStandardMaterial;
  pulsing.push({ mat: shellMat, base: shellMat.emissiveIntensity });
  pulsing.push({ mat: coreMat, base: coreMat.emissiveIntensity });
  instance(shellGeo, shellMat, spots.crystals, {
    sink: 0.3,
    castShadow: true,
    tinted: true,
    leanInto: true,
  });
  instance(coreGeo, coreMat, spots.crystals, { sink: 0.28, tinted: true, leanInto: true });

  // --- duskbell flowers, four colorways ---
  const flowerGeo = duskbellGeo();
  for (let colorway = 0; colorway < FLOWER_TINTS.length; colorway++) {
    const mat = surfaceMat({
      color: FLOWER_TINTS[colorway],
      emissive: FLOWER_TINTS[colorway],
      emissiveIntensity: GFX.composer ? 0.16 : 0.1,
      roughness: 0.8,
    }) as THREE.MeshStandardMaterial;
    instance(
      flowerGeo,
      mat,
      spots.flowers.filter((sp) => sp.variant === colorway),
    );
  }
  const budGeo = starbudGeo();
  for (let colorway = 0; colorway < STARBUD_TINTS.length; colorway++) {
    instance(
      budGeo,
      surfaceMat({ color: STARBUD_TINTS[colorway], roughness: 0.85 }),
      spots.starbuds.filter((sp) => sp.variant === colorway),
    );
  }

  // --- weeping willows on the lakeshores ---
  const willow = willowGeo();
  instance(willow.trunk, surfaceMat({ color: WILLOW_BARK, roughness: 0.9 }), spots.willows, {
    castShadow: true,
  });
  instance(
    perFaceShade(willow.canopy, 0.12, seed + 621),
    floraMat({ color: WILLOW_LEAF, roughness: 0.85, flatShading: true, vertexColors: true }),
    spots.willows,
    { castShadow: true },
  );

  // --- blossom trees, two pinks ---
  const blossom = blossomGeo();
  instance(blossom.trunk, surfaceMat({ color: BLOSSOM_BARK, roughness: 0.9 }), spots.blossoms, {
    castShadow: true,
  });
  const blossomShaded = perFaceShade(blossom.canopy, 0.15, seed + 631, 0.12);
  for (const variant of [0, 1]) {
    instance(
      blossomShaded,
      floraMat({
        color: BLOSSOM_PINKS[variant],
        roughness: 0.8,
        flatShading: true,
        vertexColors: true,
      }),
      spots.blossoms.filter((sp) => sp.variant === variant),
      { castShadow: true },
    );
  }

  // --- boulders (bundled rock, natural stone; per-spot grey tints) ---
  const boulderParts = loadedParts.get(BOULDER_URL);
  if (boulderParts) {
    for (const part of boulderParts) {
      const mat = part.material.clone() as THREE.MeshStandardMaterial;
      // the kit rock ships beige-dirt sides and a teal grass cap; regrade to
      // granite + dull moss so it reads as real stone (the minerock treatment)
      if ('color' in mat) {
        const nm = (part.material.name || '').toLowerCase();
        mat.color.set(nm.includes('grass') ? 0x6f7a76 : 0x8a8e93);
      }
      instance(part.geometry, mat, spots.boulders, { sink: 0.12, castShadow: true });
    }
  }

  // --- the rugged coast: dark weathered rocks at the cliff bases, offshore
  // stacks, and a foam ring of breaking surf at each stack's foot ---
  const seaFoam: { mesh: THREE.Mesh; phase: number }[] = [];
  {
    for (let variant = 0; variant < SEA_ROCK_URLS.length; variant++) {
      const parts = loadedParts.get(SEA_ROCK_URLS[variant]);
      if (!parts) continue;
      const rocks = spots.seaRocks.filter((sp) => sp.variant === variant);
      const stacks = spots.seaStacks.filter((sp) => sp.variant === variant);
      for (const part of parts) {
        const mat = part.material.clone() as THREE.MeshStandardMaterial;
        if ('color' in mat) mat.color.multiply(new THREE.Color(SEA_STONE));
        if ('roughness' in mat) mat.roughness = 0.95;
        instance(part.geometry, mat, rocks, {
          sink: 0.18,
          castShadow: true,
          tinted: true,
          leanInto: true,
        });
        instance(part.geometry, mat, stacks, { castShadow: true, tinted: true });
      }
    }
    const surf: Spot[] = [
      ...spots.seaStacks,
      ...spots.seaRocks
        .filter(
          (sp) =>
            sp.y < WATER_LEVEL + 0.2 &&
            sp.y + SEA_ROCK_MODEL_H[sp.variant] * sp.scale > WATER_LEVEL + 0.5 &&
            sp.scale > 2.6 &&
            hollowLandness(sp.x, sp.z) < 0.08,
        )
        .slice(0, 30),
    ];
    if (surf.length > 0) {
      const foamMat = new THREE.MeshBasicMaterial({
        color: 0xeef6f8,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      for (const st of surf) {
        const foam = new THREE.Mesh(new THREE.CircleGeometry(st.scale * 1.05, 12), foamMat);
        foam.rotation.x = -Math.PI / 2;
        foam.position.set(st.x, WATER_LEVEL + 0.1, st.z);
        seaFoam.push({ mesh: foam, phase: st.x * 0.7 + st.z * 0.31 });
        group.add(foam);
      }
    }
  }

  // The Starfall falls: the terrace lip shaped in world.ts pours into the
  // basin. A scrolling canvas-streak sheet reads as falling water in the
  // game's low-poly style; two foam discs churn at the base; a translucent
  // pool caps the terrace behind the lip. All render-only.
  // (the waterfall visual is retired: the flat streak sheet read as glitch
  // bars under the dusk grade and poured straight at the new shrine; a real
  // animated falls can return as a water.ts feature)

  // The ocean's atmosphere: low mist banks over the far water, soft light
  // rays leaning from the sky, and a distant flock tracing slow circles.
  // All render-only sprites and primitives; they gently veil what lies
  // beyond the sea without walling it off.
  const seaDrift: { mesh: THREE.Mesh; baseX: number; speed: number }[] = [];
  const seaRays: { mat: THREE.MeshBasicMaterial; base: number; phase: number }[] = [];
  let flock: THREE.InstancedMesh | null = null;
  const FLOCK_SIZE = 11;
  const FLOCK_CENTER = { x: -30, z: 1330, y: 24, r: 55 };
  if (typeof document !== 'undefined') {
    // mist banks: wide soft-alpha gradient planes riding just over the water
    const mistCanvas = document.createElement('canvas');
    mistCanvas.width = 128;
    mistCanvas.height = 32;
    const mctx = mistCanvas.getContext('2d');
    if (mctx) {
      const grad = mctx.createLinearGradient(0, 32, 0, 0);
      grad.addColorStop(0, 'rgba(255,240,248,0)');
      grad.addColorStop(0.45, 'rgba(255,240,248,0.55)');
      grad.addColorStop(1, 'rgba(255,240,248,0)');
      mctx.fillStyle = grad;
      mctx.fillRect(0, 0, 128, 32);
      // soften the ends so banks read as drifting patches, not strips
      const side = mctx.createLinearGradient(0, 0, 128, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)');
      side.addColorStop(0.2, 'rgba(0,0,0,0)');
      side.addColorStop(0.8, 'rgba(0,0,0,0)');
      side.addColorStop(1, 'rgba(0,0,0,1)');
      mctx.globalCompositeOperation = 'destination-out';
      mctx.fillStyle = side;
      mctx.fillRect(0, 0, 128, 32);
      const mistTex = new THREE.CanvasTexture(mistCanvas);
      // Placements live in sea_mist_core.ts, where a guard test holds every
      // bank (drift included) over open water: a bank that crosses land cuts a
      // hard pale line across the terrain at its z.
      for (const { x: mx, z: mz, width: w, height: hgt, opacity: op } of SEA_MIST_BANKS) {
        const mist = new THREE.Mesh(
          new THREE.PlaneGeometry(w, hgt),
          new THREE.MeshBasicMaterial({
            map: mistTex,
            transparent: true,
            opacity: op,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        mist.position.set(mx, WATER_LEVEL + hgt * 0.35, mz);
        seaDrift.push({ mesh: mist, baseX: mx, speed: 0.4 + (Math.abs(mx) % 7) * 0.09 });
        group.add(mist);
      }
      // light rays: tall additive streaks leaning sunward over the water
      const rayCanvas = document.createElement('canvas');
      rayCanvas.width = 32;
      rayCanvas.height = 128;
      const rctx = rayCanvas.getContext('2d');
      if (rctx) {
        const rg = rctx.createLinearGradient(0, 0, 32, 0);
        rg.addColorStop(0, 'rgba(255,220,235,0)');
        rg.addColorStop(0.5, 'rgba(255,228,240,0.8)');
        rg.addColorStop(1, 'rgba(255,220,235,0)');
        rctx.fillStyle = rg;
        rctx.fillRect(0, 0, 32, 128);
        const fade = rctx.createLinearGradient(0, 0, 0, 128);
        fade.addColorStop(0, 'rgba(0,0,0,0)');
        fade.addColorStop(0.75, 'rgba(0,0,0,0)');
        fade.addColorStop(1, 'rgba(0,0,0,1)');
        rctx.globalCompositeOperation = 'destination-out';
        rctx.fillStyle = fade;
        rctx.fillRect(0, 0, 32, 128);
        const rayTex = new THREE.CanvasTexture(rayCanvas);
        for (const { x: rx, z: rz, height: hgt, opacity: op, phase } of SEA_LIGHT_RAYS) {
          const mat = new THREE.MeshBasicMaterial({
            map: rayTex,
            transparent: true,
            opacity: op,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          });
          const ray = new THREE.Mesh(new THREE.PlaneGeometry(9, hgt), mat);
          ray.position.set(rx, WATER_LEVEL + hgt * 0.42, rz);
          ray.rotation.z = 0.24; // leaning with the anchored sun
          seaRays.push({ mat, base: op, phase });
          group.add(ray);
        }
      }
      // the horizon cloud bank: big painterly cumulus stacked low over the
      // the distant flock: simple chevron birds circling over the sound
      const wing = new THREE.BufferGeometry();
      wing.setAttribute(
        'position',
        new THREE.BufferAttribute(
          new Float32Array([
            -0.9, 0, 0, 0, 0.16, 0.22, 0, 0, 0.1, 0.9, 0, 0, 0, 0.16, 0.22, 0, 0, 0.1,
          ]),
          3,
        ),
      );
      wing.computeVertexNormals();
      flock = new THREE.InstancedMesh(
        wing,
        new THREE.MeshBasicMaterial({ color: 0x4a3f55, side: THREE.DoubleSide }),
        FLOCK_SIZE,
      );
      // Seed every instance on its time-zero orbit BEFORE the first update():
      // fresh instance matrices are all-zero, which parks the bounding volume
      // at the world origin and stretched the group's cull footprint by ~900u
      // (374x1442 measured), keeping the whole realm's flora drawn from
      // anywhere in the west column. The seed covers only the starting arc,
      // not the full orbit the birds trace, so frustum culling is off for
      // these 11 instances rather than trusting a sphere they leave.
      flock.frustumCulled = false;
      {
        const sm = new THREE.Matrix4();
        const sq = new THREE.Quaternion();
        const sup = new THREE.Vector3(0, 1, 0);
        const sv = new THREE.Vector3();
        const ssc = new THREE.Vector3(1.4, 1, 1.4);
        for (let i = 0; i < FLOCK_SIZE; i++) {
          const ang = -i * 0.18;
          sv.set(
            FLOCK_CENTER.x + Math.sin(ang) * (FLOCK_CENTER.r + (i % 3) * 4),
            FLOCK_CENTER.y,
            FLOCK_CENTER.z + Math.cos(ang) * (FLOCK_CENTER.r + (i % 3) * 4),
          );
          sq.setFromAxisAngle(sup, ang + Math.PI / 2);
          flock.setMatrixAt(i, sm.compose(sv, sq, ssc));
        }
        flock.instanceMatrix.needsUpdate = true;
      }
      group.add(flock);
    }
  }

  // The great tree of Eldergleam, rising over the town square. Position and
  // trunk radius come from REALM_PROPS.greatTrees: the same record the sim's
  // collision grid consumes, so the visual and the collider never drift.
  const treeSpot = REALM_PROPS.greatTrees?.[0];
  if (greatTreeScene && treeSpot) {
    const tree = greatTreeScene.clone(true);
    const tx = treeSpot.x,
      tz = treeSpot.z;
    tree.position.set(tx, terrainHeight(tx, tz, seed) - 0.2, tz);
    tree.scale.setScalar(6.5);
    tree.rotation.y = 0.8;
    tree.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    group.add(tree);
    const canopyLight = new THREE.PointLight(GLOW_LIGHT_COLOR, 9, 20, 2);
    canopyLight.position.set(tx, terrainHeight(tx, tz, seed) + 7, tz);
    canopyLight.userData.baseIntensity = 9;
    glowLights.push(canopyLight);
    group.add(canopyLight);
  }

  // Glow lights at the largest features (deterministic pick: the biggest
  // scales are the giants). They join the renderer's fireLights budget.
  const lit = [...spots.mushrooms, ...spots.crystals].sort((a, b) => b.scale - a.scale);
  for (const spot of lit.slice(0, GLOW_LIGHT_COUNT)) {
    const light = new THREE.PointLight(GLOW_LIGHT_COLOR, 6, 15, 2);
    light.position.set(spot.x, spot.y + 1.2 + spot.scale * 0.5, spot.z);
    light.userData.baseIntensity = 6;
    glowLights.push(light);
    group.add(light);
  }

  return {
    group,
    glowLights,
    animated: [...seaFoam.map((f) => f.mesh), ...seaDrift.map((b) => b.mesh)],
    update(time: number): void {
      // one gentle shared breath across the glowing materials
      const breathe = 1 + Math.sin(time * 0.9) * 0.16;
      for (const entry of pulsing) entry.mat.emissiveIntensity = entry.base * breathe;
      // the surf rings around stacks and shore rocks swell and relax
      for (const f of seaFoam) {
        f.mesh.scale.setScalar(1 + Math.sin(time * 1.4 + f.phase) * 0.12);
      }
      // mist banks drift, rays breathe, the flock wheels over the sound
      for (const bank of seaDrift) {
        bank.mesh.position.x =
          bank.baseX + Math.sin(time * 0.05 * bank.speed) * MIST_DRIFT_AMPLITUDE;
      }
      for (const ray of seaRays) {
        ray.mat.opacity = ray.base * (0.7 + 0.3 * Math.sin(time * 0.4 + ray.phase));
      }
      if (flock) {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const v = new THREE.Vector3();
        const sc = new THREE.Vector3();
        for (let i = 0; i < FLOCK_SIZE; i++) {
          const lag = i * 0.18;
          const ang = time * 0.09 - lag;
          const wob = Math.sin(time * 1.1 + i * 2.3);
          v.set(
            FLOCK_CENTER.x + Math.sin(ang) * (FLOCK_CENTER.r + (i % 3) * 4),
            FLOCK_CENTER.y + Math.sin(time * 0.5 + i) * 2.2,
            FLOCK_CENTER.z + Math.cos(ang) * (FLOCK_CENTER.r + (i % 3) * 4),
          );
          q.setFromAxisAngle(up, ang + Math.PI / 2);
          sc.set(1.4, 1 + wob * 0.5, 1.4); // the wing flap
          flock.setMatrixAt(i, m.compose(v, q, sc));
        }
        flock.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
