import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type Document, type Node as GltfNode, getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  GUILD_TROPHY_DUNGEONS,
  guildSourceFingerprint,
  HIGHWATCH_GUILD_ASSET,
  mergeGuildCollision,
  tierTarget,
  VERTEX_COLOUR_SCALE,
} from '../scripts/assets/highwatch_guild/build.mjs';
import {
  documentTriangles,
  findCoplanarOverlaps,
  visibleOverlaps,
} from '../scripts/assets/highwatch_guild/coplanar.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { isPlacedBuildingInterior } from '../src/render/eastbrook_placed_building';
import { HIGHWATCH_GUILD_SIGN } from '../src/render/highwatch_guild_sign';
import { placedTextureTierPath } from '../src/render/placed_texture_tier_core';
import { HIGHWATCH_BUILDINGS_BY_ID } from '../src/sim/highwatch_layout';

// The shipped Highwatch adventurers' guild, Lantern Hall (public/models/tidehold/highwatch/
// guild.glb and its .half and .quarter texture tiers), built in Blender by
// scripts/assets/highwatch_guild/build_guild.py on the guild's own kit, settled as one
// (guild_settle.py), painted with Highwatch's Alpine slate maps of the painted town
// (guild_texture.py, textures.json) and dressed with painted props (guild_props.py, the atlas
// props/build_atlas.mjs packs), then shipped by build.mjs, which also merges the collision rows
// the same Blender run writes into data/asset_collision_overrides.json. Pins the bytes of every
// tier, the live source fingerprint, the named parts the town view draws (the G_INT ones cast no
// shadow, and each trophy and each plaque's gilding is a part of its own for the trophy room),
// the painted materials and their maps, the tiers' sizes, the props' atlas against its
// manifest, the triangle budget, the footing the town buries, the door and the open roof the
// camera's air is cut to, the collision rows, and no z-fighting. Re-pin the sha256, size and
// triangle literals only with a re-export.

const ROOT = path.join(__dirname, '..');
const GLB = path.join(ROOT, HIGHWATCH_GUILD_ASSET.target);
type GuildTier = 'full' | 'half' | 'quarter';
/** Each tier's shipped bytes and sha256 (build.mjs prints both). */
const SHIPPED: Record<GuildTier, { bytes: number; sha256: string }> = {
  full: {
    bytes: 4189756,
    sha256: '7a860f1e452f263fd5bfd79e12af29039b28269b3ae3099369d10247b34e3441',
  },
  half: {
    bytes: 2500200,
    sha256: '3bf7acaeae9b83ad210dd18e28712e14b55f1cb9fd5e6fa81806f5fcb9dfea4f',
  },
  quarter: {
    bytes: 2025032,
    sha256: '4549ee17ff7380e296f355f75aa6d393a86e47921489a162a509df52ad80fe06',
  },
};
const TIERS = Object.keys(SHIPPED) as GuildTier[];
const tierFile = (tier: GuildTier) => path.join(ROOT, tierTarget(tier));
/** Triangles per named part, from the Blender build report. */
const TRIANGLES: Record<string, number> = {
  GuildShell: 22828,
  GuildRoof: 11608,
  GuildTrim: 2124,
  GuildYard: 4975,
  GuildGlow: 664,
  G_INT_Timber: 1968,
  G_INT_Furnishings: 20962,
  G_INT_Trophy_hollow_crypt: 800,
  G_INT_Trophy_sunken_bastion: 797,
  G_INT_Trophy_drowned_temple: 700,
  G_INT_Trophy_wildheart_basin: 797,
  G_INT_Trophy_gravewyrm_sanctum: 1400,
  G_INT_TrophyGilt_hollow_crypt: 306,
  G_INT_TrophyGilt_sunken_bastion: 306,
  G_INT_TrophyGilt_drowned_temple: 306,
  G_INT_TrophyGilt_wildheart_basin: 306,
  G_INT_TrophyGilt_gravewyrm_sanctum: 306,
};

const TEXTURES = JSON.parse(
  readFileSync(path.join(ROOT, 'scripts/assets/highwatch_guild/textures.json'), 'utf8'),
) as {
  headroom: number;
  materials: Record<string, { color: string; normal?: string; atlas?: boolean }>;
};
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

let doc: Document;

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

interface GlbJson {
  scenes: unknown;
  nodes: unknown;
  meshes: unknown;
  accessors: Record<string, unknown>[];
  materials: Record<string, unknown>[];
  textures: unknown;
  images: { name: string; mimeType: string; bufferView: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  extensionsRequired?: string[];
}

function readGlb(file: string): { json: GlbJson; bin: Buffer } {
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(0), `${file} is a GLB`).toBe(0x46546c67);
  const jsonLen = buf.readUInt32LE(12);
  return {
    json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GlbJson,
    bin: buf.subarray(20 + jsonLen + 8),
  };
}

/** Everything about a tier file that is not a picture: the scene graph, the meshes, every
 *  accessor's shape and the materials. */
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

/** Each image's name, type, pixel size, mip count and supercompression (read from its KTX2
 *  header: 1 is BasisLZ, the ETC1S colour maps; 2 is Zstandard, the UASTC normal maps). */
function images({ json, bin }: { json: GlbJson; bin: Buffer }) {
  return json.images.map((img) => {
    const view = json.bufferViews[img.bufferView];
    const at = view.byteOffset ?? 0;
    return {
      name: img.name,
      mime: img.mimeType,
      w: bin.readUInt32LE(at + 20),
      h: bin.readUInt32LE(at + 24),
      levels: bin.readUInt32LE(at + 40),
      scheme: bin.readUInt32LE(at + 44),
    };
  });
}

interface GuildExtras {
  floor: number;
  door: number[];
  hall: { plate: number; ridge: number; truss: number };
  tower: number[];
  trophies: string[];
  sign: { x: number; y: number; z: number; width: number; height: number; face: number };
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
});

describe('the Highwatch guild GLB', () => {
  it('carries no light, transmission, volume, skin or animation a post-boot building must not add', () => {
    const used = doc
      .getRoot()
      .listExtensionsUsed()
      .map((ext) => ext.extensionName);
    for (const banned of [
      'KHR_lights_punctual',
      'KHR_materials_transmission',
      'KHR_materials_volume',
    ]) {
      expect(used, banned).not.toContain(banned);
    }
    expect(doc.getRoot().listSkins()).toEqual([]);
    expect(doc.getRoot().listAnimations()).toEqual([]);
  });

  it('ships the pinned bytes of every texture tier, in the media manifest, credited as project art', () => {
    for (const tier of TIERS) {
      const bytes = readFileSync(tierFile(tier));
      expect(bytes.length, tier).toBe(SHIPPED[tier].bytes);
      expect(createHash('sha256').update(bytes).digest('hex'), tier).toBe(SHIPPED[tier].sha256);
      expect(bytes.toString('latin1'), tier).toContain('EXT_meshopt_compression');
      // served under its own content hash, so a manifest left on an old export fails
      const key = tierTarget(tier).replace(/^public\//, '');
      const stem = key.replace(/\.glb$/, '');
      expect(MEDIA_ASSETS[key], tier).toBe(
        `/media/${stem}.${SHIPPED[tier].sha256.slice(0, 12)}.glb`,
      );
    }
    const credits = readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
    const row = credits
      .split('\n')
      .find((line) =>
        line.includes(
          "Highwatch adventurers' guild, Lantern Hall (`public/models/tidehold/highwatch/guild.glb`",
        ),
      );
    expect(row).toBeDefined();
    // the painted maps it wears and the painted props it is dressed with are named
    expect(row).toMatch(/painted/i);
    expect(row).toMatch(/Tripo/);
    // all three tiers, under the project's own licence (the Tripo pieces are a paid plan's
    // output: never redistributed apart from the game)
    expect(row).toContain('guild.half.glb');
    expect(row).toContain('guild.quarter.glb');
    expect(row).toContain('Project asset, rights reserved | **No, permission required**');
  });

  it('carries the live source fingerprint on every tier, its own kit, maps and props included', async () => {
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    for (const tier of TIERS) {
      const file = await io.read(tierFile(tier));
      expect(file.getRoot().getExtras(), tier).toMatchObject({
        authoring: 'Blender',
        sourceFingerprint: guildSourceFingerprint(),
      });
    }
    // a change to the guild's kit, its paint, its settling or its props re-ships it: every map
    // the paint wears, the paint table, the props' manifest and pack, the shared ship kit, and
    // every builder script in the kit's folder. Three scripts there never touch the export:
    // guild_scene.py stages the review scene after it, props/bake_low.py bakes the props'
    // local source pack (props_data.json and the atlas stand for its output) and
    // render_lantern_seal_icon.py renders an item icon.
    const kit = 'scripts/assets/highwatch_guild';
    for (const spec of Object.values(TEXTURES.materials)) {
      for (const file of [spec.color, spec.normal].filter((f): f is string => !!f)) {
        expect(HIGHWATCH_GUILD_ASSET.inputs).toContain(`${kit}/${file}`);
      }
    }
    for (const input of [
      `${kit}/textures.json`,
      `${kit}/props/props.json`,
      `${kit}/props/props_data.json`,
      'scripts/assets/eastbrook_ferry/shiplib.py',
    ]) {
      expect(HIGHWATCH_GUILD_ASSET.inputs).toContain(input);
    }
    const offExport = ['guild_scene.py', 'props/bake_low.py', 'render_lantern_seal_icon.py'];
    const scripts = (readdirSync(path.join(ROOT, kit), { recursive: true }) as string[])
      .map((file) => file.split(path.sep).join('/'))
      .filter((file) => file.endsWith('.py') && !offExport.includes(file));
    expect(scripts.length).toBeGreaterThanOrEqual(12);
    for (const script of scripts)
      expect(HIGHWATCH_GUILD_ASSET.inputs).toContain(`${kit}/${script}`);
    // the manor's kit it was first built with is gone from the tree and from its inputs
    expect(HIGHWATCH_GUILD_ASSET.inputs.some((input) => input.includes('highwatch_manor'))).toBe(
      false,
    );
  });

  it('keeps its named parts under one root, a trophy and a gilding part per dungeon', () => {
    const roots = doc.getRoot().listScenes()[0].listChildren();
    expect(roots.map((n) => n.getName())).toEqual(['HighwatchGuild_ROOT']);
    const parts = roots[0].listChildren().map((n) => n.getName());
    expect([...parts].sort()).toEqual(Object.keys(TRIANGLES).sort());
    expect([...GUILD_TROPHY_DUNGEONS].sort()).toEqual([
      'drowned_temple',
      'gravewyrm_sanctum',
      'hollow_crypt',
      'sunken_bastion',
      'wildheart_basin',
    ]);
    for (const dungeon of GUILD_TROPHY_DUNGEONS) {
      expect(parts).toContain(`G_INT_Trophy_${dungeon}`);
      expect(parts).toContain(`G_INT_TrophyGilt_${dungeon}`);
    }
    // the town view casts no shadow from a part under a G_INT group
    // (render/eastbrook_placed_building.ts): the trusses, the furniture and the trophies
    for (const name of parts.filter((part) => part.startsWith('G_INT'))) {
      expect(isPlacedBuildingInterior({ name, parent: null } as never), name).toBe(true);
    }
    for (const name of ['GuildShell', 'GuildRoof', 'GuildYard']) {
      expect(isPlacedBuildingInterior({ name, parent: null } as never), name).toBe(false);
    }
  });

  it('wears the painted maps on its painted materials, the rest untextured, its glass warm', () => {
    const root = doc.getRoot();
    const names = root
      .listMaterials()
      .map((m) => m.getName())
      .sort();
    for (const name of names) expect(HIGHWATCH_GUILD_ASSET.materials).toContain(name);
    for (const name of [
      'GuildTimber',
      'GuildDressed',
      'GuildPlaster',
      'GuildSlate',
      'GuildProps',
      'GuildGlow',
      'GuildGlowLantern',
    ]) {
      expect(names, name).toContain(name);
    }
    for (const material of root.listMaterials()) {
      const name = material.getName();
      const spec = TEXTURES.materials[name];
      const map = material.getBaseColorTexture();
      // the vertex colour is the whole colour (times the map): no factor tints it
      expect(material.getBaseColorFactor(), name).toEqual([1, 1, 1, 1]);
      if (!spec) {
        expect(map, name).toBeNull();
        expect(material.getNormalTexture(), name).toBeNull();
        // an untextured material's vertex colours are drawn as they are
        expect(
          (material.getExtras() as { vertexColourScale?: number }).vertexColourScale,
          name,
        ).toBe(undefined);
        continue;
      }
      expect(map, name).not.toBeNull();
      expect(map?.getMimeType(), name).toBe('image/ktx2');
      expect(material.getNormalTexture() !== null, name).toBe(Boolean(spec.normal));
      // the vertex colours sit under the headroom; the runtime multiplies them back
      // (src/render/vertex_colour_glb_parts.ts)
      expect(material.getExtras(), name).toEqual({ vertexColourScale: VERTEX_COLOUR_SCALE });
    }
    // the factor undoes the headroom: the Blender export ships a stored colour v as
    // srgbToLinear(v), so a tint of 1 stored at 1 / headroom draws as the map itself
    expect(TEXTURES.headroom).toBe(1.5);
    expect(VERTEX_COLOUR_SCALE).toBe(Number((1 / srgbToLinear(1 / TEXTURES.headroom)).toFixed(6)));
    expect(VERTEX_COLOUR_SCALE).toBeCloseTo(2.4877, 4);
    const hue = (name: string) =>
      root
        .listMaterials()
        .find((m) => m.getName() === name)
        ?.getEmissiveFactor() ?? [0, 0, 0];
    for (const name of ['GuildGlow', 'GuildGlowLantern']) {
      const [r, g, b] = hue(name);
      expect(r, name).toBeGreaterThan(g);
      expect(g, name).toBeGreaterThan(b);
    }
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        expect(prim.getAttribute('COLOR_0'), mesh.getName()).not.toBeNull();
        const painted = TEXTURES.materials[prim.getMaterial()?.getName() ?? ''];
        expect(prim.getAttribute('TEXCOORD_0') !== null, mesh.getName()).toBe(Boolean(painted));
      }
    }
  });

  it('ships its texture tiers: the same model with every map at half and a quarter of its size', () => {
    const base = readGlb(GLB);
    const baseImages = images(base);
    // the four tiling colour maps a shipped face wears (plaster, timber, dressed stone, slate),
    // their four normal maps and the props' atlas (the cloth maps stay in textures.json for the
    // built pieces that stand in where a prop is not packed: no shipped face wears cloth)
    expect(baseImages).toHaveLength(9);
    for (const img of baseImages) expect(img.mime).toBe('image/ktx2');
    // at full: every tiling map at the tier table's size (the builder resizes by that table, so
    // its numbers are pinned here too) and the props' one atlas at its packed size
    // (props/props.json). A re-pack at twice the side would quadruple its memory in every tier
    // and still halve cleanly, and an atlas flag dropped from textures.json squashes it square.
    expect(HIGHWATCH_GUILD_ASSET.tiers.full).toEqual({ suffix: '', color: 1024, normal: 128 });
    expect(TEXTURES.materials.GuildProps.atlas).toBe(true);
    expect(baseImages.filter((img) => img.name === 'GuildProps_color')).toHaveLength(1);
    for (const img of baseImages) {
      const side = img.name.endsWith('_normal') ? 128 : 1024;
      const want = img.name === 'GuildProps_color' ? { w: 2048, h: 5120 } : { w: side, h: side };
      expect({ w: img.w, h: img.h }, img.name).toEqual(want);
    }
    for (const tier of TIERS.filter((t) => t !== 'full')) {
      const file = readGlb(tierFile(tier));
      expect(shape(file), tier).toBe(shape(base));
      const sizes = HIGHWATCH_GUILD_ASSET.tiers[tier];
      const k = sizes.color / HIGHWATCH_GUILD_ASSET.tiers.full.color;
      expect(
        images(file).map(({ name, mime, w, h }) => ({ name, mime, w, h })),
        tier,
      ).toEqual(
        baseImages.map(({ name, mime, w, h }) => {
          if (name.endsWith('_normal')) return { name, mime, w: sizes.normal, h: sizes.normal };
          if (name === 'GuildProps_color') return { name, mime, w: w * k, h: h * k };
          return { name, mime, w: sizes.color, h: sizes.color };
        }),
      );
      expect(readFileSync(tierFile(tier)).length, tier).toBeLessThan(readFileSync(GLB).length);
    }
    // every map of every tier carries its whole mip chain, the colour maps in ETC1S (BasisLZ)
    // and the normal maps in UASTC (Zstandard)
    for (const tier of TIERS) {
      for (const img of images(readGlb(tierFile(tier)))) {
        const label = `${tier} ${img.name}`;
        expect(img.scheme, label).toBe(img.name.endsWith('_normal') ? 2 : 1);
        expect(img.levels, label).toBe(Math.floor(Math.log2(Math.max(img.w, img.h))) + 1);
      }
    }
    const { full, half, quarter } = HIGHWATCH_GUILD_ASSET.tiers;
    for (const kind of ['color', 'normal'] as const) {
      expect(half[kind]).toBe(full[kind] / 2);
      expect(quarter[kind]).toBe(full[kind] / 4);
      expect(quarter[kind] % 4).toBe(0);
    }
    // the loader finds each tier through the media manifest (placed_texture_tier_core.ts)
    const exists = (p: string) => MEDIA_ASSETS[p.replace(/^\/+/, '')] !== undefined;
    const model = '/models/tidehold/highwatch/guild.glb';
    expect(placedTextureTierPath(model, 'full', exists)).toBe(model);
    expect(placedTextureTierPath(model, 'half', exists)).toBe(
      '/models/tidehold/highwatch/guild.half.glb',
    );
    expect(placedTextureTierPath(model, 'quarter', exists)).toBe(
      '/models/tidehold/highwatch/guild.quarter.glb',
    );
  });

  it('ships the same geometry in every tier, only its maps resized', async () => {
    // shape() reads each accessor's layout and bounds, never its data: decode every tier and
    // compare each accessor's bytes, so a UV snap or a tint that varied by tier fails here
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const digests = (d: Document) =>
      d
        .getRoot()
        .listAccessors()
        .map((accessor) => {
          const a = accessor.getArray();
          if (!a) return '';
          return createHash('sha256')
            .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
            .digest('hex');
        });
    const full = digests(doc);
    expect(full.length).toBeGreaterThan(100);
    for (const tier of TIERS.filter((t) => t !== 'full')) {
      expect(digests(await io.read(tierFile(tier))), tier).toEqual(full);
    }
  });

  it('holds every tier to its file budget', () => {
    // The files: the model under 4400 KiB, its .half under 2600 KiB and its .quarter (what a
    // phone loads) under 2100 KiB, so a re-export that grows one fails here and not only at
    // its re-pinned hash. Every tier carries the same geometry and float UVs (about 1740 KiB:
    // the painted faces' UVs repeat far past [0, 1], so they cannot be normalized). The rest is
    // the KTX2 maps: five tiling colour maps at 1024, five normal maps at 128 and the props'
    // 2048 by 5120 atlas, about 2430 KiB at full (the atlas 1480 KiB of it), 680 KiB at half
    // and 190 KiB at a quarter.
    expect(readFileSync(GLB).length).toBeLessThan(4400 * 1024);
    expect(readFileSync(tierFile('half')).length).toBeLessThan(2600 * 1024);
    expect(readFileSync(tierFile('quarter')).length).toBeLessThan(2100 * 1024);
  });

  it("was packed from the live props manifest: each piece's source, budget and tile", () => {
    // props_data.json and the atlas are what props/build_atlas.mjs made of props/props.json (its
    // sources are a maintainer-local pack under tmp/asset_src, never checked in): a piece added,
    // dropped, re-sourced, over its budget or moved to another tile without re-running it
    // fails here
    const dir = path.join(ROOT, 'scripts/assets/highwatch_guild/props');
    const manifest = JSON.parse(readFileSync(path.join(dir, 'props.json'), 'utf8')) as {
      atlas: { width: number; height: number; pad: number; out: string };
      props: { id: string; source: string; dense?: string; triangles: number; tile: number[] }[];
    };
    const data = JSON.parse(readFileSync(path.join(dir, 'props_data.json'), 'utf8')) as {
      atlas: string;
      props: Record<string, { source: string; uvs: number[][]; faces: number[][] }>;
    };
    expect(data.atlas).toBe(manifest.atlas.out);
    expect(TEXTURES.materials.GuildProps.color).toBe(manifest.atlas.out);
    expect(Object.keys(data.props).sort()).toEqual(manifest.props.map((p) => p.id).sort());
    const { width, height, pad } = manifest.atlas;
    // (UVs rounded to 1e-4, stored with Blender's bottom-left origin)
    const slack = 2e-4;
    for (const p of manifest.props) {
      const piece = data.props[p.id];
      expect(piece.source, p.id).toBe(p.source);
      expect(piece.faces.length, p.id).toBeGreaterThan(0);
      expect(piece.faces.length, p.id).toBeLessThanOrEqual(p.triangles);
      const [left, top, side] = p.tile;
      // a small piece a small tile ("lower texture size for smaller objects")
      expect([256, 512, 1024], p.id).toContain(side);
      const u0 = (left + pad) / width - slack;
      const u1 = (left + side - pad) / width + slack;
      const v0 = 1 - (top + side - pad) / height - slack;
      const v1 = 1 - (top + pad) / height + slack;
      const outside = piece.uvs.filter(([u, v]) => u < u0 || u > u1 || v < v0 || v > v1);
      expect(outside.length, `${p.id} corners off its tile`).toBe(0);
      // and the tile itself inside the atlas
      expect(left >= 0 && top >= 0 && left + side <= width && top + side <= height, p.id).toBe(
        true,
      );
    }
    // no two tiles share a texel, or one piece would paint over another
    for (const [i, a] of manifest.props.entries()) {
      const [ax, ay, aSide] = a.tile;
      for (const b of manifest.props.slice(i + 1)) {
        const [bx, by, bSide] = b.tile;
        const apart = ax + aSide <= bx || bx + bSide <= ax || ay + aSide <= by || by + bSide <= ay;
        expect(apart, `${a.id} and ${b.id} share texels`).toBe(true);
      }
    }
    // the trophy room's five trophies, its plaques and their gilding are all painted pieces
    for (const id of [
      'trophy_crypt',
      'trophy_bastion',
      'trophy_temple',
      'trophy_wildheart',
      'trophy_gravewyrm',
      'trophy_plaque',
      'gilt_laurel',
    ]) {
      expect(Object.keys(data.props), id).toContain(id);
    }
  });

  it('stays inside its triangle budget, part by part', () => {
    let total = 0;
    for (const [name, want] of Object.entries(TRIANGLES)) {
      const got = trianglesUnder(node(name));
      expect(got, name).toBe(want);
      total += got;
    }
    // never past 90,000 with every room furnished
    expect(total).toBeGreaterThanOrEqual(40_000);
    expect(total).toBeLessThanOrEqual(90_000);
    // each trophy a small part of its own (the room shows up to five at once)
    for (const dungeon of GUILD_TROPHY_DUNGEONS) {
      expect(TRIANGLES[`G_INT_Trophy_${dungeon}`], dungeon).toBeLessThan(2_000);
    }
  });

  it('stands on a yard of footing, as wide and deep as its record reaches', () => {
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    expect(bounds.min[1]).toBeCloseTo(-1, 2);
    const guild = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
    const reach = guild.reach;
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(reach.halfWidth * 2, 2);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(reach.halfDepth * 2, 2);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(guild.nativeDimensions.height + 1.05, 2);
    // the yard in front (-z), the trophy hall behind
    expect(bounds.min[2]).toBeLessThan(-24);
    expect(bounds.max[2]).toBeGreaterThan(20);
  });

  it('stamps the door, the open roof and the belfry lantern the camera and the town read', () => {
    const extras = (node('HighwatchGuild_ROOT').getExtras() as { highwatchGuild: GuildExtras })
      .highwatchGuild;
    // a grand door: 3.8 wide, 5.6 high over the floor (a player stands 2.6)
    expect(extras.door).toEqual([3.8, 5.6]);
    expect(extras.floor).toBeCloseTo(0.6, 9);
    // the great hall: walls of 10.5, the ridge at 19, nothing of the roof under 11 over the floor
    expect(extras.hall.plate - extras.floor).toBeCloseTo(10.5, 9);
    expect(extras.hall.ridge - extras.floor).toBeCloseTo(19, 9);
    expect(extras.hall.truss - extras.floor).toBeGreaterThanOrEqual(11);
    // the belfry lantern stands over the great roof's ridge
    expect(extras.tower[1]).toBeGreaterThan(extras.hall.ridge);
    expect([...extras.trophies].sort()).toEqual([...GUILD_TROPHY_DUNGEONS].sort());
    // the gateway's name board: the painted lettering stands where the model's board hangs,
    // well over a player's head, a real gap proud of the board's faces
    expect(extras.sign).toEqual({ ...HIGHWATCH_GUILD_SIGN });
    expect(extras.sign.y - extras.sign.height / 2).toBeGreaterThan(3);
    expect(extras.sign.face).toBeGreaterThanOrEqual(0.09 + 0.04);
  });

  it('ships the collision rows the Blender run wrote, under the model id', () => {
    const written = JSON.parse(
      readFileSync(path.join(ROOT, HIGHWATCH_GUILD_ASSET.collision), 'utf8'),
    ) as { size: number; rows: unknown };
    const table = JSON.parse(
      readFileSync(path.join(ROOT, 'data/asset_collision_overrides.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(table[HIGHWATCH_GUILD_ASSET.collisionId]).toEqual(written.rows);
    const bounds = getBounds(doc.getRoot().listScenes()[0]);
    expect(written.size).toBeCloseTo(
      Math.max(...[0, 1, 2].map((i) => bounds.max[i] - bounds.min[i])),
      1,
    );
    const raw = readFileSync(path.join(ROOT, 'data/asset_collision_overrides.json'), 'utf8');
    expect(mergeGuildCollision(raw, written.rows)).toBe(raw);
    // a re-export replaces the guild's row in place with every other row as it was (merging
    // the shipped rows back restores the file byte for byte), and adds it to a table without it
    const swapped = mergeGuildCollision(raw, { boxes: [], ramps: [] });
    expect(swapped).not.toBe(raw);
    const swappedTable = JSON.parse(swapped) as Record<string, unknown>;
    expect(swappedTable[HIGHWATCH_GUILD_ASSET.collisionId]).toEqual({ boxes: [], ramps: [] });
    expect(Object.keys(swappedTable)).toEqual(Object.keys(table));
    expect(mergeGuildCollision(swapped, written.rows)).toBe(raw);
    const added = mergeGuildCollision('{\n  "other": { "boxes": [] }\n}\n', written.rows);
    expect(JSON.parse(added)).toEqual({
      other: { boxes: [] },
      [HIGHWATCH_GUILD_ASSET.collisionId]: written.rows,
    });
    expect(added.endsWith('\n}\n')).toBe(true);
  });
});

/**
 * The contacts the audit sees on the shipped model, by group (the two parts and materials, the
 * facing): how many and their area in square yards. Every one is a joint of the kit's own shell
 * and roof (a timber against a wall's plaster or stone, a porch slate on its dressed gable, the
 * trophy hall's posts meeting the great hall's back wall, two slate courses lapping a finger's
 * width apart at the front eave): joints the audit passes as twins on an unpainted model (one
 * material, one colour: the same pixel). The painted maps and the baked light tint each face its
 * own way, so the audit weighs them here, as it did the painted Highwatch manor on the same kit.
 * The largest, the eave's lap, is about a quarter of a square yard. A new contact anywhere, or
 * one of these grown, turns this red.
 */
const KNOWN_CONTACTS: Record<string, { hits: number; area: number }> = {
  'GuildRoof/GuildSlate x GuildRoof/GuildSlate n=0,0.8,-0.6': { hits: 1, area: 0.254 },
  'GuildRoof/GuildSlate x GuildShell/GuildDressed n=-0.49,0.87,0': { hits: 2, area: 0.112 },
  'GuildRoof/GuildSlate x GuildShell/GuildDressed n=0.49,0.87,0': { hits: 1, area: 0.102 },
  'GuildShell/GuildDressed x GuildShell/GuildDressed n=0,0,-1': { hits: 3, area: 0.125 },
  'GuildShell/GuildDressed x GuildShell/GuildTimber n=-1,0,0': { hits: 2, area: 0.067 },
  'GuildShell/GuildPlaster x GuildShell/GuildTimber n=0,-1,0': { hits: 13, area: 0.544 },
  'GuildShell/GuildPlaster x GuildShell/GuildTimber n=0,1,0': { hits: 1, area: 0.029 },
  'GuildShell/GuildTimber x GuildShell/GuildTimber n=-1,0,0': { hits: 3, area: 0.21 },
  'GuildShell/GuildTimber x GuildShell/GuildTimber n=0,0,-1': { hits: 2, area: 0.019 },
  'GuildShell/GuildTimber x GuildShell/GuildTimber n=1,0,0': { hits: 1, area: 0.206 },
};

describe('the Highwatch guild has no coplanar faces fighting in the depth buffer', () => {
  it('finds no new overlap a camera can see across the whole shipped model', () => {
    const triangles = documentTriangles(doc);
    const all = findCoplanarOverlaps(triangles);
    // not vacuous: the model is full of flush joints the audit has to weigh
    expect(all.length).toBeGreaterThan(1000);
    const visible = visibleOverlaps(triangles, all);
    const label = (hit: (typeof visible)[number]) =>
      `${hit.parts.join(' x ')} at ${hit.at.join(', ')} gap ${hit.gap.toFixed(3)}`;
    // every decal-like piece (the rugs, the painted props: the trophies, their plaques and
    // gilding, the board, the banners, the crest, the furniture; the yard's paving) stands a
    // real layer clear of what it lies on, and no prop fights itself (props/build_atlas.mjs drops
    // a piece's coplanar twins): none at all outside the frame
    const frame = /^(GuildShell|GuildRoof)\//;
    expect(
      visible.filter((hit) => !hit.parts.every((part) => frame.test(part))).map(label),
    ).toEqual([]);
    // and not vacuous outside the frame: the props, the rugs and the paving lie flush on what
    // they stand on in hundreds of places the visibility pass has to clear
    expect(
      all.filter((hit) => !hit.parts.every((part) => frame.test(part))).length,
    ).toBeGreaterThan(200);
    const groups: Record<string, { hits: number; area: number }> = {};
    for (const hit of visible) {
      const key = `${[...hit.parts].sort().join(' x ')} n=${hit.normal.join(',')}`;
      const group = groups[key] ?? { hits: 0, area: 0 };
      group.hits++;
      group.area += hit.area;
      groups[key] = group;
    }
    expect(Object.keys(groups).sort()).toEqual(Object.keys(KNOWN_CONTACTS).sort());
    for (const [key, known] of Object.entries(KNOWN_CONTACTS)) {
      expect(groups[key]?.hits, key).toBe(known.hits);
      expect(groups[key]?.area, key).toBeCloseTo(known.area, 3);
    }
  }, 120000);
});
