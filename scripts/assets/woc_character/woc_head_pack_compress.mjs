// Compress a raw WOC head pack (the GLB woc_head_pack.py exports) into the compressed whole
// pack the split step cuts into the shipped files: every texture to KTX2 UASTC through the WOC
// character encoder (ktx_encode.mjs, the "color, medium/high tier" settings: UASTC level 2,
// zstd 18, RDO), the core's colour textures packed into one atlas first (head_atlas.mjs: every
// face piece then samples one texture, so the renderer can draw a face as one mesh; the atlas
// brings its own mip levels, built per cell, where every other texture's are the encoder's),
// unreferenced skins dropped (the exporter emits one for the bare rig; no piece
// is skinned), all-zero morph targets dropped per mesh (extras.targetNames kept in step, so look
// morphs up by name), then meshopt on the rigid pieces (the atlas's uvs alone keep 16 bits:
// head_atlas.mjs holdHeadAtlasUvs). Node TRS written by quantization is left as is.
//
// Level of detail (2026-10-03): once the geometry is final (after the atlas, still at the raw
// pack's full float precision) every piece takes a mid and a far index list (the WOC_lod
// extension, lod_indices.mjs, measured against the height of the body the type rides: the
// pinned anatomyTop of its fit in export_split.json, or --lod-height), carried through the
// meshopt step by keepLodIndices; the written pack is read back and every level held to the
// deviation it records before anything is written. The split keeps each piece's levels with it.
// --no-lod builds exactly the pack the step made before; --lod-report writes every piece's
// numbers (triangles, measured deviations, the morph check) to a file.
//
// Grey hair (2026-10-03): every texture only hair-role materials sample as their base colour
// (a hairstyle's strands, its scalp cap, the beards: hair_grey.mjs hairGreyTextures) is turned
// to its linear luminance in grey before its one encode (hair_grey.mjs greyPng), then encoded
// ETC1S at quality 255, compression level 5 (WOC_HAIR_GREY_KTX) instead of UASTC. The head tint
// reads nothing of a hair texel but that luminance (src/render/characters/woc_head_tint.ts), so
// a hair draws as it did; on the 2026-10-01 packs the strand and beard textures came out 64 to
// 69% smaller and the scalp caps 53 to 63%. The core atlas (skin, eyes, brows and the rest) is
// never touched. --colour-hair builds them the old way (the colour masters, UASTC like the
// core), byte for byte the files the step made before.
//
//   KTX_BIN=<ktx-software/bin> node scripts/assets/woc_character/woc_head_pack_compress.mjs \
//     <raw.glb> <out.glb> [--rdo <lambda>] [--webp] [--no-lod] [--lod-height <units>]
//     [--lod-report <file.json>] [--colour-hair]
//
// --webp ships WebP textures instead of KTX2 (the fallback when the ktx CLI is unavailable). A
// WebP carries no mip levels: the GPU makes them from the whole image, so a WebP atlas bleeds
// between its cells from level 4 again (head_atlas.mjs). Never ship a core built this way.
//
// Rebuild recipe, per head type (a, then b):
//   1. export <raw.glb> with woc_head_pack.py (the Blender command in its header);
//   2. compress it here into <pack.glb>, a build path OUTSIDE public/ (the whole pack no longer
//      ships);
//   3. split it into the catalog's streamed files (woc_head_catalog.ts wocHeadAllUrls: the
//      core, one file per hairstyle, the facial hair by shared texture), written into
//      public/models/chars/players/woc/ and verified against the pack piece by piece:
//        node scripts/assets/woc_character/woc_head_pack_split.mjs <pack.glb>
//   4. node scripts/build_media_manifest.mjs generate, then re-pin the head rows of
//      tests/woc_character_size_budget.test.ts (tests/woc_head_split_files.test.ts checks the
//      file set against the catalog).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { greyPng, hairGreyTextures, WOC_HAIR_GREY_KTX } from './hair_grey.mjs';
import {
  atlasHeadCore,
  headAtlasLevelPngs,
  holdHeadAtlasUvs,
  releaseHeadAtlasUvs,
} from './head_atlas.mjs';
import { createKtxEncoder } from './ktx_encode.mjs';
import { addLodIndices, LOD_VERIFY_TOLERANCE, verifyLodIndices } from './lod_indices.mjs';
import { keepLodIndices, WocLodExtension } from './woc_lod_extension.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');
/** The body fit each head type rides (woc_head_catalog.ts WOC_HEAD_TYPES[type].fit). */
const HEAD_TYPE_FIT = { a: 'male', b: 'female' };

function parseArgs(argv) {
  const opts = {
    input: null,
    output: null,
    rdo: 1.0,
    webp: false,
    lod: true,
    lodHeight: null,
    lodReport: null,
    greyHair: true,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rdo') opts.rdo = Number(argv[++i]);
    else if (argv[i] === '--webp') opts.webp = true;
    else if (argv[i] === '--no-lod') opts.lod = false;
    else if (argv[i] === '--lod-height') opts.lodHeight = Number(argv[++i]);
    else if (argv[i] === '--lod-report') opts.lodReport = path.resolve(argv[++i]);
    else if (argv[i] === '--colour-hair') opts.greyHair = false;
    else rest.push(argv[i]);
  }
  [opts.input, opts.output] = rest;
  if (!opts.input || !opts.output) {
    throw new Error(
      'usage: woc_head_pack_compress.mjs <raw.glb> <out.glb> [--rdo n] [--webp] [--no-lod] ' +
        '[--lod-height units] [--lod-report file] [--colour-hair]',
    );
  }
  return opts;
}

/** The height the type's levels are measured against: the crown its fit's bodies are
 *  normalized by (the split build's pinned anatomyTop, feet at the rig origin). */
function headLodHeight(doc) {
  const letters = new Set();
  for (const node of doc.getRoot().listNodes()) {
    const m = /^WocHead_([A-Z])_/.exec(node.getName());
    if (m && node.getMesh()) letters.add(m[1].toLowerCase());
  }
  if (letters.size !== 1) throw new Error(`a head pack of ${letters.size} head types`);
  const [type] = letters;
  const fit = HEAD_TYPE_FIT[type];
  const pin = JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'export_split.json'), 'utf8'));
  const height = pin.anatomyTop?.[fit];
  if (!fit || !(height > 0)) throw new Error(`no pinned anatomyTop for head type ${type} (${fit})`);
  return height;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, WocLodExtension])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(opts.input);
  const root = doc.getRoot();

  // the bare rig's skin: no node uses it, so it only costs inverse bind matrices
  const used = new Set(
    root
      .listNodes()
      .map((n) => n.getSkin())
      .filter(Boolean),
  );
  let droppedSkins = 0;
  for (const skin of root.listSkins()) {
    if (!used.has(skin)) {
      skin.dispose();
      droppedSkins++;
    }
  }

  // morph targets whose position deltas are zero on every primitive of a mesh (a hair piece's
  // eye sliders, an eye's scalp tucks) cost bytes and per-frame morph work for nothing: drop
  // them and keep extras.targetNames and the default weights in step
  let droppedTargets = 0;
  for (const mesh of root.listMeshes()) {
    const prims = mesh.listPrimitives();
    const n = prims[0]?.listTargets().length ?? 0;
    if (!n) continue;
    const names = mesh.getExtras()?.targetNames ?? [];
    const keep = [];
    for (let i = 0; i < n; i++) {
      const live = prims.some((p) => {
        const pos = p.listTargets()[i]?.getAttribute('POSITION');
        if (!pos) return false;
        const a = pos.getArray();
        for (let j = 0; j < a.length; j++) if (Math.abs(a[j]) > 1e-7) return true;
        return false;
      });
      keep.push(live);
    }
    if (keep.every(Boolean)) continue;
    for (const p of prims) {
      const targets = p.listTargets();
      for (let i = n - 1; i >= 0; i--) {
        if (!keep[i]) {
          p.removeTarget(targets[i]);
          targets[i].dispose();
        }
      }
    }
    const weights = mesh.getWeights();
    mesh.setWeights(weights.filter((_w, i) => keep[i]));
    mesh.setExtras({ ...mesh.getExtras(), targetNames: names.filter((_nm, i) => keep[i]) });
    droppedTargets += keep.filter((k) => !k).length;
  }

  // one colour atlas for the core (head_atlas.mjs), built from the PNG masters before they encode
  const atlas = await atlasHeadCore(doc);

  // the geometry is final here, at the raw pack's full precision: every piece's levels of detail
  const lodHeight = opts.lod ? (opts.lodHeight ?? headLodHeight(doc)) : null;
  const lod = opts.lod ? await addLodIndices(doc, { height: lodHeight }) : null;

  const textures = root.listTextures();
  // the hair, scalp and beard textures in grey (hair_grey.mjs), each from its colour master
  const greyHair = new Set(opts.greyHair ? hairGreyTextures(doc) : []);
  for (const tex of greyHair) {
    const png = tex.getImage();
    if (!png || tex.getMimeType() !== 'image/png') {
      throw new Error(
        `hair texture ${tex.getName()} is ${tex.getMimeType()}, expected a PNG master`,
      );
    }
    tex.setImage(await greyPng(png));
  }
  if (opts.webp) {
    await doc.transform(textureCompress({ targetFormat: 'webp', quality: 92 }));
  } else {
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    const encoder = createKtxEncoder({
      repoRoot: ROOT,
      cacheDir: path.join(ROOT, 'tmp', 'woc_head_pack_ktx_cache'),
    });
    const settings = { codec: 'uastc', srgb: true, rdo: opts.rdo };
    // an atlas whose levels went missing on the way here would encode with generated ones and
    // look right up close: fail instead
    if (
      atlas &&
      !textures.some((tex) => tex.getName() === atlas.atlas && headAtlasLevelPngs(tex))
    ) {
      throw new Error(`${atlas.atlas}: the atlas texture has no mip levels of its own to encode`);
    }
    await Promise.all(
      textures.map(async (tex) => {
        const png = tex.getImage();
        if (!png || tex.getMimeType() !== 'image/png') {
          throw new Error(
            `texture ${tex.getName()} is ${tex.getMimeType()}, expected a PNG master`,
          );
        }
        // the atlas hands over every level; the encoder generates the others' from the master
        const levels = headAtlasLevelPngs(tex);
        const ktx = levels
          ? await encoder.encodeLevels(
              levels.map((level) => Buffer.from(level)),
              settings,
            )
          : await encoder.encode(
              Buffer.from(png),
              greyHair.has(tex) ? WOC_HAIR_GREY_KTX : settings,
            );
        tex.setImage(new Uint8Array(ktx)).setMimeType('image/ktx2');
        tex.setURI(`${(tex.getName() || 'texture').replace(/\.png$/i, '')}.ktx2`);
      }),
    );
  }
  await doc.transform(prune({ keepLeaves: true }));
  // the atlas's uvs sit out the pack-wide quantization (12 bits of the unit square: half a
  // texel on an atlas) and are written at 16 bits; every other attribute is quantized as before
  const heldUvs = holdHeadAtlasUvs(doc);
  if (lod) {
    // the levels follow their vertices through meshopt's reorder (keepLodIndices)
    const step = meshopt({ encoder: MeshoptEncoder, level: 'high' });
    await doc.transform(keepLodIndices([step], { encoder: MeshoptEncoder }));
  } else {
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  }
  if (releaseHeadAtlasUvs(doc) !== heldUvs) {
    throw new Error('the meshopt step dropped a primitive whose atlas uvs were held');
  }
  const out = await io.writeBinary(doc);
  // the written pack read back: every level re-measured over the quantized pieces
  const lodCheck = lod
    ? verifyLodIndices(await io.readBinary(out), { tolerance: LOD_VERIFY_TOLERANCE * lodHeight })
    : null;
  if (lodCheck?.failures.length) {
    throw new Error(`WOC_lod levels fail their check:\n  ${lodCheck.failures.join('\n  ')}`);
  }
  if (lod && opts.lodReport) {
    fs.mkdirSync(path.dirname(opts.lodReport), { recursive: true });
    fs.writeFileSync(opts.lodReport, `${JSON.stringify({ ...lod, check: lodCheck }, null, 1)}\n`);
  }
  fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
  fs.writeFileSync(opts.output, out);
  const before = fs.statSync(opts.input).size;
  console.log(
    JSON.stringify({
      input: opts.input,
      output: opts.output,
      bytesBefore: before,
      bytesAfter: out.length,
      textures: textures.length,
      atlas,
      codec: opts.webp ? 'webp' : `uastc rdo ${opts.rdo}`,
      greyHair: opts.greyHair
        ? {
            codec: opts.webp
              ? 'webp'
              : `etc1s qlevel ${WOC_HAIR_GREY_KTX.qlevel} clevel ${WOC_HAIR_GREY_KTX.clevel}`,
            textures: [...greyHair].map((tex) => tex.getName()),
          }
        : null,
      lod: lod
        ? {
            height: lodHeight,
            ...lod.totals,
            checkedLevels: lodCheck.rows.length,
            worstExcess: lodCheck.rows.length
              ? Math.max(...lodCheck.rows.map((r) => r.measured - r.recorded))
              : 0,
          }
        : null,
      droppedSkins,
      droppedTargets,
      morphTargets: Object.fromEntries(
        root.listMeshes().map((m) => [m.getName(), m.getExtras()?.targetNames ?? []]),
      ),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
