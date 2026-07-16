// Foliage asset pipeline: like build_assets.mjs but adds mesh simplification —
// the Quaternius nature trees ship at 4-10k tris each, far too heavy for the
// ~1,200-instance decoration field. Also strips all-white COLOR_0 attributes
// (tree leaves carry a useless constant white that bloats the buffers; bark
// keeps its baked AO gradient).
//
// Usage: node scripts/assets/build_foliage.mjs scripts/assets/specs/foliage.json
//
// Spec item format (superset of build_assets.mjs):
//   { "src", "out", "type": "static", "maxTex": 512, "simplify": 0.45,
//     "recolor": [{ "match": "Leaves_TwistedTree", "hue": 115, "saturation": 0.8, "brightness": 1 }] }
// "simplify" is the target triangle ratio (omit to skip). The meshopt
// simplifier locks attribute-seam borders, so the chunky alpha-cutout leaf
// cards survive while the dense sculpted barks collapse.
// "recolor" hue-rotates matching textures (degrees) — the kit's twisted-tree
// leaf sheet is autumn-red, which we shift to green (bushes) / olive (swamp).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// URL.pathname keeps a leading slash before a Windows drive letter, which
// path.resolve mangles into "D:\D:\..."; fileURLToPath is correct on every OS.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SIMPLIFY_ERROR = 0.05;

function resolveSrc(src) {
  return path.isAbsolute(src) ? src : path.join(ROOT, src);
}

/** Drop COLOR_0 attributes that are constant white — pure buffer bloat. */
function stripWhiteVertexColors(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const col = prim.getAttribute('COLOR_0');
      if (!col) continue;
      const el = [];
      let allWhite = true;
      for (let i = 0; i < col.getCount() && allWhite; i++) {
        col.getElement(i, el);
        if (el[0] < 0.999 || el[1] < 0.999 || el[2] < 0.999) allWhite = false;
      }
      if (allWhite) prim.setAttribute('COLOR_0', null);
    }
  }
}

/** Hue-rotate textures whose name/uri matches a recolor rule. */
async function recolorTextures(doc, rules) {
  for (const tex of doc.getRoot().listTextures()) {
    const name = `${tex.getName()} ${tex.getURI()}`;
    const rule = rules.find((r) => name.includes(r.match));
    if (!rule) continue;
    const img = await sharp(Buffer.from(tex.getImage()))
      .modulate({
        hue: rule.hue ?? 0,
        saturation: rule.saturation ?? 1,
        brightness: rule.brightness ?? 1,
      })
      .png()
      .toBuffer();
    tex.setImage(img);
  }
}

async function processItem(io, item) {
  const srcPath = resolveSrc(item.src);
  const outPath = path.join(PUBLIC_DIR, item.out);
  const doc = await io.read(srcPath);

  stripWhiteVertexColors(doc);
  if (item.recolor) await recolorTextures(doc, item.recolor);

  const transforms = [];
  if (item.simplify) {
    transforms.push(
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: item.simplify,
        error: SIMPLIFY_ERROR,
      }),
    );
  }
  transforms.push(prune(), dedup());
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

  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`  ${item.out}  ${kb}KB  ${tris} tris`);
}

async function main() {
  const specs = process.argv.slice(2);
  if (!specs.length) {
    console.error('usage: node scripts/assets/build_foliage.mjs <spec.json> [...]');
    process.exit(1);
  }
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  let failures = 0;
  for (const specFile of specs) {
    const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
    console.log(`spec: ${specFile} (${spec.items.length} items)`);
    for (const item of spec.items) {
      try {
        await processItem(io, item);
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
