// Asset pipeline: optimize raw downloaded packs (tmp/asset_src) into shipping
// files under public/. Usage: node scripts/assets/build_assets.mjs <spec.json> [...more specs]
//
// Spec format: { "items": [ {
//   "src":  "tmp/asset_src/.../Model.glb",        // .glb or .gltf (+external .bin/png)
//   "out":  "models/chars/knight.glb",            // relative to public/
//   "type": "character" | "static" | "copy",
//   "keepClips": ["Idle", ...],                   // optional: drop all other animations
//   "renameClips": { "from": "to" },              // optional: applied after prefix strip
//   "addClipsFrom": ["tmp/.../Rig_Medium_X.glb"], // optional: merge clips from rig libs
//   "attachMeshes": [{ "from": "weapon.glb",      // optional: bake a prop/weapon mesh
//                      "bone": "handslot.r" }],    //   parented under a named bone
//   "maxTex": 512,                                 // optional: clamp texture dimension
//   "keepExtras": true                             // optional: retain extras-bearing leaf nodes
// } ] }
//
// Bulk mode: instead of `src`/`out`, an item may use `srcDir`/`outDir` to convert
// EVERY .gltf/.glb in a folder in one entry. Each out file is named from the source
// basename, lowercased, with `.gltf`/`.glb`/`.gltf.glb` stripped:
//   { "srcDir": "tmp/asset_src/dungeon_extra/gltf", "outDir": "models/dungeon",
//     "type": "static", "maxTex": 512 }
//
// - Clip names like "AnimalArmature|Idle" (or triple-prefixed) are stripped to
//   the segment after the last '|', then deduped.
// - "character": resample + prune + dedup + meshopt(high). Never joins/flattens/
//   simplifies (would corrupt rigs/hard edges on low-poly).
// - "static": same pipeline (no clips expected) — geometry-safe, no simplify.
// - "copy": byte-for-byte copy (HDRIs, plain textures).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  mergeDocuments,
  meshopt,
  prune,
  resample,
  textureCompress,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

// URL.pathname keeps a leading slash before a Windows drive letter, which
// path.resolve mangles into "D:\D:\..."; fileURLToPath is correct on every OS.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function stripClipName(name) {
  const i = name.lastIndexOf('|');
  return i >= 0 ? name.slice(i + 1) : name;
}

// src may be absolute (e.g. pointing at the main checkout's tmp/asset_src from
// a git worktree) or relative to the repo root.
function resolveSrc(src) {
  return path.isAbsolute(src) ? src : path.join(ROOT, src);
}

function resolveOutput(outputRoot, out) {
  const absoluteRoot = path.resolve(outputRoot);
  const outputPath = path.resolve(absoluteRoot, out);
  if (outputPath === absoluteRoot || !outputPath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`output path escapes output root: ${out}`);
  }
  return outputPath;
}

// Expand any `srcDir`/`outDir` item into one item per .gltf/.glb in that folder,
// so a single spec entry can bulk-convert a whole pack. Each out name is derived
// from the source basename: lowercased, non-alphanumerics → `_`, and the
// `.gltf` / `.glb` / `.gltf.glb` extension stripped. Other item keys (type,
// maxTex, …) are carried onto every expanded item.
function expandItems(items) {
  const out = [];
  for (const raw of items) {
    if (!raw.srcDir) {
      out.push(raw);
      continue;
    }
    const dir = resolveSrc(raw.srcDir);
    const exts = raw.exts ?? ['.gltf', '.glb'];
    const files = fs
      .readdirSync(dir)
      .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
      .sort();
    const { srcDir, outDir, exts: _drop, ...rest } = raw;
    for (const f of files) {
      const name = f
        .replace(/\.gltf\.glb$/i, '')
        .replace(/\.(gltf|glb)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      out.push({ ...rest, src: path.join(dir, f), out: `${outDir}/${name}.glb` });
    }
  }
  return out;
}

function dropMeshIslands(root, opts, outName) {
  const minTris = opts.minTris ?? 150;
  const maxDim = opts.maxDim ?? 1;
  let dropped = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute('POSITION');
      const indices = prim.getIndices();
      if (!posAttr || !indices) continue;
      const pos = posAttr.getArray();
      const idx = indices.getArray();
      const nVerts = pos.length / 3;
      // canonicalize verts by quantized position so seam-split verts join
      const canon = new Map();
      const vertKey = new Int32Array(nVerts);
      for (let v = 0; v < nVerts; v++) {
        const k = `${Math.round(pos[v * 3] * 1e4)},${Math.round(pos[v * 3 + 1] * 1e4)},${Math.round(pos[v * 3 + 2] * 1e4)}`;
        let id = canon.get(k);
        if (id === undefined) {
          id = canon.size;
          canon.set(k, id);
        }
        vertKey[v] = id;
      }
      const parent = new Int32Array(canon.size);
      for (let i = 0; i < parent.length; i++) parent[i] = i;
      const find = (a) => {
        let r = a;
        while (parent[r] !== r) r = parent[r];
        while (parent[a] !== r) {
          const next = parent[a];
          parent[a] = r;
          a = next;
        }
        return r;
      };
      for (let t = 0; t < idx.length; t += 3) {
        const a = find(vertKey[idx[t]]);
        const b = find(vertKey[idx[t + 1]]);
        const c = find(vertKey[idx[t + 2]]);
        parent[a] = c;
        parent[b] = c;
      }
      const comps = new Map();
      for (let t = 0; t < idx.length; t += 3) {
        const rootId = find(vertKey[idx[t]]);
        let comp = comps.get(rootId);
        if (!comp) {
          comp = { tris: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
          comps.set(rootId, comp);
        }
        comp.tris++;
        for (const vi of [idx[t], idx[t + 1], idx[t + 2]]) {
          for (let ax = 0; ax < 3; ax++) {
            const v = pos[vi * 3 + ax];
            if (v < comp.min[ax]) comp.min[ax] = v;
            if (v > comp.max[ax]) comp.max[ax] = v;
          }
        }
      }
      const doomed = new Set();
      for (const [rootId, comp] of comps) {
        const dims = comp.max.map((m, i) => m - comp.min[i]);
        if (comp.tris >= minTris && Math.max(...dims) <= maxDim) {
          doomed.add(rootId);
          dropped++;
        }
      }
      if (!doomed.size) continue;
      const kept = [];
      for (let t = 0; t < idx.length; t += 3) {
        if (doomed.has(find(vertKey[idx[t]]))) continue;
        kept.push(idx[t], idx[t + 1], idx[t + 2]);
      }
      indices.setArray(nVerts > 65535 ? new Uint32Array(kept) : new Uint16Array(kept));
    }
  }
  console.log(`  dropIslands: removed ${dropped} island(s) from ${outName}`);
}

async function processModel(io, item, outputRoot) {
  const srcPath = resolveSrc(item.src);
  const outPath = resolveOutput(outputRoot, item.out);
  const doc = await io.read(srcPath);
  const root = doc.getRoot();

  // Drop baked-in decoration islands from a merged mesh (e.g. the KayKit
  // stables building ships with yard horses welded into its one primitive).
  // An "island" is a connected triangle component (shared vertex positions);
  // { "minTris": N, "maxDim": D } drops every island with at least N
  // triangles whose bounding box fits inside a D-sized cube: big-but-small
  // organic clutter, never the building shell (many small welded islands).
  if (item.dropIslands) dropMeshIslands(root, item.dropIslands, item.out);

  // Merge animation clips from separate library glbs. KayKit's v2 packs ship
  // animations in standalone Rig_Medium_*.glb files, each carrying a mannequin
  // mesh + its own copy of the skeleton. Merge a lib in, repoint every newly
  // added animation channel onto the character's own bone of the same name,
  // then drop the lib's scenes + nodes so only its clips survive (the mannequin
  // meshes / duplicate bones fall out, and prune() sweeps the orphaned data).
  if (item.addClipsFrom) {
    const origNodeByName = new Map();
    for (const n of root.listNodes()) origNodeByName.set(n.getName(), n);
    const origNodes = new Set(origNodeByName.values());
    const origScenes = new Set(root.listScenes());
    const origAnims = new Set(root.listAnimations());
    for (const libRel of item.addClipsFrom) {
      mergeDocuments(doc, await io.read(resolveSrc(libRel)));
    }
    let orphan = 0;
    for (const anim of root.listAnimations()) {
      if (origAnims.has(anim)) continue;
      for (const ch of anim.listChannels()) {
        const tgt = ch.getTargetNode();
        if (!tgt) continue;
        const orig = origNodeByName.get(tgt.getName());
        if (orig) ch.setTargetNode(orig);
        else orphan++;
      }
    }
    for (const scene of root.listScenes()) if (!origScenes.has(scene)) scene.dispose();
    for (const node of root.listNodes()) if (!origNodes.has(node)) node.dispose();
    if (orphan)
      console.warn(`  WARN ${item.out}: ${orphan} merged channel(s) had no matching bone`);
  }

  // Bake standalone prop/weapon meshes onto a bone. KayKit ships weapons as
  // separate glbs authored to sit at the handslot bone; merge one in, reparent
  // its root node under the bone, and (for the common single-node weapon) zero
  // the node's translation+rotation while keeping its scale — this mirrors the
  // runtime flatten+attach in render/characters/assets.ts, so a baked-in weapon
  // lands exactly where the renderer would have attached it at runtime.
  if (item.attachMeshes) {
    for (const att of item.attachMeshes) {
      const bone = root.listNodes().find((n) => n.getName() === att.bone);
      if (!bone) {
        console.warn(`  WARN ${item.out}: attach bone '${att.bone}' not found`);
        continue;
      }
      const before = new Set(root.listScenes());
      mergeDocuments(doc, await io.read(resolveSrc(att.from)));
      for (const scene of root.listScenes()) {
        if (before.has(scene)) continue;
        const roots = scene.listChildren();
        const single = roots.length === 1;
        for (const node of roots) {
          scene.removeChild(node);
          if (single) {
            node.setTranslation([0, 0, 0]);
            node.setRotation([0, 0, 0, 1]);
          }
          bone.addChild(node);
        }
        scene.dispose();
      }
    }
  }

  // mergeDocuments (clips or props) imports each source's own buffer; a GLB must
  // have a single one — consolidate every accessor onto the first buffer.
  if (item.addClipsFrom || item.attachMeshes) {
    const mainBuffer = root.listBuffers()[0];
    for (const acc of root.listAccessors()) acc.setBuffer(mainBuffer);
    for (const buf of root.listBuffers()) if (buf !== mainBuffer) buf.dispose();
  }

  // normalize + filter animation clips
  const seen = new Set();
  for (const anim of root.listAnimations()) {
    let name = stripClipName(anim.getName());
    if (item.renameClips && item.renameClips[name]) name = item.renameClips[name];
    const drop = (item.keepClips && !item.keepClips.includes(name)) || seen.has(name);
    if (drop) {
      anim.dispose();
      continue;
    }
    seen.add(name);
    anim.setName(name);
  }
  if (item.keepClips) {
    const missing = item.keepClips.filter((c) => !seen.has(c));
    if (missing.length) console.warn(`  WARN ${item.out}: missing clips ${missing.join(', ')}`);
  }

  const transforms = [resample(), prune({ keepExtras: item.keepExtras === true }), dedup()];
  if (item.maxTex) {
    transforms.push(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [item.maxTex, item.maxTex],
      }),
    );
  }
  transforms.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...transforms);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  const clips = root.listAnimations().length;
  console.log(`  ${item.out}  ${kb}KB${clips ? ` (${clips} clips)` : ''}`);
}

function processCopy(item, outputRoot) {
  const srcPath = resolveSrc(item.src);
  const outPath = resolveOutput(outputRoot, item.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.copyFileSync(srcPath, outPath);
  console.log(`  ${item.out}  ${(fs.statSync(outPath).size / 1024).toFixed(0)}KB (copy)`);
}

async function main() {
  const args = process.argv.slice(2);
  // `--output-root` is an explicit non-shipping destination for reproducible
  // candidate builds. The default remains public/ for every existing caller.
  let outputRoot = PUBLIC_DIR;
  const oi = args.indexOf('--output-root');
  if (oi >= 0) {
    const requestedRoot = args[oi + 1];
    if (!requestedRoot) {
      console.error('usage: --output-root <directory>');
      process.exit(1);
    }
    outputRoot = path.isAbsolute(requestedRoot) ? requestedRoot : path.resolve(ROOT, requestedRoot);
    args.splice(oi, 2);
  }
  // optional `--shard i/n`: process only every n-th expanded item, so several
  // converter processes can run in parallel over ONE spec. Filtering happens
  // after srcDir expansion over a stable sorted order, so shards are disjoint
  // and together cover every item.
  let shard = null;
  const si = args.indexOf('--shard');
  if (si >= 0) {
    const [i, n] = (args[si + 1] ?? '').split('/').map(Number);
    if (!Number.isInteger(i) || !Number.isInteger(n) || n <= 0 || i < 0 || i >= n) {
      console.error('usage: --shard <i>/<n>  (0 <= i < n)');
      process.exit(1);
    }
    shard = { i, n };
    args.splice(si, 2);
  }
  const specs = args;
  if (!specs.length) {
    console.error(
      'usage: node scripts/assets/build_assets.mjs <spec.json> [...] [--output-root dir] [--shard i/n]',
    );
    process.exit(1);
  }
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  let failures = 0;
  for (const specFile of specs) {
    const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
    // optional top-level `defaults` merged into every item (item keys win) —
    // lets a spec share addClipsFrom/renameClips/keepClips across many chars
    const defaults = spec.defaults ?? {};
    let items = expandItems(spec.items);
    if (shard) items = items.filter((_, idx) => idx % shard.n === shard.i);
    console.log(
      `spec: ${specFile} (${items.length} items${shard ? `, shard ${shard.i}/${shard.n}` : ''})`,
    );
    for (const raw of items) {
      const item = { ...defaults, ...raw };
      try {
        if (item.type === 'copy') processCopy(item, outputRoot);
        else await processModel(io, item, outputRoot);
      } catch (err) {
        failures++;
        console.error(`  FAIL ${item.src}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  if (failures) {
    console.error(`${failures} item(s) failed`);
    process.exit(1);
  }
}

main();
