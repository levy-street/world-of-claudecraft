// Deterministic SHA-256 of the resolved translation table.
//
// An ad-hoc byte-equivalence diagnostic: print the hash in two checkouts (or
// before and after a refactor) and compare the two lines by eye to confirm a
// behavior-preserving change left the resolved table byte-identical. There is no
// committed baseline; determinism is enforced by the committed line-item locale
// slices (src/ui/i18n.resolved.generated/), the CI freshness diff, and the
// determinism tests (tests/i18n_resolved_equivalence.test.ts). Zero runtime deps;
// bundles the TS source with esbuild (the same pattern as
// scripts/export_loot_spreadsheet.mjs) and serializes with a stable recursive key
// order so the hash does not depend on object insertion order.
//
// Usage:
//   node scripts/i18n_resolved_hash.mjs    print "locales=.. bytes=.. sha256=.."

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();

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

// Run as a CLI only when invoked directly (not when imported by the test).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { locales, bytes, sha256 } = await computeResolvedHash();
  console.log(`locales=${locales} bytes=${bytes} sha256=${sha256}`);
}
