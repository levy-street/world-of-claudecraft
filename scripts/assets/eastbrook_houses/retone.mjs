// Rewrites one surface tone (a material's base colour factor) in shipped kit models without
// rebuilding them: the tone lives in the GLB's JSON chunk, so only that chunk is rewritten
// and every buffer, map and mesh stays byte for byte what the build wrote. Keep build.py's
// COLOUR_SETS in step, so the next full build writes the same tone.
//
//   node scripts/assets/eastbrook_houses/retone.mjs <folder under public/models> <material> <r> <g> <b>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const [folder, material, ...rgb] = process.argv.slice(2);
if (!folder || !material || rgb.length !== 3)
  throw new Error('usage: retone.mjs <folder> <material> <r> <g> <b>');
const tone = rgb.map(Number);
const dir = path.join(ROOT, 'public', 'models', folder);
let changed = 0;
for (const name of readdirSync(dir)
  .filter((file) => file.endsWith('.glb'))
  .sort()) {
  const file = path.join(dir, name);
  const bytes = readFileSync(file);
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${name} is not a GLB`);
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${name}: first chunk is not JSON`);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const rest = bytes.subarray(20 + jsonLength);
  let touched = false;
  for (const entry of json.materials ?? []) {
    if (entry.name !== material) continue;
    entry.pbrMetallicRoughness ??= {};
    const alpha = entry.pbrMetallicRoughness.baseColorFactor?.[3] ?? 1;
    entry.pbrMetallicRoughness.baseColorFactor = [...tone, alpha];
    touched = true;
  }
  if (!touched) continue;
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  if (pad) text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  writeFileSync(file, Buffer.concat([head, text, rest]));
  changed++;
}
console.log(`${folder}: ${material} set to ${tone.join(', ')} in ${changed} files`);
