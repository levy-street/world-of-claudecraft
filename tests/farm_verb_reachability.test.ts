// The go-live reachability guard for the bed verbs (Phase 9b). The Phase 9 QA
// verdict was exactly this hole: a sim-API-green IWorld verb with NO caller
// under the client surfaces is invisible to a player, and every suite stayed
// green while it was missing. So each bed verb pins at least one REAL call
// site under src/ui or src/game (the surfaces a player's input reaches),
// counted from the source tree itself rather than from any registry a
// refactor could leave stale.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = ['src/ui', 'src/game'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else if (path.endsWith('.ts')) {
      yield path;
    }
  }
}

/** Every client-surface file whose source calls `needle` as a member. */
function callSites(needle: string): string[] {
  const sites: string[] = [];
  for (const root of ROOTS) {
    for (const path of walk(root)) {
      if (readFileSync(path, 'utf8').includes(needle)) sites.push(path);
    }
  }
  return sites;
}

describe('farm verb reachability: plantCrop', () => {
  it('has at least one client call site under src/ui or src/game', () => {
    const sites = callSites('.plantCrop(');
    expect(sites.length).toBeGreaterThanOrEqual(1);
  });
});
