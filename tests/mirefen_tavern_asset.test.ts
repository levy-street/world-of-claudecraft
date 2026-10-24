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
  tavernShellVolumes,
} from '../src/render/mirefen_tavern_core';
import { TAVERN_HALL_AIR_TOP } from '../src/render/mirefen_tavern_interior_core';
import { TAVERN_SMOKE_SOURCES } from '../src/render/mirefen_tavern_smoke_core';
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
// headroom, the texture-tier files beside the model, the triangle and size budgets, the model's
// stamped numbers against the sim, and the shell against the volumes the runtime ghosts it by
// and the plumes against the pots they rise from. Re-pin the
// sha256, size and triangle literals only with a re-export (docs/design/mirefen-tavern.md).

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, MIREFEN_TAVERN_ASSET.target);
/** Each texture tier's file: its bytes and sha256 (the model first). */
const SHIPPED: Record<MirefenTavernTier, { bytes: number; sha256: string }> = {
  full: {
    bytes: 4925048,
    sha256: 'bae959685a39caba2f939168544b06a52e952c0139b8052899bdffb870a4beee',
  },
  half: {
    bytes: 2748272,
    sha256: 'a2b207dc9b853fd9e33bbd7283cb65c7479003408c581293f5302c96290d865d',
  },
  quarter: {
    bytes: 2129852,
    sha256: 'c2dc972d582a50609229d252d8ed61cb2e92ff343f3b946add37413d33732ceb',
  },
};
const TIERS = Object.keys(SHIPPED) as MirefenTavernTier[];
const tierFile = (tier: MirefenTavernTier) => path.join(ROOT, tierTarget(tier));
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  TavernFrame: 7743,
  TavernFurnishings: 10654,
  TavernLights: 8733,
  TavernGrounds: 5070,
  TavernDog: 374,
  HallWallFront: 1080,
  HallWallFrontLeft: 2080,
  HallWallFrontRight: 2070,
  HallWallBack: 1836,
  HallWallLeft: 4839,
  HallWallRight: 3876,
  HallRoof: 3773,
  WingWallEast: 1096,
  WingWallBack: 914,
  WingWallWest: 672,
  WingRoof: 1018,
  TowerWall: 2567,
  TowerRoof: 1092,
  HallPorch: 656,
  BarPillar: 772,
  TavernTrim: 20013,
  TavernClutter: 12032,
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

/** Every corner of a named part, in the tavern's local frame. */
function corners(name: string): [number, number, number][] {
  const n = node(name);
  const m = n.getWorldMatrix();
  const v = [0, 0, 0];
  const out: [number, number, number][] = [];
  for (const prim of n.getMesh()?.listPrimitives() ?? []) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    for (let k = 0; k < pos.getCount(); k++) {
      pos.getElement(k, v);
      out.push([
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
      ]);
    }
  }
  return out;
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
  materials: Record<
    string,
    {
      color: string;
      normal?: string;
      roughness: number;
      yards?: number;
      atlas?: boolean;
      scale?: [number, number];
    }
  >;
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
    // the eight painted materials of the map table (the seven tiling maps and the props' atlas),
    // and the metal, the glow and the plain rest
    expect(MIREFEN_TAVERN_ASSET.painted).toEqual(Object.keys(TEXTURES.materials).sort());
    expect(MIREFEN_TAVERN_ASSET.painted).toEqual([
      'TavernCloth',
      'TavernDressed',
      'TavernFloor',
      'TavernPlaster',
      'TavernProps',
      'TavernRoof',
      'TavernStone',
      'TavernTimber',
    ]);
    expect(
      Object.keys(TEXTURES.materials).filter((name) => TEXTURES.materials[name].atlas),
    ).toEqual(['TavernProps']);
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
      // (the props' atlas packs forty 512 tiles: twice the tier's colour size across and five
      // times down, textures.json `scale`)
      const [sx, sy] = spec.scale ?? [1, 1];
      expect(color?.getSize(), name).toEqual([full.color * sx, full.color * sy]);
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
    // (each smooth sheet laid flat on its plane, so never more than it), and is that rate on most
    // of them. The tower's hat is the one cone: its slates are laid round it in whole repeats with
    // their courses following its slope (tavern_texture.lay_sheet), so they close up toward its
    // tip and only their median holds to the kit's rate. The props' atlas has no repeat: its
    // pieces carry their own UVs into it (the next test)
    const uvPerYard = (name: string) => 1 / (TEXTURES.materials[name].yards ?? Number.NaN);
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
        if (!uv || !pos || !idx || TEXTURES.materials[name]?.atlas) continue;
        const want = uvPerYard(name);
        const label = `${n.getName()} ${name}`;
        const cone = n.getName() === 'TowerRoof';
        const rates: number[] = [];
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
          if (!cone) expect(rate, label).toBeLessThan(want * 1.05);
          rates.push(rate);
          edges++;
          if (Math.abs(rate - want) < want * 0.05) onRate++;
        }
        if (cone && edges > 20) {
          rates.sort((x, y) => x - y);
          expect(Math.abs(rates[Math.floor(edges / 2)] / want - 1), label).toBeLessThan(0.05);
        } else if (edges > 20) {
          expect(onRate / edges, label).toBeGreaterThan(0.6);
        }
        checked += edges;
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });

  it("lays the props' pieces inside their atlas tiles, on the trim, the clutter and the lights", () => {
    // the textured props (scripts/assets/mirefen_tavern/inn_props.py) carry their own UVs into
    // the atlas props/build_atlas.mjs packs from props/props.json: every corner inside one of
    // the pieces' tiles (never in a tile's padding, nor off the map). The dressing is trim and
    // clutter (shed below medium and high); a light fitting (the chandelier, the sconces) rides
    // in the lights with the flames on its wicks, so no tier draws a flame without its candle;
    // a piece the sim collides with (the dresser, the barrels, the crates, the sacks, the
    // firewood: `dressing` records) rides with the furniture and the barrels in its racks, and
    // the copper hood over the hearth with the frame, so every tier draws what it stands for.
    // Never on a shell part, which fades for the camera.
    const atlas = JSON.parse(
      readFileSync(path.join(ROOT, 'scripts/assets/mirefen_tavern/props/props.json'), 'utf8'),
    ) as {
      atlas: { width: number; height: number; pad: number };
      props: { id: string; tile: number[] }[];
    };
    const { width, height, pad } = atlas.atlas;
    // (the shipped UVs are quantized: a texel of slack; glTF's UV origin is the map's top-left,
    // as the tiles' pixels are)
    const su = 1 / width;
    const sv = 1 / height;
    const inTile = (u: number, v: number) =>
      atlas.props.some(
        ({ tile: [x, y, side] }) =>
          u >= (x + pad) / width - su &&
          u <= (x + side - pad) / width + su &&
          v >= (y + pad) / height - sv &&
          v <= (y + side - pad) / height + sv,
      );
    const uv = [0, 0];
    const parts = new Set<string>();
    let count = 0;
    for (const n of doc.getRoot().listNodes()) {
      for (const prim of n.getMesh()?.listPrimitives() ?? []) {
        if (prim.getMaterial()?.getName() !== 'TavernProps') continue;
        parts.add(n.getName());
        const tc = prim.getAttribute('TEXCOORD_0');
        expect(tc, n.getName()).not.toBeNull();
        for (let i = 0; i < (tc?.getCount() ?? 0); i++) {
          tc?.getElement(i, uv);
          expect(inTile(uv[0], uv[1]), `${n.getName()} corner ${i} at ${uv}`).toBe(true);
          count++;
        }
      }
    }
    for (const part of parts) {
      expect(
        ['TavernTrim', 'TavernClutter', 'TavernLights', 'TavernFurnishings', 'TavernFrame'],
        part,
      ).toContain(part);
    }
    expect(parts.has('TavernTrim')).toBe(true);
    expect(parts.has('TavernLights')).toBe(true);
    expect(parts.has('TavernFurnishings')).toBe(true);
    expect(TAVERN_TRIM_PARTS).toContain('TavernTrim');
    // some forty pieces of a few hundred triangles each, the tankards, candles and boards many
    // times over: tens of thousands of corners in all
    expect(count).toBeGreaterThan(20000);
  });

  it('names a piece of the atlas for every dressing record, and only for those', () => {
    // a `dressing` record is drawn by the model it names (inn_props.py stands it from
    // layout.json), so a missing or misspelled name would surface only in the Blender build
    const atlas = JSON.parse(
      readFileSync(path.join(ROOT, 'scripts/assets/mirefen_tavern/props/props.json'), 'utf8'),
    ) as { props: { id: string }[] };
    const ids = new Set(atlas.props.map((p) => p.id));
    const dressing = TAVERN_PROPS.filter((p) => p.kind === 'dressing');
    expect(dressing.map((p) => p.model).sort()).toEqual([
      'barrel_stack',
      'crate_stack',
      'dresser',
      'firewood_basket',
      'grain_sacks',
    ]);
    for (const p of dressing) expect(ids.has(p.model ?? ''), p.model).toBe(true);
    for (const p of TAVERN_PROPS) {
      if (p.kind !== 'dressing') expect(p.model, p.kind).toBeUndefined();
    }
  });

  it('draws every collider-backed dressing piece on every tier, with the furniture', () => {
    // the sim collides with a `dressing` record whatever the tier, so its painted model rides a
    // part every tier keeps (TavernFurnishings), never the trim or the clutter the lower tiers
    // shed: inside each record's footprint the furniture's painted corners rise from its floor
    // to its full height (the model stands scaled to the record's height)
    expect(TAVERN_CRITICAL_PARTS).toContain('TavernFurnishings');
    const furniture = node('TavernFurnishings');
    const m = furniture.getWorldMatrix();
    const v = [0, 0, 0];
    const painted: [number, number, number][] = [];
    for (const prim of furniture.getMesh()?.listPrimitives() ?? []) {
      if (prim.getMaterial()?.getName() !== 'TavernProps') continue;
      const pos = prim.getAttribute('POSITION');
      for (let k = 0; k < (pos?.getCount() ?? 0); k++) {
        pos?.getElement(k, v);
        painted.push([
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        ]);
      }
    }
    const dressing = TAVERN_PROPS.filter((p) => p.kind === 'dressing');
    expect(dressing).toHaveLength(5);
    for (const p of dressing) {
      const base = tavernPropBaseY(p);
      // (the footprint's box square to the tavern's axes: every record is turned a quarter)
      const c = Math.abs(Math.cos(p.rot));
      const s = Math.abs(Math.sin(p.rot));
      const ex = c * (p.hw ?? 0) + s * (p.hd ?? 0) + 0.02;
      const ez = s * (p.hw ?? 0) + c * (p.hd ?? 0) + 0.02;
      const inside = painted.filter(
        ([x, y, z]) =>
          Math.abs(x - p.x) <= ex &&
          Math.abs(z - p.z) <= ez &&
          y >= base - 0.05 &&
          y <= base + p.height + 0.3,
      );
      expect(inside.length, p.model).toBeGreaterThan(50);
      expect(Math.max(...inside.map(([, y]) => y)), p.model).toBeGreaterThan(base + 0.9 * p.height);
    }
  });

  it('keeps every texture tier under its texel budget', () => {
    // the size pins below bound the downloads, not what the GPU holds: every map's texels with
    // its mip chain, per tier, the props' atlas the biggest of them (2048 by 5120 at full, half
    // and a quarter of that on the lower tiers), and no map past that size on a side
    const budget: Record<string, number> = { full: 24.5e6, half: 6.2e6, quarter: 1.6e6 };
    const side: Record<string, number> = { full: 5120, half: 2560, quarter: 1280 };
    expect(TIERS.slice().sort()).toEqual(['full', 'half', 'quarter']);
    for (const tier of TIERS) {
      const maps = images(readGlb(tierFile(tier)));
      const texels = maps.reduce((n, { w, h }) => n + (w * h * 4) / 3, 0);
      expect(texels, tier).toBeLessThan(budget[tier]);
      for (const { name, w, h } of maps) {
        expect(Math.max(w, h), `${tier} ${name}`).toBeLessThanOrEqual(side[tier]);
      }
    }
  });

  it("was packed from the live props manifest: each piece's source, budget and tile", () => {
    // props_data.json and the atlas are what props/build_atlas.mjs made of props/props.json (its
    // sources are a maintainer-local pack under tmp/asset_src, never checked in): a piece added,
    // dropped, re-sourced, over its budget or moved to another tile without re-running it
    // fails here
    const dir = path.join(ROOT, 'scripts/assets/mirefen_tavern/props');
    const manifest = JSON.parse(readFileSync(path.join(dir, 'props.json'), 'utf8')) as {
      atlas: { width: number; height: number; pad: number; out: string };
      props: { id: string; source: string; dense?: string; triangles: number; tile: number[] }[];
    };
    const data = JSON.parse(readFileSync(path.join(dir, 'props_data.json'), 'utf8')) as {
      atlas: string;
      props: Record<string, { source: string; uvs: number[][]; faces: number[][] }>;
    };
    expect(data.atlas).toBe(manifest.atlas.out);
    expect(Object.keys(data.props).sort()).toEqual(manifest.props.map((p) => p.id).sort());
    const { width, height, pad } = manifest.atlas;
    // (UVs rounded to 1e-4, stored with Blender's bottom-left origin)
    const slack = 2e-4;
    for (const p of manifest.props) {
      const piece = data.props[p.id];
      expect(piece.source, p.id).toBe(p.source);
      expect(piece.faces.length, p.id).toBeGreaterThan(0);
      // a piece baked from its `dense` model (bake_low.py) arrives at its budget; one simplified
      // here keeps its UV seams, so it stops where they let it, within a third over (the stag)
      const cap = p.dense ? p.triangles : Math.ceil((p.triangles * 4) / 3);
      expect(piece.faces.length, p.id).toBeLessThanOrEqual(cap);
      const [left, top, side] = p.tile;
      const u0 = (left + pad) / width - slack;
      const u1 = (left + side - pad) / width + slack;
      const v0 = 1 - (top + side - pad) / height - slack;
      const v1 = 1 - (top + pad) / height + slack;
      const outside = piece.uvs.filter(([u, v]) => u < u0 || u > u1 || v < v0 || v > v1);
      expect(outside.length, `${p.id} corners off its tile`).toBe(0);
    }
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
    // lift was cut off: the light could only shift the hue). The props are left out: their
    // corners are a white tint with only a touch of the warmth (build_tavern.py PROPS_WARM),
    // their paint carrying its own light and shade
    const values: number[] = [];
    const c = [0, 0, 0, 0];
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const colour = prim.getAttribute('COLOR_0');
        if (!colour || !prim.getMaterial()?.getBaseColorTexture()) continue;
        if (prim.getMaterial()?.getName() === 'TavernProps') continue;
        for (let i = 0; i < colour.getCount(); i++) {
          colour.getElement(i, c);
          values.push(Math.max(c[0], c[1], c[2]));
        }
      }
    }
    values.sort((x, y) => x - y);
    // (the painted rebuild is about half the old triangles, its detail in the maps: still tens
    // of thousands of painted corners to read the spread from)
    expect(values.length).toBeGreaterThan(60000);
    const at = (f: number) => values[Math.floor((values.length - 1) * f)];
    const mapLevel = 1 / VERTEX_COLOUR_SCALE;
    expect(at(0.5)).toBeGreaterThan(mapLevel * 0.4);
    expect(at(0.5)).toBeLessThan(mapLevel);
    // (1.25: the oak lining the lower walls now takes the flames' brightest light off the
    // limewash there, inn_hall.py)
    expect(at(0.99) * VERTEX_COLOUR_SCALE).toBeGreaterThan(1.25);
    expect(values.filter((v) => v >= 0.995).length / values.length).toBeLessThan(0.001);
  });

  it("keeps the roofs' covering out of the warm bake: every slate the map's own grey", () => {
    // the slates tint by brightness alone (the lichen is in the map), and the roof is all
    // outside: the hall's bake box reaches up under the ridge, and its lanterns once warmed
    // the slates through the sarking, wearing the grey slates brick red from the road. The
    // painted rebuild lays its slates as a few big bowed faces wearing the slate map (no
    // modelled shingles), each slope one smooth sheet sharing its corners across its faces, so its
    // roofs carry a couple of thousand corners, not tens of thousands
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
    expect(corners).toBeGreaterThan(2000);
    expect(worst.off, worst.mesh).toBeLessThan(1 / 255);
  });

  it('ships its texture tiers: the same model with every map at half and a quarter of its size', () => {
    const base = readGlb(GLB);
    const baseImages = images(base);
    // the seven tiling colour maps, the props' atlas and the six normal maps
    expect(baseImages).toHaveLength(14);
    for (const tier of TIERS.filter((t) => t !== 'full')) {
      const file = readGlb(tierFile(tier));
      expect(shape(file), tier).toBe(shape(base));
      const sizes = MIREFEN_TAVERN_ASSET.tiers[tier];
      expect(
        images(file).map(({ name, mime, w, h }) => ({ name, mime, w, h })),
        tier,
      ).toEqual(
        baseImages.map((img) => {
          if (img.name.endsWith('_normal')) return { ...img, w: sizes.normal, h: sizes.normal };
          const [sx, sy] = TEXTURES.materials[img.name.replace(/_color$/, '')]?.scale ?? [1, 1];
          return { ...img, w: sizes.color * sx, h: sizes.color * sy };
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
    // a whole inn with its booths, stage, nook, kitchen, hammerbeam roof and grounds, rebuilt
    // in the painted town's hand-built style (scripts/assets/mirefen_tavern/inn_*.py): big
    // bowed faces wearing the painted maps, the stones, slates and grain in the paint rather
    // than the geometry, so under the triangles of the modelled build it replaced (108.9k, with
    // mossy modelled shingles and leaded panes). Raised from 74k in all and 54k on the low tier
    // for the dressing remade from painted multi-view models (some forty pieces baked to a few
    // hundred triangles each by props/bake_low.py, the trophies, the chandelier and the sign's
    // tankard to 800 to 1100; the dresser, barrels, crates, sacks and firewood the sim collides
    // with, the barrels in the racks and the light fittings on every tier) and for the oak
    // wainscot and exposed frame the common room's walls are lined with (inn_hall.py, about
    // 3.4k on the shell): under 99k in all and the low tier under 65k, so a later pass cannot
    // quietly grow them. Merged per material at runtime (one mesh per material and one per
    // material of each shell part); the trim and the clutter are shed below medium and high.
    expect(total).toBeLessThan(99000);
    const low = TAVERN_CRITICAL_PARTS.reduce((n, p) => n + TRIANGLES[p], 0);
    expect(low).toBeLessThan(65000);
    // The files: the model under 5000 KiB, its .half under 2850 KiB and its .quarter (what a
    // phone loads) under 2250 KiB, raised from 3600, 2150 and 1700 KiB for that dressing (the
    // props' atlas now 2048 by 5120 at the full tier, forty tiles, and the extra geometry);
    // raised from 2700, 1800 and 1500 KiB for the first dressing before that, and lowered from
    // 3600, 2600 and 2350 KiB with the rebuild. The full tier's seven tiling colour maps at 1024
    // and the props' atlas, six normal maps at 128 (KTX2), and the float UVs every tiling face
    // carries in every tier (they repeat far past [0, 1], so they cannot be normalized, and a
    // texture transform to quantize them would clone each map; the atlas's are normalized).
    expect(readFileSync(GLB).length).toBeLessThan(5000 * 1024);
    expect(readFileSync(tierFile('half')).length).toBeLessThan(2850 * 1024);
    expect(readFileSync(tierFile('quarter')).length).toBeLessThan(2250 * 1024);
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
    // (its pillar, which cuts away, the kegs and the racks behind it), the wall fire, the
    // trophies an arm's length off the walls and the great stag over the front door, two yards
    // out over the doorway's head (scripts/assets/mirefen_tavern/inn_props.py HUNG), stand
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
          if (Math.abs(x) < 1.8 && z > 10.6 && y > 5.5) continue; // the great stag over the door
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
    // a piece outside on the terrain (everything on the grounds but the dog on the porch)
    // carries the ground's height under its middle (baseY): the model seats it there and the
    // sim's collider tops it there
    const outside = TAVERN_PROPS.filter((p) => p.baseY !== undefined);
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

  it('keeps every wall, the porch and its sign inside the volumes the cutaway ghosts them by', () => {
    // a piece of the outside shell standing out of its part's fade volumes would stay solid while
    // the part ghosts round it (mirefen_tavern_core.ts tavernShellVolumes): every corner of each
    // box-shaped shell part outside the hall's room lies in one of its volumes (a hand of
    // slack). What hangs inside on a wall goes with the wall, seen only through it.
    const slack = 0.2;
    const H = TAVERN_HALL;
    const inRoom = (x: number, z: number) =>
      Math.abs(x) < H.x1 - H.wall && z > H.z0 + H.wall && z < H.z1 - H.wall;
    for (const part of TAVERN_SHELL_PARTS) {
      const vols = tavernShellVolumes(part);
      if (!vols) continue;
      const out: string[] = [];
      for (const [x, y, z] of corners(part)) {
        if (inRoom(x, z)) continue;
        const held = vols.some(
          (q) =>
            x >= q[0] - slack &&
            x <= q[1] + slack &&
            y >= q[2] - slack &&
            y <= q[3] + slack &&
            z >= q[4] - slack &&
            z <= q[5] + slack,
        );
        if (!held) out.push(`${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
      }
      expect(out.slice(0, 5), part).toEqual([]);
    }
  });

  it('smokes out of the chimney pots and from under the flue cowl', () => {
    // each plume's mouth (mirefen_tavern_smoke_core.ts) where its smoke leaves the model: the
    // wall fire's at the top of its two pots, the hearth's between the flue's pipe and its cowl
    const top = (part: string, x0: number, z0: number, r: number) =>
      Math.max(
        ...corners(part)
          .filter(([x, , z]) => Math.hypot(x - x0, z - z0) < r)
          .map(([, y]) => y),
      );
    const [stack, flue] = TAVERN_SMOKE_SOURCES;
    expect(Math.abs(top('HallWallRight', stack.x, stack.z, 0.9) - stack.y)).toBeLessThan(0.2);
    const cowl = top('HallRoof', flue.x, flue.z, 0.9);
    expect(cowl).toBeGreaterThan(flue.y + 0.3);
    expect(cowl).toBeLessThan(flue.y + 1.2);
  });
});
