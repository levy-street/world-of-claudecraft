// The repo's gates compare bytes read straight off disk: goldenMaster
// (tests/server/helpers/golden.ts) diffs fixture text against freshly
// serialized LF output, the control-byte guard in tests/architecture.test.ts
// bans a raw CR in shipping source, and the media manifest hashes asset bytes.
// A CRLF-smudged checkout (core.autocrlf=true, the Git for Windows installer
// default) therefore failed hundreds of tests at once with no hint of the
// cause. The `* text=auto eol=lf` .gitattributes rule pins working trees to LF
// on every platform; this suite welds that rule in place and turns a smudged
// checkout into ONE failure that names the remediation.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..');

const REMEDIATION =
  'this checkout has CRLF line endings; delete the affected files and re-check ' +
  'them out (commit or stash uncommitted work first): ' +
  'git ls-files -z | xargs -0 rm -f -- ; git checkout -- .';

/** Every file under dir, recursively; fixtures live in nested subdirectories. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

describe('LF working-tree policy', () => {
  it('pins * text=auto eol=lf in .gitattributes', () => {
    const lines = readFileSync(path.join(root, '.gitattributes'), 'utf8').split('\n');
    const rule = lines.find((l) => /^\*\s+text=auto\s+eol=lf\s*$/.test(l));
    expect(rule, 'the repo-wide LF rule is load-bearing for the golden-master gates').toBeDefined();
  });

  it('golden-master fixtures carry no CR byte on disk', () => {
    const fixtures = walk(path.join(root, 'tests/server/fixtures')).filter((f) =>
      f.endsWith('.json'),
    );
    // Vacuity floor near the real count (93 at pinning time): an empty or
    // near-empty walk means the suite is scanning the wrong place, not that
    // the tree went clean.
    expect(fixtures.length).toBeGreaterThan(80);
    const smudged = fixtures.filter((f) => readFileSync(f).includes(0x0d));
    expect(smudged, REMEDIATION).toEqual([]);
  });
});
