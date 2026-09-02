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
//
// A SEED IS A PROPERTY WRITE, never a bare declaration. `graphicsPreset:` names
// a key in a settings object; `.graphicsPreset =` and `['graphicsPreset'] =`
// name a member on one. A top-level `const graphicsPreset = ...` is a local,
// and two rigs have one; counting those as seed sites is what forced the
// enclosing-block scan below into a whole-file fallback.
const PRESET_WRITE =
  /(?:\.graphicsPreset|\['graphicsPreset'\]|\["graphicsPreset"\])\s*=\s*([^,;\n}]+)|graphicsPreset\s*:\s*([^,;\n}]+)/g;

interface SeedSite {
  readonly file: string;
  /** The written values, source text, in order. */
  readonly values: readonly string[];
  /** True only when EVERY seeding site in the file carries the marker in its own
   *  enclosing block. A file-wide `includes` was the first draft and it proves
   *  co-OCCURRENCE, never co-LOCATION: scripts/perf_baseline.mjs deliberately
   *  scopes its marker inside the branch that seeds, so a second seeding branch
   *  without one would have passed a file-wide check unnoticed. */
  readonly hasMarker: boolean;
}

/** The innermost `{ ... }` block containing `index`, as source text. Falls back
 *  or '' when the write is not inside braces at all.
 *
 *  FAILS CLOSED, and the first draft did not: it returned the WHOLE SOURCE in
 *  that case, quietly restoring the file-wide `includes` this scan exists to
 *  replace. For a guard, the direction that can only make a check PASS is the
 *  unsafe one, whatever it is called. */
function enclosingBlock(source: string, index: number, level = 0): string {
  let skips = level;
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    if (source[i] === '}') depth++;
    else if (source[i] === '{') {
      if (depth === 0) {
        if (skips > 0) {
          skips--;
          depth = 0;
          continue;
        }
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return '';
  depth = 0;
  let end = source.length;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      if (depth === 0) {
        end = i + 1;
        break;
      }
      depth--;
    }
  }
  return source.slice(start, end);
}

/** True when the marker is set in the seed's own block OR in any block
 *  enclosing it, up to file scope.
 *
 *  THE INNERMOST BLOCK ALONE IS TOO STRICT, and would refuse a legitimate rig:
 *  a marker set once above an if/else that seeds two different presets in its
 *  arms is correct and would have been reported as an offender. Co-location
 *  still means something, because a SIBLING block is never in the chain: the
 *  fixture whose marker sits in a different function still fails. */
function markerSetForSeed(source: string, index: number): boolean {
  for (let level = 0; level < 12; level++) {
    const block = enclosingBlock(source, index, level);
    if (block === '') return false;
    if (markerIsSet(block)) return true;
  }
  return false;
}

/** The marker counts only when it is SET, never merely mentioned: an explicit
 *  `graphicsDefaultApplied: false` is an invitation to the probe, not a fix.
 *
 *  The value is CAPTURED and compared rather than excluded by a lookahead. The
 *  lookahead form (`\s*(?!false\b)`) reads correctly and is wrong: `\s*`
 *  backtracks to consume nothing, the lookahead then sits on the space before
 *  `false` and succeeds, so `graphicsDefaultApplied: false` passes as SET. The
 *  control below drives exactly that fixture, which is how it was caught. */
const MARKER_WRITE = /graphicsDefaultApplied\s*[:=]\s*([^,;\n}]+)/g;

function markerIsSet(block: string): boolean {
  return [...block.matchAll(MARKER_WRITE)].some((entry) => entry[1].trim() !== 'false');
}

/**
 * A written value is a SETTINGS SEED unless it is a quoted string literal.
 * `woc_settings.graphicsPreset` is numeric (1 to 6, src/game/settings.ts), so a
 * quoted value can only be a label in a report or a fixture, never a seed a
 * boot probe could overwrite. Narrow on purpose: it is the only shape the one
 * carve-out below has, and widening it would let a real seed through.
 */
function isSettingsSeed(value: string): boolean {
  // A BACKTICK is not a label: a template literal is the natural way to write a
  // computed seed, so only the two plain quote forms mark a report field.
  return !/^['"]/.test(value.trim());
}

/** Read the seed sites out of already-stripped sources. Separate from the walk
 *  so the arms below can drive it over synthetic source: a sweep whose only
 *  input is a passing tree cannot tell a working predicate from `return []`. */
function readSeedSites(sources: ReadonlyArray<{ file: string; source: string }>): SeedSite[] {
  const out: SeedSite[] = [];
  for (const { file, source } of sources) {
    const matches = [...source.matchAll(PRESET_WRITE)];
    if (matches.length === 0) continue;
    const values = matches.map((m) => (m[1] ?? m[2] ?? '').trim());
    const hasMarker = matches.every((m) => markerSetForSeed(source, m.index ?? 0));
    out.push({ file, values, hasMarker });
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
    // family measures 50 seed sites today. The floor is 45, five under that: a
    // count floor is a blunt instrument and a near-zero-slack one reds on
    // ordinary rig churn instead of on a broken scan, which is why DEPTH is
    // checked by NAME below rather than by arithmetic.
    expect(seedSites.length).toBeGreaterThanOrEqual(45);
    expect(seedSites.filter((site) => site.hasMarker).length).toBeGreaterThanOrEqual(45);
    // DEPTH, which a flat count cannot see: five of the seed sites are nested,
    // so a walker that stopped recursing would leave 45 and clear a bare
    // count floor while silently dropping rigs this ruling seeded. Named,
    // because that is what makes the check about depth rather than arithmetic.
    for (const nested of [
      'lib/perf_hitch_browser.mjs',
      'assets/banker_chest/capture_ingame.mjs',
      'assets/ignivar_herald/capture_ingame.mjs',
      'assets/eastbrook_grand_armoury/capture_contract.mjs',
      'assets/fenbridge_town/capture_contract.mjs',
    ]) {
      expect(
        seedSites.some((site) => site.file === nested),
        `the walk no longer reaches ${nested}`,
      ).toBe(true);
    }
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
      // CO-LOCATION, the shape a file-wide `includes` cannot see: the marker is
      // set in one block and the preset seeded in ANOTHER. That is the real rig
      // shape (perf_baseline scopes its marker to the branch that seeds), so a
      // second seeding branch without one has to be caught.
      {
        file: 'e.mjs',
        source:
          'function a() { s.graphicsDefaultApplied = true; }\nfunction b() { s.graphicsPreset = 5; }\n',
      },
      // The marker MENTIONED but set to false is an invitation to the probe.
      {
        file: 'f.mjs',
        source: 'JSON.stringify({ graphicsPreset: 4, graphicsDefaultApplied: false })',
      },
      // Bracket access and a template value: a seed either way.
      { file: 'g.mjs', source: "s['graphicsPreset'] = 3;\n" },
      { file: 'h.mjs', source: 'JSON.stringify({ graphicsPreset: `${tier}` })' },
      // A bare top-level DECLARATION is not a seed site. Two live rigs have one
      // (`const graphicsPreset = mobile ? 1 : 5;`), and counting them forced the
      // enclosing-block scan into a whole-file fallback that quietly restored
      // the file-wide marker check. Not a seeder, so not listed below.
      { file: 'i.mjs', source: 'const graphicsPreset = mobile ? 1 : 5;\n' },
      // OUTER SCOPE counts: a marker set once above an if/else that seeds two
      // presets in its arms is correct, and an innermost-block-only rule would
      // have reported it as an offender. The sibling case (e.mjs) still fails,
      // because a sibling block is never in the enclosing chain.
      {
        file: 'k.mjs',
        source:
          'function seed() {\n  s.graphicsDefaultApplied = true;\n  if (low) { s.graphicsPreset = 1; } else { s.graphicsPreset = 6; }\n}\n',
      },
    ];
    const sites = readSeedSites(fixtures);
    expect(sites.map((s) => s.file)).toEqual([
      'a.mjs',
      'b.mjs',
      'c.mjs',
      'e.mjs',
      'f.mjs',
      'g.mjs',
      'h.mjs',
      'k.mjs',
    ]);
    expect(sites.map((s) => s.hasMarker)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(isSettingsSeed('`${tier}`'), 'a template value is a seed, not a label').toBe(true);
    // enclosingBlock fails CLOSED: a write outside any brace yields no block, so
    // no marker can be found for it, rather than the whole file being searched.
    expect(readSeedSites([{ file: 'j.mjs', source: 's.graphicsPreset = 5;\n' }])[0].hasMarker).toBe(
      false,
    );
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
