// The re-mint registry's completeness guard.
//
// `scripts/assets/remint_lockfile_fingerprints.mjs` is the tool that re-stamps
// every shipping GLB after a lockfile leaf rename (package-lock.json ->
// pnpm-lock.yaml was the case that minted it). Every fingerprinted family hashes
// the lockfile among its inputs, so a rename moves EVERY family's fingerprint at
// once, and a family the registry does not enumerate keeps the old 64-hex stamp
// inside its shipped GLB with no diff and no failing test to say so. The
// registry's own ASSETS list is hand-written apart from Fenbridge (which derives
// its rows from the contracts), and nothing pinned that the hand list covers the
// families that exist.
//
// This guard is that pin. It walks scripts/assets for the fingerprint families
// that actually exist and requires each to be wired into the registry, so a
// family authored later fails here on the day it ships instead of at the next
// lockfile rename.
//
// ONE FAMILY IS OUT TODAY, and it carries a CHECKED premise rather than a bare
// name, so an exemption cannot outlive its reason: ignivar_herald ships a GLB
// with no sourceFingerprint extras at all, so the registry would throw on it.
// farm_props was the second row until 2026-08-31: it was a REAL OPEN GAP,
// stamped and lockfile-derived but unregistered and re-stamped only through its
// own exporter. Registering it (sixteen rows derived from FARM_PROP_CONTRACTS)
// reddened the omission arm here, which is exactly the pairing this guard was
// built to force, and its row is gone rather than rewritten.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';
import { stripComments } from './helpers/strip_comments';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS_ROOT = path.join(ROOT, 'scripts', 'assets');
const REGISTRY = path.join(ASSETS_ROOT, 'remint_lockfile_fingerprints.mjs');
const LEAF = 'source_fingerprint.mjs';

/** Every directory under scripts/assets that owns a source_fingerprint.mjs. */
function fingerprintFamilies(): string[] {
  const families = new Set<string>();
  for (const found of sourceFilesUnder(ASSETS_ROOT)) {
    const segments = found.file.split('/');
    if (segments.length !== 2) continue;
    if (segments[1] !== LEAF) continue;
    families.add(segments[0]);
  }
  return [...families].sort();
}

/**
 * The families the registry actually wires in, read off its import statements
 * with comments stripped first: a commented-out import (or a family named only
 * in the header prose) must not count as enumerated.
 */
function registeredFamilies(): string[] {
  const code = stripComments(readFileSync(REGISTRY, 'utf8'));
  const found = new Set<string>();
  for (const match of code.matchAll(/from\s+'\.\/([A-Za-z0-9_]+)\/source_fingerprint\.mjs'/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

/** Whether a shipped GLB carries a 64-hex sourceFingerprint the tool can re-stamp. */
function carriesSourceFingerprint(relative: string): boolean {
  const text = readFileSync(path.join(ROOT, relative), 'latin1');
  return /"sourceFingerprint"\s*:\s*"[0-9a-f]{64}"/.test(text);
}

// Each row states WHY the family is not in the registry, and the test below
// checks that reason against the tree rather than taking it on trust.
const EXEMPT = {
  ignivar_herald: 'public/models/creatures/ignivar_herald.glb',
} as const;

describe('remint registry completeness', () => {
  it('reads scripts/assets only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });

  it('finds every fingerprint family, and finds them a level down', () => {
    const families = fingerprintFamilies();
    // A single-level read of scripts/assets finds NO source_fingerprint.mjs at
    // all (every leaf lives one directory down), so a non-empty result is
    // itself proof the walk recursed. The floor sits at the shipped count so a
    // family that moves or disappears cannot shrink the corpus silently.
    expect(families.length, `families found: ${families.join(', ')}`).toBeGreaterThanOrEqual(9);
    expect(families).toContain('eastbrook_town');
    expect(families).toContain('fenbridge_town');
    expect(families).toContain('farm_props');
    // The leaf really is a directory down, never a file sitting in the root.
    for (const family of families) {
      expect(
        sourceFilesUnder(ASSETS_ROOT).some((f) => f.file === `${family}/${LEAF}`),
        `${family}/${LEAF}`,
      ).toBe(true);
    }
  });

  it('the registry enumerates every fingerprint family that is not exempt', () => {
    const registered = new Set(registeredFamilies());
    const omitted = fingerprintFamilies().filter(
      (family) => !registered.has(family) && !(family in EXEMPT),
    );
    // The omission list is asserted FIRST so a dropped family reports itself by
    // name; the vacuity floor below would otherwise fire on the same edit and
    // say only that the count fell.
    expect(
      omitted,
      `these fingerprint families are missing from scripts/assets/remint_lockfile_fingerprints.mjs: ${omitted.join(', ')}`,
    ).toEqual([]);
    // Non-vacuity: the registry really does wire families in, so an empty parse
    // (a refactor to a different import spelling) cannot pass the arm above by
    // emptying the family side instead of the registry side. Held at the
    // shipped count, so a family dropped from BOTH sides still reds.
    expect(registered.size, 'families wired into the registry').toBe(8);
  });

  it('every family the registry imports still exists on disk', () => {
    const families = new Set(fingerprintFamilies());
    const dangling = registeredFamilies().filter((family) => !families.has(family));
    expect(dangling, `registry imports a family with no ${LEAF}`).toEqual([]);
  });

  it('each exempt family is still exempt for the reason recorded, and still unregistered', () => {
    const registered = new Set(registeredFamilies());
    for (const family of Object.keys(EXEMPT) as (keyof typeof EXEMPT)[]) {
      expect(
        registered.has(family),
        `${family} is registered now: delete its EXEMPT row in this file`,
      ).toBe(false);
    }
    // ignivar_herald: nothing to re-stamp. The registry THROWS on a GLB with no
    // sourceFingerprint extras, so this family is out by construction; the day
    // its export starts stamping one, this arm reds and it must be registered.
    expect(
      carriesSourceFingerprint(EXEMPT.ignivar_herald),
      'ignivar_herald ships an unstamped GLB',
    ).toBe(false);
  });
});
