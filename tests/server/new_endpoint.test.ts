// Golden coverage for the endpoint scaffold generator (scripts/new_endpoint.mjs).
//
// Two layers:
//   1. Pure-builder units: descriptor parsing + rung derivation, import-specifier
//      computation (root == repo AND root != repo), and the append-only insertion
//      helpers on synthetic sources.
//   2. A golden end-to-end: seed a TEMP root with copies of every file the generator
//      appends to, spawn the CLI against it, then prove the emitted domain module +
//      test TYPE-CHECK (child tsc) and the emitted test PASSES (child vitest), that
//      every append is byte-level APPEND-ONLY (no existing line reordered or removed),
//      that all three auth rungs emit correctly, that the generator refuses to
//      overwrite and never writes outside --root (the real tree stays untouched).
//
// The temp roots live under the gitignored tmp/ so a crash cannot dirty the tree, and
// so the emitted *.test.ts matches the default vitest include glob when the child
// vitest runs it by absolute path. They are always removed in afterAll.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendApiErrorKey,
  appendCatalogLeaf,
  appendCodeToArray,
  appendErrorCode,
  CODE_PARITY_TEST_FILE,
  derivePlan,
  EXPECTED_CODES_CONST,
  importSpecifier,
  KNOWN_CODES_CONST,
  parseArgs,
  pathParams,
  REGISTRY_IMPORT_ANCHOR,
  REGISTRY_SPREAD_ANCHOR,
  registerInRegistry,
  renderModule,
  surfaceForPath,
  toCamel,
  toPascal,
  toUpperSnake,
  UsageError,
  // @ts-expect-error - untyped zero-dep build tool (no .d.ts), same convention as the other scripts/*.mjs-importing tests.
} from '../../scripts/new_endpoint.mjs';

// tests/server/new_endpoint.test.ts -> the repo root is two directories up.
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(REPO, 'scripts', 'new_endpoint.mjs');
const TSC = join(REPO, 'node_modules', '.bin', 'tsc');
const VITEST = join(REPO, 'node_modules', '.bin', 'vitest');

// Every file the generator appends to, seeded as a copy into each temp root.
const APPEND_TARGETS = [
  'server/http/error_codes.ts',
  'tests/server/http/error_codes.test.ts',
  'tests/api_error_code_parity.test.ts',
  'src/ui/api_error_i18n.ts',
  'src/ui/i18n.catalog/api_error.ts',
  'server/http/registry.ts',
];

const tempRoots: string[] = [];

/** Create a temp root under the gitignored tmp/ seeded with copies of the append targets. */
function seedRoot(): string {
  mkdirSync(join(REPO, 'tmp'), { recursive: true });
  const root = mkdtempSync(join(REPO, 'tmp', 'new-endpoint-golden-'));
  tempRoots.push(root);
  for (const rel of APPEND_TARGETS) {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
  mkdirSync(join(root, 'server'), { recursive: true });
  mkdirSync(join(root, 'tests', 'server'), { recursive: true });
  return root;
}

/** Run the generator CLI against a temp root, resolving specifiers against the real repo. */
function runGen(root: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--repo', REPO, ...args], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The real tree's `git status --porcelain`, for the untouched-tree assertion. */
function gitPorcelain(): string {
  return spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' }).stdout ?? '';
}

/**
 * Run the given emitted test files through a CHILD vitest. The emitted tests live under
 * tmp/, which vite.config excludes from a bare run; a written --config override with an
 * explicit include (and empty exclude) runs exactly these files anyway.
 */
function runChildVitest(root: string, testPaths: string[]): { status: number; out: string } {
  const config = join(root, 'vitest.golden.config.mjs');
  writeFileSync(
    config,
    `export default { test: { include: ${JSON.stringify(testPaths)}, exclude: [] } };\n`,
  );
  const result = spawnSync(VITEST, ['run', '--config', config], {
    cwd: REPO,
    encoding: 'utf8',
    // CI runners color the piped child output (ANSI then sits between "Tests" and the
    // count in the summary line, defeating the plain-text assertions below), so ask the
    // child for no color and strip whatever arrives anyway.
    env: { ...process.env, NO_COLOR: '1' },
  });
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
  const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(ansi, '');
  return { status: result.status ?? 1, out };
}

/**
 * Assert `updated` is `original` with lines only ADDED (append-only): every original
 * line survives in order, and the lines matched to the original reconstruct it
 * byte-for-byte. Returns the added lines for the caller to assert on.
 */
function assertAppendOnly(original: string, updated: string): string[] {
  const o = original.split('\n');
  const u = updated.split('\n');
  const matchedIdx: number[] = [];
  let oi = 0;
  for (let ui = 0; ui < u.length && oi < o.length; ui++) {
    if (u[ui] === o[oi]) {
      matchedIdx.push(ui);
      oi++;
    }
  }
  expect(oi, 'every original line must survive in order (nothing removed/reordered)').toBe(
    o.length,
  );
  const reconstructed = matchedIdx.map((i) => u[i]).join('\n');
  expect(reconstructed, 'the preserved lines must reconstruct the original byte-for-byte').toBe(
    original,
  );
  expect(u.length, 'the append must add at least one line').toBeGreaterThan(o.length);
  const matched = new Set(matchedIdx);
  return u.filter((_, i) => !matched.has(i));
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pure builders (units).
// ---------------------------------------------------------------------------

describe('descriptor parsing and rung derivation', () => {
  it('parses the documented CLI flags', () => {
    const raw = parseArgs(['--domain', 'widget', '--method', 'post', '--path', '/api/widgets']);
    expect(raw).toMatchObject({
      domain: 'widget',
      method: 'post',
      path: '/api/widgets',
      public: false,
    });
  });

  it('rejects an unknown flag and a missing value', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(UsageError);
    expect(() => parseArgs(['--domain'])).toThrow(UsageError);
  });

  it('derives the owner rung from a :param path (no --public)', () => {
    const plan = derivePlan({ domain: 'widget', method: 'GET', path: '/api/widgets/:id' }, REPO);
    expect(plan.authLevel).toBe('owner');
    expect(plan.paramName).toBe('id');
    expect(plan.hasParam).toBe(true);
    expect(plan.code).toBe('widget.not_found');
    expect(plan.surface).toBe('api');
  });

  it('derives the public rung from --public, keeping meta-worthy :param info', () => {
    const plan = derivePlan(
      { domain: 'widget', method: 'GET', path: '/api/widgets/:id', public: true },
      REPO,
    );
    expect(plan.authLevel).toBe('public');
    expect(plan.hasParam).toBe(true);
    expect(plan.code).toBe('widget.invalid_input');
  });

  it('derives the authenticated rung when there is no :param and no --public', () => {
    const plan = derivePlan({ domain: 'widget', method: 'POST', path: '/api/widgets' }, REPO);
    expect(plan.authLevel).toBe('authenticated');
    expect(plan.paramName).toBeNull();
    expect(plan.code).toBe('widget.invalid_input');
  });

  it('takes the LAST :param as the owned resource id', () => {
    expect(pathParams('/api/a/:x/b/:y')).toEqual(['x', 'y']);
    const plan = derivePlan({ domain: 'thing', method: 'DELETE', path: '/api/a/:x/b/:y' }, REPO);
    expect(plan.paramName).toBe('y');
  });

  it('maps a path prefix to its surface', () => {
    expect(surfaceForPath('/api/x')).toBe('api');
    expect(surfaceForPath('/admin/api/x')).toBe('admin');
    expect(surfaceForPath('/oauth/x')).toBe('oauth');
    expect(surfaceForPath('/internal/x')).toBe('internal');
  });

  it('rejects an invalid domain, method, or path', () => {
    expect(() => derivePlan({ domain: 'Bad-Slug', method: 'GET', path: '/api/x' }, REPO)).toThrow(
      UsageError,
    );
    expect(() => derivePlan({ domain: 'ok', method: 'FETCH', path: '/api/x' }, REPO)).toThrow(
      UsageError,
    );
    expect(() => derivePlan({ domain: 'ok', method: 'GET', path: 'api/x' }, REPO)).toThrow(
      UsageError,
    );
  });

  it('rejects a path with characters that could break out of the emitted string literal', () => {
    for (const path of ['/api/x";evil', '/api/x`t', '/api/x ${y}', '/api/x\\y', '/api/x\nz']) {
      expect(() => derivePlan({ domain: 'ok', method: 'GET', path }, REPO), path).toThrow(
        UsageError,
      );
    }
    // A legitimate :param path is accepted.
    expect(derivePlan({ domain: 'ok', method: 'GET', path: '/api/x/:id' }, REPO).paramName).toBe(
      'id',
    );
  });

  it('derives the name casings', () => {
    expect(toPascal('widget_thing')).toBe('WidgetThing');
    expect(toCamel('widget_thing')).toBe('widgetThing');
    expect(toUpperSnake('widget_thing')).toBe('WIDGET_THING');
  });
});

describe('import-specifier computation', () => {
  it('yields the natural specifier when the emitted file sits in the repo', () => {
    const from = join(REPO, 'server', 'widget.ts');
    expect(importSpecifier(from, join(REPO, 'server', 'http', 'types'))).toBe('./http/types');
    expect(importSpecifier(from, join(REPO, 'server', 'http_util'))).toBe('./http_util');
  });

  it('climbs out of a --root temp dir back to the real repo spine', () => {
    const from = join(REPO, 'tmp', 'golden-x', 'server', 'widget.ts');
    expect(importSpecifier(from, join(REPO, 'server', 'http', 'types'))).toBe(
      '../../../server/http/types',
    );
    const test = join(REPO, 'tmp', 'golden-x', 'tests', 'server', 'widget.test.ts');
    expect(importSpecifier(test, join(REPO, 'tests', 'server', 'helpers'))).toBe(
      '../../../../tests/server/helpers',
    );
  });

  it('renders the module under --root with a repo-relative spine import', () => {
    const plan = derivePlan(
      { domain: 'widget', method: 'GET', path: '/api/widgets/:id', root: join(REPO, 'tmp', 'z') },
      REPO,
    );
    // --repo defaults to --root when unset, so pass repo explicitly via derivePlan cwd:
    const scoped = derivePlan(
      {
        domain: 'widget',
        method: 'GET',
        path: '/api/widgets/:id',
        root: join(REPO, 'tmp', 'z'),
        repo: REPO,
      },
      REPO,
    );
    const module = renderModule(scoped);
    expect(module).toContain("from '../../../server/http/schema'");
    expect(module).toContain('meta: OWNED_META');
    expect(module).toContain("requireOwned: { kind: OWNED_RESOURCE, ownerScope: 'account' }");
    // The unused first plan proves derivePlan tolerates an absent --repo (defaults to root).
    expect(plan.repo).toBe(join(REPO, 'tmp', 'z'));
  });
});

describe('append-only insertion helpers (synthetic sources)', () => {
  it('appends an error code before the frozen-object tail', () => {
    const src = [
      'export const ERROR_CODES = deepFreeze({',
      "  'a.b': { params: [] },",
      '} as const);',
      '',
    ].join('\n');
    const out = appendErrorCode(src, 'x.y');
    expect(assertAppendOnly(src, out)).toEqual(["  'x.y': { params: [] },"]);
    expect(out.indexOf("'x.y'")).toBeLessThan(out.indexOf('} as const);'));
  });

  it('appends a code to a sorted literal snapshot array', () => {
    const src = [`${EXPECTED_CODES_CONST}`, "  'a.b',", '];', ''].join('\n');
    const out = appendCodeToArray(src, EXPECTED_CODES_CONST, 'x.y');
    expect(assertAppendOnly(src, out)).toEqual(["  'x.y',"]);
  });

  it('appends the identity API_ERROR_KEYS row', () => {
    const src = [
      'export const API_ERROR_KEYS = {',
      "  'a.b': 'apiError.a.b',",
      '} satisfies Record<string, TranslationKey>;',
      '',
    ].join('\n');
    const out = appendApiErrorKey(src, 'x.y');
    expect(assertAppendOnly(src, out)).toEqual(["  'x.y': 'apiError.x.y',"]);
  });

  it('appends a new catalog domain block, and refuses a pre-existing domain', () => {
    const src = [
      'export const apiErrorStrings = {',
      '  auth: {',
      "    required: 'Not authenticated.',",
      '  },',
      '};',
      '',
    ].join('\n');
    const out = appendCatalogLeaf(src, 'widget', 'not_found', 'That widget could not be found.');
    expect(assertAppendOnly(src, out)).toEqual([
      '  widget: {',
      "    not_found: 'That widget could not be found.',",
      '  },',
    ]);
    expect(() => appendCatalogLeaf(out, 'widget', 'other', 'x')).toThrow(UsageError);
  });

  it('registers a domain import + spread, each above its registry anchor', () => {
    const src = [
      "import { routes as walletRoutes } from '../wallet';",
      REGISTRY_IMPORT_ANCHOR,
      "import { createRouter } from './router';",
      '',
      'export const apiRoutes = [',
      '  ...walletRoutes,',
      REGISTRY_SPREAD_ANCHOR,
      '];',
      '',
    ].join('\n');
    const out = registerInRegistry(src, 'widget');
    const added = assertAppendOnly(src, out);
    expect(added).toContain("import { routes as widgetRoutes } from '../widget';");
    expect(added).toContain('  ...widgetRoutes,');
    // The import lands above the import anchor; the spread above the spread anchor.
    expect(out.indexOf('widgetRoutes } from')).toBeLessThan(out.indexOf(REGISTRY_IMPORT_ANCHOR));
    expect(out.indexOf('  ...widgetRoutes,')).toBeLessThan(out.indexOf(REGISTRY_SPREAD_ANCHOR));
  });

  it('appends exactly one KNOWN_CODES row to the REAL code-parity test source (append-only)', () => {
    // The golden child vitest cannot run tests/api_error_code_parity.test.ts in-temp (it pulls
    // the generated-locale i18n graph the temp root does not seed), so pin the parity-target
    // append against the real source directly: it lands EXACTLY ONE new row and, removing that
    // row, reconstructs the original byte-for-byte (the same append-only idiom).
    const src = readFileSync(join(REPO, CODE_PARITY_TEST_FILE), 'utf8');
    const out = appendCodeToArray(src, KNOWN_CODES_CONST, 'sample.pinned_row');
    expect(assertAppendOnly(src, out)).toEqual(["  'sample.pinned_row',"]);
  });

  it('throws UsageError when an append anchor or its closing marker is missing', () => {
    // insertBeforeLine path: the ERROR_CODES tail line is absent entirely.
    expect(() => appendErrorCode('const nope = 1;\n', 'x.y')).toThrow(UsageError);
    // insertBeforeMarkerAfter path: the section const is absent...
    expect(() => appendCodeToArray('const OTHER = [\n];\n', KNOWN_CODES_CONST, 'x.y')).toThrow(
      UsageError,
    );
    // ...and present but never closed by its '];' marker.
    expect(() => appendCodeToArray(`${KNOWN_CODES_CONST}\n`, KNOWN_CODES_CONST, 'x.y')).toThrow(
      UsageError,
    );
  });
});

// ---------------------------------------------------------------------------
// Golden end-to-end.
// ---------------------------------------------------------------------------

describe('golden: all three rungs emit, type-check, and pass (one temp root)', () => {
  it('scaffolds owner/authenticated/public with real guards, tsc + vitest green, append-only', async () => {
    const root = seedRoot();
    const originals = new Map(
      APPEND_TARGETS.map((rel) => [rel, readFileSync(join(root, rel), 'utf8')]),
    );
    const before = gitPorcelain();

    const owner = runGen(root, ['--domain', 'orb', '--method', 'GET', '--path', '/api/orbs/:id']);
    const auth = runGen(root, ['--domain', 'relay', '--method', 'POST', '--path', '/api/relays']);
    const pub = runGen(root, [
      '--domain',
      'beacon',
      '--method',
      'GET',
      '--path',
      '/api/beacons/:id',
      '--public',
    ]);
    for (const [name, gen] of [
      ['owner', owner],
      ['authenticated', auth],
      ['public', pub],
    ] as const) {
      expect(gen.status, `${name} generator failed: ${gen.stderr}`).toBe(0);
    }

    // Rung-specific content markers. The authenticated + owner rungs compose the SHARED
    // moderation-gated, scope-enforced guard (createReadGuard on a GET, createActiveGuard
    // on a mutating route), never a bespoke inline guard.
    const orbMod = readFileSync(join(root, 'server', 'orb.ts'), 'utf8');
    expect(orbMod, 'owner GET uses the shared read guard').toContain(
      'createReadGuard(() => orbDb)',
    );
    expect(orbMod).toContain("requireOwned: { kind: OWNED_RESOURCE, ownerScope: 'account' }");
    expect(orbMod).toContain('accountAndScopeForToken');
    const relayMod = readFileSync(join(root, 'server', 'relay.ts'), 'utf8');
    expect(relayMod, 'mutating route uses the shared active guard').toContain(
      'createActiveGuard(() => relayDb)',
    );
    expect(relayMod, 'a mutating route names the rate-limit recipe step').toContain(
      'rateLimit(RELAY_POLICY)',
    );
    expect(relayMod).toContain('withBody()');
    const beaconMod = readFileSync(join(root, 'server', 'beacon.ts'), 'utf8');
    expect(beaconMod).toContain('meta: { publicRead: true }');
    expect(beaconMod, 'a public read carries no bearer guard').not.toContain('createReadGuard');
    expect(beaconMod).not.toContain('createActiveGuard');
    expect(beaconMod).not.toContain('requireOwned');

    // Nothing written outside --root.
    expect(gitPorcelain(), 'the real tree must be untouched by a --root emission').toBe(before);

    // Every append target is byte-level append-only; the code file carries all three codes.
    for (const rel of APPEND_TARGETS) {
      const added = assertAppendOnly(
        originals.get(rel) as string,
        readFileSync(join(root, rel), 'utf8'),
      );
      expect(added.length, `${rel} gained lines`).toBeGreaterThan(0);
    }
    const codeAdded = assertAppendOnly(
      originals.get('server/http/error_codes.ts') as string,
      readFileSync(join(root, 'server/http/error_codes.ts'), 'utf8'),
    );
    expect(codeAdded).toContain("  'orb.not_found': { params: [] },");
    expect(codeAdded).toContain("  'relay.invalid_input': { params: [] },");
    expect(codeAdded).toContain("  'beacon.invalid_input': { params: [] },");

    // All six emitted files (module + test per rung) TYPE-CHECK in one tsconfig.
    const files = ['orb', 'relay', 'beacon'].flatMap((d) => [
      join(root, 'server', `${d}.ts`),
      join(root, 'tests', 'server', `${d}.test.ts`),
    ]);
    const tsconfig = join(root, 'tsconfig.golden.json');
    writeFileSync(
      tsconfig,
      JSON.stringify({
        extends: join(REPO, 'tsconfig.json'),
        compilerOptions: { noEmit: true },
        include: [],
        files,
      }),
    );
    const tsc = spawnSync(TSC, ['-p', tsconfig, '--noEmit'], { cwd: REPO, encoding: 'utf8' });
    expect(tsc.status, `tsc failed:\n${tsc.stdout}\n${tsc.stderr}`).toBe(0);

    // All three emitted tests PASS, plus the code-catalog snapshot stays green against the
    // appended ERROR_CODES (parity-green). One child vitest, via the --config override so
    // the vite.config tmp/** exclude does not hide the emitted tests.
    const testPaths = ['orb', 'relay', 'beacon'].map((d) =>
      join(root, 'tests', 'server', `${d}.test.ts`),
    );
    testPaths.push(join(root, 'tests', 'server', 'http', 'error_codes.test.ts'));
    const child = runChildVitest(root, testPaths);
    expect(child.status, `emitted tests / snapshot failed:\n${child.out}`).toBe(0);
    // Belt-and-braces over exit-code-only: the child summary must show real collected
    // tests passing (an emitted-but-empty suite cannot ride a zero exit).
    expect(child.out).toMatch(/Tests\s+\d+ passed/);
  }, 180_000);
});

describe('golden: negative paths', () => {
  it('refuses to overwrite an existing domain module (nonzero exit)', () => {
    const root = seedRoot();
    const first = runGen(root, ['--domain', 'dup', '--method', 'GET', '--path', '/api/dups']);
    expect(first.status).toBe(0);
    const second = runGen(root, ['--domain', 'dup', '--method', 'GET', '--path', '/api/dups']);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('refusing to overwrite');
  });

  it('refuses when an append target is missing (nonzero exit, nothing written)', () => {
    mkdirSync(join(REPO, 'tmp'), { recursive: true });
    const empty = mkdtempSync(join(REPO, 'tmp', 'new-endpoint-golden-'));
    tempRoots.push(empty);
    const gen = runGen(empty, [
      '--domain',
      'foo',
      '--method',
      'GET',
      '--path',
      '/api/foos',
      '--public',
    ]);
    expect(gen.status).not.toBe(0);
    expect(gen.stderr).toContain('append target is missing');
    // Nothing was created (the precondition check runs before any write).
    expect(existsSync(join(empty, 'server', 'foo.ts'))).toBe(false);
  });
});
