// THE CAPTURE-SEED MARKER GUARD (masterwrought D131,
// qr-19-capture-seed-without-marker).
//
// A capture or perf rig that seeds `woc_settings.graphicsPreset` and stops
// there is advisory, not authoritative: `src/main.ts` runs
// `firstRunGraphicsPreset` on boot, and with `graphicsDefaultApplied` absent
// the device probe is free to classify the machine and PERSIST its own tier
// over the seed (src/game/settings.ts declares the marker with `def: false`,
// and src/render/gfx.ts:1689 gates the probe on it). The committed frames were
// right anyway, but by ACCIDENT: headless is software GL and
// resolveDefaultGraphicsPreset lows software GPUs, so the harness agreed with
// the seed by luck. Three of the exposed rigs are perf INSTRUMENTS, where the
// failure is worse than a wrong screenshot: a tour that believes it is
// benching a high tier may be benching whatever the machine resolved, and
// nothing reports it.
//
// WHY THERE IS NO RIG ALLOWLIST, stated because the row that ordered this
// guard expected one. The carve-out considered was "a rig that forces the tier
// with `?gfx=` is immune", on the ground that `forcedTierFromSearch`
// (src/render/gfx.ts:1378) outranks the stored preset. It is false for exactly
// the rigs that need the seed most, and two of them say so in their own
// comments: `?gfx=` forces the RENDERER tier only, while the HUD's per-tier
// knobs read the STORED preset (scripts/perf_baseline.mjs, "the ?gfx= query
// forces only the RENDERER tier while the HUD"; scripts/load_probe.mjs, "so
// the per-tier UI knobs resolve the same preset the ?gfx tier forces"). A
// probe that overwrites the stored preset therefore corrupts the knob half of
// a ?gfx-forced run too. The marker is inert where it is unnecessary and
// correct where it is not, so every seeder carries it and this guard has no
// rig exemptions to rot.
//
// The ONE carve-out below is not a rig: it is a file that writes the NAME into
// a report, and it self-clears if that ever stops being true.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';
import { stripComments } from './helpers/strip_comments';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptsRoot = join(repoRoot, 'scripts');

/** The marker that tells `firstRunGraphicsPreset` the tier is already chosen. */
const MARKER = 'graphicsDefaultApplied';

/** Every `graphicsPreset` WRITE in a source: the property form used inside a
 *  settings object literal and the assignment form used when a rig merges into
 *  an existing `woc_settings` blob. Comments are stripped first, so prose about
 *  the key (this file's own header, and the rigs' own comments) never counts. */
const PRESET_WRITE = /graphicsPreset\s*[:=]\s*([^,;\n}]+)/g;

interface SeedSite {
  readonly file: string;
  /** The written values, source text, in order. */
  readonly values: readonly string[];
  readonly hasMarker: boolean;
}

/**
 * A written value is a SETTINGS SEED unless it is a quoted string literal.
 * `woc_settings.graphicsPreset` is numeric (1 to 6, src/game/settings.ts), so a
 * quoted value can only be a label in a report or a fixture, never a seed a
 * boot probe could overwrite. Narrow on purpose: it is the only shape the one
 * carve-out below has, and widening it would let a real seed through.
 */
function isSettingsSeed(value: string): boolean {
  return !/^['"`]/.test(value.trim());
}

/** Read the seed sites out of already-stripped sources. Separate from the walk
 *  so the arms below can drive it over synthetic source: a sweep whose only
 *  input is a passing tree cannot tell a working predicate from `return []`. */
function readSeedSites(sources: ReadonlyArray<{ file: string; source: string }>): SeedSite[] {
  const out: SeedSite[] = [];
  for (const { file, source } of sources) {
    const values = [...source.matchAll(PRESET_WRITE)].map((m) => m[1].trim());
    if (values.length === 0) continue;
    out.push({ file, values, hasMarker: source.includes(MARKER) });
  }
  return out;
}

/**
 * Files that write the KEY but seed no settings, one entry with its own reason.
 * Never a bare allowlist: each entry is re-checked below against
 * `isSettingsSeed`, so an entry whose file starts seeding for real fails here
 * instead of silently exempting it.
 */
const NOT_A_SETTINGS_SEED: ReadonlyArray<{ readonly file: string; readonly reason: string }> = [
  {
    file: 'publish_storage_visual_evidence.mjs',
    reason:
      "writes graphicsPreset: 'low' as a PROVENANCE field into the evidence JSON it publishes, describing the tier the capture ran at. A quoted label, never a woc_settings write: nothing in this script touches localStorage, so no boot probe can overwrite anything here.",
  },
];

const sources = sourceFilesUnder(scriptsRoot, { skipDirectories: ['node_modules'] }).map(
  ({ file, full }) => ({ file, source: stripComments(readFileSync(full, 'utf8')) }),
);
const seedSites = readSeedSites(sources);

describe('capture rigs seed the graphics default-applied marker', () => {
  it('every rig that seeds graphicsPreset also seeds graphicsDefaultApplied', () => {
    const exempt = new Set(NOT_A_SETTINGS_SEED.map((row) => row.file));
    const offenders = seedSites
      .filter((site) => !site.hasMarker)
      .filter((site) => !exempt.has(site.file))
      .filter((site) => site.values.some(isSettingsSeed))
      .map((site) => `scripts/${site.file} (${site.values.join(', ')})`);
    expect(
      offenders,
      'a script seeds woc_settings.graphicsPreset without graphicsDefaultApplied, so main.ts runs firstRunGraphicsPreset on boot and the device probe may PERSIST its own tier over the seed. Seed the marker beside the preset (scripts/pr_shot_targets.mjs is the idiom):\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('holds the whole rig family, not a handful', () => {
    // Anti-vacuity: a broken walk, a broken stripper or a regex that stopped
    // matching would empty the corpus and pass the arm above over nothing. The
    // family was 50 files at the ruling; the floor is deliberately well under
    // that so ordinary rig churn does not touch it, and well over zero.
    expect(seedSites.length).toBeGreaterThanOrEqual(40);
    expect(seedSites.filter((site) => site.hasMarker).length).toBeGreaterThanOrEqual(40);
  });

  it('every carve-out entry still writes no settings seed', () => {
    // The entries self-clear: the exemption is granted about a QUOTED value, so
    // a file that starts seeding for real loses it here rather than keeping an
    // exemption argued about something else.
    const byFile = new Map(seedSites.map((site) => [site.file, site]));
    const stale: string[] = [];
    for (const row of NOT_A_SETTINGS_SEED) {
      const site = byFile.get(row.file);
      if (!site) {
        stale.push(`${row.file}: no longer writes graphicsPreset at all; drop the entry`);
        continue;
      }
      if (site.values.some(isSettingsSeed)) {
        stale.push(
          `${row.file}: now writes a real settings seed (${site.values.join(', ')}); it must seed the marker instead of being exempt`,
        );
      }
      expect(row.reason.length, `${row.file} needs a written reason`).toBeGreaterThan(80);
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });

  it('the reader and the seed predicate refuse the shapes they must', () => {
    // The positive control. Every rig on the real tree passes the arm above, so
    // nothing there can separate a working reader from one that returns an
    // empty list, or a working predicate from `() => false`.
    const fixtures = [
      { file: 'a.mjs', source: 's.graphicsPreset = 5;\n' },
      {
        file: 'b.mjs',
        source: 'JSON.stringify({ graphicsPreset: 1, graphicsDefaultApplied: true })',
      },
      { file: 'c.mjs', source: "report({ graphicsPreset: 'low' })" },
      { file: 'd.mjs', source: 'const unrelated = 1;' },
    ];
    const sites = readSeedSites(fixtures);
    expect(sites.map((s) => s.file)).toEqual(['a.mjs', 'b.mjs', 'c.mjs']);
    expect(sites.map((s) => s.hasMarker)).toEqual([false, true, false]);
    expect(isSettingsSeed('5')).toBe(true);
    expect(isSettingsSeed('presetValue')).toBe(true);
    expect(isSettingsSeed("'low'")).toBe(false);
    expect(isSettingsSeed('"low"')).toBe(false);
    // A comment naming the key is not a write: the stripper runs before the
    // reader, which is why this file's own header cannot fail its own arm.
    expect(
      readSeedSites([{ file: 'e.mjs', source: stripComments('// graphicsPreset: 5\n') }]),
    ).toEqual([]);
  });

  it('scans the scripts tree only through the shared recursive walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });
});
