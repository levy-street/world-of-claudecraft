#!/usr/bin/env node
// Masterwrought Phase 11d, unit 1 (ruling 11d-U1-SHARD): resolve the two
// parents' CI shard-weight harvests (scripts/ci_shard_weights.generated.json)
// as a KEY UNION. The NEWER __provenance block wins (higher GitHub run id); on
// a shared key the newer harvest's measured weight wins; rows only the older
// table carries are CARRIED with their measured weight; `files` is re-derived
// from the merged key count. No weight is ever hand-written: every number in
// the output is one of the two parents' measured values. Prints the coverage
// of the union over the walked non-browser test tree (the same walk
// tests/ci_shard_partition.test.ts applies: tests/browser/ and
// *.browser.test.ts excluded) so the 95 percent floor is measured BEFORE the
// table is committed; a union under the floor means a fresh CI harvest runs
// before the phase closes (release-merge gate surprises, class 2).
//
// Usage (from the repo root):
//   node scripts/merge_audit/shard_weight_union.mjs            dry run, report only
//   node scripts/merge_audit/shard_weight_union.mjs --write    write the merged table
// Optional: --ours <ref> --theirs <ref> (defaults below are the 11b merge parents).
// The parents are read with `git show`; nothing is checked out.
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TABLE = 'scripts/ci_shard_weights.generated.json';
const DEFAULT_OURS = 'd5304a78c4a1add6b1ed5a0b66ddb9f8246a4d73';
const DEFAULT_THEIRS = '8cd964d599ebbb6800fc20741690a0b9b6f17b40';

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const oursRef = argValue('--ours', DEFAULT_OURS);
const theirsRef = argValue('--theirs', DEFAULT_THEIRS);
const write = process.argv.includes('--write');

function showJson(ref) {
  const raw = execFileSync('git', ['-C', ROOT, 'show', `${ref}:${TABLE}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

export function unionTables(ours, theirs) {
  const oursProv = ours.__provenance;
  const theirsProv = theirs.__provenance;
  const oursKeys = Object.keys(ours).filter((k) => k !== '__provenance');
  const theirsKeys = Object.keys(theirs).filter((k) => k !== '__provenance');
  const newerIsTheirs = Number(theirsProv.run) > Number(oursProv.run);
  const newer = newerIsTheirs ? theirs : ours;
  const older = newerIsTheirs ? ours : theirs;
  const newerProv = newer.__provenance;
  const olderProv = older.__provenance;
  const newerKeys = new Set(Object.keys(newer).filter((k) => k !== '__provenance'));
  const olderKeys = Object.keys(older).filter((k) => k !== '__provenance');
  const carried = olderKeys.filter((k) => !newerKeys.has(k)).sort();
  const sortedKeys = [...new Set([...newerKeys, ...olderKeys])].sort();
  const merged = { __provenance: null };
  for (const k of sortedKeys) merged[k] = newerKeys.has(k) ? newer[k] : older[k];
  // The carried rows keep the older TABLE's values, and that table's own
  // provenance disclosure travels with them: collapsing the carried rows to
  // "run <olderProv.run>" would launder locally measured weights into an
  // apparent CI-harvested pedigree one union at a time (the 11d gate
  // reviewer's finding: 27 of the absorb's 28 carried rows were the
  // 2026-08-19 LOCAL measurements the older table disclosed, not harvest
  // rows).
  const olderPedigree = olderProv.localMerge
    ? `the older table (run ${olderProv.run}), whose own provenance reads: "${olderProv.localMerge}"`
    : `the older table's CI harvest (run ${olderProv.run})`;
  merged.__provenance = {
    run: newerProv.run,
    harvested: newerProv.harvested,
    files: sortedKeys.length,
    localMerge:
      '2026-08-21 farming absorb (masterwrought Phase 11d, ruling 11d-U1-SHARD): KEY UNION of ' +
      `the two parent harvests; the newer CI harvest (run ${newerProv.run}, ${newerKeys.size} ` +
      `rows) wins on every shared key and ${carried.length} rows only the other parent's table ` +
      `carried keep that table's measured weight, sourced from ${olderPedigree}; no weight is ` +
      `hand-written; files counts the merged table (${newerKeys.size} harvested + ` +
      `${carried.length} carried)`,
  };
  return {
    merged,
    stats: {
      oursKeys: oursKeys.length,
      theirsKeys: theirsKeys.length,
      shared: oursKeys.filter((k) => theirsKeys.includes(k)).length,
      carried,
      newer: newerIsTheirs ? 'theirs' : 'ours',
      union: sortedKeys.length,
    },
  };
}

// The SAME walk predicate the enforcing pin applies
// (tests/ci_shard_partition.test.ts): skip browser/, node_modules, dist and
// dot-directories, and never follow symlinks (withFileTypes, no statSync), so
// this tool cannot certify a coverage number the gate's own walk would then
// reject.
export function walkTestFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (name === 'browser' || name === 'node_modules' || name === 'dist') continue;
        if (name.startsWith('.')) continue;
        walk(join(dir, name));
      } else if (
        entry.isFile() &&
        name.endsWith('.test.ts') &&
        !name.endsWith('.browser.test.ts')
      ) {
        out.push(join(dir, name).slice(root.length + 1));
      }
    }
  };
  walk(join(root, 'tests'));
  return out.sort();
}

function main() {
  const ours = showJson(oursRef);
  const theirs = showJson(theirsRef);
  const { merged, stats } = unionTables(ours, theirs);
  console.log('ours   ', oursRef, JSON.stringify(ours.__provenance));
  console.log('theirs ', theirsRef, JSON.stringify(theirs.__provenance));
  console.log('ours keys', stats.oursKeys, 'theirs keys', stats.theirsKeys, 'shared', stats.shared);
  console.log(
    'newer harvest:',
    stats.newer,
    '; carried from the older table:',
    stats.carried.length,
  );
  console.log('union keys', stats.union);
  const walked = walkTestFiles(ROOT);
  const keys = new Set(Object.keys(merged).filter((k) => k !== '__provenance'));
  const covered = walked.filter((f) => keys.has(f)).length;
  const ratio = covered / walked.length;
  console.log('walked non-browser test files', walked.length, 'covered', covered, ratio.toFixed(4));
  const stale = [...keys].filter((k) => !walked.includes(k));
  console.log('union keys with no file on disk', stale.length, stale.join(' '));
  if (ratio < 0.95) console.log('COVERAGE UNDER THE 95 PERCENT FLOOR: a fresh CI harvest is owed');
  if (write) {
    writeFileSync(join(ROOT, TABLE), `${JSON.stringify(merged, null, 2)}\n`);
    console.log('wrote', TABLE, 'keys', stats.union);
  } else {
    console.log('dry run (pass --write to write the merged table)');
  }
}

if (process.argv[1]?.endsWith('shard_weight_union.mjs')) main();
