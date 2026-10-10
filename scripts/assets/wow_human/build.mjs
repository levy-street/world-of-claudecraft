import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { animEncoder, leanAnimJson } from '../woc_character/anim_timeline.mjs';
import { gaitSpeed, retargetClip } from './retarget.mjs';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
for (const fit of ['male', 'female']) {
  const base = await io.read(`public/models/chars/players/woc/base_${fit}.glb`);
  const nodes = base
    .getRoot()
    .listNodes()
    .filter((n) => !n.getMesh());
  const target = nodes.map((n) => ({
    name: n.getName(),
    parent: nodes.indexOf(n.getParentNode()),
    t: n.getTranslation(),
    q: n.getRotation(),
  }));
  const source = JSON.parse(fs.readFileSync(`tmp/wow_human/${fit}-decoded.json`, 'utf8'));
  const clips = source.clips.map((c) => retargetClip(source, target, fit, c));
  const anatomy = JSON.parse(
    fs.readFileSync('scripts/assets/woc_character/export_split.json', 'utf8'),
  );
  const calibration = {};
  // WOC player height and the state machine reference speeds. Verify these
  // against the runtime in woc_wow_animations.test.mjs when changing either.
  for (const [name, speed] of [
    ['a_walkN', 2.2],
    ['a_runN', 7],
    ['a_walkS', 4.55],
  ]) {
    const clip = clips.find((c) => c.name === `WoW_${name}`);
    const measured = gaitSpeed(target, clip, 2.86 / anatomy.anatomyTop[fit], name.endsWith('S'));
    calibration[name] = {
      sourceFps: clip.fps,
      measured,
      reference: speed,
      timeScale: speed / measured,
    };
    clip.fps *= speed / measured;
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const dest = nodes.map((n) =>
    doc
      .createNode(n.getName())
      .setTranslation(n.getTranslation())
      .setRotation(n.getRotation())
      .setScale(n.getScale()),
  );
  target.forEach((b, i) => {
    (b.parent < 0 ? scene : dest[b.parent]).addChild(dest[i]);
  });
  for (const clip of clips) {
    const anim = doc
      .createAnimation(clip.name)
      .setExtras({ sourceClip: clip.name.slice(4), loop: clip.loop });
    const times = Float32Array.from({ length: clip.frames }, (_, i) => i / clip.fps);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    target.forEach((b, i) => {
      for (const [key, path, type] of [
        ['q', 'rotation', 'VEC4'],
        ['t', 'translation', 'VEC3'],
      ]) {
        const values = clip.tracks[b.name][key];
        // An absent track blends back to the bind transform in AnimationMixer.
        // Do not serialize hundreds of constant bind translations/attachments.
        const bind = b[key];
        if (values.every((v) => v.every((x, k) => Math.abs(x - bind[k]) < 1e-6))) continue;
        const output = doc
          .createAccessor()
          .setType(type)
          .setArray(new Float32Array(values.flat()))
          .setBuffer(buffer);
        const sampler = doc
          .createAnimationSampler()
          .setInput(input)
          .setOutput(output)
          .setInterpolation('LINEAR');
        anim
          .addSampler(sampler)
          .addChannel(
            doc
              .createAnimationChannel()
              .setSampler(sampler)
              .setTargetNode(dest[i])
              .setTargetPath(path),
          );
      }
    });
  }
  // Keep every authored key: resampling short foot contacts to 30 Hz changes
  // planted-foot speed. Inputs are already shared by all channels in each clip.
  await doc.transform(dedup(), meshopt({ encoder: animEncoder(MeshoptEncoder), level: 'high' }));
  const out = `public/models/chars/players/woc/wow_anims_${fit}.glb`;
  const binary = Buffer.from(await io.writeBinary(doc));
  const oldJsonSize = binary.readUInt32LE(12);
  const json = leanAnimJson(JSON.parse(binary.subarray(20, 20 + oldJsonSize).toString()));
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(padded);
  const header = Buffer.from(binary.subarray(0, 20));
  const tail = binary.subarray(20 + oldJsonSize);
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12);
  fs.writeFileSync(out, Buffer.concat([header, padded, tail]));
  fs.writeFileSync(
    `tmp/wow_human/${fit}-retargeted.json`,
    JSON.stringify({ bones: target, clips }),
  );
  fs.writeFileSync(`tmp/wow_human/${fit}-calibration.json`, JSON.stringify(calibration, null, 2));
  console.log(`${fit}: ${clips.length} clips, ${fs.statSync(out).size} bytes`);
}
