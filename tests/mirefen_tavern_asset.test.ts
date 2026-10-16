import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  type Accessor,
  type Document,
  type Node as GltfNode,
  getBounds,
  NodeIO,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MIREFEN_TAVERN_ASSET,
  type MirefenTavernTier,
  sourceFingerprint,
  tierTarget,
  VERTEX_COLOUR_SCALE,
} from '../scripts/assets/mirefen_tavern/build.mjs';
import {
  MIREFEN_TAVERN_LAYOUT_FILE,
  mirefenTavernLayout,
} from '../scripts/assets/mirefen_tavern/layout';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  TAVERN_CRITICAL_PARTS,
  TAVERN_FRONT_SPLIT,
  TAVERN_OPTIONAL_PARTS,
  TAVERN_SHELL_PARTS,
  TAVERN_TRIM_PARTS,
} from '../src/render/mirefen_tavern_core';
import { TAVERN_HALL_AIR_TOP } from '../src/render/mirefen_tavern_interior_core';
import { placedTextureTierPath } from '../src/render/placed_texture_tier_core';
import {
  TAVERN_DOOR,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_HOOD,
  TAVERN_PROPS,
  TAVERN_TOWER,
  tavernToWorld,
} from '../src/sim/content/mirefen_tavern';
import { tavernPropBaseY, tavernPropCollider } from '../src/sim/mirefen_tavern';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The shipped Mirefen tavern GLB (public/models/props/mirefen_tavern.glb), built in Blender from
// the sim's own layout (scripts/assets/mirefen_tavern/layout.json, exported from
// src/sim/content/mirefen_tavern.ts with the terrain under it) and shipped by build.mjs. Pins the
// bytes, the source fingerprint, the layout's freshness against the sim and the terrain, the
// named tier and shell parts the runtime keeps, sheds and cuts away, the painted maps on the
// painted materials (the Fenrire look of the painted town, scripts/assets/mirefen_tavern/
// textures.json) and the untextured rest, the painted vertex colours stored under their
// headroom, the texture-tier files beside the model, the triangle and size budgets, and the
// model's stamped numbers against the sim. Re-pin the
// sha256, size and triangle literals only with a re-export (docs/design/mirefen-tavern.md).

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, MIREFEN_TAVERN_ASSET.target);
/** Each texture tier's file: its bytes and sha256 (the model first). */
const SHIPPED: Record<MirefenTavernTier, { bytes: number; sha256: string }> = {
  full: {
    bytes: 3576888,
    sha256: 'fd13e5345871a6aea696012e37b2ce8638bc300ae4372fa6a888510ed3816099',
  },
  half: {
    bytes: 2622988,
    sha256: '9b3ffb9bd2057451495da080c110dddfefc0715441c08d79d012e5f3d855622d',
  },
  quarter: {
    bytes: 2336820,
    sha256: '68b42389c65cdafdbf6b221552d8a835e665d73e070313d63e8fe94c13bf786e',
  },
};
const TIERS = Object.keys(SHIPPED) as MirefenTavernTier[];
const tierFile = (tier: MirefenTavernTier) => path.join(ROOT, tierTarget(tier));
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  TavernFrame: 10976,
  TavernFurnishings: 8264,
  TavernLights: 4680,
  TavernGrounds: 11438,
  TavernDog: 374,
  HallWallFront: 1272,
  HallWallFrontLeft: 4565,
  HallWallFrontRight: 4547,
  HallWallBack: 2612,
  HallWallLeft: 4105,
  HallWallRight: 5795,
  HallRoof: 12864,
  WingWallEast: 2064,
  WingWallBack: 2036,
  WingWallWest: 976,
  WingRoof: 1812,
  TowerWall: 4370,
  TowerRoof: 2000,
  HallPorch: 2228,
  BarPillar: 784,
  TavernTrim: 8804,
  TavernClutter: 12350,
};
/** The player model, pivot to crown (HUMANOID_H in render/characters/manifest.ts). */
const PLAYER_H = 2.6;

let doc: Document;

/** A GLB's JSON chunk and binary chunk, read raw (the tier files are compared byte-level). */
function readGlb(file: string): { json: GlbJson; bin: Buffer } {
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(0), `${file} is a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  return {
    json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GlbJson,
    bin: buf.subarray(20 + jsonLen + 8),
  };
}

interface GlbJson {
  scenes: unknown;
  nodes: unknown;
  meshes: unknown;
  accessors: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  textures: { source?: number; extensions?: { KHR_texture_basisu?: { source: number } } }[];
  images: { name: string; mimeType: string; bufferView: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  extensionsRequired?: string[];
}

/** Everything about a tier file that is not a picture: the scene graph, the meshes, every
 *  accessor's shape and bounds, the materials. Buffer views are left out (a smaller map moves
 *  their offsets). */
function shape({ json }: { json: GlbJson }): string {
  return JSON.stringify({
    scenes: json.scenes,
    nodes: json.nodes,
    meshes: json.meshes,
    accessors: json.accessors.map((a) => ({
      componentType: a.componentType,
      count: a.count,
      type: a.type,
      normalized: a.normalized ?? false,
      min: a.min,
      max: a.max,
    })),
    materials: json.materials,
    textures: json.textures,
    extensionsRequired: json.extensionsRequired,
  });
}

/** Each image's name, type and pixel size (read from its KTX2 header). */
function images({ json, bin }: { json: GlbJson; bin: Buffer }) {
  return json.images.map((img) => {
    const view = json.bufferViews[img.bufferView];
    const at = view.byteOffset ?? 0;
    return {
      name: img.name,
      mime: img.mimeType,
      w: bin.readUInt32LE(at + 20),
      h: bin.readUInt32LE(at + 24),
    };
  });
}

function node(name: string): GltfNode {
  const found = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === name);
  if (!found) throw new Error(`no node ${name}`);
  return found;
}

function trianglesUnder(n: GltfNode): number {
  let total = 0;
  const walk = (m: GltfNode): void => {
    for (const prim of m.getMesh()?.listPrimitives() ?? []) {
      total += (prim.getIndices()?.getCount() ?? 0) / 3;
    }
    for (const child of m.listChildren()) walk(child);
  };
  walk(n);
  return total;
}

interface TavernExtras {
  tiers: Record<string, string[]>;
  shell: string[];
  hall: { eave: number; ridge: number; truss: number };
  door: number[];
  nookRadius: number;
}

function extras(): TavernExtras {
  return (node('MirefenTavern_ROOT').getExtras() as { mirefenTavern: TavernExtras }).mirefenTavern;
}

let io: NodeIO;

/** The painted maps' table (scripts/assets/mirefen_tavern/textures.json). */
const TEXTURES = JSON.parse(
  readFileSync(path.join(ROOT, 'scripts/assets/mirefen_tavern/textures.json'), 'utf8'),
) as {
  headroom: number;
  materials: Record<string, { color: string; normal?: string; roughness: number }>;
};

/** sRGB to linear, one channel. */
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('mirefen tavern GLB', () => {
  it('ships the pinned bytes of every texture tier, in the media manifest', () => {
    for (const tier of TIERS) {
      const bytes = readFileSync(tierFile(tier));
      expect(bytes.length, tier).toBe(SHIPPED[tier].bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), tier).toBe(SHIPPED[tier].sha256);
      expect(bytes.toString('latin1'), tier).toContain('EXT_meshopt_compression');
      const suffix = MIREFEN_TAVERN_ASSET.tiers[tier].suffix.replace('.', '\\.');
      expect(MEDIA_ASSETS[tierTarget(tier).replace(/^public\//, '')], tier).toMatch(
        new RegExp(`^/media/models/props/mirefen_tavern${suffix}\\.[0-9a-f]{12}\\.glb$`),
      );
    }
  });

  it('is credited as original project art wearing the painted town maps', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    const row = credits.split('\n').find((line) => line.includes('Mirefen tavern (`public/'));
    expect(row).toContain('Mirefen tavern (`public/models/props/mirefen_tavern.glb`');
    expect(row).toContain('mirefen_tavern.half.glb');
    expect(row).toContain('mirefen_tavern.quarter.glb');
    expect(row).toContain('town_tex_painted_var/fenrire');
  });

  it('carries the live source fingerprint, every tier', async () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
    // every painted map and the map table are fingerprinted inputs
    for (const spec of Object.values(TEXTURES.materials)) {
      for (const file of [spec.color, spec.normal].filter((f): f is string => !!f)) {
        expect(MIREFEN_TAVERN_ASSET.inputs).toContain(`scripts/assets/mirefen_tavern/${file}`);
      }
    }
    expect(MIREFEN_TAVERN_ASSET.inputs).toContain('scripts/assets/mirefen_tavern/textures.json');
    expect(MIREFEN_TAVERN_ASSET.inputs).toContain(
      'scripts/assets/mirefen_tavern/tavern_texture.py',
    );
    for (const tier of TIERS.filter((t) => t !== 'full')) {
      const tierDoc = await io.read(tierFile(tier));
      expect(tierDoc.getRoot().getExtras(), tier).toEqual(doc.getRoot().getExtras());
    }
  });

  it('was built from the live layout: the sim content and the terrain under it', () => {
    const committed = JSON.parse(readFileSync(path.join(ROOT, MIREFEN_TAVERN_LAYOUT_FILE), 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(mirefenTavernLayout())));
  });

  it('keeps every named part the runtime keeps, sheds or cuts away, under one root', () => {
    const root = doc.getRoot().listScenes()[0].listChildren();
    expect(root.map((n) => n.getName())).toEqual(['MirefenTavern_ROOT']);
    for (const name of MIREFEN_TAVERN_ASSET.requiredNodes) expect(node(name)).toBeTruthy();
    for (const part of [...TAVERN_CRITICAL_PARTS, ...TAVERN_TRIM_PARTS, ...TAVERN_OPTIONAL_PARTS]) {
      expect(node(part).getParentNode()?.getName(), part).toBe('MirefenTavern_ROOT');
      expect(trianglesUnder(node(part)), part).toBeGreaterThan(0);
    }
    expect(extras().tiers).toEqual({
      low: [...TAVERN_CRITICAL_PARTS],
      medium: [...TAVERN_TRIM_PARTS],
      high: [...TAVERN_OPTIONAL_PARTS],
    });
    expect(extras().shell).toEqual([...TAVERN_SHELL_PARTS]);
  });

  it('wears the painted maps on its painted materials, the rest untextured, and nothing animates', () => {
    const root = doc.getRoot();
    const materials = root.listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual(MIREFEN_TAVERN_ASSET.materials);
    // the seven painted materials of the map table, and the metal, the glow and the plain rest
    expect(MIREFEN_TAVERN_ASSET.painted).toEqual(Object.keys(TEXTURES.materials).sort());
    expect(MIREFEN_TAVERN_ASSET.painted).toEqual([
      'TavernCloth',
      'TavernDressed',
      'TavernFloor',
      'TavernPlaster',
      'TavernRoof',
      'TavernStone',
      'TavernTimber',
    ]);
    const full = MIREFEN_TAVERN_ASSET.tiers.full;
    for (const m of materials) {
      const name = m.getName();
      const spec = TEXTURES.materials[name];
      // the vertex colour is the whole colour (times the map): no factor tints it
      expect(m.getBaseColorFactor(), name).toEqual([1, 1, 1, 1]);
      if (!spec) {
        expect(m.getBaseColorTexture(), name).toBeNull();
        expect(m.getNormalTexture(), name).toBeNull();
        // an untextured material's vertex colours are drawn as they are
        expect((m.getExtras() as { vertexColourScale?: number }).vertexColourScale, name).toBe(
          undefined,
        );
        continue;
      }
      // a painted material's vertex colours sit under the headroom: its extras name the factor
      // the runtime multiplies them back by (src/render/vertex_colour_glb_parts.ts)
      expect(m.getExtras(), name).toEqual({ vertexColourScale: VERTEX_COLOUR_SCALE });
      const color = m.getBaseColorTexture();
      expect(color?.getName(), name).toBe(`${name}_color`);
      expect(color?.getMimeType(), name).toBe('image/ktx2');
      expect(color?.getSize(), name).toEqual([full.color, full.color]);
      expect(m.getRoughnessFactor(), name).toBeCloseTo(spec.roughness, 5);
      expect(m.getMetallicFactor(), name).toBe(0);
      const normal = m.getNormalTexture();
      if (spec.normal) {
        expect(normal?.getName(), name).toBe(`${name}_normal`);
        expect(normal?.getMimeType(), name).toBe('image/ktx2');
        expect(normal?.getSize(), name).toEqual([full.normal, full.normal]);
        // the kit's strength is baked into the map: drawn at scale 1
        expect(m.getNormalScale(), name).toBe(1);
      } else {
        expect(normal, name).toBeNull();
      }
    }
    // one map per slot, none shared, none left over
    const painted = MIREFEN_TAVERN_ASSET.painted;
    const normals = painted.filter((n) => TEXTURES.materials[n].normal).length;
    expect(root.listTextures()).toHaveLength(painted.length + normals);
    expect(normals).toBe(6);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    // the vertex colours on every face; UVs on a painted face only
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const label = `${mesh.getName()} ${prim.getMaterial()?.getName()}`;
        expect(prim.getAttribute('COLOR_0'), label).not.toBeNull();
        const isPainted = painted.includes(prim.getMaterial()?.getName() ?? '');
        expect(prim.getAttribute('TEXCOORD_0') !== null, label).toBe(isPainted);
      }
    }
  });

  it('lays each painted map at its kit repeat on its faces, never across the whole tavern', () => {
    // a painted face's UVs advance a repeat per textures.json `yards` along the face: sampled
    // over every painted triangle, the UV distance per yard stays at the material's own rate
    // (planar per face, so never more than it), and is that rate on most of them
    const uvPerYard = (name: string) =>
      1 / (TEXTURES.materials[name] as unknown as { yards: number }).yards;
    const v = [0, 0, 0];
    const a = [0, 0];
    const b = [0, 0];
    let checked = 0;
    for (const n of doc.getRoot().listNodes()) {
      const mesh = n.getMesh();
      if (!mesh) continue;
      // positions are quantized in the mesh's own frame: measure yards in the world
      const m = n.getWorldMatrix();
      const world = (pos: Accessor, k: number) => {
        pos.getElement(k, v);
        return [
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        ];
      };
      for (const prim of mesh.listPrimitives()) {
        const name = prim.getMaterial()?.getName() ?? '';
        const uv = prim.getAttribute('TEXCOORD_0');
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (!uv || !pos || !idx) continue;
        const want = uvPerYard(name);
        let onRate = 0;
        let edges = 0;
        for (let t = 0; t < idx.getCount(); t += 3) {
          const i = idx.getScalar(t);
          const j = idx.getScalar(t + 1);
          const p = world(pos, i);
          const q = world(pos, j);
          uv.getElement(i, a);
          uv.getElement(j, b);
          const yards = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          if (yards < 0.25) continue;
          const rate = Math.hypot(a[0] - b[0], a[1] - b[1]) / yards;
          expect(rate, `${n.getName()} ${name}`).toBeLessThan(want * 1.05);
          edges++;
          if (Math.abs(rate - want) < want * 0.05) onRate++;
        }
        if (edges > 20) expect(onRate / edges, `${n.getName()} ${name}`).toBeGreaterThan(0.6);
        checked += edges;
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it('stores the painted colours under the headroom, so the warm light lifts the paint unclamped', () => {
    // the factor the runtime multiplies a painted vertex colour back by undoes the headroom:
    // the Blender export ships a stored colour v as srgbToLinear(v), so a tint of 1 stored at
    // 1 / headroom draws as the map itself
    expect(TEXTURES.headroom).toBe(1.5);
    expect(VERTEX_COLOUR_SCALE).toBe(Number((1 / srgbToLinear(1 / TEXTURES.headroom)).toFixed(6)));
    expect(VERTEX_COLOUR_SCALE).toBeCloseTo(2.4876, 3);
    // every painted corner's brightest channel: the bulk sits under the map's own level
    // (1 / VERTEX_COLOUR_SCALE, about 0.4: tints, the dim far corners, the shaded feet of the
    // walls), the warm light and shiplib's wear lift the brightest well above the map, and
    // almost none reaches the clamp (with no headroom a tint of 1 sat AT the clamp, and every
    // lift was cut off: the light could only shift the hue)
    const values: number[] = [];
    const c = [0, 0, 0, 0];
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const colour = prim.getAttribute('COLOR_0');
        if (!colour || !prim.getMaterial()?.getBaseColorTexture()) continue;
        for (let i = 0; i < colour.getCount(); i++) {
          colour.getElement(i, c);
          values.push(Math.max(c[0], c[1], c[2]));
        }
      }
    }
    values.sort((x, y) => x - y);
    expect(values.length).toBeGreaterThan(100000);
    const at = (f: number) => values[Math.floor((values.length - 1) * f)];
    const mapLevel = 1 / VERTEX_COLOUR_SCALE;
    expect(at(0.5)).toBeGreaterThan(mapLevel * 0.4);
    expect(at(0.5)).toBeLessThan(mapLevel);
    expect(at(0.99) * VERTEX_COLOUR_SCALE).toBeGreaterThan(1.3);
    expect(values.filter((v) => v >= 0.995).length / values.length).toBeLessThan(0.001);
  });

  it("keeps the roofs' covering out of the warm bake: every slate the moss map's own grey", () => {
    // the slates tint by brightness alone (the moss is in the map), and the roof is all
    // outside: the hall's bake box reaches up under the ridge, and its lanterns once warmed
    // the slates through the sarking, wearing the grey moss slates brick red from the road
    const c = [0, 0, 0, 0];
    let corners = 0;
    let worst = { off: 0, mesh: '' };
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMaterial()?.getName() !== 'TavernRoof') continue;
        const colour = prim.getAttribute('COLOR_0');
        if (!colour) continue;
        for (let i = 0; i < colour.getCount(); i++) {
          colour.getElement(i, c);
          corners++;
          const off = Math.max(Math.abs(c[0] - c[1]), Math.abs(c[0] - c[2]));
          if (off > worst.off) worst = { off, mesh: mesh.getName() };
        }
      }
    }
    expect(corners).toBeGreaterThan(20000);
    expect(worst.off, worst.mesh).toBeLessThan(1 / 255);
  });

  it('ships its texture tiers: the same model with every map at half and a quarter of its size', () => {
    const base = readGlb(GLB);
    const baseImages = images(base);
    expect(baseImages).toHaveLength(13);
    for (const tier of TIERS.filter((t) => t !== 'full')) {
      const file = readGlb(tierFile(tier));
      expect(shape(file), tier).toBe(shape(base));
      const sizes = MIREFEN_TAVERN_ASSET.tiers[tier];
      expect(
        images(file).map(({ name, mime, w, h }) => ({ name, mime, w, h })),
        tier,
      ).toEqual(
        baseImages.map((img) => {
          const size = img.name.endsWith('_normal') ? sizes.normal : sizes.color;
          return { ...img, w: size, h: size };
        }),
      );
      expect(readFileSync(tierFile(tier)).length, tier).toBeLessThan(readFileSync(GLB).length);
    }
    // the tier rule's half and quarter, every map on the four-pixel block grid
    const { full, half, quarter } = MIREFEN_TAVERN_ASSET.tiers;
    for (const kind of ['color', 'normal'] as const) {
      expect(half[kind]).toBe(full[kind] / 2);
      expect(quarter[kind]).toBe(full[kind] / 4);
      expect(quarter[kind] % 4).toBe(0);
    }
    for (const img of baseImages) expect(img.mime).toBe('image/ktx2');
    // the loader finds each tier through the media manifest (placed_texture_tier_core.ts)
    const exists = (p: string) => MEDIA_ASSETS[p.replace(/^\/+/, '')] !== undefined;
    const model = '/models/props/mirefen_tavern.glb';
    expect(placedTextureTierPath(model, 'full', exists)).toBe(model);
    expect(placedTextureTierPath(model, 'half', exists)).toBe(
      '/models/props/mirefen_tavern.half.glb',
    );
    expect(placedTextureTierPath(model, 'quarter', exists)).toBe(
      '/models/props/mirefen_tavern.quarter.glb',
    );
  });

  it('holds each part to its triangle budget, the low tier inside it', () => {
    let total = 0;
    for (const [name, count] of Object.entries(TRIANGLES)) {
      expect(trianglesUnder(node(name)), name).toBe(count);
      total += count;
    }
    expect(trianglesUnder(node('MirefenTavern_ROOT'))).toBe(total);
    // a whole inn with its booths, stage, nook, kitchen and hammerbeam roof, and since the
    // exterior pass its grounds: under 112k in all, the low tier under 90k, the shipped file
    // under 1600 KiB. Raised from 72.5k, 58k and 1100 KiB for the exterior the road sees: the
    // jettied upper storey with its bressumer, joists and carved brackets (the front's parts),
    // leaded diamond panes on every window, four dormers, a roof of irregular mossy shingles
    // with deep eaves (HallRoof, about 6k over the old slates), the weathering decals, and the
    // grounds (TavernGrounds, about 11k: the forecourt's bed, the terrace's tables, benches,
    // posts and lantern strings, the open stable, the trough, the hay, the cart and the
    // woodpile), all of it outside, merged per material (one mesh per material and one per
    // material of each shell part). The cobbles (trim), straw, sacks and moss cushions
    // (clutter) are shed below medium and high.
    expect(total).toBeLessThan(112000);
    const low = TAVERN_CRITICAL_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(low).toBeLessThan(90000);
    // The files: the model under 3600 KiB, its .half under 2600 KiB and its .quarter (what a
    // phone loads) under 2350 KiB. Raised from 1600 KiB for the painted maps, the triangles
    // unchanged: the full tier's seven colour maps at 1024 and six normal maps at 128 (KTX2,
    // about 1.35 MB; 0.40 MB at half, 0.11 MB at a quarter) and the float UVs every painted
    // face carries in every tier (they repeat far past [0, 1], so they cannot be normalized,
    // and a texture transform to quantize them would clone each map: about 0.64 MB over the
    // texture-free model after meshopt).
    expect(readFileSync(GLB).length).toBeLessThan(3600 * 1024);
    expect(readFileSync(tierFile('half')).length).toBeLessThan(2600 * 1024);
    expect(readFileSync(tierFile('quarter')).length).toBeLessThan(2350 * 1024);
  });

  it("stamps the sim's numbers, all generous next to the player", () => {
    const e = extras();
    expect(e.hall).toEqual({
      eave: TAVERN_HALL.eave,
      ridge: TAVERN_HALL.ridge,
      truss: TAVERN_HALL.truss,
    });
    expect(e.door).toEqual([TAVERN_DOOR.width, TAVERN_DOOR.height]);
    expect(e.nookRadius).toBe(TAVERN_TOWER.rIn);
    expect(e.door[1]).toBeGreaterThan(1.7 * PLAYER_H);
    // open to the roof: nothing crosses the room under the hammer beams, near four bodies up
    expect(e.hall.truss).toBeGreaterThan(3.5 * PLAYER_H);
  });

  it('keeps the common room clear of timber between the tables and the top of the air', () => {
    // no beam, brace, joist or hung thing crosses the room where the camera flies: over the
    // floor's furniture (the settles' backs, the candles) and under the camera's air top
    // (render/mirefen_tavern_interior_core.ts), inside the hall clear of its walls, only the bar
    // (its pillar, which cuts away, the kegs and the racks behind it), the wall fire and the
    // trophies an arm's length off the walls stand
    const lo = 2.9;
    const hi = TAVERN_HALL_AIR_TOP;
    const offenders: string[] = [];
    const v = [0, 0, 0];
    for (const n of doc.getRoot().listNodes()) {
      const mesh = n.getMesh();
      if (!mesh) continue;
      const m = n.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        if (!pos || !idx) continue;
        const pt = (k: number): [number, number, number] => {
          pos.getElement(k, v);
          return [
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
          ];
        };
        for (let t = 0; t < idx.getCount(); t += 3) {
          const a = pt(idx.getScalar(t));
          const b = pt(idx.getScalar(t + 1));
          const c = pt(idx.getScalar(t + 2));
          const x = (a[0] + b[0] + c[0]) / 3;
          const y = (a[1] + b[1] + c[1]) / 3;
          const z = (a[2] + b[2] + c[2]) / 3;
          if (y <= lo || y >= hi) continue;
          if (Math.abs(x) > TAVERN_HALL.x1 - TAVERN_HALL.wall - 1.2) continue;
          if (z < TAVERN_HALL.z0 + TAVERN_HALL.wall + 1.2) continue;
          if (z > TAVERN_HALL.z1 - TAVERN_HALL.wall - 1.2) continue;
          if (x > 2.0 && z < -4.0) continue; // the bar
          if (x > 13.2 && Math.abs(z - 2.5) < 2.6) continue; // the wall fire and its jawbone
          offenders.push(`${n.getName()} at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
        }
      }
    }
    expect(offenders.slice(0, 12)).toEqual([]);
  });

  it("draws each piece of the front where the camera's cutaway looks for it", () => {
    // the front wall's three parts meet at TAVERN_FRONT_SPLIT either side of the door
    // (mirefen_tavern_core.ts BOX_VOLUMES): no solid of one reaches into another's span, so the
    // piece a sight line crosses is the piece that ghosts
    const v = [0, 0, 0];
    const xs = (name: string): number[] => {
      const out: number[] = [];
      const n = node(name);
      const m = n.getWorldMatrix();
      for (const prim of n.getMesh()?.listPrimitives() ?? []) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        for (let k = 0; k < pos.getCount(); k++) {
          pos.getElement(k, v);
          out.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]);
        }
      }
      return out;
    };
    const slack = 0.2;
    for (const x of xs('HallWallFront')) {
      expect(Math.abs(x), 'HallWallFront').toBeLessThanOrEqual(TAVERN_FRONT_SPLIT + slack);
    }
    for (const x of xs('HallWallFrontLeft')) {
      expect(x, 'HallWallFrontLeft').toBeLessThanOrEqual(-TAVERN_DOOR.width / 2 + slack);
    }
    for (const x of xs('HallWallFrontRight')) {
      expect(x, 'HallWallFrontRight').toBeGreaterThanOrEqual(TAVERN_DOOR.width / 2 - slack);
    }
    // ...and the side parts' walls start at the split, their door leaves inside it
    const left = xs('HallWallFrontLeft');
    expect(Math.max(...left)).toBeGreaterThan(-TAVERN_FRONT_SPLIT - 0.5);
  });

  it('stands every piece outside on the terrain, colliding there', () => {
    // a piece outside on the terrain (the steps' and the terrace's flower tubs, and everything
    // on the grounds but the dog on the porch) carries the ground's height under its middle
    // (baseY): the model seats it there and the sim's collider tops it there
    const outside = TAVERN_PROPS.filter((p) => p.baseY !== undefined);
    expect(outside.filter((p) => p.kind === 'planter')).toHaveLength(4);
    expect(outside.length).toBeGreaterThan(20);
    const layout = mirefenTavernLayout().props;
    for (const p of outside) {
      const w = tavernToWorld(p.x, p.z);
      const ground = terrainHeight(w.x, w.z, WORLD_SEED) - TAVERN_FLOOR_Y;
      expect(Math.abs((p.baseY ?? 0) - ground), `${p.kind} ${p.x}`).toBeLessThan(0.02);
      expect(tavernPropBaseY(p)).toBe(p.baseY);
      const c = tavernPropCollider(p);
      if (p.standable) {
        expect(c.moveTopY).toBeCloseTo(TAVERN_FLOOR_Y + ground + p.height, 1);
        expect(c.standable).toBe(true);
      }
      expect(layout.some((q) => q.kind === p.kind && q.x === p.x && q.base === p.baseY)).toBe(true);
    }
  });

  it('stands on the ground floor at its origin, the base running down into the ground', () => {
    const scene = doc.getRoot().listScenes()[0];
    expect(scene.listChildren()[0].getTranslation()).toEqual([0, 0, 0]);
    const { min, max } = getBounds(scene);
    // the stone base reaches down under the lowest ground round the building
    expect(min[1]).toBeLessThan(-2.5);
    // the tallest things are the tower's finial over its hat and the hood's flue cap
    expect(max[1]).toBeGreaterThan(TAVERN_TOWER.peak + 1.5);
    expect(max[1]).toBeGreaterThan(TAVERN_HOOD.flueTop);
    expect(max[1]).toBeLessThan(TAVERN_TOWER.peak + 3);
  });
});
