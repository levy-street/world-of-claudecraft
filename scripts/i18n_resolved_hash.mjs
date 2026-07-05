// Deterministic SHA-256 of the resolved 14-locale translation table.
//
// This is the byte-equivalence safety net for the i18n scaling refactor: every
// behavior-preserving change must leave the resolved table byte-identical, proven
// by this hash. Zero runtime deps; bundles the TS source with esbuild (the same
// pattern as scripts/export_loot_spreadsheet.mjs) and serializes with a stable
// recursive key order so the hash does not depend on object insertion order.
//
// Usage:
//   node scripts/i18n_resolved_hash.mjs           print "locales=.. bytes=.. sha256=.."
//   node scripts/i18n_resolved_hash.mjs --write    (re)write src/ui/i18n.resolved.sha256
//   node scripts/i18n_resolved_hash.mjs --check     compare against the committed baseline; exit 1 on mismatch

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = process.cwd();
// Only the GAME table is SHA-gated here. The admin resolved table
// (src/admin/i18n.resolved.generated/) is intentionally NOT hashed: its byte-identity
// is enforced by tests/i18n_admin_catalog.test.ts (regenerate + `git diff --exit-code`),
// an exact in-tree check that makes a content-addressed admin baseline redundant. The
// game table also needs this hash because it doubles as the release-gate tripwire. Do
// not "restore" a missing src/admin/i18n.resolved.sha256 - there has never been one.
export const BASELINE_PATH = path.join(root, 'src/ui/i18n.resolved.sha256');

// Recursively sort object keys so the serialization is independent of insertion
// order (and therefore stable across a refactor that reorders declarations).
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

// Bundle src/ui/i18n.ts and reassemble the resolved table from its exports.
// `translations` itself is not exported, but every locale is an export named for
// its code and `supportedLanguages` is the authoritative ordered key set.
export async function computeResolvedHash() {
  const build = await esbuild.build({
    stdin: {
      contents: `export * from './src/ui/i18n.ts';`,
      resolveDir: root,
      sourcefile: 'i18n-resolved-hash-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  const dataUrl = `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`;
  const i18n = await import(dataUrl);

  const translations = {};
  for (const lang of i18n.supportedLanguages) translations[lang] = i18n[lang];

  const serialized = JSON.stringify(sortDeep(translations));
  return {
    locales: i18n.supportedLanguages.length,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    sha256: createHash('sha256').update(serialized, 'utf8').digest('hex'),
  };
}

function readBaseline() {
  return readFileSync(BASELINE_PATH, 'utf8').trim();
}

// Run as a CLI only when invoked directly (not when imported by the test).
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const mode = process.argv[2];
  const { locales, bytes, sha256 } = await computeResolvedHash();
  console.log(`locales=${locales} bytes=${bytes} sha256=${sha256}`);
  if (mode === '--write') {
    writeFileSync(BASELINE_PATH, `${sha256}\n`);
    console.log(`wrote baseline ${path.relative(root, BASELINE_PATH)}`);
  } else if (mode === '--check') {
    const baseline = readBaseline();
    if (baseline !== sha256) {
      console.error(`MISMATCH: resolved table hash ${sha256} != baseline ${baseline}`);
      console.error('The resolved 14-locale table changed. For a behavior-preserving change this is a bug, not a re-baseline.');
      process.exit(1);
    }
    console.log('OK: resolved table matches the committed baseline.');
  }
}
