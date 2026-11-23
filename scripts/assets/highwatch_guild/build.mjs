// Ship the Blender-authored Highwatch guild hall, Lantern Hall (scripts/assets/highwatch_guild/):
// validate the exported hierarchy, materials and root extras, stamp the source fingerprint, embed
// the painted maps (textures.json: Highwatch's Alpine slate look of the painted town, tex/, and
// the painted props' atlas) at each texture tier, then prune, dedup and meshopt it into
// public/models/tidehold/highwatch/guild.glb and its texture-tier files, guild.half.glb and
// guild.quarter.glb (the same model with every map at half and at a quarter of its size;
// src/render/placed_texture_tier_core.ts picks the file a profile loads), and merge its collision
// rows (guild.collision.json, written by the same Blender run) into
// data/asset_collision_overrides.json under the model's id. Never flatten or join: the town view
// casts no shadow from the G_INT* parts (render/eastbrook_placed_building.ts), and the trophy
// room shows each trophy part by its own node (render/highwatch_guild_trophies.ts).
//
//   blender --background --factory-startup --python scripts/assets/highwatch_guild/props/bake_low.py
//   node scripts/assets/highwatch_guild/props/build_atlas.mjs
//   blender --background --factory-startup --python scripts/assets/highwatch_guild/build_guild.py
//   node scripts/assets/highwatch_guild/build.mjs
//   node scripts/gen_collision_overrides.mjs
//   node scripts/gen_asset_catalog.mjs
//   node scripts/build_media_manifest.mjs generate
//
// The method and the numbers are the Mirefen tavern's (scripts/assets/mirefen_tavern/build.mjs),
// as the Highwatch manor shipped them before it left the town. The maps leave as KTX2 the way
// scripts/assets/compress_glb_textures.mjs encodes every shipped GLB's maps (normal maps UASTC,
// the rest ETC1S, mipmapped), so that step finds nothing left to do here. It needs the `ktx`
// tool of KTX-Software 4.3 or later on PATH, or its bin folder in KTX_BIN. A painted material's
// kit normal strength is baked into its normal map (the runtime draws every normal map at scale
// 1), and its extras carry the factor its vertex colours are multiplied back by
// (VERTEX_COLOUR_SCALE; the loader applies it as it parses the file,
// src/render/vertex_colour_glb_parts.ts applyVertexColourScale). The tiling maps' UVs stay float
// (they repeat far past [0, 1]): a KHR_texture_transform to quantize them would make three's
// loader clone every map, and a clone keeps its transcoded mips resident
// (assets/ktx2_mip_release.ts). The props' atlas is not a tiling map: its UVs are its pieces' own,
// inside [0, 1], and each tier scales it by the tier's colour size over 1024, keeping its shape.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = 'scripts/assets/highwatch_guild';
const TEXTURES = JSON.parse(readFileSync(path.join(ROOT, HERE, 'textures.json'), 'utf8'));

/** Every map file textures.json names, relative to the repo root. */
const MAP_FILES = Object.values(TEXTURES.materials).flatMap((spec) =>
  [spec.color, spec.normal].filter(Boolean).map((file) => `${HERE}/${file}`),
);

/** The five five-player dungeons the trophy room keeps a plaque for (guild_plan.TROPHY_SLOTS). */
export const GUILD_TROPHY_DUNGEONS = [
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'wildheart_basin',
  'gravewyrm_sanctum',
];

export const HIGHWATCH_GUILD_ASSET = {
  source: `${HERE}/guild_source.glb`,
  target: 'public/models/tidehold/highwatch/guild.glb',
  collision: `${HERE}/guild.collision.json`,
  /** The asset id its collision rows are stored under (the model's path, as placed). */
  collisionId: 'tidehold/highwatch/guild',
  /** The texture tiers: the file suffix and the colour and normal map sizes of each. */
  tiers: TEXTURES.tiers,
  /** The fingerprinted inputs: the Blender sources (and the ferry's shared shiplib they build
   *  with), the exported source, the painted maps and their table, the props' packed record and
   *  this builder. */
  inputs: [
    `${HERE}/guild_source.glb`,
    `${HERE}/build_guild.py`,
    `${HERE}/guild_plan.py`,
    `${HERE}/guild_lib.py`,
    `${HERE}/guild_kit.py`,
    `${HERE}/guild_pieces.py`,
    `${HERE}/guild_shell.py`,
    `${HERE}/guild_furnish.py`,
    `${HERE}/guild_yard.py`,
    `${HERE}/guild_props.py`,
    `${HERE}/guild_settle.py`,
    `${HERE}/guild_texture.py`,
    `${HERE}/guild_weather.py`,
    `${HERE}/textures.json`,
    `${HERE}/props/props.json`,
    `${HERE}/props/props_data.json`,
    ...MAP_FILES,
    'scripts/assets/eastbrook_ferry/shiplib.py',
    `${HERE}/build.mjs`,
  ],
  /** Named nodes the runtime and the tests depend on. */
  requiredNodes: [
    'HighwatchGuild_ROOT',
    'GuildShell',
    'GuildRoof',
    'GuildTrim',
    'GuildYard',
    'GuildGlow',
    'G_INT_Timber',
    'G_INT_Furnishings',
    ...GUILD_TROPHY_DUNGEONS.map((d) => `G_INT_Trophy_${d}`),
    ...GUILD_TROPHY_DUNGEONS.map((d) => `G_INT_TrophyGilt_${d}`),
  ],
  materials: [
    'GuildCloth',
    'GuildDressed',
    'GuildGlass',
    'GuildGlassBlue',
    'GuildGlassGold',
    'GuildGlassRed',
    'GuildGlow',
    'GuildGlowCandle',
    'GuildGlowLantern',
    'GuildGlowSoft',
    'GuildMetal',
    'GuildPlain',
    'GuildPlaster',
    'GuildProps',
    'GuildSlate',
    'GuildTimber',
  ],
  /** The materials that wear a painted map (textures.json), the rest draw untextured. */
  painted: Object.keys(TEXTURES.materials).sort(),
};

/** sRGB to linear, one channel. */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The linear factor a painted material multiplies its vertex colour by: guild_texture.py
 *  stores a painted face's colour under textures.json's headroom (room for the warm light to
 *  lift the paint above the map), and the Blender export ships a stored colour v as
 *  srgbToLinear(v), so a tint of 1 draws as the map itself under this factor. Written into each
 *  painted material's extras (src/render/vertex_colour_glb_parts.ts reads it). */
export const VERTEX_COLOUR_SCALE = Number((1 / srgbToLinear(1 / TEXTURES.headroom)).toFixed(6));

/** The file a texture tier ships as. */
export function tierTarget(tier, asset = HIGHWATCH_GUILD_ASSET) {
  const suffix = asset.tiers[tier].suffix;
  return asset.target.replace(/\.glb$/, `${suffix}.glb`);
}

export function guildSourceFingerprint(asset = HIGHWATCH_GUILD_ASSET, root = ROOT) {
  const hash = createHash('sha256');
  for (const file of asset.inputs) {
    // Text inputs hash with normalized line endings so a Windows checkout and a Linux
    // checkout agree; the source GLB and the maps are binary and hash byte for byte.
    const bytes = readFileSync(path.join(root, file));
    const body = /\.(glb|jpg|png)$/.test(file)
      ? bytes
      : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
    hash.update(file).update('\0').update(body).update('\0');
  }
  return hash.digest('hex');
}

/** The exact Sharp runtime gltf-transform's CLI owns (a second Sharp in one Windows process
 *  loads a second libvips and fails), and its KTX2 encoder; see compress_glb_textures.mjs. */
async function textureTools() {
  const rootRequire = createRequire(import.meta.url);
  const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
  const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
  if (process.env.KTX_BIN && !process.env.PATH?.includes(process.env.KTX_BIN)) {
    process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
  }
  const { Mode, toktx } = await import('@gltf-transform/cli');
  return { sharp, Mode, toktx };
}

/** A colour map at the tier's size, as PNG: a tiling map square at `size`, an atlas scaled by
 *  `size` over 1024 with its shape kept. */
async function colorMap(sharp, file, size, atlas) {
  if (!atlas) return sharp(file).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  const meta = await sharp(file).metadata();
  const k = size / 1024;
  return sharp(file)
    .resize(Math.round(meta.width * k), Math.round(meta.height * k), { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

/** A normal map with its kit strength baked in (x and y scaled, renormalized), at `size`,
 *  as PNG. */
async function normalMap(sharp, file, strength, size) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const x = (data[i * info.channels] / 255) * 2 - 1;
    const y = (data[i * info.channels + 1] / 255) * 2 - 1;
    const z = (data[i * info.channels + 2] / 255) * 2 - 1;
    const sx = x * strength;
    const sy = y * strength;
    const sz = Math.max(z, 0.05);
    const k = 1 / Math.hypot(sx, sy, sz);
    out[i * 3] = Math.round((sx * k * 0.5 + 0.5) * 255);
    out[i * 3 + 1] = Math.round((sy * k * 0.5 + 0.5) * 255);
    out[i * 3 + 2] = Math.round((sz * k * 0.5 + 0.5) * 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } })
    .resize(size, size, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

/** A repeat's UVs land on a grid of this many steps (a texel of the full tier's 1024 map:
 *  nothing a player could see), and each primitive's UVs are shifted by whole repeats to start
 *  at 0 (the map repeats, so it draws the same): snapped float UVs compress to well under two
 *  thirds of their raw stream under meshopt. The atlas's UVs are left as packed. */
export const UV_STEPS_PER_REPEAT = 1024;

function snapUvs(uv) {
  const array = uv.getArray();
  let minU = Number.POSITIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  for (let i = 0; i < array.length; i += 2) {
    minU = Math.min(minU, array[i]);
    minV = Math.min(minV, array[i + 1]);
  }
  const shiftU = Math.floor(minU);
  const shiftV = Math.floor(minV);
  const out = new Float32Array(array.length);
  for (let i = 0; i < array.length; i += 2) {
    out[i] = Math.round((array[i] - shiftU) * UV_STEPS_PER_REPEAT) / UV_STEPS_PER_REPEAT;
    out[i + 1] = Math.round((array[i + 1] - shiftV) * UV_STEPS_PER_REPEAT) / UV_STEPS_PER_REPEAT;
  }
  uv.setArray(out);
}

export async function buildHighwatchGuild(
  tier = 'full',
  asset = HIGHWATCH_GUILD_ASSET,
  root = ROOT,
) {
  const sizes = asset.tiers[tier];
  if (!sizes) throw new Error(`No texture tier ${tier}`);
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const { sharp, Mode, toktx } = await textureTools();
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
  const doc = await io.read(path.join(root, asset.source));
  const gltf = doc.getRoot();
  const names = new Set(gltf.listNodes().map((node) => node.getName()));
  const missing = asset.requiredNodes.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Guild source is missing nodes: ${missing.join(', ')}`);
  // (keep the UVs: no map is attached yet, so a plain prune would drop every TEXCOORD_0)
  await doc.transform(prune({ keepExtras: true, keepLeaves: true, keepAttributes: true }));
  const materials = gltf
    .listMaterials()
    .map((material) => material.getName())
    .sort();
  // A material no face uses is pruned away: the set must be the declared one or a subset of it.
  const unknown = materials.filter((name) => !asset.materials.includes(name));
  if (unknown.length) throw new Error(`Unexpected guild materials: ${unknown.join(', ')}`);
  if (
    gltf.listTextures().length ||
    gltf.listCameras().length ||
    gltf.listSkins().length ||
    gltf.listAnimations().length
  ) {
    throw new Error('The guild source exports map-free, camera-free, unskinned and still');
  }
  const extras = gltf.listScenes()[0]?.listChildren()[0]?.getExtras() ?? {};
  if (!extras.highwatchGuild) throw new Error('HighwatchGuild_ROOT lost its extras');
  // the painted maps onto their materials; only a painted face keeps its UVs. Every colour is
  // the vertex colour (times the map): the exporter leaves its socket's grey as the factor.
  for (const material of gltf.listMaterials()) {
    material.setBaseColorFactor([1, 1, 1, 1]);
    const name = material.getName();
    const spec = TEXTURES.materials[name];
    if (!spec) continue;
    // its vertex colours sit under the headroom: the runtime multiplies them back
    material.setExtras({ ...material.getExtras(), vertexColourScale: VERTEX_COLOUR_SCALE });
    const color = doc
      .createTexture(`${name}_color`)
      .setImage(
        await colorMap(sharp, path.join(root, HERE, spec.color), sizes.color, Boolean(spec.atlas)),
      )
      .setMimeType('image/png');
    material.setBaseColorTexture(color);
    if (spec.normal) {
      const normal = doc
        .createTexture(`${name}_normal`)
        .setImage(
          await normalMap(
            sharp,
            path.join(root, HERE, spec.normal),
            spec.normalStrength,
            sizes.normal,
          ),
        )
        .setMimeType('image/png');
      material.setNormalTexture(normal).setNormalScale(1);
    }
    material.setRoughnessFactor(spec.roughness).setMetallicFactor(0);
  }
  for (const mesh of gltf.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const uv = prim.getAttribute('TEXCOORD_0');
      if (asset.painted.includes(name)) {
        if (!uv) throw new Error(`${mesh.getName()}: ${name} has no UVs`);
        if (!TEXTURES.materials[name].atlas) snapUvs(uv);
      } else if (uv) {
        prim.setAttribute('TEXCOORD_0', null);
      }
    }
  }
  gltf.setExtras({ sourceFingerprint: guildSourceFingerprint(asset, root), authoring: 'Blender' });
  await doc.transform(
    prune({ keepExtras: true, keepLeaves: true }),
    dedup(),
    // the scripts/assets/compress_glb_textures.mjs routing: normal maps UASTC, the rest ETC1S
    toktx({
      mode: Mode.UASTC,
      slots: /^(normalTexture|occlusionTexture)$/,
      jobs: 2,
      encoder: sharp,
    }),
    toktx({ mode: Mode.ETC1S, jobs: 2, encoder: sharp }),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const left = gltf.listTextures().filter((texture) => texture.getMimeType() !== 'image/ktx2');
  if (left.length)
    throw new Error(`Maps left unencoded: ${left.map((t) => t.getName()).join(', ')}`);
  return io.writeBinary(doc);
}

/**
 * The override table's text with the guild's rows set: its own entry replaced in place (or
 * appended at the end), every other byte untouched (the table is formatted by hand and by the
 * Collision Master, so it is never re-serialized whole).
 */
export function mergeGuildCollision(raw, rows, id = HIGHWATCH_GUILD_ASSET.collisionId) {
  const body = JSON.stringify(rows, null, 2).replace(/\n/g, '\n  ');
  const key = `"${id}": `;
  const at = raw.indexOf(`\n  ${key}`);
  if (at >= 0) {
    const open = raw.indexOf('{', at);
    let depth = 0;
    let end = open;
    for (; end < raw.length; end++) {
      if (raw[end] === '{') depth++;
      else if (raw[end] === '}' && --depth === 0) break;
    }
    return `${raw.slice(0, open)}${body}${raw.slice(end + 1)}`;
  }
  const close = raw.lastIndexOf('}');
  const head = raw.slice(0, close).replace(/\s*$/, '');
  return `${head},\n  ${key}${body}\n}${raw.slice(close + 1)}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const tier of Object.keys(HIGHWATCH_GUILD_ASSET.tiers)) {
    const bytes = await buildHighwatchGuild(tier);
    const target = tierTarget(tier);
    mkdirSync(path.dirname(path.join(ROOT, target)), { recursive: true });
    writeFileSync(path.join(ROOT, target), bytes);
    console.log(
      `${target}: ${bytes.length} bytes, sha256 ${createHash('sha256').update(bytes).digest('hex')}`,
    );
  }
  const coll = JSON.parse(readFileSync(path.join(ROOT, HIGHWATCH_GUILD_ASSET.collision), 'utf8'));
  const tablePath = path.join(ROOT, 'data/asset_collision_overrides.json');
  writeFileSync(tablePath, mergeGuildCollision(readFileSync(tablePath, 'utf8'), coll.rows));
  console.log(
    `${HIGHWATCH_GUILD_ASSET.collisionId}: ${coll.rows.boxes.length} boxes, ${coll.rows.ramps.length} decks`,
  );
}
