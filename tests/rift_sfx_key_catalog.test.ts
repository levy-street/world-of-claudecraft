import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { tsFilesUnder } from './helpers/ts_files_under';

// src/sim/ cannot import the generated SfxId type (it lives in a client module
// the sim must never depend on, see src/sim/types.ts's `sfxKey?: string`
// comment), so nothing type-checks a `riftFx(...)` call's sfxKey literal
// against the real SFX manifest. This guard closes that gap the cheap way: it
// scrapes every riftFx(...) call site under src/sim/rift/ AND src/sim/dev_commands.ts
// (the dev `/rift_portal_spawn` command also calls riftFx directly, review
// finding, PR #2687 round 1 and round 2) for its sfxKey argument and asserts
// each one names a real, shipped SFX catalog key, so a typo'd or renamed key
// fails a test instead of silently playing nothing.

const RIFT_DIR = path.join(__dirname, '../src/sim/rift');
const SIM_DIR = path.join(__dirname, '../src/sim');
const EXTRA_SCAN_FILES = [path.join(__dirname, '../src/sim/dev_commands.ts')];

// riftFx(ctx, x, z, school, fx, sfxKey?, pid?): school and fx are drawn from
// small fixed vocabularies, so any OTHER quoted string literal inside a
// riftFx(...) call is the sfxKey argument.
const SCHOOL_AND_FX_LITERALS = new Set([
  'fire',
  'frost',
  'arcane',
  'shadow',
  'holy',
  'nature',
  'physical',
  'burst',
  'nova',
]);

// Extracts every `riftFx(...)` call's full argument text from `src`, matching
// parens with a running depth count rather than `/riftFx\(([^)]*)\)/`, so a
// call with a nested function call in its arguments (e.g. `riftFx(ctx, x, z,
// school, fx, pickKey())`) does not truncate at that inner call's closing
// paren and silently drop out of the scan.
function extractRiftFxCallArgs(src: string): string[] {
  const calls: string[] = [];
  const callRe = /riftFx\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(src))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    if (depth === 0) calls.push(src.slice(start, i - 1));
  }
  return calls;
}

function scannedFiles(): string[] {
  return tsFilesUnder(RIFT_DIR)
    .map((entry) => entry.full)
    .concat(EXTRA_SCAN_FILES);
}

// Every file under src/sim/ that actually calls riftFx. The scanned set above
// is hand-maintained (one directory plus a literal list), which is exactly how
// dev_commands.ts escaped it twice; this is the reverse sweep that fails when
// a call site lands somewhere the scan does not reach.
function filesCallingRiftFx(): string[] {
  return tsFilesUnder(SIM_DIR)
    .filter((entry) => /\briftFx\(/.test(readFileSync(entry.full, 'utf8')))
    .map((entry) => entry.full);
}

function extractRiftSfxKeyLiterals(): string[] {
  const keys = new Set<string>();
  for (const file of scannedFiles()) {
    const src = readFileSync(file, 'utf8');
    for (const args of extractRiftFxCallArgs(src)) {
      for (const str of args.matchAll(/'([^']*)'/g)) {
        const literal = str[1];
        if (!SCHOOL_AND_FX_LITERALS.has(literal)) keys.add(literal);
      }
    }
  }
  return [...keys];
}

describe('src/sim/rift riftFx sfxKey literals stay in sync with the real SFX manifest', () => {
  it('finds at least one sfxKey literal (the scan itself is not vacuous)', () => {
    expect(extractRiftSfxKeyLiterals().length).toBeGreaterThan(0);
  });

  it('every sfxKey literal passed to riftFx is a real SFX_FIXED_CATALOG_KEYS entry', () => {
    const catalog = new Set<string>(SFX_FIXED_CATALOG_KEYS as readonly string[]);
    for (const key of extractRiftSfxKeyLiterals()) {
      expect(catalog.has(key), `sfxKey '${key}' is not in SFX_FIXED_CATALOG_KEYS`).toBe(true);
    }
  });

  it('scans every src/sim file that calls riftFx, not just the rift directory', () => {
    // Without this the scanned set can silently stop covering a call site and
    // the guard above stays green over a smaller surface, which is how
    // dev_commands.ts escaped it twice.
    const scanned = new Set(scannedFiles());
    const missed = filesCallingRiftFx().filter((file) => !scanned.has(file));
    expect(missed, `riftFx call sites outside the scanned set: ${missed.join(', ')}`).toEqual([]);
  });

  it('picks up the dev_commands.ts call sites specifically', () => {
    // Pins the EXTRA_SCAN_FILES arm itself: dropping it leaves the union above
    // non-empty (the rift directory still yields keys), so only a per-file
    // assertion turns that revert red.
    const src = readFileSync(EXTRA_SCAN_FILES[0], 'utf8');
    const keys = new Set<string>();
    for (const args of extractRiftFxCallArgs(src)) {
      for (const str of args.matchAll(/'([^']*)'/g)) {
        if (!SCHOOL_AND_FX_LITERALS.has(str[1])) keys.add(str[1]);
      }
    }
    expect([...keys]).toEqual(['rift_portal_spawn']);
  });

  it('keeps a nested call in the arguments inside one extracted call', () => {
    // Pins the depth-counting matcher: the old /riftFx\(([^)]*)\)/ truncated at
    // the inner call's closing paren, dropping the sfxKey from the scan. No
    // live call site nests today, so only a synthetic source exercises it.
    const args = extractRiftFxCallArgs(
      "riftFx(ctx, at(p).x, at(p).z, 'frost', 'burst', 'rift_ice_stop');",
    );
    expect(args).toHaveLength(1);
    expect(args[0]).toContain("'rift_ice_stop'");
  });
});
