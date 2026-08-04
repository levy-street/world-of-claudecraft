// Pins the `import.meta` tripwire that every esbuild IIFE bundler script shares.
// A missed 'import.meta.env.<field>' define no longer leaves a raw `import.meta`
// in the bundle: current esbuild rewrites it to an empty object
// (var import_meta = {}), so `import_meta.env.X` TypeErrors at page boot and the
// harness can only report a __ready timeout. A tripwire testing only
// includes('import.meta') therefore waves a broken bundle through.
// scripts/wiki/render_model_stills.mjs grew the two-shape check and
// scripts/render_finder_portraits.mjs did not; nothing pinned the pair, so the
// drift was invisible. This is that pin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const IIFE_BUNDLERS = [
  'scripts/wiki/render_model_stills.mjs',
  'scripts/render_finder_portraits.mjs',
];

describe('esbuild IIFE bundle scripts guard both import.meta failure shapes', () => {
  for (const rel of IIFE_BUNDLERS) {
    it(`${rel} checks the empty-object rewrite, not just a raw import.meta`, () => {
      const src = readFileSync(join(repoRoot, rel), 'utf8');
      expect(src, 'the raw-import.meta arm (older esbuild kept it verbatim)').toContain(
        "bundleJs.includes('import.meta')",
      );
      expect(
        src,
        'the empty-object rewrite arm (var import_meta = {} / import_meta.env.X)',
      ).toContain('/\\bimport_meta\\b/.test(bundleJs)');
    });
  }
});
