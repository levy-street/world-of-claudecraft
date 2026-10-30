#!/usr/bin/env node
// Painted WOC armour: the class armour sets' colour atlases repainted so the albedo carries the
// light the way the shipped hand-painted weapons do (docs/design/art-direction.md section 3:
// "hand-painted albedo carrying the light: painted top-down key, cool painted shade, painted
// ambient occlusion in creases, crisp painted highlights on metal edges and trim"). Per set and
// body fit (public/models/chars/players/woc/armor/<fit>_<class>_{top,medium,low}.glb) only the
// COLOUR atlas changes: the normal, data (ORM) and glow atlases, the geometry, the materials and
// every other byte are kept exactly (../painted_buildings/lib/glb_image_splice.mjs).
//
// The three files of a set share one atlas layout (armor_atlas.mjs ATLAS_SIZES.full): the top
// file carries the 2048 x 1024 top level of the colour atlas and the medium file the levels
// below it (one UASTC encode cut along its top level, ../woc_character/ktx2_levels.mjs, laid back
// together at runtime by src/render/characters/woc_armor_top_levels.ts). The low file's 1024 x 512
// ETC1S atlas uses the same UVs on every set but the two shaman sets, whose glow atlas gives the
// low layout a packing of its own; theirs is resampled through the geometry instead (`transfer`).
//
// Inputs:
//   the three files of each set as committed at --source-ref (UNPAINTED_SOURCE_REF by default,
//     the last commit whose armour files are unpainted; never HEAD, which holds the painted
//     atlases, and never the working copy, so a re-run repaints the original atlases and never
//     compounds);
//   src/brush_strokes.png (project-generated, ChatGPT image generation, prompt in PROMPTS.md): a
//     seamless greyscale gouache brushwork tile, a LOW-strength stroke texture only (the look
//     does not depend on it: PAINT.brush 0 drops it).
//
// Per set (at most --jobs headless Blenders at once, each stage its own process):
//   1. the top file's colour, normal and data atlases are decoded to PNG (`ktx extract`), and a
//      Blender-ready copy of the medium file is written (meshopt decoded, dequantized, no
//      textures, no extensions; the shaman sets also carry their low layout as TEXCOORD_1);
//   2. bake_armor.py `bake` (Cycles, CPU) bakes, in the full layout at the top file's size with
//      a wide margin, the measures the paint is made of, off the bind pose: coverage; the
//      painted key, the facing of the shading normal and of the normal-mapped normal to a key
//      from above and slightly in front, and the up-facing term; ambient occlusion at a crease
//      reach and a body reach (every piece occludes every other); the convex-edge measure, how
//      far a Bevel-node normal leans off the shading normal; and the brush tile projected
//      triplanar in world space, so its strokes run on across UV seams. A piece shipped inside
//      out (drawn right only because every armour material is double sided) is read from its
//      outer side: each connected shell votes by rays which side is out. The bake is cached by
//      a stamp over its inputs, PAINT_BAKE and BAKE_VERSION; bake_armor.py `twin` (no render,
//      cached the same way under PAINT_TWIN and TWIN_VERSION) finds, on every skinned piece,
//      the hidden side of each thin plate and the texel of the side the camera sees;
//   3. bake_armor.py `composite` (numpy, composite_armor.py: its header has the recipe) paints
//      the colour atlas: the original cleaned into bolder colour blocks (a self-guided filter
//      and a Kuwahara pass flatten the photographic grain, vibrance, rich trim, cool painted
//      steel), the painted key as a warm-cool ramp of painter's values, tinted occlusion and
//      dark painted seams in creases, crisp warm cream to pale-gold edge bands on convex
//      geometry, normal-map ridges and the colour's own rims and rivets (strongest on metal
//      and gold trim, softer on leather and cloth), a polished highlight on metal facing the
//      key, and the brush tile at low strength; then the ChatGPT repaint over it, one steel, a
//      softer shade on the cloth sets, a toe that keeps every shadow off black, the hidden
//      side of each thin plate painted like its seen side, and the paladin's set kept to white
//      and gold (PAINT_CLASS). The low file's atlas is its 2 x 2 box average in linear light
//      (or the `transfer` stage's resample for the shaman sets);
//   4. the full atlas is encoded ONCE with the build's own settings (../woc_character/
//      ktx_encode.mjs: UASTC level 2, RDO lambda 1, zstd 18, sRGB, mips generated) and cut along
//      its top level: the top level into the top file, the levels below into the medium file;
//      the low atlas is encoded ETC1S quality 128 (the build's low setting); each spliced in by
//      image name (full_color_atlas, low_color_atlas). Every encode's writer parameters are
//      checked against the shipped image's before anything is written.
//
// Usage (repo root; needs `ktx` from KTX-Software 4.3+ on PATH or in ~/.local/bin, Blender 5.2
// at BLENDER or /Applications):
//   node scripts/assets/painted_armor/paint_armor.mjs [--only male_warrior,female_mage]
//        [--jobs 2] [--threads 5] [--work <dir>] [--source-ref <git ref>] [--dry-run]
//        [--render] [--no-encode]
// (the shipped run: --jobs 3 --threads 4 --render, 18 sets in about 15 minutes; --no-encode
// with --dry-run is the look loop, composite and renders only, the bakes cached; the
// PAINT_VIEWS environment variable, JSON like RENDER.views, swaps the look-check views)
//   node scripts/assets/compress_glb_textures.mjs public/models/chars/players/woc/armor/*.glb
//   node scripts/build_media_manifest.mjs generate
// then re-pin what the new bytes move: the 54 sha256 rows of
// scripts/assets/woc_character/export_split.json (tests/woc_export.test.ts) and the ceilings of
// tests/woc_character_size_budget.test.ts. --work defaults to tmp/painted_armor (gitignored); it
// keeps every stage's maps, logs, the look-check renders (--render: before and after, front and
// back three-quarter) and a report.json per set. The compress step finds every image already
// KTX2 and writes nothing; it is the repo's guard that no PNG slipped through.
//
// A rebuild of the armour files (../woc_character/build_woc_split.mjs) writes the unpainted
// atlases back: run this after it, from the rebuilt commit (--source-ref).
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  imageBytes,
  readGlb,
  spliceGlbImages,
} from '../painted_buildings/lib/glb_image_splice.mjs';
import { encoderSettings, ktxArgs } from '../woc_character/ktx_encode.mjs';
import { readKtx2, splitKtx2TopLevel } from '../woc_character/ktx2_levels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ARMOR_DIR = 'public/models/chars/players/woc/armor';
const BRUSH = path.join(HERE, 'src', 'brush_strokes.png');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const KTX = fs.existsSync(path.join(os.homedir(), '.local/bin/ktx'))
  ? path.join(os.homedir(), '.local/bin/ktx')
  : 'ktx';

export const FITS = ['male', 'female'];
export const CLASSES = [
  'druid',
  'hunter',
  'mage',
  'paladin',
  'priest',
  'rogue',
  'shaman',
  'warlock',
  'warrior',
];
export const SETS = FITS.flatMap((fit) => CLASSES.map((cls) => `${fit}_${cls}`));

/** The last commit whose armour files are the unpainted build output (release/v0.46.0 before the
 *  painted armour landed): the default source, so a re-run paints the originals again instead of
 *  painting over its own paint. A rebuild of the armour files (build_woc_split.mjs) moves it:
 *  pass the rebuilt commit as --source-ref. */
const UNPAINTED_SOURCE_REF = 'e7739ea2527029a7c713ab1e57c264c02ae5c214';

/** Bump when bake_armor.py's `bake` stage changes what it writes: the bake is cached in the work
 *  dir under a stamp over its inputs, this and PAINT_BAKE. */
const BAKE_VERSION = 2;

/** A file may grow by at most this share of its old bytes (the run warns past it). */
const BUDGET = 0.15;

/** The bake (bake_armor.py). Blender space: +Z up, a set faces -Y, and stands about 1.2 units
 *  tall, so the reaches below are in those units. */
const PAINT_BAKE = {
  // from above and slightly in front, symmetric left to right (a mirrored pair of pieces
  // shares one atlas cell, so the two must take the same light) and only slightly to the
  // front: the camera sees a player's own character from behind
  keyDir: [0, -0.2, 1],
  margin: 24,
  lowMargin: 12,
  // how far a face's rays look for its own shell when deciding which side is out
  sideReach: 0.25,
  frameSamples: 16,
  occlSamples: 32,
  aoSamples: 16,
  aoShort: 0.035,
  aoLong: 0.16,
  bevelRadius: 0.009,
  bevelSamples: 8,
  brushSamples: 4,
  brushTileUnits: 0.42,
  brushBlendPower: 4,
};

/** The paint (composite_armor.py). Colours are linear-light multipliers. */
const PAINT = {
  // 1. bolder colour blocks: a self-guided filter (radius, and the variance under which a
  //    window is flattened: the photographic grain), a light Kuwahara for brush patches,
  //    vibrance and saturation, painted steel
  guidedPx: 6,
  guidedEps: 0.006,
  kuwaharaPx: 3,
  kuwaharaMix: 0.5,
  vibrance: 0.25,
  saturation: 0.08,
  clothSaturation: 0.12,
  goldSaturation: 0.1,
  steelCool: 0.55,
  steelTint: [0.9, 0.97, 1.1],
  // crisp painted detail: an unsharp mask on the base colour's value (sigma, amount)
  crispPx: 1.6,
  crisp: 1.1,
  // value structure: a fold's or a panel's light and dark pushed apart (sigma, amount)
  structurePx: 10,
  structure: 0.35,
  // 2. the painted key: a three-stop ramp over the key facing (shade, terminator, light;
  //    painter's multipliers on the gamma-encoded colour), the normal map's share of the
  //    facing
  keyNormalMap: 0.75,
  keyShade: -0.7,
  keyMid: -0.05,
  keyLit: 0.8,
  shadeTint: [0.52, 0.56, 0.8],
  midTint: [0.92, 0.92, 0.97],
  litTint: [1.3, 1.2, 1.04],
  keyStrength: 1.0,
  // the lit side's warm screen (a share of white, tinted): lifts dark cloth into its light
  litScreen: 0.1,
  litScreenTint: [1.0, 0.92, 0.75],
  // 3. occlusion: the crease and body reaches, the file's own ORM occlusion, the crease tint
  aoShortPow: 2.0,
  aoLongPow: 0.8,
  ormOcclusion: 0.6,
  aoTint: [0.24, 0.21, 0.33],
  aoStrength: 0.9,
  aoBlurPx: 1.2,
  // 4. painted edges: the bevel measure on open (unoccluded) geometry and the normal map's
  //    ridges (gated by how much relief the set's normal map carries), dark painted grooves
  bevelLo: 0.07,
  bevelHi: 0.22,
  openLo: 0.82,
  openHi: 0.96,
  reliefTilt: 0.1,
  reliefLo: 0.03,
  reliefHi: 0.1,
  ridgeLo: 0.04,
  ridgeHi: 0.14,
  ridgeWeight: 1.0,
  ridgeInsetPx: 4,
  grooveLo: 0.04,
  grooveHi: 0.16,
  groove: 0.55,
  // the cleaned colour's own relief (sigma, the high-pass band, the non-metal share, seams)
  albedoEdgePx: 2.5,
  albedoEdgeLo: 0.025,
  albedoEdgeHi: 0.1,
  albedoEdgeNonMetal: 0.35,
  albedoSeam: 0.4,
  // every edge band widened this many texels a side (at the top level's size)
  edgeWidenPx: 1,
  edgeTint: [1.0, 0.9, 0.7],
  edgeMetal: 1.0,
  edgeNonMetal: 0.45,
  edgeLiftMetal: 3.2,
  edgeLiftNonMetal: 1.7,
  edgeWhiteMetal: 0.6,
  // 5. the polished highlight on metal facing the key; the brush tile (a z-score of its own
  //    spread, times this, multiplies the colour)
  shineLo: 0.6,
  shineHi: 0.97,
  shine: 0.6,
  brush: 0.035,
  brushBlurPx: 1.0,
  // the darkest and brightest a painted texel may be (sRGB)
  floor: 0.02,
  ceiling: 0.97,
  // 7. one steel (0 = off): the share of the painted shade's and the tinted occlusion's
  //    colour that metal sheds (it keeps their value), how far every steel plate's albedo
  //    moves toward the set's typical plate, and the share of the way an open plate's painted
  //    value moves toward the typical plate's. A plate modelled in another steel (the female
  //    warrior's polished breastplate) or turned navy by the cool shade (every back plate)
  //    read as a different metal from the pauldrons and helm.
  metalShadeNeutral: 0.75,
  steelUnify: 0.85,
  steelLitShare: 0.5,
  // 8. a softer shade (0 = off; PAINT_CLASS sets it): the share of the way the shade stop
  //    moves to the terminator, and the share of the occlusion's dark taken off
  shadeLift: 0,
  aoLift: 0,
  // 9. the shadow toe (0 = off): the floor, as a share of the cleaned original's own linear
  //    light, that the darkest painted texel eases onto, so no shadow is crushed to black, and
  //    a floor under every texel (linear; 0 lets a colour that was black stay black)
  toeShare: 0.25,
  toeBlack: 0,
  // 10. one plate, both sides (bake_armor.py `twin`; twinGapHi 0 = off): the gap (Blender
  //    units) under which a thin plate's hidden side takes all of its other side's paint and
  //    over which none; the softening of the paint it takes and the spread of the share (both
  //    texels); how far the occlusion counts beside the seen-side vote (0: hidden sides only,
  //    the inner faces of flaps); and whether rigid pieces' plates (a pauldron's inside) take part
  twinGapLo: 0.012,
  twinGapHi: 0.02,
  twinBlurPx: 2,
  twinSpreadPx: 0,
  twinAoWeight: 0,
  twinRigid: 0,
  // 11. no blue (0 = off): the share of a blue texel's chroma taken off, and how far its grey
  //    sits from its own luminance toward its brightest channel (1: white steel)
  neutralBlue: 0,
  neutralBlueLift: 0,
};

/** One plate's inside painted like its outside, for the sets whose insides read black: thick
 *  shells, so the gap reaches further, and the occlusion picks the inside (PAINT step 10). */
const PAINT_INSIDES = {
  twinGapLo: 0.03,
  twinGapHi: 0.04,
  twinBlurPx: 4,
  twinSpreadPx: 3,
  twinAoWeight: 2,
  twinRigid: 1,
};

/** Per class: the robed casters' sets (their bronze, iron and dark cloth read near black under
 *  the full painted key and occlusion) take a softer shade, a higher shadow floor and a black
 *  level; the paladin's set is white steel and gold only (the repaint painted its plates
 *  white to blue), with its insides lifted too. */
const PAINT_CLOTH = {
  shadeLift: 0.75,
  aoLift: 0.65,
  toeShare: 0.5,
  toeBlack: 0.012,
  ...PAINT_INSIDES,
};
const PAINT_CLASS = {
  mage: PAINT_CLOTH,
  priest: PAINT_CLOTH,
  warlock: PAINT_CLOTH,
  paladin: { toeShare: 0.3, toeBlack: 0.008, neutralBlue: 1, neutralBlueLift: 1, ...PAINT_INSIDES },
};

/** The thin-plate search (bake_armor.py `twin`): how far a texel's ray looks for its plate's
 *  other side, and how far the onward ray must run clear of the set for a side to count as
 *  seen (Blender units: a set stands about 1.2 tall). */
const PAINT_TWIN = { reach: 0.04, escape: 0.3 };

/** Bump when bake_armor.py's `twin` stage changes what it writes. */
const TWIN_VERSION = 2;

/** The look-check render (bake_armor.py `render`): a warm sun from the front left and above,
 *  a cool sky, a cool fill from behind; metal and roughness the way the runtime caps them
 *  (src/render/characters/woc_armor_paint_core.ts). */
const RENDER = {
  size: [720, 900],
  elevation: 12,
  // azimuth (0 straight in front, positive to the set's left), the share of the set's height
  // in frame, and the height of the frame's centre as a share of the set's
  views: process.env.PAINT_VIEWS
    ? JSON.parse(process.env.PAINT_VIEWS)
    : { front: [35, 1, 0.5], back: [205, 1, 0.5], chest: [25, 0.42, 0.74] },
  sunDir: [-0.55, -0.7, 0.75],
  sunColor: [1.0, 0.9, 0.75],
  sunEnergy: 3.2,
  fillDir: [0.6, 0.8, 0.2],
  fillColor: [0.62, 0.72, 1.0],
  fillEnergy: 0.6,
  skyColor: [0.5, 0.62, 0.85],
  skyStrength: 0.55,
  metalCap: 0.4,
  roughFloor: 0.55,
  metalRoughFloor: 0.6,
};

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function ktxInfo(file) {
  const info = execFileSync(KTX, ['info', file]).toString();
  const get = (re) => (re.exec(info) ?? [])[1];
  return {
    width: Number(get(/pixelWidth: (\d+)/)),
    height: Number(get(/pixelHeight: (\d+)/)),
    levels: Number(get(/levelCount: (\d+)/)),
    params: get(/KTXwriterScParams: (.*)/)?.trim() ?? '',
    transfer: get(/Transfer: (\w+)/),
    model: get(/Model: (\w+)/),
    channel: get(/Channel Type: \S+ \((\w+)\)/),
  };
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
      if (code !== 0 || /Traceback|^Error:/m.test(out))
        reject(new Error(`${cmd} failed, see ${log}`));
      else resolve(out);
    });
  });
}

function blender(stage, jobPath, log) {
  return run(
    BLENDER,
    ['-b', '--factory-startup', '--python', path.join(HERE, 'bake_armor.py'), '--', stage, jobPath],
    log,
  );
}

/** Decode one embedded KTX2 image to PNG (and keep the KTX2 beside it). */
function extractPng(glb, name, dir, tag) {
  const k = path.join(dir, `${tag}.ktx2`);
  const p = path.join(dir, `${tag}.png`);
  fs.writeFileSync(k, imageBytes(glb, name));
  fs.rmSync(p, { force: true });
  execFileSync(KTX, ['extract', '--transcode', 'rgba8', k, p]);
  return { png: p, ktx: k, info: ktxInfo(k) };
}

/** TEXCOORD_0 of every primitive of a decoded document, in order. */
function primitiveUvs(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      out.push({ prim, uv: prim.getAttribute('TEXCOORD_0'), pos: prim.getAttribute('POSITION') });
    }
  }
  return out;
}

/** Whether the low file's layout is the full layout: the same primitives over the same
 *  vertices with the same TEXCOORD_0. When it is not, the low UVs are returned per primitive
 *  (the vertices must still be the same, in the same order: the low file is the same mesh). */
function lowLayout(fullDoc, lowDoc) {
  const full = primitiveUvs(fullDoc);
  const low = primitiveUvs(lowDoc);
  if (full.length !== low.length) throw new Error('the low file has other primitives');
  let same = true;
  const a = [0, 0];
  const b = [0, 0];
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  for (let i = 0; i < full.length; i++) {
    const f = full[i];
    const l = low[i];
    if (f.pos.getCount() !== l.pos.getCount()) throw new Error(`primitive ${i}: other vertices`);
    for (let k = 0; k < f.pos.getCount(); k++) {
      f.pos.getElement(k, pa);
      l.pos.getElement(k, pb);
      if (pa.some((v, c) => Math.abs(v - pb[c]) > 1e-6)) {
        throw new Error(`primitive ${i}: vertex ${k} moved between the full and low files`);
      }
    }
    if (!f.uv || !l.uv) {
      if (f.uv || l.uv) throw new Error(`primitive ${i}: TEXCOORD_0 on one file only`);
      continue;
    }
    for (let k = 0; k < f.uv.getCount() && same; k++) {
      f.uv.getElement(k, a);
      l.uv.getElement(k, b);
      if (Math.abs(a[0] - b[0]) > 1e-6 || Math.abs(a[1] - b[1]) > 1e-6) same = false;
    }
  }
  return same ? null : low.map((l) => l.uv);
}

/** A Blender-ready copy of the medium file: decoded, dequantized, no textures, no extensions;
 *  with the low layout as TEXCOORD_1 when it differs. Returns the atlas material names and
 *  whether the low layout differs. */
async function prepareBlenderGlb(io, bufs, dst) {
  const doc = await io.readBinary(new Uint8Array(bufs.medium));
  const lowDoc = await io.readBinary(new Uint8Array(bufs.low));
  await doc.transform(dequantize());
  await lowDoc.transform(dequantize());
  const atlasMaterials = doc
    .getRoot()
    .listMaterials()
    .filter((m) => m.getBaseColorTexture())
    .map((m) => m.getName());
  const lowUvs = lowLayout(doc, lowDoc);
  if (lowUvs) {
    const full = primitiveUvs(doc);
    const buffer = doc.getRoot().listBuffers()[0];
    full.forEach(({ prim }, i) => {
      const src = lowUvs[i];
      if (!src) return;
      const arr = new Float32Array(src.getCount() * 2);
      const e = [0, 0];
      for (let k = 0; k < src.getCount(); k++) {
        src.getElement(k, e);
        arr[2 * k] = e[0];
        arr[2 * k + 1] = e[1];
      }
      prim.setAttribute(
        'TEXCOORD_1',
        doc.createAccessor().setType('VEC2').setArray(arr).setBuffer(buffer),
      );
    });
  }
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
  await io.write(dst, doc);
  return { atlasMaterials, lowDiffers: Boolean(lowUvs) };
}

/** Encode a PNG with the split build's settings for a colour map of `tier` and check the writer
 *  parameters against the shipped image's. */
function encodeColour(png, out, tier, shipped) {
  fs.rmSync(out, { force: true });
  execFileSync(KTX, ktxArgs(encoderSettings('color', tier), png, out), { stdio: 'pipe' });
  const got = ktxInfo(out);
  for (const k of ['params', 'transfer', 'model', 'channel']) {
    if (got[k] !== shipped[k]) {
      throw new Error(`${out}: ${k} ${got[k]} where the shipped image has ${shipped[k]}`);
    }
  }
  return { bytes: fs.readFileSync(out), info: got };
}

async function paintSet(set, opts, ctx) {
  const work = path.join(opts.work, set);
  const orig = path.join(work, 'orig');
  fs.mkdirSync(orig, { recursive: true });
  const files = { top: `${set}_top.glb`, medium: `${set}_medium.glb`, low: `${set}_low.glb` };
  const bufs = Object.fromEntries(
    Object.entries(files).map(([k, f]) => [
      k,
      execFileSync('git', ['show', `${opts.sourceRef}:${ARMOR_DIR}/${f}`], {
        cwd: ROOT,
        maxBuffer: 1 << 28,
      }),
    ]),
  );
  const glbs = Object.fromEntries(Object.entries(bufs).map(([k, b]) => [k, readGlb(b)]));
  const top = {
    color: extractPng(glbs.top, 'full_color_atlas', orig, 'top_color'),
    normal: extractPng(glbs.top, 'full_normal_atlas', orig, 'top_normal'),
    data: extractPng(glbs.top, 'full_data_atlas', orig, 'top_data'),
  };
  const medColor = ktxInfoOfImage(glbs.medium, 'full_color_atlas', orig, 'medium_color');
  const low = extractPng(glbs.low, 'low_color_atlas', orig, 'low_color');
  const W = top.color.info.width;
  const H = top.color.info.height;
  if (medColor.width * 2 !== W || medColor.height * 2 !== H) {
    throw new Error(`${set}: the medium colour atlas is not half the top level`);
  }
  const blenderGlb = path.join(work, 'blender.glb');
  const prep = await prepareBlenderGlb(ctx.io, bufs, blenderGlb);
  const job = {
    set,
    work,
    out: path.join(work, 'out'),
    renderDir: path.join(opts.work, '_renders'),
    blenderGlb,
    atlasSize: [W, H],
    lowSize: [low.info.width, low.info.height],
    colorPng: top.color.png,
    normalPng: top.normal.png,
    dataPng: top.data.png,
    lowColorPng: low.png,
    brushPng: BRUSH,
    atlasMaterials: prep.atlasMaterials,
    lowDiffers: prep.lowDiffers,
    paintBake: PAINT_BAKE,
    paint: { ...PAINT, ...(PAINT_CLASS[set.split('_')[1]] ?? {}) },
    twin: PAINT_TWIN,
    render: RENDER,
    threads: opts.threads,
  };
  job.bakeStamp = sha256(
    JSON.stringify({
      bake: PAINT_BAKE,
      medium: sha256(bufs.medium),
      low: sha256(bufs.low),
      normal: sha256(fs.readFileSync(top.normal.png)),
      brush: sha256(fs.readFileSync(BRUSH)),
      version: BAKE_VERSION,
    }),
  );
  fs.mkdirSync(job.out, { recursive: true });
  fs.mkdirSync(job.renderDir, { recursive: true });
  const jobPath = path.join(work, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
  const bakeJson = path.join(work, 'bake.json');
  const cached =
    fs.existsSync(bakeJson) &&
    JSON.parse(fs.readFileSync(bakeJson, 'utf8')).stamp === job.bakeStamp;
  if (!cached) await blender('bake', jobPath, path.join(work, 'bake.log'));
  job.twinStamp = sha256(
    JSON.stringify({
      twin: PAINT_TWIN,
      side: PAINT_BAKE.sideReach,
      medium: sha256(bufs.medium),
      version: TWIN_VERSION,
    }),
  );
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
  const twinJson = path.join(work, 'twin.json');
  const twinCached =
    fs.existsSync(twinJson) &&
    JSON.parse(fs.readFileSync(twinJson, 'utf8')).stamp === job.twinStamp;
  if (!twinCached) await blender('twin', jobPath, path.join(work, 'twin.log'));
  await blender('composite', jobPath, path.join(work, 'composite.log'));
  const stats = JSON.parse(fs.readFileSync(path.join(job.out, 'stats.json'), 'utf8'));
  let lowPng = stats.files.low?.path;
  if (prep.lowDiffers) {
    job.paintedFullPng = stats.files.full.path;
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
    await blender('transfer', jobPath, path.join(work, 'transfer.log'));
    lowPng = path.join(job.out, 'low.png');
    if (!fs.existsSync(lowPng)) throw new Error(`${set}: the transfer wrote no low atlas`);
  }
  if (opts.render) {
    job.renderLooks = { before: top.color.png, after: stats.files.full.path };
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 1));
    await blender('render', jobPath, path.join(work, 'render.log'));
  }
  if (opts.noEncode) return { set, lowDiffers: prep.lowDiffers, stats: stats.summary, files: {} };
  // encode: the full atlas once, cut along its top level; the low atlas
  const full = encodeColour(
    stats.files.full.path,
    path.join(job.out, 'full.ktx2'),
    'high',
    top.color.info,
  );
  const cut = splitKtx2TopLevel(full.bytes);
  const lowEnc = encodeColour(lowPng, path.join(job.out, 'low.ktx2'), 'low', low.info);
  const halfKtx = readKtx2(cut.half);
  if (halfKtx.pixelWidth !== medColor.width || halfKtx.levelCount !== medColor.levels) {
    throw new Error(`${set}: the cut's half is not the shipped medium map's shape`);
  }
  if (lowEnc.info.levels !== low.info.levels || lowEnc.info.width !== low.info.width) {
    throw new Error(`${set}: the low atlas is not the shipped low map's shape`);
  }
  const next = {
    top: spliceGlbImages(bufs.top, new Map([['full_color_atlas', Buffer.from(cut.top)]])),
    medium: spliceGlbImages(bufs.medium, new Map([['full_color_atlas', Buffer.from(cut.half)]])),
    low: spliceGlbImages(bufs.low, new Map([['low_color_atlas', lowEnc.bytes]])),
  };
  const report = { set, lowDiffers: prep.lowDiffers, stats: stats.summary, files: {} };
  for (const [tier, f] of Object.entries(files)) {
    report.files[f] = {
      old: bufs[tier].length,
      new: next[tier].length,
      growth: Number((next[tier].length / bufs[tier].length - 1).toFixed(4)),
    };
    if (!opts.dryRun) fs.writeFileSync(path.join(ROOT, ARMOR_DIR, f), next[tier]);
  }
  fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

/** The KTX2 header facts of an embedded image (no decode). */
function ktxInfoOfImage(glb, name, dir, tag) {
  const k = path.join(dir, `${tag}.ktx2`);
  fs.writeFileSync(k, imageBytes(glb, name));
  return ktxInfo(k);
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = {
    only: SETS,
    jobs: 2,
    threads: 5,
    work: path.join(ROOT, 'tmp', 'painted_armor'),
    dryRun: false,
    render: false,
    noEncode: false,
    sourceRef: UNPAINTED_SOURCE_REF,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') opts.only = argv[++i].split(',');
    else if (argv[i] === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]));
    else if (argv[i] === '--threads') opts.threads = Math.max(1, Number(argv[++i]));
    else if (argv[i] === '--work') opts.work = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--render') opts.render = true;
    else if (argv[i] === '--no-encode') opts.noEncode = true;
    else if (argv[i] === '--source-ref') opts.sourceRef = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  for (const s of opts.only) if (!SETS.includes(s)) throw new Error(`not a WOC armour set: ${s}`);
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const ctx = { io };
  const queue = [...opts.only];
  const reports = [];
  const failed = [];
  await Promise.all(
    Array.from({ length: Math.min(opts.jobs, queue.length) }, async () => {
      while (queue.length) {
        const s = queue.shift();
        let r;
        try {
          r = await paintSet(s, opts, ctx);
        } catch (err) {
          // one set's failure never strands the others' Blenders: log it, go on, fail at the end
          console.error(`${s}: ${err.message}`);
          failed.push(s);
          continue;
        }
        reports.push(r);
        for (const [f, x] of Object.entries(r.files)) {
          console.log(
            `${f.padEnd(26)} ${String(x.old).padStart(9)} -> ${String(x.new).padStart(9)} (${(x.growth * 100).toFixed(1)}%)`,
          );
        }
      }
    }),
  );
  const over = reports.flatMap((r) =>
    Object.entries(r.files)
      .filter(([, x]) => x.growth > BUDGET)
      .map(([f]) => f),
  );
  if (over.length) console.warn(`over the ${BUDGET * 100}% budget: ${over.join(', ')}`);
  if (failed.length) {
    console.error(`failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
  fs.writeFileSync(
    path.join(opts.work, 'summary.json'),
    JSON.stringify(
      reports.sort((a, b) => a.set.localeCompare(b.set)),
      null,
      1,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
