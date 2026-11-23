// Cave tube meshes: the visible walls/ceiling/floor of every cave
// (sim/caves.ts CaveDef chains) plus an outer rock shell. Geometry derives
// from the SAME analytic model the sim walks on (floor + horseshoe ceiling),
// so what you see is what you collide with ? and from NOTHING else: the tube
// is fully terrain-independent. It is never clamped under the ground, never
// collapsed by low terrain, and its open mouths are always exactly the
// authored node size. Where a tube pokes out of a hillside you simply see its
// rock shell; surface openings are authored as TerrainHole cutouts that the
// maker lines the mouth up with.
//
// Painted biome cells tint the interior per vertex from the same biomePaint
// grid as the terrain, so the paint brush works inside caves too.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  caveBounds,
  caveClearance,
  caveEndOpen,
  caveFloorBumpAt,
  caveStartOpen,
} from '../sim/caves';
import { getActiveWorldContent } from '../sim/data';
import { hash2 } from '../sim/rng';
import type { CaveDef, CustomPaintSwatch } from '../sim/types';
import { BIOME_BY_ID, paintedCellIdAt } from '../sim/world';
import { acquireTexture, loadTexture } from './assets/loader';
import { terrainTexturePath, terrainTextureSet } from './terrain_texture_sets';

// Interior tint per built-in biome paint id (multiplied into the rock detail
// texture). Muted, dark-leaning: cave light comes from the mouth.
const BIOME_TINT: Record<string, number> = {
  vale: 0x8a7f6a,
  marsh: 0x6f7a62,
  peaks: 0x8d8d94,
  beach: 0xc2b08a,
  desert: 0xbc9a6a,
  volcano: 0x7a5a52,
  cave: 0x77706a,
};
const UNPAINTED_TINT = 0x8a8178;

const RING_STEP = 0.8; // yards between rings along the centerline
const ARC_SEGS = 14; // vertices across the horseshoe (wall-to-wall)
const FLOOR_SEGS = 6; // vertices across the flat floor band
// Rock wall thickness between the interior surface and the outer shell.
const SHELL = 0.5;
// The exterior shell reads as darker outer rock.
const EXTERIOR_SHADE = 0.72;

export interface PaintLookup {
  swatches: Map<number, CustomPaintSwatch>;
}

/** Snapshot of the active map's custom paint swatches, taken once per mesh
 *  build. Shared with the carve-cavity mesher (cut_cavity_mesh.ts) so both
 *  interiors read the paint brush the same way. */
export function caveInteriorPaintLookup(): PaintLookup {
  const custom = getActiveWorldContent().biomePaint?.custom ?? [];
  return { swatches: new Map(custom.map((s) => [s.id, s])) };
}

const cTmp = new THREE.Color();

/** The interior tint the biome-paint grid gives a cave/cavity surface over
 *  (x, z): the painted cell's colour pulled toward cave dark, or the neutral
 *  granite tint where unpainted. Returns a SHARED scratch colour. */
export function caveInteriorTintAt(x: number, z: number, lookup: PaintLookup): THREE.Color {
  const id = paintedCellIdAt(x, z);
  if (id === null) return cTmp.setHex(UNPAINTED_TINT);
  if (id < BIOME_BY_ID.length) return cTmp.setHex(BIOME_TINT[BIOME_BY_ID[id]] ?? UNPAINTED_TINT);
  const sw = lookup.swatches.get(id);
  if (!sw) return cTmp.setHex(UNPAINTED_TINT);
  cTmp.setHex(sw.color);
  // Interior surfaces are unlit rock: pull painted colors toward the dark
  // cave base so a bright surface swatch doesn't glow underground.
  return cTmp.multiplyScalar(0.82);
}

// One material per interior texture set ('' = the default granite). The
// detail map arrives async and upgrades the material in place; the Paint
// tool's per-vertex tinting layers on top of ANY base texture, so a
// re-textured cave stays fully paintable.
const caveMaterials = new Map<string, THREE.MeshStandardMaterial>();
// Texture release handles per custom-set cave material (see disposeUnusedCaveGroundMats).
const caveMatReleases = new Map<string, (() => void)[]>();

function material(texKey?: string): THREE.MeshStandardMaterial {
  const set = texKey ? terrainTextureSet(texKey) : null;
  const key = set ? set.key : '';
  let m = caveMaterials.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
    // A whisper of self-light so an unlit bore reads as rock, not void.
    emissive: 0x1a1713,
    emissiveIntensity: 0.55,
  });
  caveMaterials.set(key, m);
  const mat = m;
  if (set) {
    // A custom interior set: reference-counted so the GC can free its VRAM when
    // no cave uses it anymore.
    const releases: (() => void)[] = [];
    const color = acquireTexture(`/${terrainTexturePath(set.key, 'color')}`, {
      srgb: true,
      repeat: true,
    });
    releases.push(color.release);
    void color.texture
      .then((tex) => {
        mat.map = tex;
        mat.needsUpdate = true;
      })
      .catch(() => {});
    const normalPath = terrainTexturePath(set.key, 'normal');
    if (normalPath) {
      const normal = acquireTexture(`/${normalPath}`, { repeat: true });
      releases.push(normal.release);
      void normal.texture
        .then((tex) => {
          mat.normalMap = tex;
          mat.needsUpdate = true;
        })
        .catch(() => {});
    }
    // A glowing set (lava): see cut_cavity_mesh, emissive turns white only
    // once the Emission map lands, and ignores the depth tint so molten veins
    // light the deepest stretch of a bore.
    const emissionPath = terrainTexturePath(set.key, 'emission');
    if (emissionPath) {
      const emission = acquireTexture(`/${emissionPath}`, { srgb: true, repeat: true });
      releases.push(emission.release);
      void emission.texture
        .then((tex) => {
          mat.emissiveMap = tex;
          mat.emissive = new THREE.Color(0xffffff);
          mat.emissiveIntensity = 1.35;
          mat.needsUpdate = true;
        })
        .catch(() => {});
    }
    caveMatReleases.set(key, releases);
  } else {
    // Default granite (Rock051, shared with the base splat): pin it forever.
    void loadTexture('/textures/terrain/Rock051_Color.jpg', { srgb: true, repeat: true })
      .then((tex) => {
        mat.map = tex;
        mat.needsUpdate = true;
      })
      .catch(() => {});
  }
  return m;
}

/**
 * Free the textures of every custom-set cave material no active cave references.
 * `usedKeys` = the terrain-texture-set keys (CaveDef.tex) in use. The default
 * granite material ('' key) is pinned and never freed.
 */
export function disposeUnusedCaveGroundMats(usedKeys: ReadonlySet<string>): void {
  for (const [key, mat] of [...caveMaterials]) {
    if (key === '' || usedKeys.has(key)) continue;
    for (const release of caveMatReleases.get(key) ?? []) release();
    caveMatReleases.delete(key);
    mat.map = null;
    mat.normalMap = null;
    mat.dispose();
    caveMaterials.delete(key);
  }
}

interface ChainPoint {
  x: number;
  z: number;
  floor: number;
  radius: number;
  // Unit lateral (perpendicular) direction in XZ.
  px: number;
  pz: number;
  // Unit forward (tangent) direction in XZ.
  fx: number;
  fz: number;
  s: number; // arc length along the chain (for UVs)
}

/** Resample a cave's node chain into evenly spaced points with lateral axes.
 *  Radii carry the cave's width multiplier (the Cave panel slider). */
function chainPoints(cave: CaveDef): ChainPoint[] {
  const nodes = cave.nodes;
  if (nodes.length < 2) return [];
  const widthMult = cave.width ?? 1;
  const pts: ChainPoint[] = [];
  let s = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    const steps = Math.max(1, Math.ceil(len / RING_STEP));
    const from = i === 0 ? 0 : 1; // segment joints share a ring
    for (let k = from; k <= steps; k++) {
      const t = k / steps;
      pts.push({
        x: a.x + dx * t,
        z: a.z + dz * t,
        floor: a.y + (b.y - a.y) * t,
        radius: (a.radius + (b.radius - a.radius) * t) * widthMult,
        px: -uz,
        pz: ux,
        fx: ux,
        fz: uz,
        s: s + len * t,
      });
    }
    s += len;
  }
  // Average lateral axes at interior joints so the tube doesn't crease.
  for (let i = 1; i + 1 < pts.length; i++) {
    const ax = (pts[i - 1].px + pts[i + 1].px) / 2;
    const az = (pts[i - 1].pz + pts[i + 1].pz) / 2;
    const l = Math.hypot(ax, az);
    if (l > 1e-4) {
      pts[i].px = ax / l;
      pts[i].pz = az / l;
      pts[i].fx = az / l;
      pts[i].fz = -ax / l;
    }
  }
  return pts;
}

/** Exported for tests: the pure tube geometry (no materials, no texture
 *  loads), so mouth-size and terrain-independence are assertable headlessly.
 *
 *  Vertex layout per ring: interior arch (ARC_SEGS+1), interior floor
 *  (FLOOR_SEGS+1), exterior arch (ARC_SEGS+1), exterior bottom
 *  (FLOOR_SEGS+1). The interior surfaces face inward, the shell faces
 *  outward; open ends get a rim annulus, closed ends a rock cap. */
export function buildCaveGeometry(
  cave: CaveDef,
  lookup: { swatches: Map<number, CustomPaintSwatch> },
): THREE.BufferGeometry | null {
  const pts = chainPoints(cave);
  if (pts.length < 2) return null;
  const heightMult = cave.height ?? 1;
  const archCols = ARC_SEGS + 1;
  const floorCols = FLOOR_SEGS + 1;
  const colsHalf = archCols + floorCols; // one surface (interior or exterior)
  const cols = colsHalf * 2;
  const rows = pts.length;
  // +4: up to two cap-center vertices per sealed end.
  const maxVerts = rows * cols + 4;
  const positions = new Float32Array(maxVerts * 3);
  const colors = new Float32Array(maxVerts * 3);
  const uvs = new Float32Array(maxVerts * 2);
  // World-scale texture density (yards per tile): the rock texture repeats at
  // the same physical size along the bore and around the profile, so wide or
  // tall caves no longer stretch it. Authored per cave (texTile); a picked
  // texture set defaults to the shared 28yd tiling, stock granite keeps the
  // legacy 5 so existing maps render unchanged.
  const TEX_TILE = cave.texTile ?? (cave.tex ? 28 : 5);
  let vi = 0;
  const push = (x: number, y: number, z: number, c: THREE.Color, u: number, v: number): void => {
    positions[vi * 3] = x;
    positions[vi * 3 + 1] = y;
    positions[vi * 3 + 2] = z;
    colors[vi * 3] = c.r;
    colors[vi * 3 + 1] = c.g;
    colors[vi * 3 + 2] = c.b;
    uvs[vi * 2] = u;
    uvs[vi * 2 + 1] = v;
    vi++;
  };
  for (let r = 0; r < rows; r++) {
    const p = pts[r];
    const clear = caveClearance(p.radius, heightMult);
    // Half-perimeter of the horseshoe arch (Ramanujan half-ellipse): the
    // profile's world length, so V coordinates are arc-length based.
    const arcLen =
      (Math.PI *
        (3 * (p.radius + clear) - Math.sqrt((3 * p.radius + clear) * (p.radius + 3 * clear)))) /
      2;
    // Interior horseshoe ceiling: u sweeps wall to wall (-1 .. 1). ALWAYS the
    // full authored arch ? nothing outside the cave's own data touches it.
    for (let a = 0; a <= ARC_SEGS; a++) {
      const u = -1 + (2 * a) / ARC_SEGS;
      const q = u * p.radius * 0.995;
      const x = p.x + p.px * q;
      const z = p.z + p.pz * q;
      const y = p.floor + clear * Math.sqrt(Math.max(0, 1 - u * u));
      push(
        x,
        y,
        z,
        caveInteriorTintAt(x, z, lookup),
        p.s / TEX_TILE,
        ((a / ARC_SEGS) * arcLen) / TEX_TILE,
      );
    }
    // Interior floor band (slightly inset so the wall seam is tight). The
    // Floor bumps slider rolls it with the SAME noise the sim's walkable
    // sheet uses (caveFloorBumpAt), fading to zero at the walls.
    for (let f = 0; f <= FLOOR_SEGS; f++) {
      const u = -0.985 + (1.97 * f) / FLOOR_SEGS;
      const q = u * p.radius;
      const x = p.x + p.px * q;
      const z = p.z + p.pz * q;
      const y = p.floor + caveFloorBumpAt(cave, x, z, Math.abs(u));
      const c = caveInteriorTintAt(x, z, lookup).multiplyScalar(0.9);
      push(x, y, z, c, p.s / TEX_TILE, ((f / FLOOR_SEGS) * (2 * p.radius * 0.985)) / TEX_TILE);
    }
    // Exterior shell arch: the same horseshoe pushed out by SHELL and dropped
    // SHELL below the floor, so the tube reads as solid rock from outside.
    const rOut = p.radius + SHELL;
    const clearOut = clear + SHELL * 2;
    for (let a = 0; a <= ARC_SEGS; a++) {
      const u = -1 + (2 * a) / ARC_SEGS;
      const q = u * rOut;
      const x = p.x + p.px * q;
      const z = p.z + p.pz * q;
      const y = p.floor - SHELL + clearOut * Math.sqrt(Math.max(0, 1 - u * u));
      const c = caveInteriorTintAt(x, z, lookup).multiplyScalar(EXTERIOR_SHADE);
      push(x, y, z, c, p.s / TEX_TILE, ((a / ARC_SEGS) * arcLen) / TEX_TILE);
    }
    // Exterior bottom band (the shell's underside).
    for (let f = 0; f <= FLOOR_SEGS; f++) {
      const u = -1 + (2 * f) / FLOOR_SEGS;
      const q = u * rOut;
      const x = p.x + p.px * q;
      const z = p.z + p.pz * q;
      const c = caveInteriorTintAt(x, z, lookup).multiplyScalar(EXTERIOR_SHADE * 0.9);
      push(x, p.floor - SHELL, z, c, p.s / TEX_TILE, ((f / FLOOR_SEGS) * (2 * rOut)) / TEX_TILE);
    }
  }
  const quadRows = rows - 1;
  const idx: number[] = [];
  // Interior winding (faces seen from inside the bore).
  const quadIn = (a: number, b: number, c: number, d: number): void => {
    idx.push(a, c, b, b, c, d);
  };
  // Exterior winding (faces seen from outside).
  const quadOut = (a: number, b: number, c: number, d: number): void => {
    idx.push(a, b, c, b, d, c);
  };
  const extBase = colsHalf;
  for (let r = 0; r < quadRows; r++) {
    const row0 = r * cols;
    const row1 = (r + 1) * cols;
    for (let a = 0; a < ARC_SEGS; a++) quadIn(row0 + a, row0 + a + 1, row1 + a, row1 + a + 1);
    const f0 = archCols;
    for (let f = 0; f < FLOOR_SEGS; f++) {
      quadIn(row0 + f0 + f, row0 + f0 + f + 1, row1 + f0 + f, row1 + f0 + f + 1);
    }
    const e0 = extBase;
    for (let a = 0; a < ARC_SEGS; a++) {
      quadOut(row0 + e0 + a, row0 + e0 + a + 1, row1 + e0 + a, row1 + e0 + a + 1);
    }
    const g0 = extBase + archCols;
    for (let f = 0; f < FLOOR_SEGS; f++) {
      quadOut(row0 + g0 + f, row0 + g0 + f + 1, row1 + g0 + f, row1 + g0 + f + 1);
    }
  }
  // ---- End treatment -------------------------------------------------------
  // Ordered CLOSED loops around each surface's profile: arch left->right,
  // then floor right->left, so consecutive loop entries are spatial
  // neighbors. Column j of the interior loop pairs with column j of the
  // exterior loop.
  const loopCols: number[] = [];
  for (let a = 0; a <= ARC_SEGS; a++) loopCols.push(a);
  for (let f = FLOOR_SEGS; f >= 0; f--) loopCols.push(archCols + f);
  const capEnd = (row: number, open: boolean, flip: boolean): void => {
    const p = pts[row === 0 ? 0 : rows - 1];
    const base = (row === 0 ? 0 : rows - 1) * cols;
    const inLoop = loopCols.map((c) => base + c);
    const outLoop = loopCols.map((c) => base + extBase + c);
    // Rim annulus between the interior and exterior profiles: the visible
    // rock thickness of an open mouth, and the sealed edge of a closed cap.
    for (let j = 0; j < inLoop.length; j++) {
      const k = (j + 1) % inLoop.length;
      if (flip) quadOut(inLoop[j], inLoop[k], outLoop[j], outLoop[k]);
      else quadIn(inLoop[j], inLoop[k], outLoop[j], outLoop[k]);
    }
    if (open) return;
    // Sealed end: a rock wall fanned across the interior profile and a
    // matching exterior cap, so a closed mouth reads as solid stone.
    const clear = caveClearance(p.radius, heightMult);
    const cIn = caveInteriorTintAt(p.x, p.z, lookup).multiplyScalar(0.85);
    const inCenter = vi;
    push(p.x, p.floor + clear * 0.42, p.z, cIn, 0, 0);
    const cOut = caveInteriorTintAt(p.x, p.z, lookup).multiplyScalar(EXTERIOR_SHADE);
    const outCenter = vi;
    // The exterior cap bulges half a shell outward along the tangent.
    const dir = row === 0 ? -1 : 1;
    push(
      p.x + p.fx * dir * SHELL * 0.5,
      p.floor - SHELL + (clear + SHELL * 2) * 0.42,
      p.z + p.fz * dir * SHELL * 0.5,
      cOut,
      0,
      0,
    );
    for (let j = 0; j < inLoop.length; j++) {
      const k = (j + 1) % inLoop.length;
      if (flip) {
        idx.push(inLoop[j], inLoop[k], inCenter);
        idx.push(outLoop[k], outLoop[j], outCenter);
      } else {
        idx.push(inLoop[k], inLoop[j], inCenter);
        idx.push(outLoop[j], outLoop[k], outCenter);
      }
    }
  };
  capEnd(0, caveStartOpen(cave), false);
  capEnd(rows - 1, caveEndOpen(cave), true);

  const geo = new THREE.BufferGeometry();
  // Cap centers appended after the ring grid: size to the actual vertex count.
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, vi * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, vi * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(0, vi * 2), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Stalactite/stalagmite spikes: cosmetic cones inside the tube (density and
// size from the Cave panel sliders; the sim never collides with them). Kept
// clear of OPEN mouths so nothing dangles in the daylight ring.
const SPIKE_SIDES = 6;

function buildSpikesGeometry(cave: CaveDef, lookup: PaintLookup): THREE.BufferGeometry | null {
  const stalac = cave.stalactites ?? 0;
  const stalag = cave.stalagmites ?? 0;
  if (stalac <= 0 && stalag <= 0) return null;
  const pts = chainPoints(cave);
  if (pts.length < 2) return null;
  const heightMult = cave.height ?? 1;
  const sizeMult = Math.min(3, Math.max(0.3, cave.spikeSize ?? 1));
  const totalLen = pts[pts.length - 1].s;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  // Deterministic per-cave salt so regenerating the same map reproduces the
  // same spikes (Date/Math.random are banned in render paths anyway).
  let salt = 0;
  for (let i = 0; i < cave.id.length; i++) salt = (salt * 31 + cave.id.charCodeAt(i)) % 9973;
  const cone = (
    x: number,
    y: number,
    z: number,
    rad: number,
    len: number,
    tint: THREE.Color,
  ): void => {
    // len > 0 grows up (stalagmite), len < 0 hangs down (stalactite).
    const base = positions.length / 3;
    for (let s = 0; s < SPIKE_SIDES; s++) {
      const a = (s / SPIKE_SIDES) * Math.PI * 2;
      positions.push(x + Math.cos(a) * rad, y, z + Math.sin(a) * rad);
      colors.push(tint.r, tint.g, tint.b);
      uvs.push(s / SPIKE_SIDES, 0);
    }
    positions.push(x, y + len, z); // tip
    colors.push(tint.r * 0.85, tint.g * 0.85, tint.b * 0.85);
    uvs.push(0.5, 0.35);
    const tip = base + SPIKE_SIDES;
    for (let s = 0; s < SPIKE_SIDES; s++) {
      const n = (s + 1) % SPIKE_SIDES;
      // Wind so the outside faces out for both orientations.
      if (len > 0) index.push(base + s, base + n, tip);
      else index.push(base + n, base + s, tip);
    }
  };
  for (let r = 0; r < pts.length; r++) {
    const p = pts[r];
    // Keep spikes out of the open-mouth rings.
    const mouthClear = Math.max(2, p.radius * 1.2);
    if (caveStartOpen(cave) && p.s < mouthClear) continue;
    if (caveEndOpen(cave) && totalLen - p.s < mouthClear) continue;
    const clear = caveClearance(p.radius, heightMult);
    // A lateral spot for this ring's spikes, kept off the walls.
    const u = (hash2(r, 9.1, salt) * 2 - 1) * 0.66;
    const x = p.x + p.px * u * p.radius;
    const z = p.z + p.pz * u * p.radius;
    const ceilY = p.floor + clear * Math.sqrt(Math.max(0, 1 - u * u));
    // Bumped WALKABLE floor at the spike spot (Floor bumps slider).
    const floorY = p.floor + caveFloorBumpAt(cave, x, z, Math.abs(u));
    const room = ceilY - floorY;
    if (room < 1.2) continue;
    const tint = caveInteriorTintAt(x, z, lookup).clone().multiplyScalar(0.92);
    if (hash2(r, 3.3, salt) < stalac * 0.55) {
      const len = Math.min(room * 0.45, clear * (0.25 + 0.5 * hash2(r, 4.4, salt)) * sizeMult);
      const rad = (0.12 + 0.3 * hash2(r, 5.5, salt)) * sizeMult + len * 0.1;
      cone(x, ceilY - 0.04, z, rad, -len, tint);
    }
    if (hash2(r, 6.6, salt) < stalag * 0.55) {
      const u2 = (hash2(r, 7.7, salt) * 2 - 1) * 0.6;
      const gx = p.x + p.px * u2 * p.radius;
      const gz = p.z + p.pz * u2 * p.radius;
      const gy = p.floor + caveFloorBumpAt(cave, gx, gz, Math.abs(u2));
      const len = Math.min(room * 0.35, clear * (0.18 + 0.4 * hash2(r, 8.8, salt)) * sizeMult);
      const rad = (0.18 + 0.34 * hash2(r, 2.2, salt)) * sizeMult + len * 0.14;
      cone(gx, gy + 0.02, gz, rad, len, tint);
    }
  }
  if (index.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function buildOneCaveMesh(cave: CaveDef, lookup: PaintLookup): THREE.Mesh | null {
  const base = buildCaveGeometry(cave, lookup);
  if (!base) return null;
  const spikes = buildSpikesGeometry(cave, lookup);
  let geo = base;
  if (spikes) {
    const merged = mergeGeometries([base, spikes]);
    if (merged) {
      base.dispose();
      spikes.dispose();
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      geo = merged;
    }
  }
  const mesh = new THREE.Mesh(geo, material(cave.tex));
  mesh.name = `cave:${cave.id}`;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * (Re)build the tube meshes for every cave in the active world into a fresh
 * group. Small worlds (documents cap at 32 caves) rebuild whole caves per
 * edit; each mesh is a few thousand triangles.
 */
export function buildCaveMeshes(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'caves';
  const caves = getActiveWorldContent().caves;
  if (!caves || caves.length === 0) return group;
  const lookup = caveInteriorPaintLookup();
  for (const cave of caves) {
    const mesh = buildOneCaveMesh(cave, lookup);
    if (mesh) group.add(mesh);
  }
  return group;
}

/**
 * Region-scoped refresh: rebuild only the cave meshes whose footprint touches
 * the edited rect (node moves, paint drags), remove meshes for deleted caves,
 * and add meshes for new ones. Mutates the group in place.
 */
export function refreshCaveMeshes(
  group: THREE.Group,
  region: { minX: number; minZ: number; maxX: number; maxZ: number },
): void {
  const caves = getActiveWorldContent().caves ?? [];
  const byId = new Map(caves.map((c) => [`cave:${c.id}`, c]));
  const lookup = caveInteriorPaintLookup();
  const pad = 3;
  // Drop meshes whose cave is gone (undo/erase).
  for (const child of [...group.children]) {
    if (!byId.has(child.name)) {
      group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
  }
  const existing = new Set(group.children.map((c) => c.name));
  for (const cave of caves) {
    const b = caveBounds(cave);
    const touches =
      b.minX - pad <= region.maxX &&
      b.maxX + pad >= region.minX &&
      b.minZ - pad <= region.maxZ &&
      b.maxZ + pad >= region.minZ;
    const name = `cave:${cave.id}`;
    if (!touches && existing.has(name)) continue;
    if (!touches && !existing.has(name)) {
      // New cave entirely outside the region (map load edge case): build it.
      const mesh = buildOneCaveMesh(cave, lookup);
      if (mesh) group.add(mesh);
      continue;
    }
    const old = group.children.find((c) => c.name === name);
    if (old) {
      group.remove(old);
      (old as THREE.Mesh).geometry?.dispose();
    }
    const mesh = buildOneCaveMesh(cave, lookup);
    if (mesh) group.add(mesh);
  }
}
