import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Biome cannot parse Svelte, so biome.json excludes `**/*.svelte` and the pre-push /
// CI floor never sees them. svelte-check covers types but not typography. That leaves
// the banned em/en dashes and emojis (root CLAUDE.md: "anywhere") caught in .svelte
// only by the local Stop hook (.claude/hooks/qa-stop.sh), which scans the working-tree
// diff and so misses anything authored outside that hook (another editor, a rebase, a
// bypassed turn). This guard makes the same rule a CI-enforced invariant for .svelte.
//
// Character classes mirror qa-stop.sh exactly: en/em/horizontal-bar dashes (U+2013,
// U+2014, U+2015) and the emoji ranges, written as escapes so this file holds no
// banned glyph itself. Scope is .svelte ONLY on purpose: a repo-wide sweep would
// red-fail on pre-existing em dashes in server/ player text, an out-of-scope cleanup.
const DASHES = /[\u2013\u2014\u2015]/;
// FE0F (variation selector) is split into its own alternation branch: biome's
// noMisleadingCharacterClass rejects a combining char sharing a class with base ranges.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}]|\u{FE0F}/u;

function svelteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...svelteFiles(full));
    else if (entry.name.endsWith('.svelte')) out.push(full);
  }
  return out;
}

describe('svelte typography', () => {
  const files = svelteFiles('src');

  it('finds .svelte files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('has no em/en dashes or emojis in any .svelte file', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (DASHES.test(line)) offenders.push(`${file}:${i + 1} [em or en dash]: ${line.trim()}`);
        if (EMOJI.test(line)) offenders.push(`${file}:${i + 1} [emoji]: ${line.trim()}`);
      });
    }
    expect(offenders, `\n${offenders.join('\n')}\n`).toEqual([]);
  });
});
