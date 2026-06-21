import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Enforces the two load-bearing src/sim invariants from the root CLAUDE.md as a
// real, always-on check instead of convention-only prose: the sim is the
// host-agnostic deterministic core, so it imports nothing from render/ui/game/net
// or Three.js, touches no DOM/browser globals, and draws no randomness or time
// from outside its seeded Rng + sim clock. A violation here means the same
// src/sim code can no longer run unchanged in Node, the browser, and the RL env,
// or that same-seed-same-world determinism is broken. Keep this green.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const simRoot = join(repoRoot, 'src', 'sim');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// Blank out comments while preserving line count and column positions, so prose
// (a code comment that names Math.random, or "the search window") cannot create a
// false positive. String literals are left intact: the dotted patterns matched
// below (Math.random, window., ...) do not appear inside the sim's player text.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A specifier a host-agnostic sim file must never import. Returns the offending
// layer/package, or null when the import is allowed.
function forbiddenImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(render|ui|game|net)\//);
  return layer ? layer[1] : null;
}

const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const DYN_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DOM_GLOBAL_RE = /\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/;
const NONDETERMINISM_RE = /\b(Math\.random|Date\.now|performance\.now)\b/;

const simFiles = walk(simRoot);

function scanLines(re: RegExp): string[] {
  const violations: string[] = [];
  for (const file of simFiles) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) violations.push(`${relative(repoRoot, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  return violations;
}

describe('src/sim architecture invariants', () => {
  it('finds the sim source tree', () => {
    expect(simFiles.length).toBeGreaterThan(10);
  });

  it('imports nothing from render/ui/game/net or three (host-agnostic core)', () => {
    const violations: string[] = [];
    for (const file of simFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const specs: string[] = [];
      for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1]);
      for (const m of src.matchAll(DYN_IMPORT_RE)) specs.push(m[1]);
      for (const spec of specs) {
        const bad = forbiddenImport(spec);
        if (bad) violations.push(`${relative(repoRoot, file)} imports '${spec}' (${bad})`);
      }
    }
    expect(violations, `src/sim must stay host-agnostic:\n${violations.join('\n')}`).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(DOM_GLOBAL_RE);
    expect(violations, `src/sim must run headless (no DOM globals):\n${violations.join('\n')}`).toEqual([]);
  });

  it('draws no randomness or wall-clock time outside Rng + the sim clock', () => {
    const violations = scanLines(NONDETERMINISM_RE);
    expect(
      violations,
      `all sim randomness/time goes through Rng (src/sim/rng.ts) and the sim clock:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
