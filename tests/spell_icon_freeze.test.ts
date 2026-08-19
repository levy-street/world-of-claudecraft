// Spell icon freeze: every live class ability icon is pinned byte-for-byte.
//
// Ability icons carry piloting muscle memory: players recognize spells on the
// bar by color blob and silhouette in peripheral vision, in PvE rotations and
// PvP alike, so changing one mid-life degrades every existing player until
// they relearn it. Owner ruling (2026-08-19, after the v0.39 repaint was
// walked back): ZERO visual change to a live class ability icon, ever, without
// a deliberate maintainer re-mint. See docs/design/spell-icon-freeze.md.
//
// The pin covers the rendered bytes (public/ui/skills/<class>/*.webp). The
// per-class mapping.json manifests are metadata and stay unpinned: a license
// or provenance edit is not a visual change. The pet/ directory is command art
// for pets, explicitly outside the freeze by the same ruling.
//
// Re-mint (maintainer decision, never a side effect of an art pass):
//   UPDATE_SPELL_ICON_FREEZE=1 npx vitest run tests/spell_icon_freeze.test.ts
// which rewrites tests/fixtures/spell_icon_freeze.sha256.json; the diff of
// that fixture is the reviewable record of exactly which icons changed.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(repoRoot, 'public/ui/skills');
const manifestPath = path.join(repoRoot, 'tests/fixtures/spell_icon_freeze.sha256.json');

// The frozen surface, spelled out rather than derived: a new class directory
// must be added HERE (and its icons minted into the manifest) deliberately.
const FROZEN_CLASS_DIRS = [
  'druid',
  'hunter',
  'mage',
  'paladin',
  'priest',
  'rogue',
  'shaman',
  'warlock',
  'warrior',
] as const;

// Directories under public/ui/skills that are deliberately OUTSIDE the freeze.
const EXEMPT_DIRS = new Set(['pet']);

// Vacuity floor near the real count (471 at minting time): a manifest that
// quietly shrank below this is a scan that stopped seeing icons, not a game
// that lost a third of its buttons.
const MINIMUM_PINNED_ICONS = 400;

function liveIconHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const cls of FROZEN_CLASS_DIRS) {
    const dir = path.join(skillsDir, cls);
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.webp')) continue;
      const bytes = readFileSync(path.join(dir, name));
      hashes[`${cls}/${name}`] = createHash('sha256').update(bytes).digest('hex');
    }
  }
  return hashes;
}

describe('spell icon freeze', () => {
  it('covers every class directory under public/ui/skills', () => {
    // Refuse rather than filter: a directory this test does not know about is
    // either a new class (add it to FROZEN_CLASS_DIRS and mint its pins) or a
    // new exempt asset family (add it to EXEMPT_DIRS with the ruling that
    // exempts it). Silence would let a whole class escape the freeze.
    const onDisk = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const known = [...FROZEN_CLASS_DIRS, ...EXEMPT_DIRS].sort();
    expect(onDisk).toEqual(known);
  });

  it('pins every live class ability icon byte-for-byte', () => {
    const live = liveIconHashes();

    if (process.env.UPDATE_SPELL_ICON_FREEZE === '1') {
      writeFileSync(manifestPath, `${JSON.stringify(live, null, 2)}\n`);
    }

    expect(existsSync(manifestPath)).toBe(true);
    const pinned = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;

    const changed = Object.keys(live).filter(
      (key) => pinned[key] !== undefined && pinned[key] !== live[key],
    );
    const unpinned = Object.keys(live).filter((key) => pinned[key] === undefined);
    const missing = Object.keys(pinned).filter((key) => live[key] === undefined);

    expect(
      changed,
      'Live class ability icons are FROZEN: players pilot by these pixels. ' +
        'If this change is a deliberate maintainer decision, re-mint with ' +
        'UPDATE_SPELL_ICON_FREEZE=1 and put the ruling in the PR body. ' +
        'Otherwise restore the original bytes. See docs/design/spell-icon-freeze.md.',
    ).toEqual([]);
    expect(unpinned, 'new ability icons must be minted into the freeze manifest').toEqual([]);
    expect(missing, 'pinned icons must not be deleted or renamed silently').toEqual([]);

    // Vacuity floor: the walk really saw the roster.
    expect(Object.keys(pinned).length).toBeGreaterThanOrEqual(MINIMUM_PINNED_ICONS);
  });
});
