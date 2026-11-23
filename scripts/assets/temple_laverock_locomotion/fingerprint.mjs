import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const INPUTS = [
  'anatomy.py',
  'bake.py',
  'clip_library.py',
  'clips.py',
  'export.mjs',
  'fingerprint.mjs',
  'jitter.py',
  'measure.mjs',
  'rig.py',
  'sdf.py',
  'warp.py',
];

export function sourceFingerprint() {
  const hash = createHash('sha256');
  for (const name of INPUTS) {
    hash.update(name + '\n');
    hash.update(readFileSync(resolve(import.meta.dirname, name), 'utf8').replace(/\r\n/g, '\n'));
  }
  const root = resolve(import.meta.dirname, '../../..');
  for (const name of ['public/models/creatures/temple_laverock.glb', 'pnpm-lock.yaml']) {
    hash.update(name + '\n');
    const bytes = readFileSync(resolve(root, name));
    hash.update(name.endsWith('.glb') ? bytes : bytes.toString('utf8').replace(/\r\n/g, '\n'));
  }
  return hash.digest('hex');
}
