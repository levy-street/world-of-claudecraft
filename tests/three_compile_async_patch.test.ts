import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

describe('three compileAsync disposal race patch', () => {
  it('keeps the installed three r165 currentProgram guard applied', () => {
    // Install-integrity trap: compileAsync polls after a churned material can
    // lose its renderer properties. A three upgrade must re-evaluate the race.
    //
    // Scope: patches/three@0.165.0.patch covers build/three.module.js ONLY.
    // build/three.cjs and build/three.module.min.js still carry the race. The
    // bundle-scope guard below proves nothing outside node_modules consumes
    // either one: no CommonJS require('three') (which would resolve the
    // package's "require" export condition to three.cjs) and no import naming
    // either bundle directly. three/src IS reachable today
    // (tests/shadow_pass_gate_three.test.ts deep-imports
    // three/src/renderers/webgl/WebGLBufferRenderer.js), but that module never
    // reaches WebGLRenderer, so the claim that holds is: every path that
    // reaches WebGLRenderer resolves to the patched three.module.js. This note
    // lives here instead of inside the .patch file because pnpm-lock.yaml pins
    // the patch file's content hash: editing the patch would invalidate that
    // pin and break pnpm install --frozen-lockfile.
    const source = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );

    // Plain includes + message keeps a failure legible: a toContain miss would
    // dump the whole 1.28 MB bundle into the reporter.
    expect(
      source.includes('if ( program === undefined || program.isReady() ) {'),
      'the three r165 compileAsync patch is not applied; re-run pnpm install',
    ).toBe(true);
    expect(
      source.includes('three r165 compileAsync disposal race'),
      'the three r165 compileAsync patch marker comment is missing; re-run pnpm install',
    ).toBe(true);
  });
});

// The scan half of the scope note above, so the note is enforced rather than
// trusted: the day a module consumes build/three.cjs (via a bare CommonJS
// require) or build/three.module.min.js (by naming it), this fails and names
// the file, with the .patch file untouched and its pnpm-lock content-hash pin
// intact.

/** Roots holding every module this repo runs, tests, or executes as a script. */
const SCAN_ROOTS = ['src', 'server', 'scripts', 'headless', 'electron', 'tests'];

/** node_modules is where the patched package itself lives, and dist is bundled
 *  output rather than a consumption decision made in this tree. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

const REQUIRE_REASON =
  'requires the bare three specifier, which resolves to the unpatched build/three.cjs';
const BUNDLE_REASON = 'names an unpatched three bundle directly';

/** The two spellings that reach an UNPATCHED three bundle. Each needle is
 *  call-shaped or quote-anchored, so this guard's own regex literals (tests/
 *  is a scanned root) cannot match themselves: a regex literal's escapes keep
 *  its source text out of its own language, the same self-match reasoning as
 *  helpers/scan_guard_self_audit.ts. */
const UNPATCHED_CONSUMERS = [
  // A CommonJS require of the bare specifier resolves the package's "require"
  // export condition to build/three.cjs.
  { needle: /require\s*\(\s*['"]three['"]\s*\)/g, reason: REQUIRE_REASON },
  // Either unpatched bundle named directly, in any module syntax (static
  // import, dynamic import(), require, vi.mock): the specifier is always
  // quoted, so the needle anchors on the quotes.
  { needle: /['"]three\/build\/three\.(?:cjs|module\.min\.js)['"]/g, reason: BUNDLE_REASON },
] as const;

/** Strip block and line comments so prose about a require (the scope note
 *  above included) cannot flag. The line arm keeps a `://` in a URL from
 *  eating the rest of its line (#2499); same spelling as the
 *  shader_pow_domain guard's stripper. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface ThreeBundleScan {
  /** How many source files the walk visited, the vacuity pin for an all-clear. */
  filesScanned: number;
  /** One `file:line reason` row per consuming site, empty on a clean tree. */
  offenders: string[];
}

// The corpus is read through helpers/source_files_under.ts, never a walk of
// this guard's own: a consumer can land in any module extension (.ts here,
// .mjs in scripts/, .cjs in electron/), and the recursion is what keeps a file
// that moves down a level inside the scan (#2485, #2489). The mkdtemp fixture
// below drives THIS producer per tests/CLAUDE.md, and the self-audit pins that
// no second, hand-rolled read sits beside it.
function scanForUnpatchedBundleUse(roots: string[], base: string): ThreeBundleScan {
  let filesScanned = 0;
  const offenders: string[] = [];
  for (const root of roots) {
    for (const entry of sourceFilesUnder(join(base, root), { skipDirectories: SKIPPED_DIRS })) {
      filesScanned++;
      const raw = readFileSync(entry.full, 'utf8');
      if (!raw.includes('three')) continue;
      const source = withoutComments(raw);
      for (const { needle, reason } of UNPATCHED_CONSUMERS) {
        needle.lastIndex = 0;
        let match = needle.exec(source);
        while (match !== null) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${root}/${entry.file}:${line} ${reason}`);
          match = needle.exec(source);
        }
      }
    }
  }
  return { filesScanned, offenders };
}

describe('the unpatched three bundles stay unconsumed', () => {
  const scan = scanForUnpatchedBundleUse(SCAN_ROOTS, repoRoot);

  it('finds no bare require of three and no import of three.cjs or three.module.min.js', () => {
    expect(
      scan.offenders,
      'a module reaches a three bundle the compileAsync patch does not cover: extend ' +
        'patches/three@0.165.0.patch to that bundle (and update the scope note in this file) ' +
        'before consuming it',
    ).toEqual([]);
  });

  it('scanned a corpus near the real tree size, so the all-clear is not vacuous', () => {
    // The expected offender set is EMPTY, so a walk that silently collapsed (a
    // renamed root, a broken walker) is indistinguishable from a clean tree in
    // the assertion above. Per tests/CLAUDE.md the floor sits just under the
    // real count: the six roots hold over five thousand source files today,
    // and a floor parked far below that is what would let a whole root leave
    // the scan unnoticed.
    expect(scan.filesScanned).toBeGreaterThan(4500);
  });

  it('reads the tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });

  describe('the producer itself', () => {
    // tests/CLAUDE.md: pin the recursion with a mkdtemp fixture driving this
    // guard's OWN producer. The planted spellings are assembled at runtime (a
    // quote helper, split bundle names) so the real scan of THIS file, which
    // sits inside the tests/ root it scans, cannot match the plants.
    const fixture = mkdtempSync(join(tmpdir(), 'three-bundle-scope-'));
    afterAll(() => rmSync(fixture, { recursive: true, force: true }));

    const single = (text: string) => `'${text}'`;
    const double = (text: string) => `"${text}"`;
    const bareRequire = `require(${single('three')})`;
    const cjsBundle = single('three/build/' + 'three.cjs');
    const minBundle = double('three/build/' + 'three.module.min.js');

    mkdirSync(join(fixture, 'root', 'nested', 'deeper'), { recursive: true });
    mkdirSync(join(fixture, 'root', 'node_modules'), { recursive: true });
    mkdirSync(join(fixture, 'root', 'dist'), { recursive: true });
    // The sanctioned spelling: a bare ESM import resolves the "import"
    // condition to the PATCHED three.module.js, so it must not flag.
    writeFileSync(
      join(fixture, 'root', 'clean.ts'),
      `import * as THREE from ${single('three')};\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'spaced.cjs'),
      `const t = require( ${double('three')} );\n`,
    );
    // A URL ahead of the site: the comment stripper must not let its `//` eat
    // the require off the end of the line (#2499).
    writeFileSync(
      join(fixture, 'root', 'nested', 'cjs_require.ts'),
      `const url = ${single('https://x.dev/y')}; const three = ${bareRequire};\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'nested', 'cjs_bundle.js'),
      `const t = await import(${cjsBundle});\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'nested', 'deeper', 'min_import.mjs'),
      `import ${minBundle};\n`,
    );
    writeFileSync(
      join(fixture, 'root', 'nested', 'commented.ts'),
      `// prose about ${bareRequire} stays legal\nexport {};\n`,
    );
    writeFileSync(join(fixture, 'root', 'nested', 'notes.txt'), `${bareRequire}\n`);
    writeFileSync(
      join(fixture, 'root', 'node_modules', 'dep.js'),
      `module.exports = ${bareRequire};\n`,
    );
    writeFileSync(join(fixture, 'root', 'dist', 'bundle.js'), `module.exports = ${bareRequire};\n`);

    const found = scanForUnpatchedBundleUse(['root'], fixture);

    it('flags each planted consumer, at depth, across module extensions and quote styles', () => {
      expect([...found.offenders].sort()).toEqual([
        `root/nested/cjs_bundle.js:1 ${BUNDLE_REASON}`,
        `root/nested/cjs_require.ts:1 ${REQUIRE_REASON}`,
        `root/nested/deeper/min_import.mjs:1 ${BUNDLE_REASON}`,
        `root/spaced.cjs:1 ${REQUIRE_REASON}`,
      ]);
    });

    it('leaves the bare ESM import, prose, non-source files, node_modules and dist alone', () => {
      // Per-dimension negatives: each clean plant holds the exemption for
      // exactly its own case. The corpus count pins that the two skipped
      // DIRECTORIES never entered the walk while the six clean and planted
      // FILES all did (notes.txt is not a source extension).
      expect(found.offenders.some((row) => row.includes('clean.ts'))).toBe(false);
      expect(found.offenders.some((row) => row.includes('commented.ts'))).toBe(false);
      expect(found.filesScanned).toBe(6);
    });
  });
});
