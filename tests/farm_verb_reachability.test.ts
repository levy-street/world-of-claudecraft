import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The pin that would have caught the Phase 9 (bn) gap: a farming verb the
// worlds and the wire all carry is still unreachable by an ordinary player
// until some CLIENT control calls it. The scan covers src/game and src/ui
// only: the definitions (src/net, src/world_api) and the sim never count as
// reachability. It fails toward MISSING (zero call sites is red) and lists
// what it found so a deletion names its survivors. One describe per verb;
// a new client-reachable farming verb lands with its own describe here.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOTS = ['src/game', 'src/ui'] as const;

function clientCallSites(verb: string): string[] {
  const needle = `.${verb}(`;
  const found: string[] = [];
  for (const root of SCAN_ROOTS) {
    const dir = join(repoRoot, root);
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const file = join(entry.parentPath, entry.name);
      const hasCall = readFileSync(file, 'utf8')
        .split('\n')
        .some((line) => {
          const lead = line.trimStart();
          // A comment mentioning the verb is not reachability.
          if (lead.startsWith('//') || lead.startsWith('*') || lead.startsWith('/*')) return false;
          return line.includes(needle);
        });
      if (hasCall) found.push(relative(repoRoot, file));
    }
  }
  return found.sort();
}

describe('harvestCrop client reachability', () => {
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('harvestCrop');
    expect(
      sites.length,
      `expected a client call site of .harvestCrop( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('openPlantSheet client reachability', () => {
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('openPlantSheet');
    expect(
      sites.length,
      `expected a client call site of .openPlantSheet( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe('plantCrop client reachability', () => {
  it('has at least one call site under src/game or src/ui', () => {
    const sites = clientCallSites('plantCrop');
    expect(
      sites.length,
      `expected a client call site of .plantCrop( under ${SCAN_ROOTS.join(' or ')}; found: [${sites.join(', ')}]`,
    ).toBeGreaterThanOrEqual(1);
  });
});
