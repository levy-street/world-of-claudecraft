// Rig slimming pre-step: thins a raw rigged GLB before build_assets.mjs optimizes it, for
// creature rigs whose clips need more than the optimizer's default resample. build_assets.mjs
// is a fingerprinted input of every Eastbrook-era asset (CLAUDE.md here, "Source fingerprints
// are load-bearing"), so per-rig knobs live in this step instead of in it.
//
// Usage, per spec (no npm alias: package.json is itself a fingerprinted input):
//   node scripts/assets/slim_rig_source.mjs scripts/assets/specs/<spec>.json
//   node scripts/assets/build_assets.mjs scripts/assets/specs/<spec>.json
//   node scripts/assets/compress_glb_textures.mjs public/<out>
//
// A spec item opts in by naming its raw export as `rigSource`. This step writes the thinned
// copy to the item's `src`, which build_assets.mjs then reads like any other source (it ignores
// the fields below). Items without `rigSource` are skipped.
//   "rigSource": "tmp/asset_src/heart_slabwright_woc.glb",
//   "src": "tmp/asset_src/heart_slabwright_woc.slim.glb",
//   "resampleTolerance": 0.005,          // optional: drop more keys (lossy; the optimizer's
//                                        //   own resample keeps its 1e-4 default)
//   "dropStillChannels": true,           // optional: drop tracks that only hold the rest pose
//   "materialName": "heart_slabwright"   // optional: rename the first material (without the
//                                        //   tripo_ prefix its atlas takes the smaller ETC1S)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}

/** Drop every animation track that only ever holds its node's rest pose: a mixer holds the rest
 *  pose for a node no track drives, and each track costs its own JSON entries (a rig of rigid
 *  rocks spends most of its file on them). */
function dropStillChannels(doc) {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
  for (const anim of doc.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) {
      const sampler = channel.getSampler();
      const node = channel.getTargetNode();
      const out = sampler?.getOutput()?.getArray();
      const path = channel.getTargetPath();
      if (!node || !out || !['translation', 'rotation', 'scale'].includes(path)) continue;
      const rest =
        path === 'translation'
          ? node.getTranslation()
          : path === 'rotation'
            ? node.getRotation()
            : node.getScale();
      const size = rest.length;
      let still = sampler.getInterpolation() !== 'CUBICSPLINE';
      for (let i = 0; still && i < out.length; i += size) {
        const key = Array.from(out.subarray(i, i + size));
        const flipped = key.map((v) => -v);
        still = near(key, rest) || (path === 'rotation' && near(flipped, rest));
      }
      if (still) {
        channel.dispose();
        sampler.dispose();
      }
    }
  }
}

async function slimItem(io, item) {
  const doc = await io.read(resolvePath(item.rigSource));
  const transforms = [];
  if (item.resampleTolerance) transforms.push(resample({ tolerance: item.resampleTolerance }));
  if (item.dropStillChannels) transforms.push(dropStillChannels);
  if (item.materialName) {
    transforms.push((d) => d.getRoot().listMaterials()[0].setName(item.materialName));
  }
  await doc.transform(...transforms);
  const outPath = resolvePath(item.src);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(outPath, doc);
  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`  ${item.rigSource} -> ${item.src} (${kb} KB)`);
}

async function main() {
  const specs = process.argv.slice(2);
  if (!specs.length) {
    console.error('usage: node scripts/assets/slim_rig_source.mjs <spec.json> [...]');
    process.exit(1);
  }
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  for (const specFile of specs) {
    const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
    const defaults = spec.defaults ?? {};
    console.log(`spec: ${specFile}`);
    for (const raw of spec.items) {
      const item = { ...defaults, ...raw };
      if (!item.rigSource) continue;
      if (!item.src || resolvePath(item.src) === resolvePath(item.rigSource)) {
        throw new Error(`${specFile}: an item with rigSource needs its own src to write to`);
      }
      await slimItem(io, item);
    }
  }
}

main();
