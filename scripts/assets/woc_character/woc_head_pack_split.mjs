// Split a compressed WOC head pack (the woc_head_pack_compress.mjs output) into the streamed
// file set src/render/characters/woc_head_catalog.ts defines (wocHeadCoreUrl, wocHeadPieceUrl,
// wocHeadAllUrls), so a character downloads only the pieces its look wears:
//   head_type_<t>_core.glb        the base head plus every eye, brow, nose, mouth, ear and
//                                 piercing piece (small, texture-sharing, swapped in the builder)
//   head_type_<t>_hair_<id>.glb   one hairstyle: its strands and, where authored, its scalp cap
//   head_type_<t>_beard_<id>.glb  a facial-hair style with a texture of its own (the handlebar)
//   head_type_<t>_beards.glb      every other facial-hair style (they share one atlas)
//
// Each file is the pack minus every other piece. The rig's bone hierarchy stays whole, so
// `head` sits under its ancestors exactly as before, and every kept piece is untouched: its node
// TRS (which carries the pack's meshopt dequantization: never reset), its mesh and morph target
// names (extras.targetNames), its materials, and the KTX2 textures byte for byte. Geometry is
// decoded and re-encoded with meshopt, never re-quantized: the pack stores its normals as
// octahedral codes (the compress step's meshopt FILTER method), and re-filtering the DECODED
// normals would be a second lossy pass (it moves a few hundred components per pack), so the
// stored codes are read back out of the compressed bytes (octahedralNormalCodes) and re-encoded
// exactly. Every other stream carries no filter and round-trips as is. A pack whose normals are
// stored any other way is written with no filters at all (QUANTIZE, lossless, a little larger).
//
// The file rule is reproduced here from the piece node names (WocHead_<T>_<slot>_<id>[_L|_R]);
// the `urls` this prints must equal wocHeadAllUrls(<t>), and tests/woc_head_split_files.test.ts
// pins the files on disk against the catalog. Every file is verified in memory before anything
// is written (verifyFile), and the union of their pieces must be the pack's pieces exactly.
//
// Level of detail (2026-10-03): a piece's WOC_lod levels (woc_lod_extension.mjs, made by the
// compress step) ride with it. Nothing here renumbers a vertex, so every level's indices are
// copied as they decode, and a dropped piece's levels are disposed with its primitive, their
// accessors pruned with it. verifyFile holds each kept piece's levels to the pack's (the same
// indices, the same recorded deviation, meshopt-compressed) and every file to carrying only
// accessors something in it uses.
//
//   node scripts/assets/woc_character/woc_head_pack_split.mjs <pack.glb> \
//     [--out-dir <dir>] [--list]
//
// --out-dir defaults to public/models/chars/players/woc (the catalog's split directory).
// --list prints the plan (file -> pieces, textures) and writes nothing. The pack itself is a
// build intermediate: keep it out of public/ (the split files replace it there).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ExtensionProperty, Logger, NodeIO, PropertyType, Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { cloneDocument, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { WOC_LOD, WocLodExtension } from './woc_lod_extension.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The catalog's split directory (woc_head_catalog.ts PACK_DIR), relative to public/. */
const SPLIT_DIR = 'models/chars/players/woc';
/** The rig bone every piece hangs from. */
const HEAD_BONE = 'head';
/** Beard ids shipped in a file of their own (a texture of their own): the catalog's
 *  BEARDS_WITH_OWN_FILE. Every other beard rides the shared beards file. */
const BEARDS_WITH_OWN_FILE = new Set(['handlebar']);
/** Slots that ride the core file with the base head. */
const CORE_SLOTS = new Set(['eyes', 'brows', 'nose', 'mouth', 'ears', 'piercing']);
const MESHOPT = 'EXT_meshopt_compression';
const QUANTIZATION = 'KHR_mesh_quantization';

function parseArgs(argv) {
  const opts = { input: null, outDir: path.join(ROOT, 'public', SPLIT_DIR), list: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out-dir') opts.outDir = path.resolve(argv[++i]);
    else if (argv[i] === '--list') opts.list = true;
    else rest.push(argv[i]);
  }
  [opts.input] = rest;
  if (!opts.input || rest.length > 1) {
    throw new Error('usage: woc_head_pack_split.mjs <pack.glb> [--out-dir <dir>] [--list]');
  }
  return opts;
}

// --- the file rule (woc_head_catalog.ts, read off the node names) ----------------------------

/** The type and the file one piece ships in. */
function fileOfPiece(name) {
  const m = /^WocHead_([A-Z])_([a-z]+)(?:_(\w+))?$/.exec(name);
  if (!m) throw new Error(`${name}: not a head piece name (WocHead_<T>_<slot>_<id>[_L|_R])`);
  const [, letter, slot, id] = m;
  const type = letter.toLowerCase();
  const stem = `head_type_${type}`;
  if (slot === 'base' && id === undefined) return { type, file: `${stem}_core.glb` };
  if (id === undefined) throw new Error(`${name}: a ${slot} piece without a variant id`);
  if (slot === 'hair' || slot === 'beard') {
    // the catalog draws hair and facial hair as one centred node per variant
    if (/_[LR]$/.test(id)) throw new Error(`${name}: ${slot} pieces are centred, never paired`);
    if (slot === 'hair') return { type, file: `${stem}_hair_${id}.glb` };
    return {
      type,
      file: BEARDS_WITH_OWN_FILE.has(id) ? `${stem}_beard_${id}.glb` : `${stem}_beards.glb`,
    };
  }
  if (CORE_SLOTS.has(slot)) return { type, file: `${stem}_core.glb` };
  throw new Error(`${name}: unknown head slot "${slot}"`);
}

/** Core first, then the hairstyles, then facial hair; alphabetical within each. */
function fileOrder(file) {
  if (file.endsWith('_core.glb')) return `0 ${file}`;
  if (file.includes('_hair_')) return `1 ${file}`;
  return `2 ${file}`;
}

// --- the source pack -------------------------------------------------------------------------

/** Every texture a material samples (core slots and extension slots). */
function texturesOf(material) {
  const graph = material.getGraph();
  const out = new Set();
  const visit = (prop) => {
    for (const child of graph.listChildren(prop)) {
      if (child instanceof Texture) out.add(child);
      else if (child instanceof ExtensionProperty) visit(child);
    }
  };
  visit(material);
  return out;
}

function pieceTextures(node) {
  const out = new Set();
  for (const prim of node.getMesh().listPrimitives()) {
    const mat = prim.getMaterial();
    if (mat) for (const tex of texturesOf(mat)) out.add(tex);
  }
  return out;
}

/** Validates the pack against the export contract and plans the files. */
function planPack(doc) {
  const root = doc.getRoot();
  const heads = root.listNodes().filter((n) => n.getName() === HEAD_BONE);
  if (heads.length !== 1)
    throw new Error(`expected one "${HEAD_BONE}" node, found ${heads.length}`);
  const [head] = heads;
  if (root.listSkins().length || root.listAnimations().length) {
    throw new Error('the pack carries skins or animations (split the COMPRESSED pack)');
  }
  const pieces = root.listNodes().filter((n) => n.getMesh());
  const names = new Set();
  const types = new Set();
  const plan = new Map();
  for (const node of pieces) {
    const name = node.getName();
    if (names.has(name)) throw new Error(`${name}: two pieces share the name`);
    names.add(name);
    if (node.getParentNode() !== head) throw new Error(`${name} is not a child of "${HEAD_BONE}"`);
    if (node.getSkin()) throw new Error(`${name} is skinned (the contract is rigid pieces)`);
    if (node.listChildren().length) throw new Error(`${name} has child nodes`);
    if (node.getMesh().getName() !== name) {
      throw new Error(`${name}: its mesh is named "${node.getMesh().getName()}"`);
    }
    const { type, file } = fileOfPiece(name);
    types.add(type);
    if (!plan.has(file)) plan.set(file, []);
    plan.get(file).push(name);
  }
  for (const child of head.listChildren()) {
    if (!child.getMesh())
      throw new Error(`"${HEAD_BONE}" carries a non-piece child ${child.getName()}`);
  }
  if (types.size !== 1) throw new Error(`pieces of ${types.size} head types in one pack`);
  const ordered = new Map(
    [...plan].sort(([a], [b]) => (fileOrder(a) < fileOrder(b) ? -1 : 1)).map(([f, p]) => [f, p]),
  );
  return { type: [...types][0], pieces, plan: ordered };
}

/** The beard atlas check: the grouped beards share ONE texture and every own-file beard has a
 *  texture no other beard samples (the reason it ships alone). Returns the finding. */
function beardAtlas(pieces) {
  const byId = new Map();
  for (const node of pieces) {
    const m = /^WocHead_[A-Z]_beard_(\w+)$/.exec(node.getName());
    if (m) byId.set(m[1], pieceTextures(node));
  }
  const grouped = [...byId].filter(([id]) => !BEARDS_WITH_OWN_FILE.has(id));
  const own = [...byId].filter(([id]) => BEARDS_WITH_OWN_FILE.has(id));
  const problems = [];
  const shared = grouped[0]?.[1] ?? new Set();
  if (grouped.length && shared.size !== 1) {
    problems.push(`${grouped[0][0]} samples ${shared.size} textures, not one shared atlas`);
  }
  for (const [id, tex] of grouped) {
    if (tex.size !== shared.size || [...tex].some((t) => !shared.has(t))) {
      problems.push(`${id} does not sample the shared beard atlas`);
    }
  }
  for (const [id, tex] of own) {
    if (tex.size === 0) problems.push(`${id} samples no texture of its own`);
    for (const [other, otherTex] of byId) {
      if (other !== id && [...tex].some((t) => otherTex.has(t))) {
        problems.push(`${id} shares a texture with ${other}`);
      }
    }
  }
  const names = (set) => [...set].map((t) => t.getName());
  return {
    sharedAtlas: names(shared),
    sharedBy: grouped.map(([id]) => id),
    own: Object.fromEntries(own.map(([id, tex]) => [id, names(tex)])),
    problems,
  };
}

// --- lossless normals ------------------------------------------------------------------------

/** The octahedral codes the pack stores for every NORMAL, read out of the COMPRESSED bytes (the
 *  buffer view decoded without its filter), by JSON accessor index. Null when any normal (or a
 *  tangent, which the FILTER method would also re-filter) is stored some other way. */
function octahedralNormalCodes(glb) {
  const { json, bin } = glb;
  const normals = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if (prim.attributes.TANGENT !== undefined) return null;
      if (prim.attributes.NORMAL !== undefined) normals.add(prim.attributes.NORMAL);
    }
  }
  const views = new Map();
  const codes = new Map();
  for (const index of normals) {
    const acc = json.accessors[index];
    const view = json.bufferViews[acc.bufferView];
    const ext = view?.extensions?.[MESHOPT];
    const octahedral8 =
      ext?.mode === 'ATTRIBUTES' &&
      ext.filter === 'OCTAHEDRAL' &&
      ext.byteStride === 4 &&
      ext.buffer === 0 &&
      acc.componentType === 5120 &&
      acc.normalized === true &&
      acc.type === 'VEC3' &&
      !acc.sparse;
    if (!octahedral8) return null;
    let raw = views.get(acc.bufferView);
    if (!raw) {
      raw = new Uint8Array(ext.count * 4);
      const at = ext.byteOffset ?? 0;
      MeshoptDecoder.decodeGltfBuffer(
        raw,
        ext.count,
        4,
        bin.subarray(at, at + ext.byteLength),
        'ATTRIBUTES',
      );
      views.set(acc.bufferView, raw);
    }
    const first = (acc.byteOffset ?? 0) / 4;
    const out = new Int8Array(raw.buffer, raw.byteOffset + first * 4, acc.count * 4).slice();
    // the decoder takes the third code as the unit length: the encoder always writes 127
    for (let i = 0; i < acc.count; i++) if (out[i * 4 + 2] !== 127) return null;
    codes.set(index, out);
  }
  return codes;
}

/** Float normals meshopt's octahedral encoder maps back onto exactly these 8-bit codes: the
 *  unit-L1 point of each code (upper half), or its fold (lower half). On the fold edge a
 *  component is zero and the encoder reads its sign, so it carries a signed tiny value instead
 *  (both codes there decode to the same normal; this keeps the pack's own). */
function normalsForCodes(codes) {
  const count = codes.length / 4;
  const out = new Float32Array(count * 3);
  const folded = (sign, magnitude) => sign * (magnitude === 0 ? 1e-30 : magnitude);
  for (let i = 0; i < count; i++) {
    const u = codes[i * 4] / 127;
    const v = codes[i * 4 + 1] / 127;
    const z = 1 - Math.abs(u) - Math.abs(v);
    out[i * 3] = z >= 0 ? u : folded(Math.sign(u), 1 - Math.abs(v));
    out[i * 3 + 1] = z >= 0 ? v : folded(Math.sign(v), 1 - Math.abs(u));
    out[i * 3 + 2] = z;
  }
  return out;
}

// --- one output file -------------------------------------------------------------------------

async function buildFile(io, src, keep, method) {
  const doc = cloneDocument(src);
  const keepSet = new Set(keep);
  for (const node of doc.getRoot().listNodes()) {
    if (node.getMesh() && !keepSet.has(node.getName())) node.dispose();
  }
  // only what the dropped pieces leave unreferenced: no node, attribute, index or texture rewrites
  await doc.transform(
    prune({
      propertyTypes: [
        PropertyType.MESH,
        PropertyType.PRIMITIVE,
        PropertyType.PRIMITIVE_TARGET,
        PropertyType.MATERIAL,
        PropertyType.TEXTURE,
        PropertyType.ACCESSOR,
        PropertyType.BUFFER,
      ],
      keepLeaves: true,
      keepAttributes: true,
      keepIndices: true,
      keepSolidTextures: true,
    }),
  );
  const ext = doc
    .getRoot()
    .listExtensionsUsed()
    .find((e) => e.extensionName === MESHOPT);
  if (!ext) throw new Error(`the pack does not use ${MESHOPT} (split the COMPRESSED pack)`);
  ext.setEncoderOptions({ method });
  return io.writeBinary(doc);
}

// --- verification ----------------------------------------------------------------------------

function parseGlb(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2)
    throw new Error('not a GLB 2');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  let bin = Buffer.alloc(0);
  if (binAt < buf.length) {
    if (buf.readUInt32LE(binAt + 4) !== 0x004e4942) throw new Error('second GLB chunk is not BIN');
    bin = buf.subarray(binAt + 8, binAt + 8 + buf.readUInt32LE(binAt));
  }
  return { json, bin };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Node index -> its name path from the scene root ('WOC_Rig_Male/root/.../head'). */
function nodePaths(json) {
  const parent = new Map();
  json.nodes.forEach((n, i) => {
    for (const c of n.children ?? []) parent.set(c, i);
  });
  const paths = new Map();
  json.nodes.forEach((_n, i) => {
    const names = [];
    for (let at = i; at !== undefined; at = parent.get(at)) names.unshift(json.nodes[at].name);
    paths.set(i, names.join('/'));
  });
  return paths;
}

/** A node minus its graph links (name, TRS, extras: everything else it carries). */
function nodeOwn(node) {
  const { children: _c, mesh: _m, ...own } = node;
  return own;
}

function imageBytes({ json, bin }, image) {
  const bv = json.bufferViews[image.bufferView];
  if (image.uri !== undefined || bv.buffer !== 0)
    throw new Error(`image ${image.name} is external`);
  const at = bv.byteOffset ?? 0;
  return bin.subarray(at, at + bv.byteLength);
}

/** Every image a texture references: its own `source` and each extension's (KHR_texture_basisu,
 *  EXT_texture_webp, a fallback pair), in a stable order. */
function textureSources(tex) {
  const out = typeof tex.source === 'number' ? [tex.source] : [];
  for (const key of Object.keys(tex.extensions ?? {}).sort()) {
    const source = tex.extensions[key]?.source;
    if (typeof source === 'number') out.push(source);
  }
  return out;
}

/** An image by content (name, type and bytes), so two files compare whatever their layout. */
const imageKey = (glb, image) =>
  `${image.name}|${image.mimeType}|${sha256(imageBytes(glb, image))}`;

/** A material with every texture reference resolved to its images and the sampler it draws
 *  with, so two files compare regardless of their index layout. */
function canonMaterial(glb, index) {
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v === null || typeof v !== 'object') return v;
    if (key?.endsWith('Texture') && typeof v.index === 'number') {
      const { index: texIndex, ...info } = v;
      const tex = glb.json.textures[texIndex];
      return {
        ...walk(info),
        texture: {
          name: tex.name,
          sampler: tex.sampler === undefined ? null : glb.json.samplers[tex.sampler],
          extensions: Object.keys(tex.extensions ?? {}).sort(),
          images: textureSources(tex).map((i) => imageKey(glb, glb.json.images[i])),
        },
      };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
  };
  return walk(glb.json.materials[index]);
}

/** Texture indices one material samples (any `*Texture` slot, extensions included). */
function materialTextures(material) {
  const out = new Set();
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      if (key?.endsWith('Texture') && typeof v.index === 'number') out.add(v.index);
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  walk(material);
  return out;
}

/** Texture indices a file's materials sample. */
function sampledTextures(json) {
  return new Set((json.materials ?? []).flatMap((m) => [...materialTextures(m)]));
}

/** Accessor indices a file's JSON uses: primitive attributes, indices, morph targets and
 *  WOC_lod levels, skins' inverse bind matrices, animation samplers. */
function referencedAccessors(json) {
  const out = new Set();
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      if (prim.indices !== undefined) out.add(prim.indices);
      for (const a of Object.values(prim.attributes ?? {})) out.add(a);
      for (const t of prim.targets ?? []) for (const a of Object.values(t)) out.add(a);
      for (const level of prim.extensions?.[WOC_LOD]?.levels ?? []) out.add(level.indices);
    }
  }
  for (const skin of json.skins ?? []) {
    if (skin.inverseBindMatrices !== undefined) out.add(skin.inverseBindMatrices);
  }
  for (const anim of json.animations ?? []) {
    for (const s of anim.samplers ?? []) out.add(s.input).add(s.output);
  }
  return out;
}

function accessorMeta(json, index) {
  const { componentType, normalized, type, count, min, max, sparse } = json.accessors[index];
  return { componentType, normalized: !!normalized, type, count, min, max, sparse };
}

function sameArray(a, b) {
  if (a === null || b === null) return a === b;
  if (a.constructor !== b.constructor || a.length !== b.length) return false;
  const ba = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
  return ba.equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

function sameAccessor(a, b) {
  if (!a || !b) return a === b;
  return (
    a.getType() === b.getType() &&
    a.getComponentType() === b.getComponentType() &&
    a.getNormalized() === b.getNormalized() &&
    a.getCount() === b.getCount() &&
    sameArray(a.getArray(), b.getArray())
  );
}

/** Two triangle lists of the same type that draw the same triangles in the same order, each
 *  with the same winding. A level's list is held to this, not to its bytes: the meshopt triangle
 *  codec may start a triangle at another corner when it encodes it after other accessors than
 *  the pack did (its edge and vertex memory runs on across the accessors of a buffer view),
 *  which changes nothing drawn (measured on the first LOD build: one triangle of 156 in one
 *  brow piece). */
function sameTriangleList(a, b) {
  if (!a || !b) return a === b;
  if (
    a.getType() !== b.getType() ||
    a.getComponentType() !== b.getComponentType() ||
    a.getCount() !== b.getCount() ||
    a.getCount() % 3 !== 0
  ) {
    return false;
  }
  const x = a.getArray();
  const y = b.getArray();
  for (let i = 0; i < x.length; i += 3) {
    const [p, q, r] = [x[i], x[i + 1], x[i + 2]];
    const [u, v, w] = [y[i], y[i + 1], y[i + 2]];
    const rotated =
      (p === u && q === v && r === w) ||
      (p === v && q === w && r === u) ||
      (p === w && q === u && r === v);
    if (!rotated) return false;
  }
  return true;
}

/** Checks one written file against the pack; throws naming every problem, else returns what
 *  the file carries. */
async function verifyFile(io, file, bytes, keep, srcGlb, srcDoc) {
  const problems = [];
  const fail = (msg) => problems.push(`${file}: ${msg}`);
  const out = parseGlb(bytes);
  const { json } = out;
  const srcPaths = nodePaths(srcGlb.json);
  const outPaths = nodePaths(json);
  const keepSet = new Set(keep);

  // the rig: every bone of the pack at the same path with the same own properties, no more
  const bonesOf = (glb, paths) =>
    new Map(
      glb.json.nodes
        .map((n, i) => [n, i])
        .filter(([n]) => n.mesh === undefined)
        .map(([n, i]) => [paths.get(i), nodeOwn(n)]),
    );
  const srcBones = bonesOf(srcGlb, srcPaths);
  const outBones = bonesOf(out, outPaths);
  for (const [p, own] of srcBones) {
    if (!outBones.has(p)) fail(`bone ${p} missing`);
    else if (!deepEqual(outBones.get(p), own)) fail(`bone ${p} changed (TRS or extras)`);
  }
  for (const p of outBones.keys()) if (!srcBones.has(p)) fail(`unexpected node ${p}`);
  const sceneRoots = (j) => (j.scenes?.[j.scene ?? 0]?.nodes ?? []).map((i) => j.nodes[i].name);
  if (json.scenes?.length !== 1 || !deepEqual(sceneRoots(json), sceneRoots(srcGlb.json))) {
    fail('scene roots differ from the pack');
  }

  // the pieces: exactly the group, each a child of `head`, each unchanged
  const heads = json.nodes.map((n, i) => [n, i]).filter(([n]) => n.name === HEAD_BONE);
  if (heads.length !== 1) throw new Error(`${file}: ${heads.length} "${HEAD_BONE}" nodes`);
  const headIndex = heads[0][1];
  const srcHead = srcGlb.json.nodes.findIndex((n) => n.name === HEAD_BONE);
  if (outPaths.get(headIndex) !== srcPaths.get(srcHead)) fail(`"${HEAD_BONE}" moved in the rig`);
  const children = json.nodes[headIndex].children ?? [];
  const pieceNames = children.map((i) => json.nodes[i].name);
  if (json.nodes.filter((n) => n.mesh !== undefined).length !== children.length) {
    fail(`a mesh node outside "${HEAD_BONE}"`);
  }
  if (new Set(pieceNames).size !== pieceNames.length) fail('a piece twice');
  const extra = pieceNames.filter((n) => !keepSet.has(n));
  const missing = keep.filter((n) => !pieceNames.includes(n));
  if (extra.length) fail(`pieces not in the group: ${extra.join(', ')}`);
  if (missing.length) fail(`pieces missing: ${missing.join(', ')}`);
  const srcByName = new Map(srcGlb.json.nodes.map((n) => [n.name, n]));
  const usedMaterials = new Set();
  for (const i of children) {
    const node = json.nodes[i];
    const src = srcByName.get(node.name);
    if (!src || node.mesh === undefined) {
      fail(`${node.name} is not a pack piece`);
      continue;
    }
    if (!deepEqual(nodeOwn(node), nodeOwn(src))) fail(`${node.name}: node TRS or extras changed`);
    const mesh = json.meshes[node.mesh];
    const srcMesh = srcGlb.json.meshes[src.mesh];
    if (mesh.name !== node.name) fail(`${node.name}: mesh named "${mesh.name}"`);
    if (!deepEqual(mesh.extras, srcMesh.extras)) fail(`${node.name}: mesh extras (target names)`);
    if (!deepEqual(mesh.weights, srcMesh.weights)) fail(`${node.name}: default morph weights`);
    const targetNames = mesh.extras?.targetNames ?? [];
    if (mesh.primitives.length !== srcMesh.primitives.length) {
      fail(`${node.name}: primitive count`);
      continue;
    }
    mesh.primitives.forEach((prim, p) => {
      const sp = srcMesh.primitives[p];
      const where = `${node.name} primitive ${p}`;
      if ((prim.mode ?? 4) !== (sp.mode ?? 4)) fail(`${where}: mode`);
      const targets = prim.targets ?? [];
      if (targets.length !== (sp.targets ?? []).length) fail(`${where}: morph target count`);
      if (targets.length && targets.length !== targetNames.length) {
        fail(`${where}: ${targets.length} targets, ${targetNames.length} target names`);
      }
      if (!deepEqual(Object.keys(prim.attributes).sort(), Object.keys(sp.attributes).sort())) {
        fail(`${where}: attribute set`);
      }
      const pairs = [[prim.indices, sp.indices, 'indices']];
      for (const k of Object.keys(sp.attributes))
        pairs.push([prim.attributes[k], sp.attributes[k], k]);
      (sp.targets ?? []).forEach((t, ti) => {
        for (const k of Object.keys(t)) pairs.push([targets[ti]?.[k], t[k], `target ${ti} ${k}`]);
      });
      // the piece's level-of-detail index lists ride with it, each as the pack records it
      const lod = prim.extensions?.[WOC_LOD]?.levels ?? [];
      const srcLod = sp.extensions?.[WOC_LOD]?.levels ?? [];
      if (lod.length !== srcLod.length) fail(`${where}: ${lod.length} ${WOC_LOD} levels`);
      srcLod.forEach((level, l) => {
        if (lod[l]?.maxDeviation !== level.maxDeviation) {
          fail(`${where}: ${WOC_LOD} level ${l} maxDeviation`);
        }
        pairs.push([lod[l]?.indices, level.indices, `${WOC_LOD} level ${l}`]);
      });
      for (const [a, b, what] of pairs) {
        if ((a === undefined) !== (b === undefined)) fail(`${where}: ${what} presence`);
        else if (a !== undefined) {
          if (!deepEqual(accessorMeta(json, a), accessorMeta(srcGlb.json, b))) {
            fail(`${where}: ${what} accessor type, count or bounds`);
          }
          const view = json.bufferViews[json.accessors[a].bufferView];
          if (!view?.extensions?.[MESHOPT]) fail(`${where}: ${what} is not meshopt-compressed`);
        }
      }
      if ((prim.material === undefined) !== (sp.material === undefined)) fail(`${where}: material`);
      else if (prim.material !== undefined) {
        usedMaterials.add(prim.material);
        if (!deepEqual(canonMaterial(out, prim.material), canonMaterial(srcGlb, sp.material))) {
          fail(`${where}: material ${json.materials[prim.material].name} changed`);
        }
      }
    });
  }

  // textures: exactly the ones its materials sample, each image byte-identical to the pack's
  const materialCount = json.materials?.length ?? 0;
  if (usedMaterials.size !== materialCount) fail('carries a material no piece draws');
  const textureCount = json.textures?.length ?? 0;
  const sampled = sampledTextures(json);
  for (let t = 0; t < textureCount; t++) {
    if (!sampled.has(t)) fail(`carries texture ${t}, which no material samples`);
  }
  const usedImages = new Set((json.textures ?? []).flatMap(textureSources));
  for (let im = 0; im < (json.images?.length ?? 0); im++) {
    if (!usedImages.has(im)) fail(`carries image ${json.images[im].name}, which no texture uses`);
  }
  // by content: the images are byte for byte the pack's images its kept pieces' materials
  // sample, each once (two images sharing a name cannot confuse this)
  const packImages = new Set();
  for (const node of srcGlb.json.nodes) {
    if (!keepSet.has(node.name) || node.mesh === undefined) continue;
    for (const prim of srcGlb.json.meshes[node.mesh].primitives) {
      if (prim.material === undefined) continue;
      for (const t of materialTextures(srcGlb.json.materials[prim.material])) {
        for (const im of textureSources(srcGlb.json.textures[t])) packImages.add(im);
      }
    }
  }
  const want = [...packImages].map((im) => imageKey(srcGlb, srcGlb.json.images[im])).sort();
  const got = (json.images ?? []).map((im) => imageKey(out, im)).sort();
  if (!deepEqual(got, want)) {
    fail("images are not byte for byte the ones its pieces' materials sample in the pack");
  }
  const images = (json.images ?? []).map((im) => ({
    name: im.name,
    bytes: imageBytes(out, im).length,
  }));

  // accessors: only what something in the file uses (a dropped piece's levels go with it)
  const referenced = referencedAccessors(json);
  for (let a = 0; a < (json.accessors?.length ?? 0); a++) {
    if (!referenced.has(a)) fail(`carries accessor ${a}, which nothing in it uses`);
  }
  let lodLevels = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) lodLevels += prim.extensions?.[WOC_LOD]?.levels.length ?? 0;
  }
  if ((json.extensionsUsed ?? []).includes(WOC_LOD) !== lodLevels > 0) {
    fail(`lists ${WOC_LOD} in extensionsUsed with ${lodLevels} levels`);
  }

  // meshopt kept, quantization declared, the pack's required extensions, every buffer embedded
  const required = [...(json.extensionsRequired ?? [])].sort();
  const packRequired = [...(srcGlb.json.extensionsRequired ?? [])].sort();
  if (!deepEqual(required, packRequired)) {
    fail(`requires [${required}], the pack [${packRequired}]`);
  }
  for (const ext of [MESHOPT, QUANTIZATION])
    if (!required.includes(ext)) fail(`${ext} not required`);
  if ((json.buffers ?? []).some((b) => b.uri !== undefined)) fail('an external buffer');

  // decoded geometry: every piece identical to the pack's (no re-quantization, no TRS change)
  const outDoc = await io.readBinary(bytes);
  const srcNodes = new Map(
    srcDoc
      .getRoot()
      .listNodes()
      .map((n) => [n.getName(), n]),
  );
  for (const node of outDoc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const src = srcNodes.get(node.getName());
    const where = `${node.getName()} (decoded)`;
    if (!src?.getMesh()) {
      fail(`${where}: not a pack piece`);
      continue;
    }
    const trs = (n) => [n.getTranslation(), n.getRotation(), n.getScale()];
    if (!deepEqual(trs(node), trs(src))) fail(`${where}: TRS`);
    const srcPrims = src.getMesh().listPrimitives();
    mesh.listPrimitives().forEach((prim, p) => {
      const sp = srcPrims[p];
      if (!sp) {
        fail(`${where}: primitive ${p} missing in the pack`);
        return;
      }
      if (!sameAccessor(prim.getIndices(), sp.getIndices())) fail(`${where}: indices ${p}`);
      const sems = prim.listSemantics();
      if (!deepEqual([...sems].sort(), [...sp.listSemantics()].sort())) fail(`${where}: semantics`);
      for (const sem of sems) {
        if (!sameAccessor(prim.getAttribute(sem), sp.getAttribute(sem))) {
          fail(`${where}: primitive ${p} ${sem} decodes differently`);
        }
      }
      const targets = prim.listTargets();
      const srcTargets = sp.listTargets();
      if (targets.length !== srcTargets.length) fail(`${where}: target count`);
      targets.forEach((t, ti) => {
        for (const sem of srcTargets[ti]?.listSemantics() ?? []) {
          if (!sameAccessor(t.getAttribute(sem), srcTargets[ti].getAttribute(sem))) {
            fail(`${where}: primitive ${p} target ${ti} ${sem} decodes differently`);
          }
        }
      });
      const mat = prim.getMaterial();
      const srcMat = sp.getMaterial();
      if (!!mat !== !!srcMat || (mat && !mat.equals(srcMat))) fail(`${where}: material ${p}`);
      const levels = prim.getExtension(WOC_LOD)?.listLevels() ?? [];
      const srcLevels = sp.getExtension(WOC_LOD)?.listLevels() ?? [];
      if (levels.length !== srcLevels.length) fail(`${where}: primitive ${p} ${WOC_LOD} levels`);
      levels.forEach((level, l) => {
        const src = srcLevels[l];
        if (!src || !sameTriangleList(level.getIndices(), src.getIndices())) {
          fail(`${where}: primitive ${p} ${WOC_LOD} level ${l} indices decode differently`);
        } else if (level.getMaxDeviation() !== src.getMaxDeviation()) {
          fail(`${where}: primitive ${p} ${WOC_LOD} level ${l} maxDeviation`);
        }
      });
    });
  }

  if (problems.length) throw new Error(`verification failed:\n  ${problems.join('\n  ')}`);
  return {
    pieces: pieceNames,
    materials: (json.materials ?? []).map((m) => m.name),
    images,
    lodLevels,
  };
}

// --- main ------------------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, WocLodExtension])
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const packBytes = fs.readFileSync(opts.input);
  const srcGlb = parseGlb(packBytes);
  const src = await io.readBinary(new Uint8Array(packBytes));
  src.setLogger(new Logger(Logger.Verbosity.WARN));
  const { type, pieces, plan } = planPack(src);
  const beards = beardAtlas(pieces);
  if (beards.problems.length) {
    throw new Error(
      'the beard texture sharing differs from the catalog rule (BEARDS_WITH_OWN_FILE in ' +
        `woc_head_catalog.ts):\n  ${beards.problems.join('\n  ')}`,
    );
  }
  // a texture in two files would be downloaded twice: the groups must not share one
  const filesByTexture = new Map();
  const byName = new Map(pieces.map((n) => [n.getName(), n]));
  for (const [file, names] of plan) {
    for (const name of names) {
      for (const tex of pieceTextures(byName.get(name))) {
        if (!filesByTexture.has(tex)) filesByTexture.set(tex, new Set());
        filesByTexture.get(tex).add(file);
      }
    }
  }
  const sharedAcross = [...filesByTexture].filter(([, files]) => files.size > 1);
  if (sharedAcross.length) {
    throw new Error(
      `textures shared across split files:\n  ${sharedAcross
        .map(([tex, files]) => `${tex.getName()}: ${[...files].join(', ')}`)
        .join('\n  ')}`,
    );
  }
  const urls = [...plan.keys()].map((f) => `${SPLIT_DIR}/${f}`);
  const rel = (p) => {
    const r = path.relative(ROOT, p);
    return r.startsWith('..') ? p : r || '.';
  };

  if (opts.list) {
    const files = [...plan].map(([file, names]) => ({
      file,
      pieces: names,
      images: [...new Set(names.flatMap((n) => [...pieceTextures(byName.get(n))]))].map((t) =>
        t.getName(),
      ),
    }));
    console.log(
      JSON.stringify({ input: rel(path.resolve(opts.input)), type, beards, files, urls }, null, 1),
    );
    return;
  }

  // the build copy: the pack again, its normals swapped for the floats that re-encode onto the
  // stored octahedral codes (`src` stays as decoded, the reference every file is checked against)
  const codes = octahedralNormalCodes(srcGlb);
  const work = await io.readBinary(new Uint8Array(packBytes));
  work.setLogger(new Logger(Logger.Verbosity.WARN));
  if (codes) {
    const accessors = work.getRoot().listAccessors();
    for (const [index, c] of codes) {
      const acc = accessors[index];
      if (acc.getCount() * 4 !== c.length || acc.getComponentType() !== 5120) {
        throw new Error(`accessor ${index} is not the normal the pack JSON lists`);
      }
      acc.setArray(normalsForCodes(c)).setNormalized(false);
    }
  }
  const { FILTER, QUANTIZE } = EXTMeshoptCompression.EncoderMethod;
  const method = codes ? FILTER : QUANTIZE;

  // build and verify every file in memory first: nothing is written unless all of them pass
  const built = [];
  for (const [file, names] of plan) {
    const bytes = await buildFile(io, work, names, method);
    const carried = await verifyFile(io, file, bytes, names, srcGlb, src);
    built.push({ file, bytes, ...carried });
  }
  const seen = new Map();
  for (const { file, pieces: got } of built) {
    for (const name of got) seen.set(name, [...(seen.get(name) ?? []), file]);
  }
  const lost = pieces.map((n) => n.getName()).filter((n) => !seen.has(n));
  const twice = [...seen].filter(([, files]) => files.length !== 1).map(([n]) => n);
  if (lost.length || twice.length || seen.size !== pieces.length) {
    throw new Error(`piece union differs from the pack: lost [${lost}] duplicated [${twice}]`);
  }

  fs.mkdirSync(opts.outDir, { recursive: true });
  for (const { file, bytes } of built) fs.writeFileSync(path.join(opts.outDir, file), bytes);
  const stalePattern = new RegExp(`^head_type_${type}(?:_.+)?\\.glb$`);
  const stale = fs
    .readdirSync(opts.outDir)
    .filter((f) => stalePattern.test(f) && !plan.has(f))
    .sort();
  if (stale.length) {
    console.warn(
      `not written by this split, move them out of ${rel(opts.outDir)}: ${stale.join(', ')}`,
    );
  }
  const files = built.map(({ file, bytes, pieces: got, materials, images, lodLevels }) => ({
    file,
    bytes: bytes.length,
    pieces: got,
    materials,
    images,
    lodLevels,
  }));
  console.log(
    JSON.stringify(
      {
        input: rel(path.resolve(opts.input)),
        outDir: rel(opts.outDir),
        type,
        packBytes: packBytes.length,
        splitBytes: files.reduce((a, f) => a + f.bytes, 0),
        normals: codes
          ? 'the stored octahedral codes, re-encoded exactly (meshopt FILTER)'
          : 'unfiltered (meshopt QUANTIZE): the pack stores them in another form',
        beards,
        files,
        urls,
        stale,
        verified:
          'every file: its pieces under the pack rig head at the same path, bones unchanged, node ' +
          'TRS, mesh and morph target names, materials and image bytes as in the pack, geometry ' +
          'and WOC_lod levels decoding identical, no accessor nothing uses; the union of pieces ' +
          'is the pack, each once',
      },
      null,
      1,
    ),
  );
}

// the pure parts, for tests/woc_head_pack_split.test.ts
export { BEARDS_WITH_OWN_FILE, fileOfPiece, normalsForCodes, octahedralNormalCodes, parseGlb };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
