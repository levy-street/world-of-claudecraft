// Builds the hand-keyed animation libraries for the WOC male and female rigs.
//
//   node scripts/assets/woc_keyed_anims/build.mjs           the shipped libraries:
//       public/models/chars/players/woc_keyed/woc_{male,female}.glb (SHIPPED_CLIPS only)
//   node scripts/assets/woc_keyed_anims/build.mjs --all [dir]   every keyed clip,
//       into dir (default tmp/woc_keyed_anims) for review
//
// Each library is meshless: the rig's bone hierarchy plus one animation per clip,
// meshopt-compressed like the rig's own library. After a shipped build, run
// validate.mjs --write-contacts and `node scripts/build_media_manifest.mjs generate`.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { animEncoder } from '../woc_character/anim_timeline.mjs';
import { authorClip } from './author.mjs';
import { CATALOG, SHIPPED_CLIPS } from './catalog.mjs';
import { rigFromDocument } from './kinematics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RIG_DIR = path.join(ROOT, 'public/models/chars/players/woc');
export const SHIPPED_DIR = path.join(ROOT, 'public/models/chars/players/woc_keyed');

export async function glbIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

/** The bind rig of a WOC body fit, read from its shipped base. */
export async function wocRig(io, fit) {
  return rigFromDocument(await io.read(path.join(RIG_DIR, `base_${fit}.glb`)));
}

/** One fit's library of the named clips, compressed and ready to write. */
export async function buildLibrary(rig, fit, names) {
  const doc = new Document(),
    buffer = doc.createBuffer(),
    scene = doc.createScene();
  const nodes = rig.map((b) =>
    doc.createNode(b.name).setTranslation(b.t).setRotation(b.q).setScale(b.s),
  );
  rig.forEach((b, i) => {
    (b.parent < 0 ? scene : nodes[b.parent]).addChild(nodes[i]);
  });
  doc.getRoot().setExtras({
    wocKeyedAnimations: {
      method: 'hand-keyed-poses',
      source: 'scripts/assets/woc_keyed_anims',
      // The build never samples another library's tracks, but most key values
      // are body-level targets measured off a reference at chosen beats (README).
      buildReadsReferenceMotion: false,
      keyValuesFromReferenceMeasurements: true,
    },
  });
  const clips = [];
  for (const name of names) {
    const clip = authorClip(rig, fit, name);
    const anim = doc.createAnimation(clip.name).setExtras({ loop: clip.loop, family: clip.family });
    const times = Float32Array.from({ length: clip.frames }, (_, i) => i / clip.fps);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    for (const [index, b] of rig.entries()) {
      for (const [key, targetPath, type] of [
        ['t', 'translation', 'VEC3'],
        ['q', 'rotation', 'VEC4'],
      ]) {
        const values = clip.tracks[b.name][key];
        if (!values.flat().every(Number.isFinite))
          throw new Error(`Non-finite ${fit}/${clip.name}/${b.name}`);
        if (values.every((v) => v.every((x, k) => Math.abs(x - b[key][k]) < 1e-7))) continue;
        // Quaternion sign continuity keeps compression and external editors on the short arc.
        if (key === 'q')
          for (let i = 1; i < values.length; i++) {
            if (values[i].reduce((sum, x, k) => sum + x * values[i - 1][k], 0) < 0)
              values[i] = values[i].map((x) => -x);
          }
        const accessor = doc
          .createAccessor()
          .setType(type)
          .setArray(new Float32Array(values.flat()))
          .setBuffer(buffer);
        const sampler = doc
          .createAnimationSampler()
          .setInput(input)
          .setOutput(accessor)
          .setInterpolation('LINEAR');
        anim
          .addSampler(sampler)
          .addChannel(
            doc
              .createAnimationChannel()
              .setSampler(sampler)
              .setTargetNode(nodes[index])
              .setTargetPath(targetPath),
          );
      }
    }
    if (clip.warnings && Object.keys(clip.warnings).length)
      console.warn(`${fit}/${clip.name} limits:`, clip.warnings);
    clips.push({ name: clip.name, family: clip.family, loop: clip.loop, duration: clip.duration });
  }
  await doc.transform(dedup(), meshopt({ encoder: animEncoder(MeshoptEncoder), level: 'high' }));
  return { doc, clips };
}

async function main() {
  const all = process.argv[2] === '--all';
  const output = all ? path.resolve(ROOT, process.argv[3] ?? 'tmp/woc_keyed_anims') : SHIPPED_DIR;
  const names = all ? Object.keys(CATALOG) : SHIPPED_CLIPS;
  const io = await glbIO();
  fs.mkdirSync(output, { recursive: true });
  const report = { output: path.relative(ROOT, output), fits: {} };
  for (const fit of ['male', 'female']) {
    const { doc, clips } = await buildLibrary(await wocRig(io, fit), fit, names);
    const dest = path.join(output, `woc_${fit}.glb`);
    await io.write(dest, doc);
    const bytes = fs.readFileSync(dest);
    report.fits[fit] = {
      clips,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    console.log(`${fit}: ${clips.length} hand-keyed clips, ${bytes.length} bytes`);
  }
  // The report stays out of public/, which deploys verbatim.
  const reports = path.join(ROOT, 'tmp/woc_keyed_anims');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(
    path.join(reports, all ? 'build-report-all.json' : 'build-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
