// Build the SPLIT WOC player character files (the 2026-09-25 character size gameplan, steps 3
// and 4): one base and one animation library per body type, and three armor files per set and
// body type, instead of 18 per-class files that each repeat the body, the face, the rig, every
// clip and the high texture tier.
//
//   public/models/chars/players/woc/base_<sex>.glb        rig + body, no clips, no head (the
//                                                          modular head packs are the head)
//   public/models/chars/players/woc/anims_<sex>.glb       the rig's nodes + every clip, no mesh
//   public/models/chars/players/woc/armor/<sex>_<class>_low.glb
//                                                          one armor set, bound to a copy of the
//                                                          rig by bone name, its own low layout
//   public/models/chars/players/woc/armor/<sex>_<class>_medium.glb
//                                                          the same set over the full layout,
//                                                          every map at half its size
//   public/models/chars/players/woc/armor/<sex>_<class>_top.glb
//                                                          the top mip level of each of those
//                                                          maps, and nothing else
//
// The medium and top files are one build (2026-10-03): the set's atlases are composed at the
// full layout (armor_atlas.mjs ATLAS_SIZES.full) and each map is encoded ONCE with its whole mip
// chain, then cut along its top level (ktx2_levels.mjs): the medium file carries the levels
// below it, a complete texture at half the size, and the top file the top level. A texture's
// top level is three quarters of its bytes and only a close-up samples it, so every character
// draws the medium file and the runtime lays the top file over it for the few seen up close
// (the local player, a preview: src/render/characters/woc_armor_packs.ts). The top file is a
// standard GLB whose one degenerate mesh wears one material holding each top level in the
// slot its map fills in the medium file, under the same image name, so the plain loader reads
// it and the runtime pairs each level with its map by name (woc_armor_top_levels.ts).
//
// Inputs (the Blender export of claude-animation-20260924, export_bundle_v01.py):
//   <export>/Modular/<sex>/character_base.glb + appearance_parts.glb + character.manifest.json
//   <export>/Modular/armor/armor_*.glb and <export>/_build/inventory-<sex>.json
//   <tiers>/<tier>/armor_<sex>_<class>.{glb,manifest.json}: the artist's texture tiers; each
//     manifest's `materialTextures` names the lossless PNG master of every map at that tier's
//     size, which is what this encodes (ktx_encode.mjs), ONCE, with the gameplan's settings:
//     the low file from the artist's low tier, color (and emissive) only, ETC1S; the full layout
//     from the high tier, UASTC + RDO (normals at a gentler lambda through their own pass).
//     Overlay tier roots (--tiers-overlay) are searched first,
//     set by set: the 2026-09-30 caster cloth tiers (tmp/woc_anim_v01/caster_tiers.mjs) replace
//     the Priest/Mage/Warlock sets, the 2026-10-02 Paladin tiers (paladin_tiers.mjs beside it)
//     both Paladin sets, and the other sets keep their 09-23 tiers. A registered overlay root
//     that is missing fails the build: a set whose geometry did not change would otherwise fall
//     back to its 09-23 tier without a word, and a full build would pin the older maps.
//
// Every armor set is re-verified against the per-class assembled file of the previous
// pipeline (tmp/woc_anim_v01/build_v01.mjs -> build_woc_warrior.mjs, the artist's assembled
// reference, written to the export's Game_Ready folder and never shipped): the split files are
// composed back in memory (base + that set's MEDIUM armor + the library's clips) and the body's
// and every armor part's world-space vertices must match at rest and at two points of every clip
// (verifyAgainstReference, nearest neighbour). A file that fails does not ship (exit 1). The
// reference's original face has no counterpart: the split base ships without a head.
//
// A full passing build writes the accepted delivery pin (export_split.json beside this script:
// every shipped file's sha256, pinned by tests/woc_export.test.ts) and its report to
// tmp/woc_split/split-report.json (never under public/, which deploys verbatim).
//
// Level of detail (2026-10-03): every base and every low and medium armor file carries a mid and
// a far index list per primitive (the WOC_lod extension, woc_lod_extension.mjs, made by
// lod_indices.mjs against the body's height), added once the geometry is final and carried
// through the meshopt step by keepLodIndices; the written file is read back and each level held
// to the deviation it records (a failure stops the build like a drift does). The top files
// carry no geometry and no levels. --no-lod builds exactly the files the build made before.
//
// Usage:
//   node scripts/assets/woc_character/build_woc_split.mjs [--export dir] [--tiers dir]
//     [--tiers-overlay dir] [--no-tiers-overlay]
//     [--out dir] [--report file] [--reference-dir dir] [--only male-mage,female-rogue,...]
//     [--no-verify] [--pin-only] [--no-lod]
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import {
  cloneDocument,
  copyToDocument,
  dedup,
  mergeDocuments,
  meshopt,
  prune,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { animEncoder, leanAnimJson, uniformTimeline } from './anim_timeline.mjs';
import { atlasArmorSet } from './armor_atlas.mjs';
import {
  assertPackRigMatches,
  dropOrphanNodes,
  fixInvertedWinding,
  idlePosedAnatomyBounds,
  idlePosedSkinnedHeight,
  keepRigScene,
  mergePack,
  restPosedAnatomyBounds,
  scaleHandslots,
  stripHandslotScaleTracks,
  verifyAgainstReference,
} from './build_woc_warrior.mjs';
import { createKtxEncoder, encoderSettings } from './ktx_encode.mjs';
import { readKtx2, splitKtx2TopLevel } from './ktx2_levels.mjs';
import {
  addLodIndices,
  LOD_LEVELS,
  LOD_MIN_SAVING,
  LOD_VERIFY_TOLERANCE,
  verifyLodIndices,
} from './lod_indices.mjs';
import { retargetOrphanChannels } from './orphan_channels.mjs';
import { nodeTable, worldMatrices } from './rig_math.mjs';
import { keepLodIndices, WocLodExtension } from './woc_lod_extension.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'public', 'models', 'chars', 'players', 'woc');
const STUDIO = path.join(os.homedir(), 'Documents', 'WOC Armor Studio');
export const SEXES = ['male', 'female'];
export const CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'mage',
  'priest',
  'warlock',
  'druid',
  'shaman',
];
/** The armor files a set ships per body type (splitFiles.armor): `low` and `medium` complete
 *  files, `top` the top mip level of each of the medium file's maps. The runtime's texture
 *  tiers read them as low = low, medium = medium, high = medium + top (woc_armor_core.ts). */
export const ARMOR_FILES = ['low', 'medium', 'top'];
/** The atlas layouts the armor files are built at (armor_atlas.mjs ATLAS_SIZES), each from
 *  one of the artist's texture tiers: the low file its own, the medium and top files ONE full
 *  layout from the high tier, cut along the top level. */
export const ARMOR_LAYOUTS = { low: 'low', full: 'high' };
/** Texture tier -> the largest map dimension (the artist's tiers; the masters are already sized). */
export const TIER_MAX_DIM = { low: 256, medium: 512, high: 1024 };
/** The top file's one material (it holds a map per slot and is drawn by nothing). */
export const TOP_MATERIAL_NAME = 'full atlas top';

/** The base's one map, the body atlas: it ships at 512 like every under-armor atlas that swaps
 *  onto the same UV layout (the male handoff's 1024 was the one outlier). The base budget per
 *  fit is tests/woc_character_size_budget.test.ts WOC_SIZE_BUDGETS.base. */
export const BASE_MAP_MAX_DIM = { default: 512 };

/** The split file names, relative to the output directory. */
export const splitFiles = {
  base: (sex) => `base_${sex}.glb`,
  anims: (sex) => `anims_${sex}.glb`,
  armor: (sex, cls, file) => `armor/${sex}_${cls}_${file}.glb`,
};

/** The per-class file the previous pipeline shipped (the verification reference). */
const assembledName = (sex, cls) => `woc_${cls}${sex === 'female' ? '_female' : ''}.glb`;

function parseArgs(argv) {
  const opts = {
    export: path.join(STUDIO, 'Exports', 'WOC_Anim_v01_2026-09-24'),
    tiers: path.join(
      STUDIO,
      'Exports',
      'All_Classes_Refined_Arms_2026-09-23',
      'Texture_Tiers',
      'tiers',
    ),
    // tier roots searched BEFORE --tiers, first hit wins: the 2026-10-02 Paladin overlay (both
    // fits at the paint's true brightness, the male shoulders, gauntlets and boots on clean
    // UVs; tmp/woc_anim_v01/paladin_tiers.mjs) and the 2026-09-30 caster cloth overlay
    // (Priest/Mage/Warlock with the new tunic, gloves and boots; tmp/woc_anim_v01/caster_tiers.mjs)
    tierOverlays: [
      // the 2026-10-03 male warrior rebuild, 4,497 triangles, textures baked from the dense set
      path.join(STUDIO, 'Exports', 'Warrior_LOD_Tiers_2026-10-03', 'tiers'),
      path.join(STUDIO, 'Exports', 'Paladin_Clean_Tiers_2026-10-02', 'tiers'),
      path.join(STUDIO, 'Exports', 'Caster_Cloth_Tiers_2026-09-30', 'tiers'),
    ],
    out: DEFAULT_OUT,
    referenceDir: path.join(
      STUDIO,
      'Exports',
      'WOC_Anim_v01_2026-09-24',
      'Game_Ready',
      'public',
      'models',
      'chars',
      'players',
    ),
    report: path.join(ROOT, 'tmp', 'woc_split', 'split-report.json'),
    knight: path.join(ROOT, 'public', 'models', 'chars', 'players', 'knight.glb'),
    cache: path.join(ROOT, 'tmp', 'woc_split_ktx_cache'),
    only: null,
    verify: true,
    pinOnly: false,
    bodiesOnly: false,
    lod: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--export') opts.export = path.resolve(argv[++i]);
    else if (a === '--tiers') opts.tiers = path.resolve(argv[++i]);
    else if (a === '--tiers-overlay') opts.tierOverlays.unshift(path.resolve(argv[++i]));
    else if (a === '--no-tiers-overlay') opts.tierOverlays = [];
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    // where the report goes (a scratch build should not replace the last full build's)
    else if (a === '--report') opts.report = path.resolve(argv[++i]);
    else if (a === '--reference-dir') opts.referenceDir = path.resolve(argv[++i]);
    else if (a === '--only') opts.only = new Set(argv[++i].split(','));
    else if (a === '--no-verify') opts.verify = false;
    // re-write the accepted pin from the last full build's report (no rebuild)
    else if (a === '--pin-only') opts.pinOnly = true;
    // rebuild the bases and libraries only (the armor files and their check stay as built)
    else if (a === '--bodies-only') opts.bodiesOnly = true;
    // no WOC_lod levels: the files exactly as the build made them before the LOD step
    else if (a === '--no-lod') opts.lod = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** gltf-transform's writer drops a TRS within 1e-5 of identity (Blender exports 1.000002 bone
 *  scales), which the rest-pose checks (1e-6) then flag: put the source's exact node transforms
 *  back into a written GLB, by node name. Rig nodes only: a node carrying a mesh keeps what the
 *  writer gave it, because meshopt quantization folds a rigid mesh's dequantization into its
 *  node transform (restoring the pre-quantization TRS drew the rigid face parts ten times
 *  oversize). `lean` also drops the JSON members that restate a glTF default (the animation
 *  library, whose JSON is most of the file: anim_timeline.mjs leanAnimJson). */
function restoreTransforms(file, byName, { lean = false } = {}) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len));
  const tail = b.subarray(20 + len);
  for (const n of json.nodes ?? []) {
    if (n.mesh !== undefined) continue;
    const src = byName.get(n.name);
    if (!src) continue;
    for (const key of ['translation', 'rotation', 'scale']) {
      const v = src[key];
      if (v) n[key] = v;
      else delete n[key];
    }
    delete n.matrix;
  }
  if (lean) leanAnimJson(json);
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 32)]);
  const head = Buffer.alloc(20);
  head.write('glTF');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + tail.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.write('JSON', 16);
  fs.writeFileSync(file, Buffer.concat([head, text, tail]));
}

/** Every node's TRS in a document, by name (for restoreTransforms). */
function nodeTRS(doc) {
  const out = new Map();
  for (const n of doc.getRoot().listNodes()) {
    out.set(n.getName(), {
      translation: n.getTranslation(),
      rotation: n.getRotation(),
      scale: n.getScale(),
    });
  }
  return out;
}

/** Move every accessor onto the first buffer (a GLB carries one), disposing the rest. */
function consolidateBuffers(doc) {
  const buffers = doc.getRoot().listBuffers();
  for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffers[0]);
  for (const buffer of buffers.slice(1)) buffer.dispose();
}

/** Encode every PNG/JPEG image of a document to KTX2 with the tier's settings, by the map slot
 *  each texture fills (color / normal / data). Returns the count encoded. */
async function encodeTextures(doc, tier, encoder, pngFor = null) {
  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);
  void basisu;
  const slotsOf = new Map();
  for (const mat of doc.getRoot().listMaterials()) {
    const tag = (tex, kind) => {
      if (!tex) return;
      const cur = slotsOf.get(tex);
      // a texture shared by a color and a data slot is encoded as color (never seen here)
      if (!cur || kind === 'color') slotsOf.set(tex, { kind, mat });
    };
    tag(mat.getBaseColorTexture(), 'color');
    tag(mat.getEmissiveTexture(), 'color');
    tag(mat.getNormalTexture(), 'normal');
    tag(mat.getMetallicRoughnessTexture(), 'data');
    tag(mat.getOcclusionTexture(), 'data');
  }
  let n = 0;
  const jobs = [];
  for (const [tex, { kind, mat }] of slotsOf) {
    let master = pngFor ? pngFor(tex, mat) : tex.getImage();
    if (!master) throw new Error(`no PNG master for texture ${tex.getName()} (${mat.getName()})`);
    const mime = pngFor ? 'image/png' : tex.getMimeType();
    if (mime === 'image/ktx2') throw new Error(`refusing to re-encode KTX2 ${tex.getName()}`);
    // the body and face maps ARE their Tripo JPEG sources (no lossless master exists): the
    // pixels are decoded losslessly to PNG for the one KTX2 encode, never re-compressed
    if (mime === 'image/jpeg') master = await sharp(Buffer.from(master)).png().toBuffer();
    jobs.push(
      encoder.encode(Buffer.from(master), encoderSettings(kind, tier)).then((ktx) => {
        tex.setImage(new Uint8Array(ktx)).setMimeType('image/ktx2');
        const base = (tex.getURI() || tex.getName() || 'texture').replace(/\.(png|jpe?g)$/i, '');
        tex.setURI(`${base}.ktx2`);
        n++;
      }),
    );
  }
  await Promise.all(jobs);
  return n;
}

// -------------------------------------------------------------------------------- level of detail

/** The final geometry step of a mesh file, meshopt (reorder, quantize, compression), with the
 *  WOC_lod levels made against `height` first and carried through it (keepLodIndices). Returns
 *  the level report. Only called with LODs on: --no-lod keeps each file's own meshopt call. */
async function meshoptWithLods(doc, height) {
  const report = await addLodIndices(doc, { height });
  await doc.transform(
    keepLodIndices([meshopt({ encoder: MeshoptEncoder, level: 'high' })], {
      encoder: MeshoptEncoder,
    }),
  );
  return report;
}

/** A written file read back: every WOC_lod level re-measured over the quantized vertices and
 *  held to the deviation it records (LOD_VERIFY_TOLERANCE of the height on top). The report
 *  row's `lod`: the file's totals, the check, and every primitive's row (`rows`). */
async function writtenLodRow(io, file, report) {
  const tolerance = LOD_VERIFY_TOLERANCE * report.height;
  const { rows, failures } = verifyLodIndices(await io.read(file), { tolerance });
  const excess = rows.map((r) => r.measured - r.recorded);
  return {
    height: report.height,
    ...report.totals,
    check: {
      levels: rows.length,
      tolerance,
      worstExcess: excess.length ? Math.max(...excess) : 0,
      failures: failures.map((f) => `${path.relative(ROOT, file)}: ${f}`),
    },
    rows: report.primitives,
  };
}

// -------------------------------------------------------------------------------- base + anims

/** Dispose every clip with its channels and samplers (their accessors then prune away). */
function disposeAnimations(doc) {
  for (const a of doc.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) ch.dispose();
    for (const sm of a.listSamplers()) sm.dispose();
    a.dispose();
  }
}

const REST_EPS = 1e-5;

function sameVec(a, b, eps) {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

/** A node/path whose channel, in EVERY clip that carries it, holds the node's own rest value the
 *  whole clip long moves nothing: drop it from every clip. The bone then simply keeps its rest
 *  value, exactly what those keys wrote, so no blend between two clips can differ (a channel is
 *  only dropped when every clip agrees). Rotation compares q and -q as equal. */
function dropRestConstantChannels(doc) {
  const byTarget = new Map();
  for (const a of doc.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) {
      const key = ch.getTargetNode();
      if (!key) continue;
      const k = `${doc.getRoot().listNodes().indexOf(key)}:${ch.getTargetPath()}`;
      const list = byTarget.get(k) ?? [];
      list.push([a, ch]);
      byTarget.set(k, list);
    }
  }
  let dropped = 0;
  for (const list of byTarget.values()) {
    const [, first] = list[0];
    const node = first.getTargetNode();
    const pathName = first.getTargetPath();
    if (pathName === 'weights') continue;
    const rest =
      pathName === 'translation'
        ? node.getTranslation()
        : pathName === 'rotation'
          ? node.getRotation()
          : node.getScale();
    const n = rest.length;
    const atRest = list.every(([, ch]) => {
      const out = ch.getSampler().getOutput().getArray();
      for (let i = 0; i + n <= out.length; i += n) {
        const v = Array.from(out.subarray(i, i + n));
        if (sameVec(v, rest, REST_EPS)) continue;
        if (
          pathName === 'rotation' &&
          sameVec(
            v.map((x) => -x),
            rest,
            REST_EPS,
          )
        )
          continue;
        return false;
      }
      return true;
    });
    if (!atRest) continue;
    for (const [a, ch] of list) {
      const sm = ch.getSampler();
      a.removeChannel(ch);
      ch.dispose();
      if (!a.listChannels().some((c) => c.getSampler() === sm)) {
        a.removeSampler(sm);
        sm.dispose();
      }
      dropped++;
    }
  }
  return dropped;
}

/** Visual keying leaves ~1e-6 float noise on scale channels authored as exactly 1 (the handslot
 *  ones must be a constant 1 to drop): snap every scale channel whose whole curve sits within
 *  1e-4 of 1. The IK legs' real sub-percent scale stays as baked (build_v01.mjs cleanBase). */
function snapUnitScaleChannels(doc) {
  let snapped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== 'scale') continue;
      const sampler = ch.getSampler();
      const arr = sampler.getOutput().getArray();
      let dev = 0;
      for (const v of arr) dev = Math.max(dev, Math.abs(v - 1));
      if (dev === 0 || dev >= 1e-4) continue;
      const ones = sampler.getOutput().clone();
      ones.setArray(new Float32Array(arr.length).fill(1));
      sampler.setOutput(ones);
      snapped++;
    }
  }
  return snapped;
}

/** Dispose the original face's nodes (and with them, once pruned, their meshes, materials and
 *  maps): every name must be a mesh node of the document, so a renamed part can never slip
 *  through into a shipped base. Returns the names removed. */
function stripOriginalFace(doc, names) {
  const byName = new Map(
    doc
      .getRoot()
      .listNodes()
      .map((n) => [n.getName(), n]),
  );
  for (const name of names) {
    const node = byName.get(name);
    if (!node?.getMesh()) throw new Error(`original face part ${name} is not a mesh node`);
    if (node.listChildren().length > 0) throw new Error(`original face part ${name} has children`);
    node.dispose();
  }
  return [...names];
}

/** The animation library's writer: the build's extensions with the meshopt encoder carrying
 *  the library's filter precision (anim_timeline.mjs animEncoder: 13-bit rotations, 16-bit
 *  translation and scale). Every other file keeps the build's own IO. */
function animationIo() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.encoder': animEncoder(MeshoptEncoder, 13, 16),
    'meshopt.decoder': MeshoptDecoder,
  });
}

async function buildBody(io, opts, sex, encoder, knightHeight) {
  const dir = path.join(opts.export, 'Modular', sex);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'character.manifest.json'), 'utf8'));
  const base = await io.read(path.join(dir, manifest.base));
  retargetOrphanChannels(base);
  dropOrphanNodes(base);
  const table = nodeTable(base);
  table.doc = base;
  const world = worldMatrices(table);
  const app = await io.read(path.join(dir, manifest.packs.appearance.url));
  retargetOrphanChannels(app);
  dropOrphanNodes(app);
  mergePack(base, table, world, app, manifest.packs.appearance.nodes, 'appearance');
  keepRigScene(base);
  fixInvertedWinding(base);
  consolidateBuffers(base);
  snapUnitScaleChannels(base);
  const handslot = stripHandslotScaleTracks(base);
  // weapon-scale compensation, exactly as build_woc_warrior.mjs (the game normalizes every
  // body to one height; the slot bones cancel this body's larger factor for held props)
  const anatomy = [
    ...manifest.baseNodes,
    ...Object.values(manifest.appearance).flatMap((slot) =>
      Object.values(slot.variants).flatMap((v) => v.nodes),
    ),
  ];
  const slotScale = idlePosedAnatomyBounds(base, anatomy).height / knightHeight;
  // The handoff's ORIGINAL face (the appearance pack: head, neck, eyes, mouth, hair, brows) is
  // measured here and never shipped: the modular head packs replaced it, so the base ends at
  // the neck. Its crown, at the rest pose the game's normalization reads a WOC body in, is the
  // top every body is normalized by (anatomyTop, recorded in the pin and held by the runtime
  // as WOC_ANATOMY_TOP, src/render/characters/woc_armor_core.ts), which keeps every character
  // the size it was with that head on. Measured before the handslot scale below, which moves
  // no anatomy.
  const anatomyBounds = restPosedAnatomyBounds(base, anatomy);
  scaleHandslots(base, slotScale);
  const stripped = stripOriginalFace(base, manifest.packs.appearance.nodes);
  const trs = nodeTRS(base);

  // the animation library: the rig's nodes and every clip, no mesh, skin or material
  const anims = cloneDocument(base);
  for (const node of anims.getRoot().listNodes()) {
    if (node.getMesh() || node.getSkin()) {
      node.setMesh(null);
      node.setSkin(null);
    }
  }
  for (const skin of anims.getRoot().listSkins()) skin.dispose();
  // a node that only carried a part (no joint, no animated channel, no child) goes too
  const animated = new Set();
  for (const a of anims.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) animated.add(ch.getTargetNode());
  }
  // every joint of every skin (the face parts ride a subset skin, the body the whole rig)
  const keepNames = new Set(
    base
      .getRoot()
      .listSkins()
      .flatMap((skin) => skin.listJoints().map((j) => j.getName())),
  );
  for (const node of anims.getRoot().listNodes()) {
    const name = node.getName();
    if (keepNames.has(name) || animated.has(node) || node.listChildren().length > 0) continue;
    if (/^WOC_Armored_Rig$/.test(name)) continue;
    node.dispose();
  }
  const droppedChannels = dropRestConstantChannels(anims);
  // every clip keeps every authored frame on one shared timeline, rotations written at 13 bits
  // (anim_timeline.mjs: the 2026-10-03 measure, 39% smaller at under 0.03 degrees);
  // keepLeaves: a joint no clip moves (the left handslot) is still a rig node the library keeps
  await anims.transform(
    uniformTimeline({ fps: 60 }),
    prune({ keepLeaves: true }),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  const animsFile = path.join(opts.out, splitFiles.anims(sex));
  fs.mkdirSync(path.dirname(animsFile), { recursive: true });
  await animationIo().write(animsFile, anims);
  restoreTransforms(animsFile, trs, { lean: true });

  // the base: the rig, the body and the face, no clips (samplers and channels are not in
  // prune's default sweep: dispose them with their clip or their accessors stay)
  disposeAnimations(base);
  await base.transform(prune(), dedup());
  const encoded = await encodeTextures(base, 'high', encoder, await baseMapMasters(base));
  // the level of detail is measured against the body's own height (the crown it is normalized
  // by, over its feet), and the armor files of this fit take the same
  const lodHeight = anatomyBounds.max[1] - anatomyBounds.min[1];
  let lod = null;
  if (opts.lod) lod = await meshoptWithLods(base, lodHeight);
  else await base.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const baseFile = path.join(opts.out, splitFiles.base(sex));
  await io.write(baseFile, base);
  restoreTransforms(baseFile, trs);
  return {
    sex,
    manifest,
    handslotScale: +slotScale.toFixed(4),
    anatomyTop: anatomyBounds.max[1],
    anatomyFeet: anatomyBounds.min[1],
    lodHeight,
    strippedFaceNodes: stripped,
    droppedHandslotScaleTracks: handslot.dropped,
    baseTextures: encoded,
    base: {
      file: path.relative(ROOT, baseFile),
      bytes: fs.statSync(baseFile).size,
      sha256: sha256(baseFile),
      ...(lod ? { lod: await writtenLodRow(io, baseFile, lod) } : {}),
    },
    anims: {
      file: path.relative(ROOT, animsFile),
      bytes: fs.statSync(animsFile).size,
      sha256: sha256(animsFile),
      clips: anims.getRoot().listAnimations().length,
      droppedRestChannels: droppedChannels,
    },
    trs,
  };
}

/** Each base texture's lossless master at its BASE_MAP_MAX_DIM (the smallest cap of any node
 *  drawing it), decoded once from the handoff source (a JPEG decodes losslessly to PNG). */
async function baseMapMasters(doc) {
  const cap = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const limit = BASE_MAP_MAX_DIM[node.getName()] ?? BASE_MAP_MAX_DIM.default;
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      if (!mat) continue;
      for (const tex of [
        mat.getBaseColorTexture(),
        mat.getEmissiveTexture(),
        mat.getNormalTexture(),
        mat.getMetallicRoughnessTexture(),
        mat.getOcclusionTexture(),
      ]) {
        if (tex) cap.set(tex, Math.min(cap.get(tex) ?? Infinity, limit));
      }
    }
  }
  const masters = new Map();
  for (const [tex, limit] of cap) {
    const img = sharp(Buffer.from(tex.getImage()));
    const meta = await img.metadata();
    const dim = Math.max(meta.width ?? 0, meta.height ?? 0);
    const sized =
      dim > limit
        ? img.resize({ width: limit, height: limit, fit: 'fill', kernel: 'lanczos3' })
        : img;
    masters.set(tex, await sized.png().toBuffer());
  }
  return (tex) => masters.get(tex) ?? null;
}

// -------------------------------------------------------------------------------- armor

/** The new-rig raw pack of one set (export_bundle_v01.py inventory) and its tier source. */
function armorSources(opts, sex, cls) {
  const inv = JSON.parse(
    fs.readFileSync(path.join(opts.export, '_build', `inventory-${sex}.json`), 'utf8'),
  );
  const row = inv.find((r) => r.class === cls);
  if (!row) throw new Error(`inventory-${sex} lacks ${cls}`);
  return {
    raw: row.raw,
    parts: row.parts.map((p) => p.node),
    tier: (tier) => {
      const roots = [...opts.tierOverlays, opts.tiers];
      for (const root of roots) {
        const f = path.join(root, tier, `armor_${sex}_${cls}.manifest.json`);
        if (fs.existsSync(f)) return f;
      }
      throw new Error(`no ${tier} tier for ${sex} ${cls} under ${roots.join(', ')}`);
    },
  };
}

/** The maps a set's materials draw, by slot: the getter, the setter and the texture info
 *  (armor_atlas.mjs gives a set one atlas per map kind, every material over the same ones). */
const MAP_SLOTS = [
  {
    slot: 'baseColor',
    get: (m) => m.getBaseColorTexture(),
    set: (m, t) => m.setBaseColorTexture(t),
    info: (m) => m.getBaseColorTextureInfo(),
  },
  {
    slot: 'normal',
    get: (m) => m.getNormalTexture(),
    set: (m, t) => m.setNormalTexture(t),
    info: (m) => m.getNormalTextureInfo(),
  },
  {
    slot: 'metallicRoughness',
    get: (m) => m.getMetallicRoughnessTexture(),
    set: (m, t) => m.setMetallicRoughnessTexture(t),
    info: (m) => m.getMetallicRoughnessTextureInfo(),
  },
  {
    slot: 'occlusion',
    get: (m) => m.getOcclusionTexture(),
    set: (m, t) => m.setOcclusionTexture(t),
    info: (m) => m.getOcclusionTextureInfo(),
  },
  {
    slot: 'emissive',
    get: (m) => m.getEmissiveTexture(),
    set: (m, t) => m.setEmissiveTexture(t),
    info: (m) => m.getEmissiveTextureInfo(),
  },
];

/**
 * Cut every map of an encoded full-layout set along its top level (ktx2_levels.mjs): the set's
 * own textures keep the levels below it (each a complete texture at half the size), and the
 * returned document is the TOP file: one degenerate mesh wearing one material that holds each
 * top level in the slot its map fills here, under the same image name, so the plain loader
 * reads it and the runtime pairs each level with its map by name. Each map is cut once, however
 * many slots and materials draw it.
 */
function cutTopLevels(doc) {
  const bySlot = new Map();
  for (const material of doc.getRoot().listMaterials()) {
    for (const { slot, get } of MAP_SLOTS) {
      const texture = get(material);
      if (!texture) continue;
      const seen = bySlot.get(slot);
      if (seen && seen !== texture) {
        throw new Error(
          `top levels: two ${slot} maps in one set (${seen.getName()}, ${texture.getName()})`,
        );
      }
      bySlot.set(slot, texture);
    }
  }
  const out = new Document();
  out.createExtension(KHRTextureBasisu).setRequired(true);
  const buffer = out.createBuffer();
  const material = out.createMaterial(TOP_MATERIAL_NAME);
  const tops = new Map();
  for (const { slot, set, info } of MAP_SLOTS) {
    const texture = bySlot.get(slot);
    if (!texture) continue;
    let top = tops.get(texture);
    if (!top) {
      if (texture.getMimeType() !== 'image/ktx2') {
        throw new Error(`top levels: ${texture.getName()} is not KTX2`);
      }
      const cut = splitKtx2TopLevel(texture.getImage());
      texture.setImage(cut.half);
      top = out
        .createTexture(texture.getName())
        .setImage(cut.top)
        .setMimeType('image/ktx2')
        .setURI(texture.getURI());
      tops.set(texture, top);
    }
    set(material, top);
    // one level: no mipmapped filter on it
    info(material)
      .setMinFilter(TextureInfo.MinFilter.LINEAR)
      .setMagFilter(TextureInfo.MagFilter.LINEAR);
  }
  if (bySlot.has('emissive')) material.setEmissiveFactor([1, 1, 1]);
  const position = out.createAccessor('top_levels', buffer).setType('VEC3');
  position.setArray(new Float32Array(9));
  const primitive = out.createPrimitive().setAttribute('POSITION', position).setMaterial(material);
  const mesh = out.createMesh('top_levels').addPrimitive(primitive);
  out.createScene('top_levels').addChild(out.createNode('top_levels').setMesh(mesh));
  return out;
}

/** Every KTX2 image a written GLB embeds, by name. */
function glbImages(file) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len));
  const bin = b.subarray(20 + len + 8);
  return (json.images ?? []).map((image) => {
    const view = json.bufferViews[image.bufferView];
    const at = view.byteOffset ?? 0;
    return { name: image.name ?? '', ktx: readKtx2(bin.subarray(at, at + view.byteLength)) };
  });
}

/** The written pair the runtime lays together: every medium map has a top level of the same
 *  name, one level of the same format at exactly the size the medium map halves from. */
function checkTopLevels(mediumFile, topFile) {
  const tops = new Map(glbImages(topFile).map((image) => [image.name, image.ktx]));
  const maps = glbImages(mediumFile);
  if (maps.length !== tops.size) {
    throw new Error(`${topFile}: ${tops.size} top levels for ${maps.length} maps`);
  }
  for (const { name, ktx } of maps) {
    const top = tops.get(name);
    const fits =
      top &&
      top.levelCount === 1 &&
      top.vkFormat === ktx.vkFormat &&
      top.supercompressionScheme === ktx.supercompressionScheme &&
      ktx.pixelWidth === Math.max(1, top.pixelWidth >> 1) &&
      ktx.pixelHeight === Math.max(1, top.pixelHeight >> 1);
    if (!fits) throw new Error(`${topFile}: no top level fits ${name}`);
  }
}

/**
 * One set at one atlas layout (ARMOR_LAYOUTS): `low` writes the low file; `full` writes the
 * medium file and the top file from one encode. Returns a report row per file written.
 */
async function buildArmor(io, opts, sex, cls, layout, encoder, trs, lodHeight) {
  const tier = ARMOR_LAYOUTS[layout];
  const src = armorSources(opts, sex, cls);
  const tierManifestFile = src.tier(tier);
  const tierManifest = JSON.parse(fs.readFileSync(tierManifestFile, 'utf8'));
  const tierDir = path.dirname(tierManifestFile);
  const tierDoc = await io.read(path.resolve(tierDir, tierManifest.packs.armor.url));
  const doc = await io.read(src.raw);
  retargetOrphanChannels(doc);
  dropOrphanNodes(doc);
  // the tier's material extensions (specular, ...) must exist on the target before the copy
  for (const ext of tierDoc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'EXT_meshopt_compression') continue;
    if (
      !doc
        .getRoot()
        .listExtensionsUsed()
        .some((e) => e.extensionName === ext.extensionName)
    ) {
      doc.createExtension(ext.constructor).setRequired(ext.isRequired());
    }
  }
  // 1. the tier's material on every primitive (the geometry is the raw pack's, identical
  //    primitive for primitive; build_v01.mjs's transplant, every tier)
  const tierNodes = new Map(
    tierDoc
      .getRoot()
      .listNodes()
      .map((n) => [n.getName(), n]),
  );
  const copied = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const donor = tierNodes.get(node.getName())?.getMesh();
    if (!donor) throw new Error(`${sex} ${cls} ${tier}: tier lacks ${node.getName()}`);
    const a = mesh.listPrimitives();
    const b = donor.listPrimitives();
    if (a.length !== b.length) throw new Error(`${node.getName()}: primitive count differs`);
    a.forEach((prim, i) => {
      const s = b[i];
      if (prim.getAttribute('POSITION').getCount() !== s.getAttribute('POSITION').getCount()) {
        throw new Error(`${node.getName()}[${i}]: vertex count differs from the ${tier} tier`);
      }
      if (prim.getMaterial()?.getName() !== s.getMaterial()?.getName()) {
        throw new Error(`${node.getName()}[${i}]: material slot differs from the ${tier} tier`);
      }
      const mat = s.getMaterial();
      if (!copied.has(mat)) copied.set(mat, copyToDocument(doc, tierDoc, [mat]).get(mat));
      prim.setMaterial(copied.get(mat));
    });
  }
  // 2. every map composed from a lossless PNG master (never the artist's KTX2): the sharpest
  //    master of that map across the tiers (the high tier's; the lower tiers' are the same
  //    pixels downscaled, PSNR 50 dB and up), resized ONCE into its atlas cell
  const mt = tierManifest.materialTextures ?? {};
  const bestFile = src.tier('high');
  const best = JSON.parse(fs.readFileSync(bestFile, 'utf8')).materialTextures ?? {};
  const bestDir = path.dirname(bestFile);
  const slotOf = (mat, tex) => {
    if (mat.getBaseColorTexture() === tex) return 'baseColor';
    if (mat.getNormalTexture() === tex) return 'normal';
    if (mat.getMetallicRoughnessTexture() === tex) return 'metallicRoughness';
    if (mat.getOcclusionTexture() === tex) return 'occlusion';
    if (mat.getEmissiveTexture() === tex) return 'emissive';
    return null;
  };
  const pngFor = (tex, mat) => {
    const slot = slotOf(mat, tex);
    const top = best[mat.getName()]?.[slot];
    if (top?.png) return fs.readFileSync(path.resolve(bestDir, top.png));
    const rec = mt[mat.getName()]?.[slot];
    if (!rec?.png) return null;
    return fs.readFileSync(path.resolve(tierDir, rec.png));
  };
  // the transplanted materials reference the tier's KTX2 images: drop them before encoding
  await doc.transform(prune({ propertyTypes: ['Material', 'Texture'], keepLeaves: false }));
  consolidateBuffers(doc);
  const flipped = fixInvertedWinding(doc);
  // 3. one texture set per armor set (armor_atlas.mjs), composed from the PNG masters at the
  //    layout's sizes, and the per-piece materials and maps it replaces dropped before the one
  //    encode
  const atlas = await atlasArmorSet(doc, layout, (tex, mat) => {
    const png = pngFor(tex, mat);
    if (!png) throw new Error(`${sex} ${cls} ${tier}: no PNG master for ${mat.getName()}`);
    return png;
  });
  await doc.transform(prune({ propertyTypes: ['Material', 'Texture'], keepLeaves: false }));
  const encoded = await encodeTextures(doc, layout, encoder);
  // 4. the full layout: every map cut along its top level, the levels below it staying here
  const top = layout === 'full' ? cutTopLevels(doc) : null;
  // 5. the geometry, final here, takes its level-of-detail index lists before the meshopt step
  //    (the top file has no geometry to take any)
  let lod = null;
  if (opts.lod) {
    await doc.transform(prune(), dedup());
    lod = await meshoptWithLods(doc, lodHeight);
  } else {
    await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  }
  const kind = layout === 'full' ? 'medium' : 'low';
  const file = path.join(opts.out, splitFiles.armor(sex, cls, kind));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await io.write(file, doc);
  restoreTransforms(file, trs);
  const row = (fileKind, written, extra) => ({
    sex,
    cls,
    kind: fileKind,
    parts: src.parts,
    file: path.relative(ROOT, written),
    bytes: fs.statSync(written).size,
    sha256: sha256(written),
    ...extra,
  });
  const rows = [
    row(kind, file, {
      textures: encoded,
      atlas,
      windingFlipped: flipped.length,
      ...(lod ? { lod: await writtenLodRow(io, file, lod) } : {}),
    }),
  ];
  if (top) {
    const topFile = path.join(opts.out, splitFiles.armor(sex, cls, 'top'));
    await io.write(topFile, top);
    checkTopLevels(file, topFile);
    rows.push(row('top', topFile, { textures: top.getRoot().listTextures().length }));
  }
  return rows;
}

// -------------------------------------------------------------------------------- verify

/**
 * Bind a written armor file's parts onto a written base by bone NAME, each skinned part keeping
 * its OWN inverse bind matrices. (The runtime, woc_armor_bind.ts, instead rebakes each part into
 * the base's bind space; both put every vertex at the same posed place when the rigs agree.)
 * Each file carries its own vertex quantization baked into its skin's IBMs (gltf-transform's
 * meshopt quantize), so a base and a pack written apart never share IBMs; the rest poses must
 * still agree bone for bone (assertPackRigMatches), which is the contract that matters.
 */
function bindArmorByName(base, table, world, armorDoc, parts) {
  assertPackRigMatches(table, world, armorDoc, 'armor');
  const armorTable = nodeTable(armorDoc);
  const scenesBefore = new Set(base.getRoot().listScenes());
  const nodesBefore = new Set(base.getRoot().listNodes());
  const resolved = mergeDocuments(base, armorDoc);
  const keep = new Set();
  const skins = new Map();
  for (const name of parts) {
    const src = armorTable.byName.get(name);
    if (!src) throw new Error(`armor: missing part ${name}`);
    const part = resolved.get(src);
    const parentName = armorTable.parent.get(src)?.getName();
    const bone = table.byName.get(parentName);
    if (!bone) throw new Error(`armor: ${name} sits under ${parentName}, not a base bone`);
    const skin = part.getSkin();
    if (skin) {
      let rebound = skins.get(skin);
      if (!rebound) {
        rebound = base.createSkin(`${skin.getName()}_rebound`);
        for (const j of skin.listJoints()) {
          const twin = table.byName.get(j.getName());
          if (!twin) throw new Error(`armor: joint ${j.getName()} has no base bone`);
          rebound.addJoint(twin);
        }
        rebound.setInverseBindMatrices(skin.getInverseBindMatrices());
        skins.set(skin, rebound);
      }
      part.setSkin(rebound);
    }
    part.traverse((n) => keep.add(n));
    bone.addChild(part);
  }
  for (const scene of base.getRoot().listScenes()) if (!scenesBefore.has(scene)) scene.dispose();
  for (const node of base.getRoot().listNodes()) {
    if (!nodesBefore.has(node) && !keep.has(node)) node.dispose();
  }
}

/** base + armor + the library's clips composed back into one document, the way the runtime
 *  binds them (by bone name), for the vertex comparison against the assembled reference. */
async function composeForVerify(io, opts, sex, cls, bodyManifest) {
  const base = await io.read(path.join(opts.out, splitFiles.base(sex)));
  // the base carries the weapon-scale compensation on its handslot bones; the pack's rest check
  // compares world matrices, and nothing verified here hangs off a handslot
  for (const n of base.getRoot().listNodes()) {
    if (/^handslot\./.test(n.getName())) n.setScale([1, 1, 1]);
  }
  const table = nodeTable(base);
  table.doc = base;
  const world = worldMatrices(table);
  const armorDoc = await io.read(path.join(opts.out, splitFiles.armor(sex, cls, 'medium')));
  for (const n of armorDoc.getRoot().listNodes()) {
    if (/^handslot\./.test(n.getName())) n.setScale([1, 1, 1]);
  }
  const parts = armorSources(opts, sex, cls).parts;
  bindArmorByName(base, table, world, armorDoc, parts);
  // clips: merge the library, then point every channel at the base's same-named node
  const anims = await io.read(path.join(opts.out, splitFiles.anims(sex)));
  const before = new Set(base.getRoot().listNodes());
  mergeDocuments(base, anims);
  const byName = new Map();
  for (const n of before) byName.set(n.getName(), n);
  for (const a of base.getRoot().listAnimations()) {
    for (const ch of a.listChannels()) {
      const t = ch.getTargetNode();
      if (t && !before.has(t)) {
        const twin = byName.get(t.getName());
        if (!twin) throw new Error(`verify: clip ${a.getName()} targets unknown ${t.getName()}`);
        ch.setTargetNode(twin);
      }
    }
  }
  for (const n of base.getRoot().listNodes()) if (!before.has(n)) n.dispose();
  for (const s of base.getRoot().listScenes().slice(1)) s.dispose();
  // the body and the armor. The reference still carries the handoff's original face; the
  // split base ships none of it (stripOriginalFace), so there is nothing of it to compare.
  const refDoc = await io.read(path.join(opts.referenceDir, assembledName(sex, cls)));
  const shippedFace = bodyManifest.packs.appearance.nodes.filter((name) =>
    base
      .getRoot()
      .listNodes()
      .some((n) => n.getName() === name),
  );
  if (shippedFace.length > 0) {
    throw new Error(`verify: the base still carries the original face: ${shippedFace.join(', ')}`);
  }
  const partNames = [...bodyManifest.baseNodes, ...parts];
  return { doc: base, partNames, refDoc };
}

// -------------------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const root of [...opts.tierOverlays, opts.tiers]) {
    if (!fs.existsSync(root)) throw new Error(`texture tier root is missing: ${root}`);
  }
  if (opts.pinOnly) {
    const report = JSON.parse(fs.readFileSync(opts.report, 'utf8'));
    assertPinnable(report);
    writeAcceptedPin(opts, report);
    return;
  }
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, WocLodExtension])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const encoder = createKtxEncoder({ repoRoot: ROOT, cacheDir: opts.cache });
  const knight = await io.read(opts.knight);
  const knightHeight = idlePosedSkinnedHeight(knight);
  const report = { lod: lodSettings(opts), bodies: [], armor: [], verify: [], failures: [] };
  const wanted = (sex, cls) => !opts.only || opts.only.has(`${sex}-${cls}`) || opts.only.has(sex);
  for (const sex of SEXES) {
    if (![...CLASSES].some((c) => wanted(sex, c))) continue;
    const body = await buildBody(io, opts, sex, encoder, knightHeight);
    const { trs, manifest, ...rest } = body;
    report.bodies.push(rest);
    console.log('BODY', sex, rest.base.bytes, rest.anims.bytes, 'slot', rest.handslotScale);
    logLod('BASE', sex, rest.base.lod, report);
    if (opts.bodiesOnly) continue;
    for (const cls of CLASSES) {
      if (!wanted(sex, cls)) continue;
      for (const layout of Object.keys(ARMOR_LAYOUTS)) {
        const built = await buildArmor(io, opts, sex, cls, layout, encoder, trs, rest.lodHeight);
        for (const r of built) {
          report.armor.push(r);
          console.log('ARMOR', sex, cls, r.kind, r.bytes, 'textures', r.textures);
          logLod('ARMOR', `${sex} ${cls} ${r.kind}`, r.lod, report);
        }
      }
      if (!opts.verify) continue;
      const ref = path.join(opts.referenceDir, assembledName(sex, cls));
      if (!fs.existsSync(ref)) {
        report.failures.push(`${sex} ${cls}: no assembled reference ${ref}`);
        continue;
      }
      const { doc, partNames, refDoc } = await composeForVerify(io, opts, sex, cls, manifest);
      const check = verifyAgainstReference(doc, refDoc, partNames);
      const row = {
        sex,
        cls,
        restWorldError: check.restWorst,
        posedWorldError: check.worst,
        posedWorstAt: check.worstAt,
        verticesCompared: check.compared,
      };
      report.verify.push(row);
      console.log(
        'VERIFY',
        sex,
        cls,
        check.restWorst.toExponential(2),
        check.worst.toExponential(2),
        check.worstAt,
      );
      // the same budgets as build_woc_warrior.mjs: quantization only, never a drift
      if (check.restWorst > 5e-4 || check.worst > 1.2e-2) {
        report.failures.push(`${sex} ${cls}: split parts drift from the assembled reference`);
      }
    }
  }
  report.ktx = encoder.stats;
  fs.mkdirSync(path.dirname(opts.report), { recursive: true });
  fs.writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length) {
    console.error('SPLIT_FAIL', report.failures);
    process.exitCode = 1;
    return;
  }
  console.log('SPLIT_PASS', report.armor.length, 'armor files');
  // The accepted delivery pin: only a whole, verified build may write it.
  if (!opts.only && !opts.bodiesOnly && opts.verify && path.resolve(opts.out) === DEFAULT_OUT) {
    writeAcceptedPin(opts, report);
  }
}

/** One file's level-of-detail line (triangles at level 0, mid and far, the worst measured
 *  deviations as a share of the height), its check failures moved into the build's. */
function logLod(label, what, lod, report) {
  if (!lod) return;
  const pct = (x) => `${(100 * x).toFixed(3)}%`;
  console.log(
    'LOD',
    label,
    what,
    `tris ${lod.triangles} mid ${lod.mid} far ${lod.far}`,
    `dev mid ${pct(lod.worstMidShare)} far ${pct(lod.worstFarShare)}`,
    `check ${lod.check.levels} levels, worst excess ${lod.check.worstExcess.toExponential(2)}`,
  );
  report.failures.push(...lod.check.failures);
}

/** The level-of-detail settings a delivery was built with (the pin's `lod`), or null. */
function lodSettings(opts) {
  if (!opts.lod) return null;
  return {
    extension: 'WOC_lod',
    levels: LOD_LEVELS.map(({ name, limit, floor, lockBorder }) => ({
      name,
      maxDeviationShareOfHeight: limit,
      floor,
      lockBorder,
    })),
    minSaving: LOD_MIN_SAVING,
  };
}

/** `--pin-only` pins what a FULL verified build wrote, and nothing else: the report must cover
 *  every fit, set and armor file, carry a verify row per fit and set, and every file on disk must
 *  still be the bytes that build recorded (a partial, --no-verify or --only run never reaches a
 *  pin). */
function assertPinnable(report) {
  if (report.failures?.length) throw new Error('the last build failed: no pin');
  const want = SEXES.length * CLASSES.length;
  if ((report.bodies?.length ?? 0) !== SEXES.length)
    throw new Error('the report is not a full build');
  if ((report.armor?.length ?? 0) !== want * ARMOR_FILES.length)
    throw new Error('the report is not a full build');
  if ((report.verify?.length ?? 0) !== want) throw new Error('the report was not verified in full');
  const recorded = [
    ...report.bodies.flatMap((b) => [b.base, b.anims]),
    ...report.armor.map((a) => ({ file: a.file, sha256: a.sha256 })),
  ];
  for (const f of recorded) {
    if (sha256(path.join(ROOT, f.file)) !== f.sha256) {
      throw new Error(`${f.file} changed since the verified build: rebuild before pinning`);
    }
  }
}

/** Every file the split delivery ships (the bodies, the armor, the under-armor atlases the
 *  manifests name), with its sha256: tests/woc_export.test.ts pins the served bytes to it. */
function writeAcceptedPin(opts, report) {
  const pub = path.join(ROOT, 'public');
  const files = {};
  const add = (rel) => {
    files[rel] = sha256(path.join(pub, rel));
  };
  const rel = (abs) => path.relative(pub, abs).split(path.sep).join('/');
  for (const sex of SEXES) {
    add(rel(path.join(opts.out, splitFiles.base(sex))));
    add(rel(path.join(opts.out, splitFiles.anims(sex))));
    for (const cls of CLASSES) {
      for (const kind of ARMOR_FILES)
        add(rel(path.join(opts.out, splitFiles.armor(sex, cls, kind))));
    }
  }
  const skins = path.join(pub, 'textures', 'skins', 'woc');
  for (const f of fs
    .readdirSync(skins)
    .filter((f) => /_underarmor\.(png|ktx2)$/.test(f))
    .sort()) {
    add(`textures/skins/woc/${f}`);
  }
  const blend = path.join(STUDIO, 'claude-animation-20260924', 'WOC_Characters_Anim_v01.blend');
  const pin = {
    source: path.basename(opts.export),
    armInterface: 'WOC_Anim_v01_20260924',
    rig: '34 joints: the handoff bone names plus neck, clavicle.l/r, skirt.front/back.l/r',
    clips: report.bodies[0]?.anims.clips ?? 0,
    // the crown of the original face each base was measured with, then stripped of: the top
    // the runtime normalizes a body by (WOC_ANATOMY_TOP), in the base file's units
    anatomyTop: Object.fromEntries(report.bodies.map((b) => [b.sex, b.anatomyTop])),
    armorFiles: ARMOR_FILES,
    build:
      'export_bundle_v01.py (Blender) -> build_woc_split.mjs (base + animation library per fit; ' +
      'per set and fit a low file, a medium file and the top mip level of each of its maps; ' +
      'KTX2 from the PNG masters; verified against the assembled references)',
    // the WOC_lod settings every base and low and medium armor file carries (absent: none)
    ...(report.lod ? { lod: report.lod } : {}),
    sourceMaster: path.basename(blend),
    sourceMasterSha256: fs.existsSync(blend) ? sha256(blend) : null,
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  fs.writeFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'export_split.json'),
    `${JSON.stringify(pin, null, 2)}\n`,
  );
  console.log('PIN', Object.keys(files).length, 'files');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
