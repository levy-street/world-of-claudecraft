import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The desktop-publish workflow's "Verify version lockstep" step is the ONLY
// publish-time guard on the download-page version mechanism: tag pushes never
// run vitest, so if its greps rot, nothing reds until a release ships a stale
// download page. Phase 2 QA proved the original bare-token greps were
// satisfiable by the token in a comment or a type-only declare. This suite
// extracts the workflow's exact patterns and executes them through grep in
// BOTH directions (they must match the live tree and must reject a
// mechanism-dead revert), so the guard cannot go vacuous again without a test
// telling on it. Bonus: the live-tree arm makes a hardcode revert of the
// module red on every vitest run, not only at the next version bump.
const workflow = readFileSync('.github/workflows/desktop-publish.yml', 'utf8');

// Bound the pins to the lockstep step so a pattern elsewhere in the workflow
// cannot satisfy them.
const stepAt = workflow.indexOf('- name: Verify version lockstep');
const stepEnd = workflow.indexOf('\n  linux:', stepAt);
const step = workflow.slice(Math.max(stepAt, 0), stepEnd);

// The extractor requires the -qF (fixed-string) form: switching a guard back
// to regex or bare-token grep changes the shape, reds the count pin below, and
// forces a deliberate update here.
const guards = [...step.matchAll(/grep -qF "([^"]+)" ([^\s;]+)/g)].map((m) => ({
  pattern: m[1],
  file: m[2],
}));

// A partial hardcode revert: the load-bearing assignment replaced by a literal
// while the explanatory comment and the type-only declare keep the bare token
// in the file. Exactly the drift the original bare-token grep waved through.
const HARDCODE_REVERT = [
  '// build time through the __APP_VERSION__ define (vite.config.ts), so it can',
  'declare const __APP_VERSION__: string;',
  "export const DESKTOP_VERSION = '0.35.1';",
].join('\n');

// A dead vite arm: appVersion still computed, the define entry gone, the token
// surviving only in prose.
const DEFINE_REMOVED =
  '// __APP_VERSION__: JSON define removed; appVersion is computed but never baked';

// grep -qF semantics through the real operator when available (always true on
// CI's ubuntu runners, which is where the workflow itself runs grep). The
// fallback mirrors -qF exactly for these patterns: a fixed substring with no
// newline matches iff String.includes matches.
const grepAvailable = (() => {
  try {
    execFileSync('grep', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

function grepQF(pattern: string, input: string): boolean {
  expect(pattern).not.toContain('\n');
  if (!grepAvailable) return input.includes(pattern);
  try {
    execFileSync('grep', ['-qF', pattern], { input });
    return true;
  } catch (err) {
    // status 1 is grep's clean no-match; anything else is a real error.
    expect((err as { status?: number }).status).toBe(1);
    return false;
  }
}

describe('desktop-publish version lockstep guard', () => {
  it('carries exactly two fixed-string mechanism greps in the lockstep step', () => {
    expect(stepAt).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepAt);
    expect(guards).toHaveLength(2);
  });

  // Literal pins: weakening a pattern back to the bare token reds here first.
  it('anchors the module grep on the load-bearing assignment', () => {
    expect(guards[0]).toEqual({
      pattern: 'DESKTOP_VERSION = typeof __APP_VERSION__',
      file: 'src/game/desktop_download.ts',
    });
  });

  it('anchors the vite grep on the define entry itself', () => {
    expect(guards[1]).toEqual({
      pattern: '__APP_VERSION__: JSON.stringify(appVersion)',
      file: 'vite.config.ts',
    });
  });

  it('passes on the live tree: the module still reads the define', () => {
    expect(grepQF(guards[0].pattern, readFileSync(guards[0].file, 'utf8'))).toBe(true);
  });

  it('passes on the live tree: the build still bakes the define', () => {
    expect(grepQF(guards[1].pattern, readFileSync(guards[1].file, 'utf8'))).toBe(true);
  });

  it('rejects a hardcode revert that keeps the token in a comment and a declare', () => {
    // The fixture really carries the bare token the old vacuous grep matched...
    expect(grepQF('__APP_VERSION__', HARDCODE_REVERT)).toBe(true);
    // ...and the anchored pattern rejects it anyway.
    expect(grepQF(guards[0].pattern, HARDCODE_REVERT)).toBe(false);
  });

  it('rejects a define-line removal that keeps the token in prose', () => {
    expect(grepQF('__APP_VERSION__', DEFINE_REMOVED)).toBe(true);
    expect(grepQF(guards[1].pattern, DEFINE_REMOVED)).toBe(false);
  });
});
