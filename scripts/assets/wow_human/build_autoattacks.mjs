import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { animEncoder } from '../woc_character/anim_timeline.mjs';
import { alignDualContact, bladeContact } from './autoattack_contact.mjs';
import { measureAutoContacts } from './autoattack_measure.mjs';
import { retargetAutoAttack } from './autoattack_retarget.mjs';

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const contacts = {};
fs.mkdirSync('tmp/wow_autoattacks', { recursive: true });
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
  const source = fs.readFileSync(`scripts/assets/wow_human/source/${fit}_autoattacks.glb`);
  const gltf = await new GLTFLoader().parseAsync(
    source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    '',
  );
  const model = JSON.parse(fs.readFileSync(`scripts/assets/wow_human/source/${fit}_bind.json`));
  const clips = gltf.animations.map((a) => retargetAutoAttack(gltf, model, target, fit, a));
  const main = clips.find((c) => c.name === 'WoW_Attack1H_0');
  const contact = bladeContact(target, main, 'r');
  const off = alignDualContact(
    target,
    clips.find((c) => c.name === 'WoW_AttackOff_0'),
    'l',
    contact,
  );
  const pair = { ...main, name: 'WoW_AutoDual', tracks: { ...main.tracks } };
  const left = Object.keys(pair.tracks).filter((name) =>
    /^(clavicle|upperarm|lowerarm|wrist|armor_shoulder)\.l$/.test(name),
  );
  for (const name of left) pair.tracks[name] = off.tracks[name];
  clips.push(
    { ...main, name: 'WoW_AutoDual#main' },
    { ...off, name: 'WoW_AutoDual#off' },
    alignDualContact(target, pair, 'l', contact, left),
  );
  const doc = new Document(),
    buffer = doc.createBuffer(),
    scene = doc.createScene();
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
  contacts[fit] = {};
  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name);
    const times = Float32Array.from({ length: clip.frames }, (_, i) => i / clip.fps);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    for (const [i, b] of target.entries())
      for (const [key, path, type] of [
        ['q', 'rotation', 'VEC4'],
        ['t', 'translation', 'VEC3'],
      ]) {
        const values = clip.tracks[b.name][key];
        if (values.every((v) => v.every((x, k) => Math.abs(x - b[key][k]) < 1e-6))) continue;
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
  }

  await doc.transform(dedup(), meshopt({ encoder: animEncoder(MeshoptEncoder), level: 'high' }));
  const out = `public/models/chars/players/woc/wow_autoattacks_${fit}.glb`;
  await io.write(out, doc);
  contacts[fit] = await measureAutoContacts(fs.readFileSync(out));
  fs.writeFileSync(
    `tmp/wow_autoattacks/${fit}-retargeted.json`,
    JSON.stringify({ bones: target, clips }),
  );
  console.log(fit, clips.length, fs.statSync(out).size, contacts[fit]);
}
fs.writeFileSync(
  'src/render/characters/woc_autoattack_contacts.json',
  JSON.stringify(contacts, null, 2) + '\n',
);
