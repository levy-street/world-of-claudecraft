#!/usr/bin/env node
// Rename a buddy rig's animation clips in-place to the shared 'Idle'/'Walk'
// convention every buddy_* VISUALS entry reads through BUDDY_CLIPS
// (src/render/characters/manifest.ts). Source rigs ship the pair under a
// per-generator name (IDLE/WALK, Idle_Breathing, Crab_Idle, ...); the 2026-08-28
// pass renamed the roster it had, and this is that same pass as a script so the
// next rig costs one command instead of a bespoke ClipMap.
//
// Only equal-LENGTH renames are applied (IDLE -> Idle, WALK -> Walk): the GLB
// JSON chunk keeps its declared byte length, so no chunk header, no binary
// offset and no file length moves. A rename that would change the length is
// refused rather than silently rewriting the container.
//
// Usage: node scripts/assets/normalize_buddy_clips.mjs <file.glb> [...]

import { readFileSync, writeFileSync } from 'node:fs';

const RENAMES = new Map([
  ['IDLE', 'Idle'],
  ['WALK', 'Walk'],
  ['idle', 'Idle'],
  ['walk', 'Walk'],
]);

const JSON_CHUNK_TYPE = 0x4e4f534a; // 'JSON'

function jsonChunkRange(buf) {
  let offset = 12; // past the 12-byte GLB header
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === JSON_CHUNK_TYPE) return [offset + 8, offset + 8 + length];
    offset += 8 + length;
  }
  throw new Error('no JSON chunk found');
}

let failed = false;
for (const path of process.argv.slice(2)) {
  const buf = readFileSync(path);
  const [start, end] = jsonChunkRange(buf);
  const before = buf.toString('utf8', start, end);
  const names = (JSON.parse(before).animations ?? []).map((a) => a.name);
  let after = before;
  const applied = [];
  for (const name of names) {
    const target = RENAMES.get(name);
    if (!target || target === name) continue;
    if (target.length !== name.length) {
      console.error(`${path}: refusing ${name} -> ${target} (length would change)`);
      failed = true;
      continue;
    }
    after = after.split(`"name":"${name}"`).join(`"name":"${target}"`);
    applied.push(`${name} -> ${target}`);
  }
  if (applied.length === 0) {
    console.log(`${path}: already normalized (${names.join(', ')})`);
    continue;
  }
  const patched = Buffer.from(after, 'utf8');
  if (patched.length !== end - start) {
    console.error(`${path}: refusing rewrite, JSON chunk length changed`);
    failed = true;
    continue;
  }
  patched.copy(buf, start);
  writeFileSync(path, buf);
  console.log(`${path}: ${applied.join(', ')}`);
}
process.exit(failed ? 1 : 0);
