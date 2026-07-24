// Last Bell story interiors (DungeonDef interior 'farshore_story'): nine
// private story spaces stamped onto the shared dungeon instance pool. One
// area config drives everything: src/sim/last_bell_field.ts owns bounds,
// walls, props, terrain, and mood, and this module renders exactly that
// contract so visuals, sim ground, and collision cannot drift:
//   - the ground mesh displaces with the SAME height the sim stands on (a
//     MIRROR area re-samples the island's own terrainHeight at its source
//     anchor + local offset; an AUTHORED area calls the def's height fn off
//     the flat instance plane, DUNGEON_FLOOR_Y = 0)
//   - prop silhouettes are built to each placement's collider r/h, so what
//     you see is what you collide with
//   - perimeter walls render as natural edges (boulder ridges) for the open
//     story spaces, and as timber/stone walls for the two enclosed interiors
//     (lb_tidemill, lb_vault)
// All coordinates are instance-local; the caller positions the returned
// group at the claimed slot's origin, like the other interior builders in
// dungeon.ts (the orkadia/wildheart open-field pattern).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  LAST_BELL_AREAS,
  type StoryAreaDef,
  type StoryAreaProp,
  type StoryAreaWall,
} from '../sim/last_bell_field';
import { terrainHeight } from '../sim/world';
import { GFX, surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { radialGlowTexture } from './textures';

export type LastBellMood = StoryAreaDef['mood'];

/** The area's mood for a story dungeon id (the renderer's ambience swap keys
 * fog + light rig off it); null when the id is not a Last Bell story space. */
export function lastBellMood(dungeonId: string): LastBellMood | null {
  return LAST_BELL_AREAS[dungeonId]?.mood ?? null;
}

// Scene-level fog + light-rig grade per mood, applied by the renderer's
// ambience swap (the same seam the orkadia/wildheart field grades use; the
// builder below only adds local fill so the grade stays in one place).
export interface LastBellAmbience {
  fog: { color: number; near: number; far: number };
  sun: number;
  hemi: number;
  env: number;
  rim: number;
  sunColor: number;
  hemiSky: number;
  hemiGround: number;
}

export const LAST_BELL_MOOD_AMBIENCE: Record<LastBellMood, LastBellAmbience> = {
  // Ordinary Farshore daylight over the private Riftfields copy.
  day: {
    fog: { color: 0xc7d6bc, near: 110, far: 450 },
    sun: 2.1,
    hemi: 0.46,
    env: 0.4,
    rim: 1.1,
    sunColor: 0xffedd0,
    hemiSky: 0xdcefff,
    hemiGround: 0x465f39,
  },
  // Amber last-light: the mill at Q0, the council headland at Q4.
  dusk: {
    fog: { color: 0xc09468, near: 70, far: 330 },
    sun: 1.15,
    hemi: 0.48,
    env: 0.22,
    rim: 1.5,
    sunColor: 0xffb072,
    hemiSky: 0xffd2a0,
    hemiGround: 0x4d4038,
  },
  // Cold blue night walks: the rift-line, the Landing, The Last Watch.
  night: {
    fog: { color: 0x1c2438, near: 60, far: 300 },
    sun: 0.55,
    hemi: 0.3,
    env: 0.12,
    rim: 1.8,
    sunColor: 0x9fb2e0,
    hemiSky: 0x8b9cd0,
    hemiGround: 0x232b44,
  },
  // The drowned redoubt: near-dark, the cool point lights carry the descent.
  vault: {
    fog: { color: 0x060a0e, near: 12, far: 72 },
    sun: 0.28,
    hemi: 0.2,
    env: 0.05,
    rim: 2.4,
    sunColor: 0x9fb2e0,
    hemiSky: 0x24344a,
    hemiGround: 0x0a0e14,
  },
  // Inside the breach: wrong-colored dreamlight, teal over violet.
  dream: {
    fog: { color: 0x3a2a55, near: 55, far: 260 },
    sun: 0.9,
    hemi: 0.55,
    env: 0.2,
    rim: 2.0,
    sunColor: 0xb08cff,
    hemiSky: 0x7de8d8,
    hemiGround: 0x4a2a66,
  },
};

// Ground / rock / sky palette per mood: the ground tint lives in vertex
// colors (one shared vertex-color material, orkadia_terrain's pattern).
interface MoodPalette {
  groundHigh: number;
  groundLow: number;
  wallRock: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun?: { color: number; intensity: number };
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  stars: boolean;
}

const MOOD_PALETTE: Record<LastBellMood, MoodPalette> = {
  day: {
    groundHigh: 0x6f8a4c,
    groundLow: 0x54703e,
    wallRock: 0x8b8474,
    hemiSky: 0xdcefff,
    hemiGround: 0x465f39,
    hemiIntensity: 0.55,
    sun: { color: 0xffedd0, intensity: 0.8 },
    skyTop: 0x5f9ad4,
    skyMid: 0x9cc3e8,
    skyHorizon: 0xdfeaf0,
    stars: false,
  },
  dusk: {
    groundHigh: 0x7a6a4a,
    groundLow: 0x5c4c38,
    wallRock: 0x7c6a55,
    hemiSky: 0xffd2a0,
    hemiGround: 0x4d4038,
    hemiIntensity: 0.5,
    sun: { color: 0xffb072, intensity: 0.7 },
    skyTop: 0x35355c,
    skyMid: 0xb06a48,
    skyHorizon: 0xe8a86a,
    stars: false,
  },
  night: {
    groundHigh: 0x36444a,
    groundLow: 0x27313a,
    wallRock: 0x46505c,
    hemiSky: 0x8b9cd0,
    hemiGround: 0x232b44,
    hemiIntensity: 0.42,
    sun: { color: 0x9fb2e0, intensity: 0.35 },
    skyTop: 0x0c1424,
    skyMid: 0x18233c,
    skyHorizon: 0x2b3a55,
    stars: true,
  },
  vault: {
    groundHigh: 0x3a3f46,
    groundLow: 0x272b31,
    wallRock: 0x4a4f58,
    hemiSky: 0x24344a,
    hemiGround: 0x0a0e14,
    hemiIntensity: 0.35,
    skyTop: 0x04060a,
    skyMid: 0x080c12,
    skyHorizon: 0x0d141c,
    stars: false,
  },
  dream: {
    groundHigh: 0x463a5e,
    groundLow: 0x2f2544,
    wallRock: 0x554374,
    hemiSky: 0x7de8d8,
    hemiGround: 0x4a2a66,
    hemiIntensity: 0.6,
    sun: { color: 0xb08cff, intensity: 0.45 },
    skyTop: 0x180f2e,
    skyMid: 0x3c2a5c,
    skyHorizon: 0x2f6a66,
    stars: true,
  },
};

// Accent colors: the Bellheart's cold glow in the split bell / vault lights,
// the dream heart's teal, ward-anchor star-glass.
const VAULT_LIGHT = 0x7fb8d8;
const HEART_GLOW = 0x66e8d8;
const WARD_GLOW = 0x9fe8e0;

function hash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function shadow(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Instance-local ground height, the sim contract restated: mirror areas
// re-sample the island's own terrainHeight (this is why the builder needs
// the world seed), authored areas displace the flat plane (floor y 0).
function areaHeightFn(area: StoryAreaDef, seed: number): (lx: number, lz: number) => number {
  const mirror = area.mirror;
  if (mirror) return (lx, lz) => terrainHeight(mirror.srcX + lx, mirror.srcZ + lz, seed);
  const authored = area.height;
  if (authored) return (lx, lz) => authored(lx, lz);
  return () => 0;
}

function colorGeometry(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const count = geometry.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const shade = 0.82 + hash(i, color) * 0.22;
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

let vertexMat: THREE.Material | null = null;

function vertexMaterial(): THREE.Material {
  if (vertexMat) return vertexMat;
  vertexMat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.02,
        flatShading: true,
      })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  markSharedMaterial(vertexMat);
  return vertexMat;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

// Displaced-plane geometry cached per area (24 slot copies of one story
// space share it); keyed with the seed so a reseeded world never reuses a
// stale mirror displacement.
const groundGeos = new Map<string, THREE.BufferGeometry>();

// The mesh runs a margin past the playable bounds so the perimeter ridge
// never sits on a cliff of nothing.
const GROUND_MARGIN = 14;
const GROUND_STEP = 1.6; // yd per vertex, the exemplar fields' resolution

function buildGround(
  area: StoryAreaDef,
  heightAt: (lx: number, lz: number) => number,
  palette: MoodPalette,
  seed: number,
): THREE.Mesh {
  const key = `${area.dungeonId}:${seed}`;
  let geo = groundGeos.get(key);
  if (!geo) {
    const b = area.bounds;
    const width = b.maxX - b.minX + GROUND_MARGIN * 2;
    const depth = b.maxZ - b.minZ + GROUND_MARGIN * 2;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const segX = Math.max(16, Math.round(width / GROUND_STEP));
    const segZ = Math.max(16, Math.round(depth / GROUND_STEP));
    geo = new THREE.PlaneGeometry(width, depth, segX, segZ).rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);
    const positions = geo.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const high = new THREE.Color(palette.groundHigh);
    const low = new THREE.Color(palette.groundLow);
    const color = new THREE.Color();
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < positions.count; i++) {
      const y = heightAt(positions.getX(i), positions.getZ(i));
      positions.setY(i, y);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(1e-3, maxY - minY);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      // Blend toward the low tint downhill plus a coarse patch hash, so the
      // meadow / stone reads mottled instead of one flat fill.
      const depthT = 1 - (positions.getY(i) - minY) / span;
      const patch = hash(Math.floor(x / 7), Math.floor(z / 7)) * 0.45;
      color.copy(high).lerp(low, Math.min(1, depthT * 0.55 + patch));
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    markSharedGeometry(geo);
    groundGeos.set(key, geo);
  }
  const ground = new THREE.Mesh(geo, vertexMaterial());
  ground.receiveShadow = true;
  return ground;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

// The two enclosed interiors read as built rooms; every other story space is
// open air whose bounds read as natural rock edges.
const BUILT_WALL_STYLE: Record<string, { color: number; height: number }> = {
  lb_tidemill: { color: 0x6b5237, height: 5 }, // timber mill walls
  lb_vault: { color: 0x4a4f58, height: 8 }, // drowned redoubt stone
};

const wallGeos = new Map<string, THREE.BufferGeometry>();

// Built walls: each wall rect is split into short segments seated on the
// local ground so the vault's shelf drops never leave a floating slab.
function builtWallGeometry(
  walls: readonly StoryAreaWall[],
  heightAt: (lx: number, lz: number) => number,
  style: { color: number; height: number },
): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  for (const w of walls) {
    const alongX = w.hw >= w.hd;
    const length = (alongX ? w.hw : w.hd) * 2;
    const segments = Math.max(1, Math.ceil(length / 8));
    const segLen = length / segments;
    for (let i = 0; i < segments; i++) {
      const t = -length / 2 + segLen * (i + 0.5);
      const x = alongX ? w.x + t : w.x;
      const z = alongX ? w.z : w.z + t;
      const groundY = heightAt(x, z);
      const box = alongX
        ? new THREE.BoxGeometry(segLen + 0.05, style.height, w.hd * 2)
        : new THREE.BoxGeometry(w.hw * 2, style.height, segLen + 0.05);
      // Sunk half a yard so stepped terrain never shows a gap at the base.
      box.translate(x, groundY + style.height / 2 - 0.5, z);
      pieces.push(colorGeometry(box, style.color));
    }
  }
  const merged = mergeGeometries(pieces, false);
  if (!merged) throw new Error('Last Bell wall geometry merge failed');
  return merged;
}

// Natural edges: a ridge of flattened boulders along each wall rect, seated
// on the local ground, so the playable bound reads as terrain, not masonry.
function ridgeWallGeometry(
  walls: readonly StoryAreaWall[],
  heightAt: (lx: number, lz: number) => number,
  rockColor: number,
): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  let n = 0;
  for (const w of walls) {
    const alongX = w.hw >= w.hd;
    const length = (alongX ? w.hw : w.hd) * 2;
    const count = Math.max(2, Math.ceil(length / 4.5));
    for (let i = 0; i < count; i++) {
      n++;
      const t = -length / 2 + (length * (i + 0.5)) / count;
      const jitterAcross = (hash(n, 3) - 0.5) * 1.6;
      const x = alongX ? w.x + t : w.x + jitterAcross;
      const z = alongX ? w.z + jitterAcross : w.z + t;
      const r = 1.7 + hash(n, 5) * 1.6;
      const rock = new THREE.DodecahedronGeometry(r, 0);
      rock.scale(1, 0.62 + hash(n, 7) * 0.25, 1);
      rock.rotateY(hash(n, 9) * Math.PI);
      rock.translate(x, heightAt(x, z) + r * 0.28, z);
      pieces.push(colorGeometry(rock, rockColor));
    }
  }
  const merged = mergeGeometries(pieces, false);
  if (!merged) throw new Error('Last Bell ridge geometry merge failed');
  return merged;
}

function buildWalls(
  area: StoryAreaDef,
  heightAt: (lx: number, lz: number) => number,
  palette: MoodPalette,
  seed: number,
): THREE.Mesh {
  const key = `${area.dungeonId}:${seed}`;
  let geo = wallGeos.get(key);
  if (!geo) {
    const built = BUILT_WALL_STYLE[area.dungeonId];
    geo = built
      ? builtWallGeometry(area.walls, heightAt, built)
      : ridgeWallGeometry(area.walls, heightAt, palette.wallRock);
    markSharedGeometry(geo);
    wallGeos.set(key, geo);
  }
  const mesh = new THREE.Mesh(geo, vertexMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------

// The renderer hides the overworld sky dome inside instance bands, so each
// story space carries its own mood-graded dome (the orkadia storm-dome
// trick), cached per mood and shared by every copy.
const skyTextures = new Map<LastBellMood, THREE.CanvasTexture>();
const skyMats = new Map<LastBellMood, THREE.MeshBasicMaterial>();
let skyGeo: THREE.BufferGeometry | null = null;

function moodSkyTexture(mood: LastBellMood): THREE.CanvasTexture {
  const cached = skyTextures.get(mood);
  if (cached) return cached;
  const palette = MOOD_PALETTE[mood];
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Last Bell sky texture canvas unavailable');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, `#${palette.skyTop.toString(16).padStart(6, '0')}`);
  gradient.addColorStop(0.55, `#${palette.skyMid.toString(16).padStart(6, '0')}`);
  gradient.addColorStop(0.82, `#${palette.skyHorizon.toString(16).padStart(6, '0')}`);
  gradient.addColorStop(1, `#${palette.skyMid.toString(16).padStart(6, '0')}`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 256);
  if (palette.stars) {
    for (let i = 0; i < 240; i++) {
      const x = hash(i, 41) * 512;
      const y = hash(i, 42) * 120;
      const a = 0.25 + hash(i, 43) * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      const r = hash(i, 44) < 0.9 ? 1 : 2;
      ctx.fillRect(x, y, r, r);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  skyTextures.set(mood, tex);
  return tex;
}

function buildSkyDome(area: StoryAreaDef, mood: LastBellMood): THREE.Mesh {
  if (!skyGeo) {
    skyGeo = new THREE.SphereGeometry(320, 28, 14);
    markSharedGeometry(skyGeo);
  }
  let mat = skyMats.get(mood);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      map: moodSkyTexture(mood),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    markSharedMaterial(mat);
    skyMats.set(mood, mat);
  }
  const dome = new THREE.Mesh(skyGeo, mat);
  const b = area.bounds;
  dome.position.set((b.minX + b.maxX) / 2, 20, (b.minZ + b.maxZ) / 2);
  dome.renderOrder = -10;
  return dome;
}

// ---------------------------------------------------------------------------
// Props (procedural primitives, sized to each placement's collider r/h)
// ---------------------------------------------------------------------------

function millStone(r: number, h: number): THREE.Group {
  const group = new THREE.Group();
  const stone = surfaceMat({ color: 0x8f887a, roughness: 0.95, flatShading: true });
  const dark = surfaceMat({ color: 0x2e2a24, roughness: 1 });
  const wheel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), stone));
  wheel.position.y = h / 2;
  group.add(wheel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, h * 1.04, 10), dark);
  hub.position.y = h / 2;
  group.add(hub);
  return group;
}

function millPost(r: number, h: number): THREE.Group {
  const group = new THREE.Group();
  const wood = surfaceMat({ color: 0x6b5237, roughness: 0.94 });
  const darkWood = surfaceMat({ color: 0x54412c, roughness: 0.94 });
  const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.75, h, 8), wood));
  post.position.y = h / 2;
  group.add(post);
  const cap = shadow(new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, 0.3, r * 2.2), darkWood));
  cap.position.y = h - 0.15;
  group.add(cap);
  return group;
}

function vaultPillar(r: number, h: number): THREE.Group {
  const group = new THREE.Group();
  const stone = surfaceMat({ color: 0x6e7076, roughness: 0.96, flatShading: true });
  const base = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 1.08, h * 0.52, 10), stone),
  );
  base.position.y = h * 0.26;
  group.add(base);
  // The upper drum leans off the stack: the redoubt fell, nothing stands true.
  const broken = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(r * 0.72, r * 0.86, h * 0.4, 10), stone),
  );
  broken.position.set(r * 0.2, h * 0.72, 0);
  broken.rotation.z = 0.14;
  group.add(broken);
  for (const [dx, dz, rr] of [
    [r * 1.1, r * 0.5, r * 0.4],
    [-r * 0.9, -r * 0.7, r * 0.32],
  ] as const) {
    const rubble = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(rr, 0), stone));
    rubble.position.set(dx, rr * 0.5, dz);
    group.add(rubble);
  }
  return group;
}

function vaultBell(r: number, h: number, deps: LastBellStoryInteriorDeps): THREE.Group {
  const group = new THREE.Group();
  const bronze = surfaceMat({ color: 0x6a5c3c, roughness: 0.62, metalness: 0.35 });
  // The founding bell on its side: axis along x, mouth toward +x, top at h.
  const body = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(h * 0.32, h * 0.5, r * 1.7, 14), bronze),
  );
  body.rotation.z = Math.PI / 2;
  body.position.y = h * 0.5;
  group.add(body);
  const lip = shadow(new THREE.Mesh(new THREE.TorusGeometry(h * 0.48, h * 0.06, 8, 20), bronze));
  lip.rotation.y = Math.PI / 2;
  lip.position.set(-r * 0.85, h * 0.5, 0);
  group.add(lip);
  // The split, the Bellheart's faint glow inside it: an emissive seam along
  // the upper shell, shimmered by the shared flame flicker.
  const glowMat = new THREE.MeshLambertMaterial({
    color: HEART_GLOW,
    emissive: VAULT_LIGHT,
    emissiveIntensity: deps.lowGfx ? 1.2 : 1.8,
    transparent: true,
    opacity: 0.9,
  });
  markSharedMaterial(glowMat);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 0.35, 0.5), glowMat);
  seam.position.set(0, h * 0.86, 0);
  seam.rotation.y = 0.12;
  group.add(seam);
  deps.flames.push(seam);
  const light = new THREE.PointLight(VAULT_LIGHT, deps.lowGfx ? 7 : 10, deps.lowGfx ? 16 : 26, 2);
  if (!deps.lowGfx) light.userData.baseIntensity = 22;
  light.position.set(0, h * 0.9, 0);
  group.add(light);
  deps.fireLights.push(light);
  return group;
}

function dreamSpire(r: number, h: number): THREE.Group {
  const group = new THREE.Group();
  const crystal = surfaceMat({
    color: 0x241b38,
    roughness: 0.4,
    flatShading: true,
    emissive: 0x7a55d4,
    emissiveIntensity: 0.35,
  });
  const spire = shadow(new THREE.Mesh(new THREE.ConeGeometry(r * 0.75, h, 5), crystal));
  spire.position.y = h / 2;
  group.add(spire);
  const shard = shadow(new THREE.Mesh(new THREE.ConeGeometry(r * 0.38, h * 0.45, 5), crystal));
  shard.position.set(r * 0.7, h * 0.22, r * 0.25);
  shard.rotation.z = -0.28;
  group.add(shard);
  return group;
}

function heartCollar(r: number, h: number, deps: LastBellStoryInteriorDeps): THREE.Group {
  const group = new THREE.Group();
  const dreamStone = surfaceMat({
    color: 0x554374,
    roughness: 0.7,
    flatShading: true,
    emissive: 0x2a1c48,
    emissiveIntensity: 0.4,
  });
  const ring = shadow(
    new THREE.Mesh(new THREE.TorusGeometry(r * 0.75, r * 0.16, 8, 28), dreamStone),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = r * 0.16;
  group.add(ring);
  const coreMat = new THREE.MeshLambertMaterial({
    color: HEART_GLOW,
    emissive: HEART_GLOW,
    emissiveIntensity: deps.lowGfx ? 1.1 : 1.7,
    transparent: true,
    opacity: 0.92,
  });
  markSharedMaterial(coreMat);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.32, 0), coreMat);
  core.position.y = h * 0.55;
  group.add(core);
  deps.flames.push(core);
  if (!deps.lowGfx) {
    const light = new THREE.PointLight(HEART_GLOW, 10, 30, 2);
    light.userData.baseIntensity = 24;
    light.position.y = h * 0.7;
    group.add(light);
    deps.fireLights.push(light);
  }
  return group;
}

function watchstone(r: number, h: number): THREE.Group {
  const group = new THREE.Group();
  const stone = surfaceMat({ color: 0x7d8388, roughness: 0.96, flatShading: true });
  const dark = surfaceMat({ color: 0x14181c, roughness: 1 });
  const slab = shadow(new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, h, r * 0.7), stone));
  slab.position.y = h / 2;
  slab.rotation.y = 0.08;
  group.add(slab);
  // The empty ward socket on the face, waiting for its star-glass.
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.14, 12), dark);
  socket.rotation.x = Math.PI / 2;
  socket.position.set(0, h * 0.62, r * 0.36);
  group.add(socket);
  return group;
}

function willow(r: number, h: number): THREE.Group {
  const group = new THREE.Group();
  const bark = surfaceMat({ color: 0x4a3b2c, roughness: 0.95 });
  const leafOuter = surfaceMat({ color: 0x3d5a3f, roughness: 0.95, flatShading: true });
  const leafInner = surfaceMat({ color: 0x33503a, roughness: 0.95, flatShading: true });
  const trunk = shadow(
    new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.55, h * 0.42, 8), bark),
  );
  trunk.position.y = h * 0.21;
  group.add(trunk);
  // Weeping canopy: a wide cone whose skirt hangs back toward the mound.
  const canopy = shadow(new THREE.Mesh(new THREE.ConeGeometry(r * 3.2, h * 0.62, 12), leafOuter));
  canopy.position.y = h * 0.38 + h * 0.31;
  group.add(canopy);
  const skirt = shadow(new THREE.Mesh(new THREE.ConeGeometry(r * 2.5, h * 0.5, 12), leafInner));
  skirt.position.y = h * 0.3 + h * 0.25;
  group.add(skirt);
  return group;
}

function nameStonePlot(): THREE.Group {
  const group = new THREE.Group();
  const pale = surfaceMat({ color: 0xb9b3a4, roughness: 0.96, flatShading: true });
  // Five flat stones in a shallow arc: the names under the willow.
  for (let i = 0; i < 5; i++) {
    const stone = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.4), pale));
    stone.position.set((i - 2) * 0.95, 0.08, Math.abs(i - 2) * 0.3);
    stone.rotation.y = (hash(i, 61) - 0.5) * 0.5;
    group.add(stone);
  }
  return group;
}

function chargeSled(r: number, _h: number): THREE.Group {
  const group = new THREE.Group();
  const wood = surfaceMat({ color: 0x6b5237, roughness: 0.94 });
  const iron = surfaceMat({ color: 0x3a3f46, roughness: 0.7, metalness: 0.3 });
  const bed = shadow(new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, 0.25, r * 1.0), wood));
  bed.position.y = 0.45;
  group.add(bed);
  for (const dz of [-r * 0.45, r * 0.45]) {
    const runner = shadow(new THREE.Mesh(new THREE.BoxGeometry(r * 1.8, 0.16, 0.18), wood));
    runner.position.set(0, 0.12, dz);
    group.add(runner);
  }
  for (let i = 0; i < 3; i++) {
    const casing = shadow(
      new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, r * 0.85, 10), iron),
    );
    casing.rotation.x = Math.PI / 2;
    casing.position.set((i - 1) * 0.65, 0.86, 0);
    group.add(casing);
  }
  return group;
}

function wardAnchor(r: number, h: number, deps: LastBellStoryInteriorDeps): THREE.Group {
  const group = new THREE.Group();
  const stone = surfaceMat({ color: 0x8b8474, roughness: 0.96, flatShading: true });
  const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.9, 0.4, 8), stone));
  base.position.y = 0.2;
  group.add(base);
  const glass = surfaceMat({
    color: 0x3a5a58,
    roughness: 0.3,
    flatShading: true,
    emissive: WARD_GLOW,
    emissiveIntensity: deps.lowGfx ? 0.6 : 0.9,
  });
  // Knee-high star-glass core plus a slender spire up to the collider top.
  const core = shadow(new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.5, 0), glass));
  core.position.y = 0.95;
  group.add(core);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, h - 1.2, 6), glass);
  spire.position.y = 1.3 + (h - 1.2) / 2;
  group.add(spire);
  return group;
}

function buildLastBellProp(p: StoryAreaProp, deps: LastBellStoryInteriorDeps): THREE.Group {
  // Placement r/h ARE the collider circle (colliders.ts uses them verbatim,
  // ignoring scale), so the silhouettes build to r/h directly.
  switch (p.kind) {
    case 'lb_mill_stone':
      return millStone(p.r, p.h);
    case 'lb_mill_post':
      return millPost(p.r, p.h);
    case 'lb_vault_pillar':
      return vaultPillar(p.r, p.h);
    case 'lb_vault_bell':
      return vaultBell(p.r, p.h, deps);
    case 'lb_dream_spire':
      return dreamSpire(p.r, p.h);
    case 'lb_heart_collar':
      return heartCollar(p.r, p.h, deps);
    case 'lb_watchstone':
      return watchstone(p.r, p.h);
    case 'lb_willow':
      return willow(p.r, p.h);
    case 'lb_name_stone_plot':
      return nameStonePlot();
    case 'lb_charge_sled':
      return chargeSled(p.r, p.h);
    case 'lb_ward_anchor':
      return wardAnchor(p.r, p.h, deps);
  }
}

// ---------------------------------------------------------------------------
// Glow decals + local lights
// ---------------------------------------------------------------------------

let glowGeo: THREE.BufferGeometry | null = null;
const glowMats = new Map<number, THREE.MeshBasicMaterial>();

// Additive floor pool under a glowing prop (the point-light budget keeps only
// the nearest few lights live, so the pools are baked, the exemplar trick).
function addGlowDecal(
  group: THREE.Group,
  deps: LastBellStoryInteriorDeps,
  x: number,
  y: number,
  z: number,
  color: number,
  scale = 1,
): void {
  if (deps.lowGfx) return;
  if (!glowGeo) {
    glowGeo = new THREE.CircleGeometry(6, 20).rotateX(-Math.PI / 2);
    markSharedGeometry(glowGeo);
  }
  let mat = glowMats.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      map: radialGlowTexture(),
      color,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    markSharedMaterial(mat);
    glowMats.set(color, mat);
  }
  const glow = new THREE.Mesh(glowGeo, mat);
  glow.position.set(x, y, z);
  glow.scale.setScalar(scale);
  glow.renderOrder = 2;
  group.add(glow);
}

// The vault's descent lights: a small cool point light per broken pillar (the
// 'vault' mood is near-dark on purpose; these carry the way down). They stay
// on lowGfx at reduced strength, the exemplar fields' budget behavior.
function addVaultLight(
  group: THREE.Group,
  deps: LastBellStoryInteriorDeps,
  x: number,
  y: number,
  z: number,
): void {
  const light = new THREE.PointLight(VAULT_LIGHT, deps.lowGfx ? 6 : 9, deps.lowGfx ? 15 : 24, 2);
  if (!deps.lowGfx) light.userData.baseIntensity = 20;
  light.position.set(x, y, z);
  group.add(light);
  deps.fireLights.push(light);
}

// ---------------------------------------------------------------------------
// The story interior builder
// ---------------------------------------------------------------------------

/** Registries the renderer shares with every interior (see DungeonInteriors):
 * flames get the per-frame flicker (reused here for the Bellheart glows),
 * fireLights the point-light budget; both are pruned when the interior group
 * retires. `seed` is the world seed (Renderer reads `sim.cfg.seed`): mirror
 * areas re-sample the island's own terrainHeight with it. */
export interface LastBellStoryInteriorDeps {
  dungeonId: string;
  seed: number;
  lowGfx: boolean;
  flames: THREE.Mesh[];
  fireLights: THREE.PointLight[];
}

// Build one copy of a Last Bell story space at instance-local origin (0,0);
// the caller positions the returned group at the claimed slot's (ox, oz) and
// adds it to the scene, exactly like DungeonInteriors.buildInterior.
export function buildLastBellStoryInterior(deps: LastBellStoryInteriorDeps): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lastBellStory';
  const area = LAST_BELL_AREAS[deps.dungeonId];
  // Unknown id: an empty group beats a crash mid-frame; the sim-side guard
  // tests pin that every 'farshore_story' dungeon has an area.
  if (!area) return group;
  const palette = MOOD_PALETTE[area.mood];
  const heightAt = areaHeightFn(area, deps.seed);

  group.add(buildGround(area, heightAt, palette, deps.seed));
  group.add(buildWalls(area, heightAt, palette, deps.seed));
  group.add(buildSkyDome(area, area.mood));

  // Cosmetic mood fill (the scene-level rig grade lives in the renderer's
  // ambience swap via LAST_BELL_MOOD_AMBIENCE): a hemi wash plus, where the
  // mood has one, a soft key. Boosted on lowGfx, where the ambience swap
  // leaves the global rig untouched (the exemplar fields' compensation).
  const hemi = new THREE.HemisphereLight(
    palette.hemiSky,
    palette.hemiGround,
    deps.lowGfx ? palette.hemiIntensity * 2.2 : palette.hemiIntensity,
  );
  group.add(hemi);
  if (palette.sun) {
    const key = new THREE.DirectionalLight(
      palette.sun.color,
      deps.lowGfx ? palette.sun.intensity * 1.5 : palette.sun.intensity,
    );
    key.position.set(40, 70, -50);
    const b = area.bounds;
    key.target.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    group.add(key, key.target);
  }

  for (const p of area.props) {
    const holder = new THREE.Group();
    holder.add(buildLastBellProp(p, deps));
    // Seat on the shared height field (a 5cm sink keeps edges grounded).
    holder.position.set(p.x, heightAt(p.x, p.z) - 0.05, p.z);
    holder.rotation.y = p.rot ?? 0;
    group.add(holder);

    const groundY = heightAt(p.x, p.z);
    if (p.kind === 'lb_vault_pillar') {
      addVaultLight(group, deps, p.x, groundY + p.h * 0.8, p.z);
      addGlowDecal(group, deps, p.x, groundY + 0.08, p.z, VAULT_LIGHT, 0.7);
    } else if (p.kind === 'lb_vault_bell') {
      addGlowDecal(group, deps, p.x, groundY + 0.08, p.z, VAULT_LIGHT, 1.3);
    } else if (p.kind === 'lb_heart_collar') {
      addGlowDecal(group, deps, p.x, groundY + 0.08, p.z, HEART_GLOW, 1.4);
    } else if (p.kind === 'lb_ward_anchor') {
      addGlowDecal(group, deps, p.x, groundY + 0.08, p.z, WARD_GLOW, 0.6);
    } else if (p.kind === 'lb_dream_spire') {
      addGlowDecal(group, deps, p.x, groundY + 0.08, p.z, 0x7a55d4, 0.9);
    }
  }

  return group;
}

/** Test-only window into the mood tables (pure test import mirror). */
export const lastBellPropsInternalsForTest = {
  areas: LAST_BELL_AREAS,
  moodAmbience: LAST_BELL_MOOD_AMBIENCE,
  moodPalette: MOOD_PALETTE,
  builtWallStyle: BUILT_WALL_STYLE,
};
