#!/usr/bin/env node
// Painted Tidehold walls re-bake: smaller hand-painted wall stones on the six
// painted buildings Eastbrook stands (src/sim/eastbrook_layout.ts):
// public/models/tidehold/{bank,smithy,tavern,hall,shop_a,house_b}.glb and
// their .half.glb / .quarter.glb texture tiers, plus ONE shared tiling detail
// normal the runtime lays over the walls (detail_normal_contract.json is the
// handshake with that shader). Per file only the walls colour and normal
// images change and each walls primitive gains TEXCOORD_1; the roofs, props,
// interiors, emission, geometry, materials and every other byte are kept
// exactly (lib/glb_image_splice.mjs). The far twins (.lod*.glb), the
// Edit-pieces twins (.parts.glb) and the town looks (fenrire/, highwatch/,
// ...) are left alone.
//
// Input: src/stone_wall.png (project-generated, ChatGPT image generation,
// prompt in PROMPTS.md): stylised dressed blocks of random length and colour,
// all laid flat in courses, in dark umber mortar.
//
// Once per run (bake_walls.py `tile`, Blender's Python, numpy):
//   the tile is made tileable for real (the repeat's seam is a minimum-error
//   cut through the joints over an overlap, any colour step left is spread
//   by Moisan's periodic component, and its low-frequency drift is divided
//   out, so a big wall shows no seam, cross or brightness pattern; the run
//   writes a three-by-three tiling check beside the maps), its joints found,
//   its height BUILT (joints the floor, each stone rising off them with a
//   rounded arris and a domed face by a distance transform), and its light
//   painted INTO the colour from that height (a warm soft highlight on each
//   stone's upper edge, a cool shadow on its lower edge, darker occluded
//   joints), then simplified into brushwork with a Kuwahara filter. The same
//   height gives the shared detail normal, encoded to
//   public/textures/structures/painted_stone_wall_normal.ktx2 (UASTC, linear,
//   mips, the vertical flip baked so increasing v samples UP the tile).
//
// Per building (at most --jobs headless Blenders):
//   1. the source is the shipped bake as committed at --source-ref
//      (UNBAKED_SOURCE_REF by default, the last commit before these walls
//      were re-baked; never HEAD, which holds the re-baked walls and is
//      refused, and never the working copy), so a re-run never compounds;
//   2. TEXCOORD_1 per walls vertex, in TILE units (the tile repeats once per
//      1.0): u along the wall's horizontal tangent cross(worldUp, normal), v
//      world up, anchored in world space. The frame comes from the vertex
//      normal with its heading snapped to FRAME_STEP_DEG, so faces of one
//      wall (a few degrees of settle between them) share one frame and a
//      vertex shared by two faces carries one coordinate: the pattern only
//      breaks where the geometry already does (a corner), and the courses
//      line up round corners because v is world height for every wall;
//   3. bake_walls.py `bake` (Cycles, CPU): coverage, the painted tile and its
//      aux maps baked into the walls atlas UVs THROUGH TEXCOORD_1, with a
//      wide margin so no mip samples a gutter;
//   4. bake_walls.py `composite` (numpy): the stone mask from the ORIGINAL
//      colour atlas (feathered), the new colour (the painted tile keeps its
//      painted values, the original lends only its hue and a gentle grime),
//      the mask in the colour's ALPHA (1 re-tiled stone, 0 original), and the
//      walls normal at its OWN size, flat inside the mask (the detail normal
//      carries the stones there); half and quarter tiers box filtered;
//   5. encode with the source image's recorded `ktx create` settings (UASTC
//      `--uastc-quality 4 --zstd 22` normal; the colour ETC1S, now RGBA for
//      the mask, at the best of COLOUR_QLEVELS its file's BUDGET affords) and
//      splice the maps and TEXCOORD_1 into the full, half and quarter files.
//
// Usage (repo root; needs `ktx` from KTX-Software 4.3+ on PATH or in
// ~/.local/bin, Blender 5.2 at BLENDER or /Applications):
//   node scripts/assets/painted_buildings/rebake_walls.mjs [--only smithy,bank] [--jobs 3]
//        [--work <dir>] [--source-ref <git ref>] [--dry-run]
//   node scripts/assets/compress_glb_textures.mjs public/models/tidehold/<b>{,.half,.quarter}.glb
//   node scripts/build_media_manifest.mjs generate
// (--work defaults to tmp/painted_walls, gitignored; it keeps every stage's
// maps, logs, the review mask and a report.json per building.) The compress
// step finds every image already KTX2 and writes nothing; it is the repo's
// guard that no PNG slipped through.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { buildKtxCreateArgs } from '../lib/standalone_texture_compression_core.mjs';
import { imageBytes, readGlb, spliceGlbImages } from './lib/glb_image_splice.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const MODELS = path.join(ROOT, 'public', 'models', 'tidehold');
const TILE = path.join(HERE, 'src', 'stone_wall.png');
const DETAIL_URL = '/textures/structures/painted_stone_wall_normal.ktx2';
const DETAIL_OUT = path.join(ROOT, 'public', DETAIL_URL);
const CONTRACT = path.join(HERE, 'detail_normal_contract.json');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const KTX = fs.existsSync(path.join(os.homedir(), '.local/bin/ktx'))
  ? path.join(os.homedir(), '.local/bin/ktx')
  : 'ktx';

/** The last commit whose six walls are the painted pipeline's own bake, before the re-bake
 *  landed (release/v0.46.0): the default source. A re-baked file carries TEXCOORD_1 and is refused,
 *  so a re-run from HEAD fails safe; a new painted-pipeline bake of these models moves this ref. */
const UNBAKED_SOURCE_REF = 'e7739ea2527029a7c713ab1e57c264c02ae5c214';

/** A file may grow by at most this share of its old bytes. */
const BUDGET = 0.25;
/** How the tile is read and painted (bake_walls.py prep_tile). The typical
 *  stone (the pixel-weighted median chord, chord_widths) lands at
 *  stoneTargetYd world yards wide, which sets the yards one repeat spans. */
const TILE_RECIPE = {
  // the stylised dressed blocks sit in dark umber mortar: a joint is darker than
  // the tile's low end and than its own neighbourhood, and warm
  jointTone: 'dark',
  jointPercentile: 24,
  jointWarmth: 0.0,
  jointLocalPx: 8,
  jointLocalDrop: 0.02,
  jointMarkerPx: 4,
  // the painted tile already wraps (its joints meet across both edges), so no
  // content cut (quiltPx 0): a cut through a long block left slanted stones.
  // Any colour step left at the edges is spread out (Moisan) and the low
  // frequencies under delightCycles cycles per tile are divided out
  quiltPx: 0,
  delightCycles: 1.5,
  // stylised blocks of random length, all laid flat in courses (the owner's ask: a
  // stylised wall, bigger tiling, stones not all the same): the pixel-weighted median
  // block lands here, a course near 0.4 yd
  stoneTargetYd: 0.95,
  detailSize: 512,
  // the tile is painted with its own light already: the bake adds only a touch
  // and simplifies little, so its brushwork survives
  paint: {
    lightDir: [-0.35, 0.8, 0.5],
    shadeRange: 0.28,
    highlight: 0.35,
    warm: [1.0, 0.85, 0.6],
    shadow: 0.3,
    cool: [1.0, 0.82, 0.6],
    mortarDarken: 0.1,
    kuwaharaPx: 3,
  },
};
/** The tile's relief, in world yards over tile pixels: recessed joints and
 *  rounded, bevelled faces. It paints the light into the colour and is the
 *  shared detail normal. */
const RELIEF = {
  bevelPx: 9,
  bevelYd: 0.03,
  domePx: 30,
  domeYd: 0.036,
  brushYd: 0.006,
  grainYd: 0.002,
  aoPx: 10,
  aoDepthYd: 0.014,
  aoStrength: 0.42,
};
const MASK = {
  greySat: 0.3,
  creamValue: 0.66,
  regionRadius: 10,
  stoneShare: 0.55,
  minGrey: 0.3,
  maxCream: 0.3,
  maxTimber: 0.3,
  maxDark: 0.35,
  litMargin: 8,
  glassMargin: 8,
  maxHole: 9000,
  paleRim: 0.25,
  paleReach: 14,
  maxBoxFill: 0.84,
  minArea: 400,
  regrowPx: 48,
  seamReach: 16,
  feather: 4.0,
};
/** The colour transfer (composite_walls.py): the tile keeps its painted
 *  values, the original atlas lends its hue and a gentle grime. */
const COLOUR = {
  lowpassTexels: 40,
  // the stylised tile keeps its own mix of beige, ochre, blue-grey and brown:
  // the old atlas's dark fieldstone hue would grey every block back down
  hueStrength: 0.2,
  grimeStrength: 0.3,
  grimeRange: [0.78, 1.06],
};
/** ETC1S quality for the new colour atlas, best first: the recorded 112
 *  blocks the small stones up, so each file takes the best its budget affords. */
const COLOUR_QLEVELS = [255, 192, 112];
/** Heading step a wall's frame snaps to, and the offset that keeps the
 *  authored headings (multiples of 7.5 and 22.5 degrees) off a step edge. */
const FRAME_STEP_DEG = 15;
const FRAME_OFFSET_DEG = 3.7;
/** A wall patch's offset into the tile is a whole number of stones up to this. */
const PATCH_SHIFT_STONES = 8;
/** Suggested runtime strength for the detail normal (the shader owns it). */
// Raised from 1.0 after the in-game check: at 1.0 the relief was too subtle to read as
// depth at gameplay distance (the user's ask is that the normals visibly show).
const DETAIL_STRENGTH = 1.8;

const BUILDINGS = ['bank', 'smithy', 'tavern', 'hall', 'shop_a', 'house_b'];

/** Each building's Eastbrook stand scale, read off the layout records. */
function standScales() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'sim', 'eastbrook_layout.ts'), 'utf8');
  const consts = Object.fromEntries(
    [...src.matchAll(/^const (\w+_SCALE) = ([\d.]+);/gm)].map((m) => [m[1], Number(m[2])]),
  );
  const out = {};
  for (const m of src.matchAll(
    /assetId: '\/models\/tidehold\/(\w+)\.glb',[\s\S]*?scale: (\w+|[\d.]+),/g,
  )) {
    out[m[1]] = consts[m[2]] ?? Number(m[2]);
  }
  for (const b of BUILDINGS) if (!(out[b] > 0)) throw new Error(`no stand scale for ${b}`);
  return out;
}

function ktxInfo(file) {
  const info = execFileSync(KTX, ['info', file]).toString();
  const get = (re) => (re.exec(info) ?? [])[1];
  return {
    width: Number(get(/pixelWidth: (\d+)/)),
    height: Number(get(/pixelHeight: (\d+)/)),
    params: get(/KTXwriterScParams: (.*)/)?.trim() ?? '',
    transfer: get(/Transfer: (\w+)/),
    channel: get(/Channel Type: \S+ \((\w+)\)/),
  };
}

/** `ktx create` arguments that reproduce a source image's encoding, RGB or
 *  (`alpha`) RGBA. */
function encodeArgs(info, alpha = false) {
  const p = info.params.split(/\s+/).filter(Boolean);
  const srgb = info.transfer === 'KHR_DF_TRANSFER_SRGB';
  if (!/_RGB$/.test(info.channel ?? ''))
    throw new Error(`unexpected channel layout ${info.channel}`);
  const fmt = srgb
    ? alpha
      ? 'R8G8B8A8_SRGB'
      : 'R8G8B8_SRGB'
    : alpha
      ? 'R8G8B8A8_UNORM'
      : 'R8G8B8_UNORM';
  const common = ['--generate-mipmap', '--format', fmt];
  common.push(
    ...(srgb
      ? ['--assign-tf', 'srgb', '--assign-primaries', 'bt709']
      : ['--assign-tf', 'linear', '--assign-primaries', 'none']),
  );
  if (p.includes('--uastc-quality')) return ['--encode', 'uastc', ...p, ...common];
  if (p.includes('--qlevel') || p.includes('--clevel'))
    return ['--encode', 'basis-lz', ...p, ...common];
  throw new Error(`unrecognised writer params "${info.params}"`);
}

function encode(png, ktx2, info, { qlevel, alpha = false } = {}) {
  let args = encodeArgs(info, alpha);
  if (qlevel !== undefined) {
    const at = args.indexOf('--qlevel');
    if (at < 0) throw new Error('qlevel override on a non-ETC1S map');
    args = [...args.slice(0, at + 1), String(qlevel), ...args.slice(at + 2)];
  }
  execFileSync(KTX, ['create', ...args, png, ktx2], { stdio: 'pipe' });
  return fs.readFileSync(ktx2);
}

function run(cmd, args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('close', (code) => {
      fs.writeFileSync(log, out);
      if (code !== 0 || /Traceback/.test(out)) reject(new Error(`${cmd} failed, see ${log}`));
      else resolve(out);
    });
  });
}

const rad = (d) => (d * Math.PI) / 180;

/** A deterministic offset in [0, 1) for one wall frame. */
function frameOffset(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * TEXCOORD_1 for one vertex (scene position p, unit normal n, glTF Y-up), in
 * tile units, before its wall patch's offset: u along cross(worldUp, n) with
 * the heading snapped to the frame step, v world up on walls; on sloped and
 * level faces the frame lies in the snapped plane (v up the slope, or along
 * -Z on a level face). `frame` names the snapped frame.
 */
export function wallUv1(p, n, tileUnits) {
  const step = rad(FRAME_STEP_DEG);
  const off = rad(FRAME_OFFSET_DEG);
  if (Math.abs(n[1]) >= 0.97) {
    const s = n[1] > 0 ? -1 : 1;
    return { u: p[0] / tileUnits, v: (s * p[2]) / tileUnits, frame: `flat${s}` };
  }
  const k = Math.round((Math.atan2(n[2], n[0]) - off) / step);
  const az = k * step + off;
  const [cx, cz] = [Math.cos(az), Math.sin(az)];
  const U = [cz, 0, -cx]; // cross(worldUp, (cx, 0, cz))
  if (Math.abs(n[1]) < 0.5) {
    return { u: (p[0] * U[0] + p[2] * U[2]) / tileUnits, v: p[1] / tileUnits, frame: `w${k}` };
  }
  const ke = Math.round((Math.asin(n[1]) - off) / step);
  const el = ke * step + off;
  const N = [Math.cos(el) * cx, Math.sin(el), Math.cos(el) * cz];
  const V = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
  return {
    u: (p[0] * U[0] + p[2] * U[2]) / tileUnits,
    v: (p[0] * V[0] + p[1] * V[1] + p[2] * V[2]) / tileUnits,
    frame: `s${k}|${ke}`,
  };
}

/** Union-find over integer ids. */
function unionFind(n) {
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    },
  };
}

/** Read a GLB (decoded), compute TEXCOORD_1 for every walls primitive, write
 *  a Blender-ready copy (every map PNG, TEXCOORD_1 as (u, 1 - v) so Blender's
 *  own V flip lands it on (u, v)), and return the shipped attribute data. */
async function prepareGeometry(srcBuf, dst, pngDir, wallsName, tileUnits, stoneU) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(srcBuf));
  for (const t of doc.getRoot().listTextures()) {
    const k = path.join(pngDir, `${t.getName()}.ktx2`);
    const p = path.join(pngDir, `${t.getName()}.png`);
    fs.writeFileSync(k, Buffer.from(t.getImage()));
    execFileSync(KTX, ['extract', '--transcode', 'rgba8', k, p]);
    t.setImage(fs.readFileSync(p)).setMimeType('image/png');
  }
  await doc.transform(dequantize());
  const meshes = doc.getRoot().listMeshes();
  const users = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (users.has(mesh))
      throw new Error('a mesh is instanced twice; one frame per vertex needs one node');
    users.set(mesh, node);
  }
  // every walls vertex of the building, in scene space, with its frame
  const verts = [];
  const prims = [];
  meshes.forEach((mesh, mi) => {
    const node = users.get(mesh);
    if (!node) return;
    const m = node.getWorldMatrix();
    mesh.listPrimitives().forEach((prim, pi) => {
      if (prim.getMaterial()?.getName() !== wallsName) return;
      const pos = prim.getAttribute('POSITION');
      const nrm = prim.getAttribute('NORMAL');
      const base = verts.length;
      const v = [0, 0, 0];
      const nn = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        nrm.getElement(i, nn);
        const P = [
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        ];
        const N = [
          m[0] * nn[0] + m[4] * nn[1] + m[8] * nn[2],
          m[1] * nn[0] + m[5] * nn[1] + m[9] * nn[2],
          m[2] * nn[0] + m[6] * nn[1] + m[10] * nn[2],
        ];
        const l = Math.hypot(...N) || 1;
        verts.push({ P, uv: wallUv1(P, [N[0] / l, N[1] / l, N[2] / l], tileUnits) });
      }
      prims.push({ prim, mi, pi, base, count: pos.getCount() });
    });
  });
  // each connected wall patch (vertices of one frame joined by faces, and by
  // position across the UV seams that split vertices) takes its own offset
  // into the tile: whole stones along u, none in v, so neighbouring walls
  // never repeat in lockstep while every course stays level and a wall split
  // by an atlas seam stays one wall
  const uf = unionFind(verts.length);
  const welded = new Map();
  verts.forEach((vx, i) => {
    const key = `${vx.uv.frame}|${vx.P.map((c) => Math.round(c * 1000)).join(',')}`;
    if (welded.has(key)) uf.union(welded.get(key), i);
    else welded.set(key, i);
  });
  for (const { prim, base } of prims) {
    const idx = prim.getIndices();
    for (let f = 0; f < idx.getCount(); f += 3) {
      const t = [idx.getScalar(f), idx.getScalar(f + 1), idx.getScalar(f + 2)].map((i) => base + i);
      for (const [a, b] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[0], t[2]],
      ]) {
        if (verts[a].uv.frame === verts[b].uv.frame) uf.union(a, b);
      }
    }
  }
  const patchKey = new Map();
  verts.forEach((vx, i) => {
    const r = uf.find(i);
    const k = `${vx.uv.frame}|${vx.P.map((c) => Math.round(c * 100)).join(',')}`;
    if (!patchKey.has(r) || k < patchKey.get(r)) patchKey.set(r, k);
  });
  const shift = (i) =>
    Math.floor(frameOffset(patchKey.get(uf.find(i))) * PATCH_SHIFT_STONES) * stoneU;
  const appended = [];
  for (const { prim, mi, pi, base, count } of prims) {
    const shipped = new Float32Array(count * 2);
    const blender = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const { uv } = verts[base + i];
      const u = uv.u + shift(base + i);
      shipped[2 * i] = u;
      shipped[2 * i + 1] = uv.v;
      blender[2 * i] = u;
      blender[2 * i + 1] = 1 - uv.v;
    }
    const acc = doc
      .createAccessor()
      .setType('VEC2')
      .setArray(blender)
      .setBuffer(doc.getRoot().listBuffers()[0]);
    prim.setAttribute('TEXCOORD_1', acc);
    appended.push({ mesh: mi, primitive: pi, name: 'TEXCOORD_1', type: 'VEC2', data: shipped });
  }
  const patches = new Set(verts.map((_, i) => uf.find(i))).size;
  if (!appended.length) throw new Error(`no primitive uses ${wallsName}`);
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (
      ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu'].includes(
        ext.extensionName,
      )
    )
      ext.dispose();
  }
  await io.write(dst, doc);
  return { appended, patches };
}

/** The shared tile maps, once per run, and the runtime detail normal. */
async function prepareTile(opts) {
  const tileDir = path.join(opts.work, '_tile');
  fs.mkdirSync(tileDir, { recursive: true });
  const job = { tile: TILE, tileDir, relief: RELIEF, tileRecipe: TILE_RECIPE };
  const jobPath = path.join(tileDir, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
  await run(
    BLENDER,
    [
      '-b',
      '--factory-startup',
      '--python',
      path.join(HERE, 'bake_walls.py'),
      '--',
      'tile',
      jobPath,
    ],
    path.join(tileDir, 'tile.log'),
  );
  const stats = JSON.parse(fs.readFileSync(path.join(tileDir, 'stats.json'), 'utf8'));
  // the detail normal: flipped so increasing v samples UP the tile (a
  // CompressedTexture cannot honour flipY), encoded with the repo's own
  // standalone UASTC linear arguments
  const flipped = path.join(tileDir, 'detail_normal.flip.png');
  await sharp(path.join(tileDir, 'detail_normal.png')).flip().removeAlpha().png().toFile(flipped);
  const args = buildKtxCreateArgs({
    hasAlpha: false,
    srcPath: flipped,
    dstPath: path.join(tileDir, 'detail_normal.ktx2'),
    encoding: 'uastc',
    transferFunction: 'linear',
  });
  execFileSync(KTX, args, { stdio: 'pipe' });
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(DETAIL_OUT), { recursive: true });
    fs.copyFileSync(path.join(tileDir, 'detail_normal.ktx2'), DETAIL_OUT);
    const contract = {
      textureUrl: DETAIL_URL,
      uvAttribute: 'TEXCOORD_1',
      threeAttribute: 'uv1',
      uvUnits: 'tile: the painted tile repeats exactly once per 1.0 of uv1',
      tileWorldYards: stats.tileYd,
      stoneWidthYards: {
        p25: stats.stoneWidthYd[0],
        median: stats.stoneWidthYd[1],
        p75: stats.stoneWidthYd[2],
      },
      uAxis:
        'cross(worldUp, faceNormal), heading snapped to 15 degree steps (right-handed: u right, v up, normal out)',
      vAxis: 'world up on walls; up the slope on sloped faces',
      normalConvention: 'tangent space, OpenGL: +R along +u, +G along +v, +B out of the surface',
      encoding: 'KTX2 UASTC, linear (non-sRGB), RGB, full mip chain',
      flippedAtEncode: true,
      flipMeaning: 'increasing v samples UP the stone tile with flipY=false (the KTX2 default)',
      wrap: 'RepeatWrapping on both axes',
      mask: 'walls baseColor ALPHA: 1 re-tiled painted stone, 0 original atlas, feathered',
      maskWarning:
        'the walls are opaque glTF materials: the mask alpha must never reach opacity. The camera-fade twin is transparent, so reset diffuseColor.a to opacity after map_fragment (Standard and Lambert twins alike).',
      walls:
        'materials named painted_walls@<building> on primitives that carry TEXCOORD_1 (the six Eastbrook defaults, all tiers); the town looks carry neither',
      atlasNormalInsideMask: 'flat: the detail normal alone carries the stones there',
      suggestedStrength: DETAIL_STRENGTH,
    };
    fs.writeFileSync(CONTRACT, `${JSON.stringify(contract, null, 2)}\n`);
  }
  return { tileDir, stats };
}

async function rebake(b, opts, ctx) {
  const work = path.join(opts.work, b);
  const orig = path.join(work, 'orig');
  fs.mkdirSync(orig, { recursive: true });
  const files = { full: `${b}.glb`, half: `${b}.half.glb`, quarter: `${b}.quarter.glb` };
  const bufs = Object.fromEntries(
    Object.entries(files).map(([k, f]) => [
      k,
      execFileSync('git', ['show', `${opts.sourceRef}:public/models/tidehold/${f}`], {
        cwd: ROOT,
        maxBuffer: 1 << 28,
      }),
    ]),
  );
  const glb = readGlb(bufs.full);
  const names = { color: `${b}_walls_color`, normal: `${b}_walls_normal`, emit: `${b}_walls_emit` };
  const info = {};
  for (const [k, n] of Object.entries(names)) {
    const k2 = path.join(orig, `${n}.ktx2`);
    fs.writeFileSync(k2, imageBytes(glb, n));
    execFileSync(KTX, ['extract', '--transcode', 'rgba8', k2, path.join(orig, `${n}.png`)]);
    info[k] = ktxInfo(k2);
  }
  if (
    glb.json.meshes.some((m) => m.primitives.some((p) => p.attributes.TEXCOORD_1 !== undefined))
  ) {
    throw new Error(
      `${b}: ${opts.sourceRef} already carries TEXCOORD_1; pass an older --source-ref`,
    );
  }
  const [W, H] = [info.color.width, info.color.height];
  const tileUnits = ctx.tile.stats.tileYd / ctx.scales[b];
  const blenderGlb = path.join(work, 'blender.glb');
  // a whole stone along u, in tile units: a wall patch shifts by these
  const stoneU = ctx.tile.stats.stoneWidthYd[1] / ctx.tile.stats.tileYd;
  const { appended, patches } = await prepareGeometry(
    bufs.full,
    blenderGlb,
    orig,
    `painted_walls@${b}`,
    tileUnits,
    stoneU,
  );
  const job = {
    building: b,
    work,
    out: path.join(work, 'out'),
    tileDir: ctx.tile.tileDir,
    standScale: ctx.scales[b],
    mask: MASK,
    colour: COLOUR,
    blenderGlb,
    atlasSize: [W, H],
    samples: 16,
    margin: 16,
    origColorPng: path.join(orig, `${names.color}.png`),
    origNormalPng: path.join(orig, `${names.normal}.png`),
    origEmitPng: path.join(orig, `${names.emit}.png`),
  };
  const jobPath = path.join(work, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
  const script = path.join(HERE, 'bake_walls.py');
  for (const stage of ['bake', 'composite']) {
    await run(
      BLENDER,
      ['-b', '--factory-startup', '--python', script, '--', stage, jobPath],
      path.join(work, `${stage}.log`),
    );
  }
  const stats = JSON.parse(fs.readFileSync(path.join(job.out, 'stats.json'), 'utf8'));
  const report = { building: b, tileUnits, patches, stats, files: {} };
  for (const [tier, suffix] of [
    ['full', ''],
    ['half', '_half'],
    ['quarter', '_quarter'],
  ]) {
    const normal = encode(
      stats.files[`normal${suffix}`].path,
      path.join(job.out, `normal${suffix}.ktx2`),
      info.normal,
    );
    let next;
    let colour;
    let qlevel;
    for (qlevel of COLOUR_QLEVELS) {
      colour = encode(
        stats.files[`color${suffix}`].path,
        path.join(job.out, `color${suffix}.q${qlevel}.ktx2`),
        info.color,
        { qlevel, alpha: true },
      );
      next = spliceGlbImages(
        bufs[tier],
        new Map([
          [names.color, colour],
          [names.normal, normal],
        ]),
        appended,
      );
      if (next.length <= bufs[tier].length * (1 + BUDGET)) break;
    }
    report.files[files[tier]] = {
      old: bufs[tier].length,
      new: next.length,
      growth: Number((next.length / bufs[tier].length - 1).toFixed(4)),
      color: colour.length,
      colorQlevel: qlevel,
      normal: normal.length,
    };
    if (!opts.dryRun) fs.writeFileSync(path.join(MODELS, files[tier]), next);
  }
  fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = {
    only: BUILDINGS,
    jobs: 1,
    work: path.join(ROOT, 'tmp', 'painted_walls'),
    dryRun: false,
    sourceRef: UNBAKED_SOURCE_REF,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') opts.only = argv[++i].split(',');
    else if (argv[i] === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]));
    else if (argv[i] === '--work') opts.work = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--source-ref') opts.sourceRef = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  for (const b of opts.only)
    if (!BUILDINGS.includes(b)) throw new Error(`not an Eastbrook building: ${b}`);
  const ctx = { scales: standScales(), tile: await prepareTile(opts) };
  console.log(
    `tile: ${ctx.tile.stats.tileYd} yd per repeat, stones ${ctx.tile.stats.stoneWidthYd.join('/')} yd wide`,
  );
  const queue = [...opts.only];
  const reports = [];
  await Promise.all(
    Array.from({ length: Math.min(opts.jobs, queue.length) }, async () => {
      while (queue.length) {
        const b = queue.shift();
        const r = await rebake(b, opts, ctx);
        reports.push(r);
        for (const [f, s] of Object.entries(r.files)) {
          console.log(
            `${f.padEnd(20)} ${String(s.old).padStart(9)} -> ${String(s.new).padStart(9)} (${(s.growth * 100).toFixed(1)}%) q${s.colorQlevel}`,
          );
        }
      }
    }),
  );
  const over = reports.flatMap((r) =>
    Object.entries(r.files)
      .filter(([, s]) => s.growth > BUDGET)
      .map(([f]) => f),
  );
  if (over.length) console.warn(`over the ${BUDGET * 100}% budget: ${over.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
