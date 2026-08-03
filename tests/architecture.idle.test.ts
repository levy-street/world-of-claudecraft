import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

// Enforces the two load-bearing idle/ invariants from idle/CLAUDE.md as a real,
// always-on check, mirroring tests/architecture.test.ts for src/sim. idle/ is a
// FOURTH host over the deterministic src/sim core (like headless/), so the same
// contract applies: it imports nothing from render/ui/game/net or Three.js,
// touches no DOM/browser globals, and draws no randomness or wall-clock time
// from outside the seeded Rng + the sim clock. A violation here means the idle
// host can no longer run unchanged in Node (it does today) and would byte-replay
// from a (seed, gameplay session) pair no longer, or that it reaches a host layer
// it has no business in. Keep this green.
//
// It is per scan a SIBLING of tests/architecture.test.ts: that file owns src/sim,
// src/world_api, server, and the src/ui / src/render module classification. This
// file owns idle/ only. The two never overlap, and a guard that scans idle/ for
// forbidden imports used to not exist (the GDD Part A.6 PROPOSAL), so idle
// purity rested on idle/CLAUDE.md prose alone: a new idle module that imported
// three or called Math.random would have landed with the suite green.
//
// The scan walks idle/ with the shared walker (helpers/ts_files_under.ts), never
// its own directory read: idle/ is flat today, but the day a subdirectory grows
// under it a single-level read would leave the children out of the scan while the
// guard stayed green (the #2485 family the shared walker exists to stop). The
// self-audit below pins the walker import + the no-own-read rule structurally.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const idleRoot = path.join(repoRoot, 'idle');

// Blank out comments while preserving line count and column positions, so prose
// (a code comment that names Math.random) cannot create a false positive. Mirrors
// the stripComments in tests/architecture.test.ts.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A specifier a host-agnostic idle/ file must never import. Returns the offending
// layer/package, or null when the import is allowed (src/sim, node: stdlib, and
// sibling ./  idle/ modules all pass). Mirrors forbiddenImport in architecture.
function forbiddenIdleImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(render|ui|game|net)\//);
  return layer ? layer[1] : null;
}

const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const DYN_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DOM_GLOBAL_RE = /\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/;
const NONDETERMINISM_RE = /\b(Math\.random|Date\.now|performance\.now)\b/;

function importSpecs(src: string): string[] {
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1]);
  for (const m of src.matchAll(DYN_IMPORT_RE)) specs.push(m[1]);
  return specs;
}

function scanImports(
  files: { full: string; file: string }[],
  forbid: (spec: string) => string | null,
): string[] {
  const violations: string[] = [];
  for (const { full, file } of files) {
    const src = stripComments(readFileSync(full, 'utf8'));
    for (const spec of importSpecs(src)) {
      const bad = forbid(spec);
      if (bad) violations.push(`${file} imports '${spec}' (${bad})`);
    }
  }
  return violations;
}

function scanLines(files: { full: string; file: string }[], re: RegExp): string[] {
  const violations: string[] = [];
  for (const { full, file } of files) {
    const lines = stripComments(readFileSync(full, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) violations.push(`${file}:${i + 1}  ${line.trim()}`);
    });
  }
  return violations;
}

const idleFiles = tsFilesUnder(idleRoot);

// cli.ts is the IO/host WRAPPER (the headless/ analogue's caller-timing half),
// not a deterministic policy module. It reads Date.now() exactly twice: once to
// stamp a start time, once to print the wall-clock-elapsed shutdown line. Neither
// feeds a sim decision (the sim clock provides step deltas; the CLI hardcodes the
// 1000ms setInterval cadence). The deterministic CORE (engine + every policy leaf)
// must never touch wall-clock, so the nondeterminism scan runs over idle/ MINUS
// cli.ts. The forbidden-import and DOM scans still cover ALL of idle/, cli.ts
// included: cli.ts may print, but it still imports no host layer and touches no DOM.
const idleDetCore = idleFiles.filter((f) => f.file !== 'cli.ts');

describe('idle/ host invariants (mirrors tests/architecture.test.ts for src/sim)', () => {
  expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);

  // Anti-vacuity: the walk really reached the idle/ tree. A walk over a moved
  // root, or a filter that matched nothing, would make every scan below pass
  // over an empty set. Pin the floor near the real count (11 host modules today)
  // and name ONE module the walk must contain, so an accidental empty list fails.
  it('walks a real, non-empty slice of idle/ (anti-vacuity)', () => {
    expect(idleFiles.length).toBeGreaterThan(10);
    expect(idleFiles.map((f) => f.file)).toContain('engine.ts');
  });

  it('imports nothing from render/ui/game/net or three (host-agnostic, like src/sim)', () => {
    const violations = scanImports(idleFiles, forbiddenIdleImport);
    expect(
      violations,
      `idle/ must stay host-agnostic (src/sim + stdlib only):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(idleFiles, DOM_GLOBAL_RE);
    expect(
      violations,
      `idle/ must run headless (no DOM globals; the browser dashboard owns those):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('draws no randomness or wall-clock time outside Rng + the sim clock', () => {
    const violations = scanLines(idleDetCore, NONDETERMINISM_RE);
    expect(
      violations,
      `idle policy/engine must stay deterministic (seeded Rng + sim clock only):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  // cli.ts is exempt from the nondeterminism scan ABOVE because it owns the
  // wall-clock display (the shutdown elapsed-time log), which is IO, not a sim
  // decision. That exemption is owned here, not granted silently: a NEW wall-clock
  // or RNG use in cli.ts (one that fed a sim decision) would slip the core scan
  // above and pass nothing. This pin counts cli.ts's known Date.now() sites so
  // a third one re-reddens instead. It is `>=` rather than `===` so a deliberate
  // extra display clock is a line-update, but a decision-feeding clock that grew
  // the count would still trip the next check below: cli.ts must never call
  // Math.random, and Date.now/performance.now are display-only.
  it('cli.ts uses Date.now() only for the wall-clock display, never an RNG', () => {
    const cliSrc = stripComments(readFileSync(path.join(idleRoot, 'cli.ts'), 'utf8'));
    const dateNowCount = cliSrc.match(/\bDate\.now\b/g)?.length ?? 0;
    const perfNowCount = cliSrc.match(/\bperformance\.now\b/g)?.length ?? 0;
    const rngCount = cliSrc.match(/\bMath\.random\b/g)?.length ?? 0;
    expect(
      dateNowCount,
      'cli.ts dates: the known Date.now() sites (start time + shutdown elapsed). Add a deliberate display clock by updating this floor; a decision-feeding clock is a bug.',
    ).toBeGreaterThanOrEqual(2);
    expect(perfNowCount, 'cli.ts does not use performance.now()').toBe(0);
    expect(
      rngCount,
      'cli.ts must never call Math.random (no host RNG; the Sim owns randomness)',
    ).toBe(0);
  });

  // Teeth check (the standing self-test pattern the architecture suite uses for
  // its own matchers): the scans above only prove idle/ is CLEAN today. This pins
  // forbiddenIdleImport + the two regexes themselves so a future weakening (a
  // regex typo, a dropped branch) cannot silently let an idle module import a
  // forbidden layer or call Math.random and stay green.
  it('forbiddenIdleImport flags every forbidden layer and allows the permitted ones', () => {
    // three (the renderer dependency), bare and submodule.
    expect(forbiddenIdleImport('three')).toBe('three');
    expect(forbiddenIdleImport('three/examples/jsm/controls/OrbitControls')).toBe('three');
    // render / ui / game / net, however the relative path reaches them.
    expect(forbiddenIdleImport('../render/renderer')).toBe('render');
    expect(forbiddenIdleImport('../../render/characters/assets')).toBe('render');
    expect(forbiddenIdleImport('../ui/i18n')).toBe('ui');
    expect(forbiddenIdleImport('../game/audio')).toBe('game');
    expect(forbiddenIdleImport('../net/client_world')).toBe('net');
    // Permitted: host-agnostic src/sim, node stdlib, and sibling idle/ modules.
    expect(forbiddenIdleImport('../src/sim/types')).toBeNull();
    expect(forbiddenIdleImport('../src/sim/obs')).toBeNull();
    expect(forbiddenIdleImport('node:fs')).toBeNull();
    expect(forbiddenIdleImport('node:path')).toBeNull();
    expect(forbiddenIdleImport('./movement')).toBeNull();
  });

  it('NONDETERMINISM_RE + DOM_GLOBAL_RE keep their teeth', () => {
    for (const positive of ['Math.random()', 'Date.now()', 'performance.now()']) {
      expect(NONDETERMINISM_RE.test(positive), positive).toBe(true);
    }
    for (const negative of [
      'Math.round(x)',
      'Date.parse(s)',
      'performance.measure(a)',
      'rng.next()',
    ]) {
      expect(NONDETERMINISM_RE.test(negative), negative).toBe(false);
    }
    for (const positive of [
      'document.body.append(x)',
      'window.location.href',
      'navigator.userAgent',
      "localStorage['k']",
      'sessionStorage.setItem(a, b)',
    ]) {
      expect(DOM_GLOBAL_RE.test(positive), positive).toBe(true);
    }
    for (const negative of [
      'const windowless = computeViewport();',
      'this.documentTitle = t;',
      'const navigatorState = 1;',
    ]) {
      expect(DOM_GLOBAL_RE.test(negative), negative).toBe(false);
    }
  });

  // The two ways this guard can rot back to green-over-nothing, neither of them
  // covered by the matcher teeth above: a.) a floor left at a stale count shrunk
  // by a real idle/ trim, and b.) the walk silently dropping to empty if the
  // shared walker regressed. The anti-vacuity floor above pins (a) loosely; this
  // contract pin pairs it with a matched exact-count so a HALF-removed idle/
  // (some files gone, the floor still under the remainder) re-reddens rather than
  // slipping. Exact is intentional: idle/ is author-owned, so a deliberate trim
  // updates both the tree and this line knowingly.
  it('reports the idle/ file set it scans (coverage contract pin)', () => {
    expect(idleFiles.map((f) => f.file).sort()).toEqual(
      [
        'anti_stuck.ts',
        'auto_combat.ts',
        'auto_quest.ts',
        'cli.ts',
        'difficulty.ts',
        'engine.ts',
        'index.ts',
        'movement.ts',
        'progression_target.ts',
        'storage.ts',
        'threat_map.ts',
      ].sort(),
    );
  });
});
