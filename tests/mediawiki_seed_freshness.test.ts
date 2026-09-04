// The MediaWiki seed freshness gate: the RELEASE-TIER half of this artifact's
// two-tier posture.
//
// mediawiki/seed/pages.xml is a first-boot deploy artifact generated from the
// live sim content tables (scripts/mediawiki/build_seed.mjs, npm run wiki:seed).
// It is committed, and BETWEEN releases it trails the content on purpose:
// demanding a fresh copy in every content PR would drag a six-figure
// regenerated diff along behind a one-line quest edit. tests/
// mediawiki_seed_visibility.test.ts owns the always-on half of the posture
// (what the GENERATOR emits for today's abilities) and deliberately says
// nothing about the committed bytes.
//
// This file is the other half, so the trailing is EXPLICIT rather than merely
// unchecked:
//   - PR tier (always): the committed artifact is still this generator's own
//     output (envelope and siteinfo byte-equal to a fresh build), and neither
//     the committed copy nor a fresh build carries an em or en dash. That dash
//     arm is the forward guard: the regen was blocked for a release cycle
//     because the seed-feeding zone and lore prose carried grandfathered em
//     dashes and the copy scanners do not exclude mediawiki/, so re-adding one
//     upstream must fail HERE, on the content PR, not later at ship time.
//   - Release tier (MEDIAWIKI_SEED_RELEASE_TIER=1): the committed bytes equal a
//     fresh build exactly, so tagging a release without running
//     `npm run wiki:seed` fails instead of quietly deploying a stale wiki.
//
// Gated exactly like the I18N_RELEASE_TIER suites: its own flag, off by
// default, meant to run as its own release step, so the PR tier keeps the
// deliberate trailing. It reads its OWN flag rather than I18N_RELEASE_TIER
// because tests/release_i18n_tier_coverage.test.ts pins the set of suites
// reading that flag three ways; this gate is not an i18n suite and must not
// join that list.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RELEASE_TIER = process.env.MEDIAWIKI_SEED_RELEASE_TIER === '1';
const COMMITTED_PATH = resolve('mediawiki/seed/pages.xml');

/**
 * En dash, em dash, and horizontal bar: the same set .claude/hooks/qa-stop.sh
 * and the .githooks/pre-push copy scan block. Written as escapes on purpose, so
 * this guard's own source stays clean under the very scanners it mirrors.
 */
const DASHES = /[\u2013\u2014\u2015]/;

let committed = '';
let fresh = '';
let workDir = '';

/** Everything up to and including </siteinfo>: the generator's own envelope. */
function envelope(xml: string): string {
  const end = xml.indexOf('</siteinfo>');
  expect(end, 'the seed carries a siteinfo block').toBeGreaterThan(0);
  return xml.slice(0, end + '</siteinfo>'.length);
}

function dashLines(xml: string): string[] {
  return xml
    .split('\n')
    .map((line, index) => ({ line, index }))
    .filter((row) => DASHES.test(row.line))
    .map((row) => `line ${row.index + 1}: ${row.line.trim().slice(0, 160)}`);
}

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'woc-seed-fresh-'));
  const out = path.join(workDir, 'pages.xml');
  // MEDIAWIKI_SEED_TIMESTAMP is dropped rather than passed through: the
  // generator's built-in default is what the committed copy was built with, so
  // an ambient override in the caller's shell would fail the byte comparison
  // for a reason that has nothing to do with freshness.
  const env: Record<string, string | undefined> = { ...process.env, MEDIAWIKI_SEED_OUT: out };
  delete env.MEDIAWIKI_SEED_TIMESTAMP;
  execFileSync(process.execPath, [resolve('scripts/mediawiki/build_seed.mjs')], {
    env,
    stdio: 'pipe',
  });
  fresh = readFileSync(out, 'utf8');
  committed = readFileSync(COMMITTED_PATH, 'utf8');
}, 120_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('the MediaWiki seed artifact (PR tier: the trailing is deliberate)', () => {
  // Vacuity floor. Every arm below is an equality or an expect-empty over these
  // two strings, so a build that silently emitted nothing would pass most of
  // them. Both copies are hundreds of thousands of lines and thousands of pages
  // in the live tree; the floors sit well under that so ordinary content growth
  // never touches them, but a truncated or empty build fails here first.
  it('both copies are real seeds, not an empty or truncated build', () => {
    for (const [label, xml] of [
      ['committed', committed],
      ['fresh', fresh],
    ] as const) {
      expect(xml.length, `${label} seed byte length`).toBeGreaterThan(1_000_000);
      expect(xml.split('<page>').length - 1, `${label} seed page count`).toBeGreaterThan(500);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), `${label} xml prolog`).toBe(
        true,
      );
      expect(xml.trimEnd().endsWith('</mediawiki>'), `${label} closing element`).toBe(true);
    }
  });

  it('the committed copy is still this generator output, envelope and siteinfo byte-equal', () => {
    // The committed copy may trail on CONTENT, but it must never stop being
    // what `npm run wiki:seed` produces: a hand-edited artifact, or an envelope
    // change made without recommitting, reds here at PR tier.
    expect(envelope(committed)).toBe(envelope(fresh));
  });

  it('a fresh build carries no em or en dash (the seed-feeding prose stays dash-free)', () => {
    // Positive control for the scanner, so the expect-empty below is a real
    // absence rather than a dead regex.
    expect(dashLines(`ok\nthis line has an em dash ${'\u2014'} here\nok`).length).toBe(1);
    expect(dashLines(fresh), 'em or en dashes in a fresh seed build').toEqual([]);
  });

  it('the committed copy carries no em or en dash', () => {
    expect(dashLines(committed), 'em or en dashes in the committed seed').toEqual([]);
  });
});

describe('the MediaWiki seed artifact (release tier: the regen actually ran)', () => {
  // Registration note: this arm only runs where MEDIAWIKI_SEED_RELEASE_TIER=1
  // is set, the same shape as the I18N_RELEASE_TIER suites. Until the release
  // step sets it, the arm is inert by design rather than by accident, and the
  // PR-tier arms above still hold the artifact to this generator.
  it.runIf(RELEASE_TIER)('the committed seed is byte-identical to a fresh build', () => {
    expect(
      committed === fresh,
      'mediawiki/seed/pages.xml is stale: run `npm run wiki:seed` and commit the result ' +
        'before tagging the release',
    ).toBe(true);
  });

  it('the tier flag is read from the environment, never hard-wired on', () => {
    // A tier that silently defaulted to ON would drag the regenerated diff into
    // every content PR, which is the exact cost the trailing exists to avoid.
    expect(RELEASE_TIER).toBe(process.env.MEDIAWIKI_SEED_RELEASE_TIER === '1');
    if (process.env.MEDIAWIKI_SEED_RELEASE_TIER === undefined) expect(RELEASE_TIER).toBe(false);
  });
});
