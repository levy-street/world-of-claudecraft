// Regenerates the committed release44 ability-VFX snapshot
// (tests/helpers/ability_vfx_snapshot.json).
//
// WHY: tests/warrior_release_scope.test.ts pins that the Warrior VFX
// integration (release44) left every OTHER class's ability VFX untouched.
// Comparing the live tables against themselves (abilityVfxSpec(id) ===
// abilityVfxSpec(id) via a second copy of the same import) is a vacuous
// X === X pin, so instead this script hashes a stable JSON serialization
// of each non-warrior ability's compact + full VFX spec, plus each
// authored WARRIOR_CHOREOGRAPHY row, and commits the hashes as data. The
// test recomputes the hashes from the live tables and fails, naming the
// first id whose hash no longer matches the committed snapshot.
//
// WHEN TO REGENERATE: only after a DELIBERATE VFX spec change to a
// non-warrior ability, or an authored edit to WARRIOR_CHOREOGRAPHY (a new
// row, or a changed shape/reach/width/lift/tilt/weight/material/beats/
// weapon on an existing one). Run:
//   npx tsx scripts/ability_vfx_snapshot.ts --write
// then read the diff on tests/helpers/ability_vfx_snapshot.json and
// commit it only once every drifted id is a change you meant to make.
// Treat every hash change in that diff as a reviewed decision: if this
// script reports drift on an id you did not intend to touch, the drift
// is the bug, not the snapshot.
//
// Without --write, the script recomputes the live tables and reports (to
// stderr, non-zero exit) any id whose hash no longer matches the
// committed file, without writing anything.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abilityVfxFullSpec, abilityVfxSpec } from '../src/render/ability_vfx_registry';
import { WARRIOR_CHOREOGRAPHY } from '../src/render/warrior_vfx_specs';
import { ABILITIES } from '../src/sim/data';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, '../tests/helpers/ability_vfx_snapshot.json');

export interface AbilityVfxSnapshot {
  abilities: Record<string, { spec: string; full: string }>;
  warriorChoreography: Record<string, string>;
}

// Sorted-key canonical form: object keys sorted alphabetically, undefined
// properties dropped (matching JSON.stringify's own behavior), arrays kept
// in authored order. Produces the SAME text for the same logical spec no
// matter what order the source object literal declared its keys in.
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = canonicalize(v);
  }
  return out;
}

function stableStringify(value: unknown): string {
  // A spec of `undefined` (no VFX authored for this ability) is a real,
  // distinct state worth pinning: it hashes its own sentinel text rather
  // than falling through to JSON.stringify(undefined) (which is not a
  // string at all).
  return value === undefined ? 'undefined' : JSON.stringify(canonicalize(value));
}

export function snapshotHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

// Every non-warrior ability id in ABILITIES, hashed by its compact + full
// VFX spec; every authored WARRIOR_CHOREOGRAPHY row, hashed by its motion.
// Both id sets are walked in sorted order so the written JSON has a stable
// key order independent of declaration order in the source tables.
export function computeAbilityVfxSnapshot(): AbilityVfxSnapshot {
  const abilities: AbilityVfxSnapshot['abilities'] = {};
  for (const id of Object.keys(ABILITIES).sort()) {
    if (ABILITIES[id].class === 'warrior') continue;
    abilities[id] = {
      spec: snapshotHash(abilityVfxSpec(id)),
      full: snapshotHash(abilityVfxFullSpec(id)),
    };
  }
  const warriorChoreography: AbilityVfxSnapshot['warriorChoreography'] = {};
  for (const id of Object.keys(WARRIOR_CHOREOGRAPHY).sort()) {
    warriorChoreography[id] = snapshotHash(WARRIOR_CHOREOGRAPHY[id]);
  }
  return { abilities, warriorChoreography };
}

export function readCommittedSnapshot(): AbilityVfxSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
}

function main(): void {
  const write = process.argv.includes('--write');
  const fresh = computeAbilityVfxSnapshot();
  if (write) {
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(fresh, null, 2)}\n`);
    console.log(
      `wrote ${Object.keys(fresh.abilities).length} ability hashes + ` +
        `${Object.keys(fresh.warriorChoreography).length} choreography hashes to ${SNAPSHOT_PATH}`,
    );
    return;
  }
  const committed = readCommittedSnapshot();
  const drifted: string[] = [];
  for (const id of Object.keys(fresh.abilities)) {
    const before = committed.abilities[id];
    const after = fresh.abilities[id];
    if (!before || before.spec !== after.spec || before.full !== after.full) drifted.push(id);
  }
  for (const id of Object.keys(fresh.warriorChoreography)) {
    if (committed.warriorChoreography[id] !== fresh.warriorChoreography[id]) drifted.push(id);
  }
  if (drifted.length > 0) {
    console.error(`ability VFX snapshot is stale for: ${drifted.join(', ')}`);
    console.error('If this is a deliberate VFX change, regenerate with --write and commit it.');
    process.exitCode = 1;
    return;
  }
  console.log('ability VFX snapshot matches the live tables.');
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
