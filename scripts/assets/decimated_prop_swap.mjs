// Swap decimated geometry onto shipped GLBs under public/models.
//
// The scatter dressing props (fen reeds, lily rafts, willows, garden beds, hollow
// shrubs, gather nodes, camp crates, lava pieces, palms) are Tripo generations
// that ship at 4,000 to 16,000 triangles each and are instanced in the dozens
// per zone. This is the one-shot tool that lands a Blender decimation pass over
// them without touching anything a consumer keys on:
//
//   1. GEOMETRY comes from the export: every mesh primitive's attributes and
//      indices are transplanted onto the SHIPPED original, primitive by
//      primitive, after checking mesh names, primitive counts, material names
//      and attribute sets line up. Node hierarchy, materials, samplers, extras
//      and (by construction of the export) bounds stay what shipped, so the
//      sim colliders and click targets derived from bounds cannot drift.
//   2. TEXTURES stay the shipped bytes unless they are larger than --cap
//      (default 512). Larger maps are transcoded from the shipped KTX2,
//      downsized and re-encoded with the SAME codec the shipped map used
//      (ETC1S or UASTC), so a swap never changes a file's codec mix. Models
//      listed in --keep-1024 (landmark-scale pieces) cap at 1024 instead.
//   3. ENCODING matches the original: KHR_mesh_quantization + meshopt where
//      the original had it (scripts/assets/compress_glb_textures.mjs's
//      quantized path), the lossless FILTER meshopt method otherwise.
//   4. VERIFY: extension set, every image KTX2 with its original codec,
//      triangle count equal to the export, node list unchanged, world bounds
//      within 0.2 percent of the original. Any miss aborts before writing.
//
// Usage (from a clean checkout, ktx from KTX-Software 4.3+ on PATH or KTX_BIN):
//   node scripts/assets/decimated_prop_swap.mjs --from <export dir> \
//     [--cap 512] [--keep-1024 hollow_gate_tree,willow_tree] [--only a.glb,b.glb] \
//     [--report tmp/swap_report.json] [--dry-run]
//
// The export dir holds one <name>.glb per model to swap, plain glTF (no Draco,
// no meshopt) with the shipped names; the matching original is found under
// public/models/{props,biome,resources}. Afterwards run
// `node scripts/build_media_manifest.mjs generate`.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Mode, toktx } from '@gltf-transform/cli';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dequantize, meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// The exact Sharp runtime gltf-transform's CLI owns (see compress_glb_textures.mjs).
const rootRequire = createRequire(import.meta.url);
const cliRequire = createRequire(rootRequire.resolve('@gltf-transform/cli'));
const sharp = (await import(pathToFileURL(cliRequire.resolve('sharp')).href)).default;
if (process.env.KTX_BIN) {
  process.env.PATH = `${process.env.PATH ?? ''}${path.delimiter}${process.env.KTX_BIN}`;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODEL_DIRS = ['props', 'biome', 'resources'].map((d) =>
  path.join(ROOT, 'public', 'models', d),
);
const RGBA32 = 13; // basis transcoder_texture_format cTFRGBA32
const BOUNDS_TOLERANCE = 2e-3;

function parseArgs(argv) {
  const opts = {
    from: null,
    cap: 512,
    keep1024: new Set(),
    only: null,
    report: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') opts.from = path.resolve(argv[++i]);
    else if (a === '--cap') opts.cap = Number(argv[++i]);
    else if (a === '--keep-1024') opts.keep1024 = new Set(argv[++i].split(',').filter(Boolean));
    else if (a === '--only') opts.only = new Set(argv[++i].split(',').filter(Boolean));
    else if (a === '--report') opts.report = path.resolve(argv[++i]);
    else if (a === '--dry-run') opts.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.from) throw new Error('--from <export dir> is required');
  return opts;
}

// three ships the Basis transcoder as an ESM-packaged script; require it as CJS
// from a temp copy so its module.exports factory is reachable.
async function loadBasis() {
  const src = rootRequire.resolve('three/examples/jsm/libs/basis/basis_transcoder.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'basis-'));
  fs.copyFileSync(src, path.join(dir, 'basis_transcoder.cjs'));
  fs.copyFileSync(src.replace(/\.js$/, '.wasm'), path.join(dir, 'basis_transcoder.wasm'));
  const factory = rootRequire(path.join(dir, 'basis_transcoder.cjs'));
  const basis = await factory({ locateFile: (f) => path.join(dir, f) });
  basis.initializeBasis();
  return basis;
}

function ktx2Codec(basis, bytes) {
  const f = new basis.KTX2File(new Uint8Array(bytes));
  try {
    if (!f.isValid()) throw new Error('invalid KTX2');
    return f.isUASTC() ? 'UASTC' : 'ETC1S';
  } finally {
    f.close();
    f.delete();
  }
}

function transcodeRgba(basis, bytes) {
  const f = new basis.KTX2File(new Uint8Array(bytes));
  try {
    if (!f.isValid() || !f.startTranscoding()) throw new Error('KTX2 transcode failed');
    const width = f.getWidth();
    const height = f.getHeight();
    const size = f.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32);
    const dst = new Uint8Array(size);
    if (!f.transcodeImage(dst, 0, 0, 0, RGBA32, 0, -1, -1))
      throw new Error('KTX2 transcode failed');
    return { rgba: Buffer.from(dst.buffer, dst.byteOffset, size), width, height };
  } finally {
    f.close();
    f.delete();
  }
}

function glbJson(file) {
  const buf = fs.readFileSync(file);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
}

function worldBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : pos.getCount()) / 3;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        const w = [x, y, z];
        for (let k = 0; k < 3; k++) {
          if (w[k] < min[k]) min[k] = w[k];
          if (w[k] > max[k]) max[k] = w[k];
        }
      }
    }
  }
  return { min, max, tris: Math.round(tris) };
}

function boundsDrift(a, b) {
  let worst = 0;
  for (let k = 0; k < 3; k++) {
    const span = Math.max(a.max[k] - a.min[k], 1e-6);
    worst = Math.max(
      worst,
      Math.abs(a.min[k] - b.min[k]) / span,
      Math.abs(a.max[k] - b.max[k]) / span,
    );
  }
  return worst;
}

function nodeNames(doc) {
  return doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName())
    .join('|');
}

function originalFor(name) {
  for (const dir of MODEL_DIRS) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no shipped original for ${name} under public/models/{props,biome,resources}`);
}

function transplantGeometry(orig, exported, name) {
  const om = orig.getRoot().listMeshes();
  const em = exported.getRoot().listMeshes();
  if (om.length !== em.length) throw new Error(`${name}: mesh count ${om.length} vs ${em.length}`);
  const buffer = orig.getRoot().listBuffers()[0];
  let prims = 0;
  for (let i = 0; i < om.length; i++) {
    if (om[i].getName() !== em[i].getName())
      throw new Error(`${name}: mesh ${i} is ${om[i].getName()} vs ${em[i].getName()}`);
    const op = om[i].listPrimitives();
    const ep = em[i].listPrimitives();
    if (op.length !== ep.length)
      throw new Error(`${name}: ${om[i].getName()} has ${op.length} primitives vs ${ep.length}`);
    for (let j = 0; j < op.length; j++) {
      const a = op[j];
      const b = ep[j];
      const am = a.getMaterial()?.getName() ?? '';
      const bm = b.getMaterial()?.getName() ?? '';
      if (am !== bm) throw new Error(`${name}: primitive ${i}/${j} material ${am} vs ${bm}`);
      if (b.listTargets().length) throw new Error(`${name}: export carries morph targets`);
      const semA = a.listSemantics().sort().join(',');
      const semB = b.listSemantics().sort().join(',');
      if (semA !== semB)
        throw new Error(`${name}: primitive ${i}/${j} attributes ${semA} vs ${semB}`);
      for (const sem of b.listSemantics()) {
        const src = b.getAttribute(sem);
        const acc = orig
          .createAccessor(src.getName())
          .setType(src.getType())
          .setArray(src.getArray().slice())
          .setNormalized(src.getNormalized())
          .setBuffer(buffer);
        a.setAttribute(sem, acc);
      }
      const idx = b.getIndices();
      a.setIndices(
        idx
          ? orig
              .createAccessor(idx.getName())
              .setType('SCALAR')
              .setArray(idx.getArray().slice())
              .setBuffer(buffer)
          : null,
      );
      a.setMode(b.getMode());
      prims++;
    }
  }
  return prims;
}

async function swapOne(io, basis, opts, name) {
  const origPath = originalFor(name);
  const base = name.replace(/\.glb$/, '');
  const origJson = glbJson(origPath);
  const origExtensions = (origJson.extensionsUsed ?? []).slice().sort();
  const exported = await io.read(path.join(opts.from, name));
  await exported.transform(dequantize());
  const orig = await io.read(origPath);
  const before = worldBounds(orig);
  const nodesBefore = nodeNames(orig);
  const exportBounds = worldBounds(exported);

  const prims = transplantGeometry(orig, exported, name);

  // Textures: keep shipped bytes at or under the cap; larger maps are downsized and
  // re-encoded with the codec they shipped with (two toktx passes, one per codec).
  const cap = opts.keep1024.has(base) ? Math.max(opts.cap, 1024) : opts.cap;
  const pending = { ETC1S: [], UASTC: [] };
  const wantCodec = new Map();
  const texLog = [];
  for (const tex of orig.getRoot().listTextures()) {
    const size = tex.getSize();
    if (!size || tex.getMimeType() !== 'image/ktx2')
      throw new Error(`${name}: ${tex.getName()} is not KTX2`);
    const codec = ktx2Codec(basis, tex.getImage());
    wantCodec.set(tex, codec);
    if (size[0] <= cap) {
      texLog.push(`${tex.getName()} ${size[0]} ${codec} kept`);
      continue;
    }
    const { rgba, width, height } = transcodeRgba(basis, tex.getImage());
    const th = Math.max(4, Math.round((height * cap) / width));
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .resize(cap, th, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    pending[codec].push({ tex, png });
    texLog.push(`${tex.getName()} ${size[0]}->${cap} ${codec}`);
  }
  for (const codec of ['ETC1S', 'UASTC']) {
    if (!pending[codec].length) continue;
    for (const { tex, png } of pending[codec])
      tex.setImage(new Uint8Array(png)).setMimeType('image/png');
    await orig.transform(
      toktx({ mode: codec === 'ETC1S' ? Mode.ETC1S : Mode.UASTC, jobs: 2, encoder: sharp }),
    );
  }

  // Encoding: the way the original shipped.
  for (const ext of orig.getRoot().listExtensionsUsed()) {
    if (
      ext.extensionName === 'EXT_meshopt_compression' ||
      ext.extensionName === 'KHR_mesh_quantization'
    ) {
      ext.dispose();
    }
  }
  await orig.transform(
    prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepExtras: true }),
  );
  if (origExtensions.includes('KHR_mesh_quantization')) {
    await orig.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  } else if (origExtensions.includes('EXT_meshopt_compression')) {
    orig
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  }
  const out = Buffer.from(await io.writeBinary(orig));

  // Verify before anything lands on disk.
  const check = await io.readBinary(out);
  const outJson = JSON.parse(out.subarray(20, 20 + out.readUInt32LE(12)).toString('utf8'));
  const problems = [];
  const outExtensions = (outJson.extensionsUsed ?? []).slice().sort();
  if (outExtensions.join(',') !== origExtensions.join(','))
    problems.push(`extensions ${outExtensions.join(',')} vs ${origExtensions.join(',')}`);
  const nonKtx = (outJson.images ?? []).filter((i) => i.mimeType !== 'image/ktx2').length;
  if (nonKtx) problems.push(`${nonKtx} image(s) not KTX2`);
  for (const tex of check.getRoot().listTextures()) {
    const want = [...wantCodec.entries()].find(([t]) => t.getName() === tex.getName())?.[1];
    const got = ktx2Codec(basis, tex.getImage());
    if (want && got !== want) problems.push(`${tex.getName()} codec ${got} vs ${want}`);
    const size = tex.getSize();
    if (size && size[0] > cap) problems.push(`${tex.getName()} still ${size[0]} px`);
  }
  const after = worldBounds(check);
  if (after.tris !== exportBounds.tris)
    problems.push(`triangles ${after.tris} vs export ${exportBounds.tris}`);
  if (nodeNames(check) !== nodesBefore) problems.push('node list changed');
  const drift = boundsDrift(before, after);
  if (drift > BOUNDS_TOLERANCE) problems.push(`bounds drift ${(drift * 100).toFixed(2)}%`);
  if (problems.length) throw new Error(`${name}: ${problems.join('; ')}`);

  const bytesBefore = fs.statSync(origPath).size;
  if (!opts.dryRun) fs.writeFileSync(origPath, out);
  return {
    name,
    path: path.relative(ROOT, origPath),
    prims,
    trisBefore: before.tris,
    trisAfter: after.tris,
    bytesBefore,
    bytesAfter: out.length,
    boundsDrift: drift,
    textures: texLog,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  io.setLogger({ debug() {}, info() {}, warn() {}, error: (m) => console.error(m) });
  const basis = await loadBasis();
  const names = fs
    .readdirSync(opts.from)
    .filter((f) => f.endsWith('.glb') && (!opts.only || opts.only.has(f)))
    .sort();
  if (!names.length) throw new Error(`no .glb exports under ${opts.from}`);
  const rows = [];
  for (const name of names) {
    const row = await swapOne(io, basis, opts, name);
    rows.push(row);
    console.log(
      `${opts.dryRun ? 'would swap' : 'swapped'} ${name.padEnd(30)} tris ${String(row.trisBefore).padStart(6)} -> ${String(row.trisAfter).padStart(5)}  ${String(Math.round(row.bytesBefore / 1024)).padStart(5)} KB -> ${String(Math.round(row.bytesAfter / 1024)).padStart(5)} KB  ${row.textures.join(', ')}`,
    );
  }
  const tb = rows.reduce((s, r) => s + r.trisBefore, 0);
  const ta = rows.reduce((s, r) => s + r.trisAfter, 0);
  const bb = rows.reduce((s, r) => s + r.bytesBefore, 0);
  const ba = rows.reduce((s, r) => s + r.bytesAfter, 0);
  console.log(
    `${rows.length} file(s): ${tb.toLocaleString()} -> ${ta.toLocaleString()} triangles, ${(bb / 1048576).toFixed(1)} -> ${(ba / 1048576).toFixed(1)} MB${opts.dryRun ? ' (dry run, nothing written)' : ''}`,
  );
  if (opts.report) fs.writeFileSync(opts.report, JSON.stringify(rows, null, 1));
  if (!opts.dryRun) console.log('now run: node scripts/build_media_manifest.mjs generate');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
