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
  HIGHWATCH_MANOR_ASSET,
  type HighwatchManorTier,
  mergeManorCollision,
  sourceFingerprint,
  tierTarget,
  VERTEX_COLOUR_SCALE,
} from '../scripts/assets/highwatch_manor/build.mjs';
import {
  documentTriangles,
  findCoplanarOverlaps,
  type ManorTriangle,
  visibleOverlaps,
} from '../scripts/assets/highwatch_manor/coplanar.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { isPlacedBuildingInterior } from '../src/render/eastbrook_placed_building';
import { placedTextureTierPath } from '../src/render/placed_texture_tier_core';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';

// The shipped Highwatch manor GLB (public/models/tidehold/highwatch/manor.glb), built in Blender
// by scripts/assets/highwatch_manor/build_manor.py and shipped by build.mjs, which also merges
// the collision rows the same Blender run writes into data/asset_collision_overrides.json.
// Pins the bytes, the live source fingerprint, the named parts the town view draws (the G_INT
// ones cast no shadow), the painted maps on the painted materials (Highwatch's Alpine slate
// look of the painted town, scripts/assets/highwatch_manor/textures.json) and the untextured
// rest, the painted vertex colours stored under their headroom, the texture-tier files beside
// the model, the triangle and size budgets, the footing the town buries, the door and the open
// roof the camera's air is cut to, and the collision rows. Re-pin the sha256, size and
// triangle literals only with a re-export.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, HIGHWATCH_MANOR_ASSET.target);
/** Each texture tier's file: its bytes and sha256 (the model first). */
const SHIPPED: Record<HighwatchManorTier, { bytes: number; sha256: string }> = {
  full: {
    bytes: 2537736,
    sha256: '4e6916d09c375700f53e83dc3b2035fbb459ace3465025bfc046dd748fec4f69',
  },
  half: {
    bytes: 1712476,
    sha256: 'fe8cd7a21efe7f643ff99331fa17668042e1a652f3dd3fffa6d57eb0c6771aa2',
  },
  quarter: {
    bytes: 1464972,
    sha256: '5e076cdc3b40e68283b2e0a49a5c6c31fb3b5fde51f559b1b95bd7eadb187ea5',
  },
};
const TIERS = Object.keys(SHIPPED) as HighwatchManorTier[];
const tierFile = (tier: HighwatchManorTier) => path.join(ROOT, tierTarget(tier));
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  ManorShell: 25418,
  ManorRoof: 14278,
  ManorTrim: 5982,
  ManorGrounds: 7256,
  ManorGlow: 3006,
  G_INT_Timber: 3542,
  G_INT_Furnishings: 18507,
};

let doc: Document;
let io: NodeIO;

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

interface ManorExtras {
  floor: number;
  door: number[];
  hall: { plate: number; ridge: number; truss: number };
  lantern: number[];
}

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

/** The painted maps' table (scripts/assets/highwatch_manor/textures.json). */
const TEXTURES = JSON.parse(
  readFileSync(path.join(ROOT, 'scripts/assets/highwatch_manor/textures.json'), 'utf8'),
) as {
  headroom: number;
  materials: Record<string, { color: string; normal?: string; roughness: number; yards: number }>;
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

describe('the Highwatch manor GLB', () => {
  it('ships the pinned bytes of every texture tier, in the media manifest', () => {
    for (const tier of TIERS) {
      const bytes = readFileSync(tierFile(tier));
      expect(bytes.length, tier).toBe(SHIPPED[tier].bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), tier).toBe(SHIPPED[tier].sha256);
      expect(bytes.toString('latin1'), tier).toContain('EXT_meshopt_compression');
      const suffix = HIGHWATCH_MANOR_ASSET.tiers[tier].suffix.replace('.', '\\.');
      expect(MEDIA_ASSETS[tierTarget(tier).replace(/^public\//, '')], tier).toMatch(
        new RegExp(`^/media/models/tidehold/highwatch/manor${suffix}\\.[0-9a-f]{12}\\.glb$`),
      );
    }
  });

  it('is credited as project art wearing the painted town maps', () => {
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    const row = credits.split('\n').find((line) => line.includes('Highwatch manor (`public/'));
    expect(row).toContain('Highwatch manor (`public/models/tidehold/highwatch/manor.glb`');
    expect(row).toContain('manor.half.glb');
    expect(row).toContain('manor.quarter.glb');
    for (const source of [
      'town_tex_painted_var/harbour',
      'town_tex_painted_pat/harbour/roof_square_slate',
      'town_tex_painted_pat/harbour/stone_ashlar',
      'town_tex_painted/TownPropCloth',
    ]) {
      expect(row, source).toContain(source);
    }
  });

  it('carries the live source fingerprint, every tier', async () => {
    expect(doc.getRoot().getExtras()).toMatchObject({
      authoring: 'Blender',
      sourceFingerprint: sourceFingerprint(),
    });
    // every painted map, the map table and the painter are fingerprinted inputs
    for (const spec of Object.values(TEXTURES.materials)) {
      for (const file of [spec.color, spec.normal].filter((f): f is string => !!f)) {
        expect(HIGHWATCH_MANOR_ASSET.inputs).toContain(`scripts/assets/highwatch_manor/${file}`);
      }
    }
    expect(HIGHWATCH_MANOR_ASSET.inputs).toContain('scripts/assets/highwatch_manor/textures.json');
    expect(HIGHWATCH_MANOR_ASSET.inputs).toContain(
      'scripts/assets/highwatch_manor/manor_texture.py',
    );
    for (const tier of TIERS.filter((t) => t !== 'full')) {
      const tierDoc = await io.read(tierFile(tier));
      expect(tierDoc.getRoot().getExtras(), tier).toEqual(doc.getRoot().getExtras());
    }
  });

  it('keeps its named parts under one root, the interior ones in shadowless groups', () => {
    const roots = doc.getRoot().listScenes()[0].listChildren();
    expect(roots.map((n) => n.getName())).toEqual(['HighwatchManor_ROOT']);
    const parts = roots[0].listChildren().map((n) => n.getName());
    expect([...parts].sort()).toEqual(Object.keys(TRIANGLES).sort());
    // the town view casts no shadow from a part under a G_INT group
    // (render/eastbrook_placed_building.ts): the trusses and the furniture are indoors
    for (const name of ['G_INT_Timber', 'G_INT_Furnishings']) {
      expect(isPlacedBuildingInterior({ name, parent: null } as never), name).toBe(true);
    }
    for (const name of ['ManorShell', 'ManorRoof', 'ManorGrounds']) {
      expect(isPlacedBuildingInterior({ name, parent: null } as never), name).toBe(false);
    }
  });

  it('wears the painted maps on its painted materials, the rest untextured, unskinned and still', () => {
    const root = doc.getRoot();
    const materials = root.listMaterials();
    expect(materials.map((m) => m.getName()).sort()).toEqual([...HIGHWATCH_MANOR_ASSET.materials]);
    // the six painted materials of the map table (every stone the jointless dressed granite:
    // the manor models its blocks and joints); the metal, the glass, the glows and the plain
    // rest draw untextured
    expect(HIGHWATCH_MANOR_ASSET.painted).toEqual(Object.keys(TEXTURES.materials).sort());
    expect(HIGHWATCH_MANOR_ASSET.painted).toEqual([
      'ManorCloth',
      'ManorDressed',
      'ManorFloor',
      'ManorPlaster',
      'ManorSlate',
      'ManorTimber',
    ]);
    const full = HIGHWATCH_MANOR_ASSET.tiers.full;
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
      // the loader multiplies its colour by (src/render/vertex_colour_glb_parts.ts)
      expect(m.getExtras(), name).toEqual({ vertexColourScale: VERTEX_COLOUR_SCALE });
      const color = m.getBaseColorTexture();
      expect(color?.getName(), name).toBe(`${name}_color`);
      expect(color?.getMimeType(), name).toBe('image/ktx2');
      expect(color?.getSize(), name).toEqual([full.color, full.color]);
      expect(m.getRoughnessFactor(), name).toBeCloseTo(spec.roughness, 5);
      expect(m.getMetallicFactor(), name).toBe(0);
      // every painted map has its normal map, the kit's strength baked in: drawn at scale 1
      const normal = m.getNormalTexture();
      expect(normal?.getName(), name).toBe(`${name}_normal`);
      expect(normal?.getMimeType(), name).toBe('image/ktx2');
      expect(normal?.getSize(), name).toEqual([full.normal, full.normal]);
      expect(m.getNormalScale(), name).toBe(1);
    }
    // one map per slot, none shared, none left over: six colour and six normal maps
    expect(root.listTextures()).toHaveLength(12);
    expect(root.listSkins()).toHaveLength(0);
    expect(root.listAnimations()).toHaveLength(0);
    // the lit glass glows warm amber (a glTF emission cannot read the vertex colours, so the
    // glowing materials carry their own hue); the coloured glass glows faintly
    const glow = materials.find((m) => m.getName() === 'ManorGlow');
    const [r, g, b] = glow?.getEmissiveFactor() ?? [0, 0, 0];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
    const glass = materials.find((m) => m.getName() === 'ManorGlass');
    expect(Math.max(...(glass?.getEmissiveFactor() ?? [0]))).toBeLessThan(r);
    // the stained glass's colours each glow in their own hue: blue, garnet and gold
    const hue = (name: string) =>
      materials.find((m) => m.getName() === name)?.getEmissiveFactor() ?? [0, 0, 0];
    const [br, bg, bb] = hue('ManorGlassBlue');
    expect(bb).toBeGreaterThan(Math.max(br, bg));
    const [rr, rg, rb] = hue('ManorGlassRed');
    expect(rr).toBeGreaterThan(Math.max(rg, rb) * 3);
    const [gr, gg, gb] = hue('ManorGlassGold');
    expect(gr).toBeGreaterThan(gg);
    expect(gg).toBeGreaterThan(gb);
    // the warm lights come in four tones, every one warm, no two alike: amber and honey
    // windows, the brighter lanterns, the softer candle flames
    const warm = ['ManorGlow', 'ManorGlowSoft', 'ManorGlowLantern', 'ManorGlowCandle'].map(hue);
    for (const [wr, wg, wb] of warm) {
      expect(wr).toBeGreaterThan(wg);
      expect(wg).toBeGreaterThan(wb);
    }
    expect(new Set(warm.map((c) => c.map((v) => v.toFixed(2)).join(','))).size).toBe(4);
    // the vertex colours on every face; UVs on a painted face only
    const painted = HIGHWATCH_MANOR_ASSET.painted;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const label = `${mesh.getName()} ${prim.getMaterial()?.getName()}`;
        expect(prim.getAttribute('COLOR_0'), label).not.toBeNull();
        const isPainted = painted.includes(prim.getMaterial()?.getName() ?? '');
        expect(prim.getAttribute('TEXCOORD_0') !== null, label).toBe(isPainted);
      }
    }
  });

  it('lays each painted map at its kit repeat on its faces, never across the whole manor', () => {
    // a painted face's UVs advance a repeat per textures.json `yards` along the face: sampled
    // over every painted triangle, the UV distance per yard stays at the material's own rate
    // (planar per face, so never more than it), and is that rate on most of them
    const v = [0, 0, 0];
    const a = [0, 0];
    const b = [0, 0];
    let checked = 0;
    const seen = new Set<string>();
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
        const repeat = TEXTURES.materials[name].yards;
        const want = 1 / repeat;
        // edges long enough to measure (a quarter yard, or a quarter of the cloth's short repeat)
        const shortest = Math.min(0.25, repeat / 4);
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
          if (yards < shortest) continue;
          const rate = Math.hypot(a[0] - b[0], a[1] - b[1]) / yards;
          expect(rate, `${n.getName()} ${name}`).toBeLessThan(want * 1.05);
          edges++;
          if (Math.abs(rate - want) < want * 0.05) onRate++;
        }
        if (edges > 20) expect(onRate / edges, `${n.getName()} ${name}`).toBeGreaterThan(0.6);
        if (edges > 0) seen.add(name);
        checked += edges;
      }
    }
    expect([...seen].sort()).toEqual([...HIGHWATCH_MANOR_ASSET.painted]);
    expect(checked).toBeGreaterThan(10000);
  });

  it('stores the painted colours under the headroom, so the warm light lifts the paint unclamped', () => {
    // the factor the loader multiplies a painted material's colour by undoes the headroom:
    // the Blender export ships a stored colour v as srgbToLinear(v), so a tint of 1 stored at
    // 1 / headroom draws as the map itself
    expect(TEXTURES.headroom).toBe(1.5);
    expect(VERTEX_COLOUR_SCALE).toBe(Number((1 / srgbToLinear(1 / TEXTURES.headroom)).toFixed(6)));
    expect(VERTEX_COLOUR_SCALE).toBeCloseTo(2.4876, 3);
    // every painted corner's brightest channel: the bulk sits under the map's own level
    // (1 / VERTEX_COLOUR_SCALE, about 0.4: the darker family members, the baked occlusion, the
    // grime and the eaves' shade over the paint), the warm light lifts the brightest above the
    // map, and almost none reaches the clamp (with no headroom a tint of 1 sat AT the clamp,
    // and every lift was cut off: the light could only shift the hue)
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
    expect(values.length).toBeGreaterThan(80000);
    const at = (f: number) => values[Math.floor((values.length - 1) * f)];
    const mapLevel = 1 / VERTEX_COLOUR_SCALE;
    expect(at(0.5)).toBeGreaterThan(mapLevel * 0.1);
    expect(at(0.5)).toBeLessThan(mapLevel);
    expect(at(0.99) * VERTEX_COLOUR_SCALE).toBeGreaterThan(1.3);
    expect(values.filter((v) => v >= 0.995).length / values.length).toBeLessThan(0.001);
  });

  it("keeps every slate the map's own blue: the slates carry brightness, never a hue", () => {
    // the slates tint by brightness alone (their blue is in the map), the warm bake leaves the
    // roof out (it is all outside) and the weathering mixes in grey on it, so no corner of the
    // painted roof carries a hue of its own
    const c = [0, 0, 0, 0];
    let corners = 0;
    let worst = { off: 0, mesh: '' };
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMaterial()?.getName() !== 'ManorSlate') continue;
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
    expect(corners).toBeGreaterThan(15000);
    expect(worst.off, worst.mesh).toBeLessThan(1 / 255);
  });

  it('ships its texture tiers: the same model with every map at half and a quarter of its size', () => {
    const base = readGlb(GLB);
    const baseImages = images(base);
    expect(baseImages).toHaveLength(12);
    for (const tier of TIERS.filter((t) => t !== 'full')) {
      const file = readGlb(tierFile(tier));
      expect(shape(file), tier).toBe(shape(base));
      const sizes = HIGHWATCH_MANOR_ASSET.tiers[tier];
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
    const { full, half, quarter } = HIGHWATCH_MANOR_ASSET.tiers;
    for (const kind of ['color', 'normal'] as const) {
      expect(half[kind]).toBe(full[kind] / 2);
      expect(quarter[kind]).toBe(full[kind] / 4);
      expect(quarter[kind] % 4).toBe(0);
    }
    for (const img of baseImages) expect(img.mime).toBe('image/ktx2');
    expect(base.json.extensionsRequired).toContain('KHR_texture_basisu');
    // the town's loader finds each tier through the media manifest (placed_texture_tier_core.ts)
    const exists = (p: string) => MEDIA_ASSETS[p.replace(/^\/+/, '')] !== undefined;
    const model = '/models/tidehold/highwatch/manor.glb';
    expect(placedTextureTierPath(model, 'full', exists)).toBe(model);
    expect(placedTextureTierPath(model, 'half', exists)).toBe(
      '/models/tidehold/highwatch/manor.half.glb',
    );
    expect(placedTextureTierPath(model, 'quarter', exists)).toBe(
      '/models/tidehold/highwatch/manor.quarter.glb',
    );
  });

  it('stays inside its triangle budget, part by part, and its files inside theirs', () => {
    let total = 0;
    for (const [name, want] of Object.entries(TRIANGLES)) {
      const got = trianglesUnder(node(name));
      expect(got, name).toBe(want);
      total += got;
    }
    // the proposal's budget: 50,000 to 70,000 with all the furniture, never past 90,000 (the
    // exterior detail pass, the cresting, corbels and leaded glass, spends some of that headroom)
    expect(total).toBeGreaterThanOrEqual(50_000);
    expect(total).toBeLessThanOrEqual(90_000);
    // The files: the model under 2560 KiB, its .half under 1750 KiB and its .quarter (what a
    // phone loads) under 1500 KiB, the triangles unchanged. Raised from the texture-free model's
    // 1.02 MB (one file) for the painted maps: the full tier's six colour maps at 1024 and six
    // normal maps at 128 (KTX2, about 1.17 MB; 0.34 MB at half, 0.09 MB at a quarter), and the
    // float UVs every painted face carries in every tier (they repeat far past [0, 1], so they
    // cannot be normalized, and a texture transform to quantize them would clone each map:
    // about 0.35 MB over the texture-free model after meshopt).
    expect(readFileSync(GLB).length).toBeLessThan(2560 * 1024);
    expect(readFileSync(tierFile('half')).length).toBeLessThan(1750 * 1024);
    expect(readFileSync(tierFile('quarter')).length).toBeLessThan(1500 * 1024);
  });

  it('stands on a yard of footing, as wide and deep as its record reaches', () => {
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    // the painted set's seat: the ground line at y 0 and a yard of footing under it
    expect(bounds.min[1]).toBeCloseTo(-1, 2);
    const manor = HIGHWATCH_BUILDINGS_BY_ID.highwatch_manor;
    const reach = manor.reach;
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(reach.halfWidth * 2, 2);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(reach.halfDepth * 2, 2);
    // centred across, the garden in front (-z), the dais bay behind
    expect(bounds.min[0] + bounds.max[0]).toBeCloseTo(0, 3);
    expect(bounds.min[2]).toBeLessThan(-25);
    expect(bounds.max[2]).toBeGreaterThan(15);
  });

  it('stamps the door, the open roof and the lantern the camera and the town read', () => {
    const extras = (node('HighwatchManor_ROOT').getExtras() as { highwatchManor: ManorExtras })
      .highwatchManor;
    // a grand door: 3.6 wide, 5.2 high over the floor (a player stands 2.6)
    expect(extras.door).toEqual([3.6, 5.2]);
    expect(extras.floor).toBeCloseTo(0.6, 9);
    // the great hall: walls of 10.5, the ridge at 19, nothing of the roof under 11 over the floor
    expect(extras.hall.plate - extras.floor).toBeCloseTo(10.5, 9);
    expect(extras.hall.ridge - extras.floor).toBeCloseTo(19, 9);
    expect(extras.hall.truss - extras.floor).toBeGreaterThanOrEqual(11);
    // the lantern stands over the ridge, over the hearth
    expect(extras.lantern[1]).toBeGreaterThan(extras.hall.ridge);
    expect(extras.lantern[0]).toBe(0);
    expect(extras.lantern[2]).toBe(0);
  });

  it('ships the collision rows the Blender run wrote, under the model id', () => {
    const written = JSON.parse(
      readFileSync(path.join(ROOT, HIGHWATCH_MANOR_ASSET.collision), 'utf8'),
    ) as { size: number; rows: unknown };
    const table = JSON.parse(
      readFileSync(path.join(ROOT, 'data/asset_collision_overrides.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(table[HIGHWATCH_MANOR_ASSET.collisionId]).toEqual(written.rows);
    // the rows are stored in multiples of the model's largest dimension
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    expect(written.size).toBeCloseTo(
      Math.max(...[0, 1, 2].map((i) => bounds.max[i] - bounds.min[i])),
      1,
    );
    // merging is idempotent and touches nothing else in the table's text
    const raw = readFileSync(path.join(ROOT, 'data/asset_collision_overrides.json'), 'utf8');
    expect(mergeManorCollision(raw, written.rows)).toBe(raw);
  });
});

// Two flat squares facing up, `lift` apart (the second smaller, inside the first).
function stack(lift: number, colorB = [0.9, 0.1, 0.1]): ManorTriangle[] {
  const quad = (y: number, r: number, color: number[], part: string): ManorTriangle[] => [
    { part, material: 'M', a: [-r, y, -r], b: [-r, y, r], c: [r, y, r], color },
    { part, material: 'M', a: [-r, y, -r], b: [r, y, r], c: [r, y, -r], color },
  ];
  return [...quad(0, 2, [0.5, 0.5, 0.5], 'floor'), ...quad(lift, 1, colorB, 'rug')];
}

/**
 * The contacts the audit sees on the shipped model, by group (the two parts and materials, the
 * facing): how many and their area in square yards. Every group but the frame timbers' was
 * already in the texture-free model, the same faces, where an audit that weighed the faces in
 * the order the export wrote them missed them (its cover test breaks ties in that order; it now
 * weighs a canonical order): a door jamb and a corner post flush with (or 3 mm proud of) a
 * wall's plaster, the trophy board under a banner's rod, a plate 3 cm over the high table's
 * cloth, a stud on the high seat, the stone storey's inner face under the arches' thresholds,
 * two slates where the porch roof meets the hall's, slivers where a timber meets plaster. The
 * frame timbers' grew from 2 hits to 14: timbers a little over a centimetre apart that the
 * audit no longer counts as twins, since their colours are now tints over the paint; a
 * centimetre is deep enough for the depth buffer at any range the manor is seen from.
 */
const KNOWN_CONTACTS: Record<string, { hits: number; area: number }> = {
  'G_INT_Furnishings/ManorCloth x G_INT_Furnishings/ManorMetal n=0,1,0': { hits: 5, area: 0.203 },
  'G_INT_Furnishings/ManorMetal x G_INT_Furnishings/ManorTimber n=-1,0,0': {
    hits: 1,
    area: 0.016,
  },
  'G_INT_Furnishings/ManorMetal x G_INT_Furnishings/ManorTimber n=0,0,-1': {
    hits: 3,
    area: 0.08,
  },
  'ManorRoof/ManorSlate x ManorRoof/ManorSlate n=0,0.84,-0.54': { hits: 2, area: 0.068 },
  'ManorShell/ManorDressed x ManorShell/ManorDressed n=-1,0,0': { hits: 9, area: 0.108 },
  'ManorShell/ManorDressed x ManorShell/ManorDressed n=1,0,0': { hits: 9, area: 0.109 },
  'ManorShell/ManorDressed x ManorShell/ManorTimber n=-1,0,0': { hits: 2, area: 0.053 },
  'ManorShell/ManorDressed x ManorShell/ManorTimber n=1,0,0': { hits: 2, area: 0.064 },
  'ManorShell/ManorPlaster x ManorShell/ManorPlaster n=0,1,0': { hits: 1, area: 0.012 },
  'ManorShell/ManorPlaster x ManorShell/ManorTimber n=0,0,-1': { hits: 6, area: 1.944 },
  'ManorShell/ManorPlaster x ManorShell/ManorTimber n=0,1,0': { hits: 7, area: 0.282 },
  'ManorShell/ManorPlaster x ManorShell/ManorTimber n=1,0,0': { hits: 2, area: 0.205 },
  // the frame timbers 1.2 cm apart (2 hits before the paint, 0.019 square yards)
  'ManorShell/ManorTimber x ManorShell/ManorTimber n=0,1,0': { hits: 9, area: 0.062 },
  'ManorShell/ManorTimber x ManorShell/ManorTimber n=1,0,0': { hits: 5, area: 0.069 },
};

describe('the Highwatch manor has no coplanar faces fighting in the depth buffer', () => {
  it('finds a rug a hair over a floor, and lets one a layer over it be', () => {
    const close = stack(0.01);
    expect(visibleOverlaps(close, findCoplanarOverlaps(close)).length).toBeGreaterThan(0);
    const lifted = stack(0.05);
    expect(findCoplanarOverlaps(lifted)).toEqual([]);
    // twins (same material, same colour) draw the same pixel either way
    const twins = stack(0.0, [0.5, 0.5, 0.5]);
    expect(findCoplanarOverlaps(twins)).toEqual([]);
  });

  it('weighs the faces in one order, however the export split them into primitives', async () => {
    // the shipped model with every mesh's primitives in reverse: the audit sorts them back
    const reversed = await io.read(GLB);
    for (const mesh of reversed.getRoot().listMeshes()) {
      const prims = mesh.listPrimitives();
      for (const prim of prims) mesh.removePrimitive(prim);
      for (const prim of [...prims].reverse()) mesh.addPrimitive(prim);
    }
    const order = (triangles: ManorTriangle[]) =>
      triangles.map((t) => `${t.part} ${t.material} ${t.a.join(',')}`);
    expect(order(documentTriangles(reversed))).toEqual(order(documentTriangles(doc)));
  });

  it('finds no new overlap a camera can see across the whole shipped model', () => {
    const triangles = documentTriangles(doc);
    const all = findCoplanarOverlaps(triangles);
    // not vacuous: the model is full of flush joints the audit has to weigh
    expect(all.length).toBeGreaterThan(1000);
    const visible = visibleOverlaps(triangles, all);
    const groups: Record<string, { hits: number; area: number }> = {};
    for (const hit of visible) {
      const key = `${[...hit.parts].sort().join(' x ')} n=${hit.normal.join(',')}`;
      const group = groups[key] ?? { hits: 0, area: 0 };
      group.hits++;
      group.area += hit.area;
      groups[key] = group;
    }
    // every decal-like piece (rugs, banners, tapestries, the crest, the furniture, the garden's
    // paving and beds, the glass) stands a real layer clear of what it lies on, and nothing
    // fights but the known contacts above: a new one anywhere turns this red
    expect(Object.keys(groups).sort()).toEqual(Object.keys(KNOWN_CONTACTS).sort());
    for (const [key, known] of Object.entries(KNOWN_CONTACTS)) {
      expect(groups[key]?.hits, key).toBe(known.hits);
      expect(groups[key]?.area, key).toBeCloseTo(known.area, 3);
    }
  }, 120000);
});
