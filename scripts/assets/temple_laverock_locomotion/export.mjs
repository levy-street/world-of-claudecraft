// Reproducible, original-rig locomotion bank. No mesh or texture is exported.
// BLENDER may name another installation of Blender 5.2.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { sourceFingerprint } from './fingerprint.mjs';

const root = resolve(import.meta.dirname, '../../..');
const raw = resolve(root, 'tmp/laverock/raw.glb');
mkdirSync(resolve(root, 'tmp/laverock'), { recursive: true });
if (!process.argv.includes('--skip-bake')) {
  const blender =
    process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
  const result = spawnSync(
    blender,
    [
      '--background',
      '--factory-startup',
      '--python',
      resolve(import.meta.dirname, 'bake.py'),
      '--',
      raw,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('Laverock locomotion bake failed');
}
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const source = await io.read(resolve(root, 'public/models/creatures/temple_laverock.glb'));
const bank = await io.read(raw);
const targets = new Map(
  source
    .getRoot()
    .listNodes()
    .map((node) => [node.getName(), node]),
);
const mismatch = [];
for (const node of bank.getRoot().listNodes()) {
  const target = targets.get(node.getName());
  if (!target) throw new Error('Unknown locomotion joint: ' + node.getName());
  if (node.getParentNode()?.getName() !== target.getParentNode()?.getName()) {
    throw new Error('Mismatched locomotion parent: ' + node.getName());
  }
  for (const [part, read] of [
    ['translation', 'getTranslation'],
    ['rotation', 'getRotation'],
    ['scale', 'getScale'],
  ]) {
    const actual = node[read]();
    const expected = target[read]();
    const error = Math.max(...actual.map((value, i) => Math.abs(value - expected[i])));
    if (error > 0.0001) mismatch.push({ joint: node.getName(), part, error, actual, expected });
  }
}
if (mismatch.length) throw new Error(JSON.stringify(mismatch, null, 2));
console.log('Rest skeleton matches shipped Laverock:', bank.getRoot().listNodes().length, 'nodes');
bank
  .getRoot()
  .listNodes()
  .find((node) => node.getName() === 'LaverockRig')
  .setExtras({
    laverockLocomotionSourceSha256: sourceFingerprint(),
  });
await io.write(resolve(root, 'public/models/creatures/temple_laverock_locomotion.glb'), bank);
