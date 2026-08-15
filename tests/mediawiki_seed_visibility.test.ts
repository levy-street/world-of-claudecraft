// The MediaWiki seed publishes one page per player-visible ability, so a renamed
// or retired ability must not leave a stale or orphaned wiki page behind.
//
// This checks the GENERATOR against the current content, not the committed
// mediawiki/seed/pages.xml. That file is a first-boot deploy artifact the release
// regenerates when it ships, and its committed copy trails the content by tens of
// thousands of lines at any given moment, so demanding a fresh copy in every
// content PR would drag that whole unrelated diff along. Rebuilding into a temp
// dir keeps the real invariant: what the generator emits for TODAY's abilities is
// exactly the visible set, with no duplicates and no dangling links.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';

let xml = '';
let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'woc-seed-'));
  const out = path.join(workDir, 'pages.xml');
  execFileSync(process.execPath, [resolve('scripts/mediawiki/build_seed.mjs')], {
    env: { ...process.env, MEDIAWIKI_SEED_OUT: out },
    stdio: 'pipe',
  });
  xml = readFileSync(out, 'utf8');
}, 120_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('MediaWiki ability visibility', () => {
  it('publishes exactly the player-visible abilities', () => {
    const actualTitles = [...xml.matchAll(/<title>([^<]+ \(Ability\)(?: \(\d+\))?)<\/title>/g)]
      .map((match) => match[1])
      .sort();
    const titleCounts = new Map<string, number>();
    const expectedTitles = Object.values(ABILITIES)
      .filter((ability) => ability.hiddenFromPlayer !== true)
      .map((ability) => {
        const base = `${ability.name} (Ability)`.replace(
          /[&<>"']/g,
          (char) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char] ??
            char,
        );
        const count = (titleCounts.get(base) ?? 0) + 1;
        titleCounts.set(base, count);
        return count === 1 ? base : `${base} (${count})`;
      })
      .sort();

    expect(actualTitles).toEqual(expectedTitles);
    expect(xml).not.toContain('<title>Sacred Goad (Ability) (2)</title>');
    expect(xml).not.toContain('[[undefined]]');
  });

  it('publishes the reworked Retribution defensive under its current name only', () => {
    expect(xml).toContain('<title>Debt of Light (Ability)</title>');
    expect(xml).not.toContain('Faithforged Guard (Ability)');
  });
});
