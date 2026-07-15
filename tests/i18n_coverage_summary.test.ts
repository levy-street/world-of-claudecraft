import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - zero-dep build script (no .d.ts). The CLI in the same module is
// exercised by spawning it below, so importing the pure formatter here checks the
// exact code CI runs rather than a copy.
import { formatCoverageSummary, formatInt } from '../scripts/i18n_coverage_summary.mjs';

// scripts/i18n_coverage_summary.mjs posts the i18n coverage counts (the small
// src/ui/i18n.status.summary.json rollup) to $GITHUB_STEP_SUMMARY as the CI audit
// trail that replaces the summary file's committed-bytes `git diff` history. This
// suite covers the pure formatter, the CLI's append path, the missing-file failure,
// and the repo-wide dash/emoji ban on the emitted markdown.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/i18n_coverage_summary.mjs');

// True if `text` contains any code point banned repo-wide (CLAUDE.md): U+2013 en
// dash, U+2014 em dash, U+FE0F emoji variation selector, or the common emoji blocks
// (symbols/pictographs supplemental, misc symbols + dingbats, regional-indicator
// flags). Tested by numeric code point so this guard file itself contains none of
// the banned glyphs.
function hasBannedGlyph(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0x2013 || cp === 0x2014 || cp === 0xfe0f) return true;
    if (cp >= 0x1f000 && cp <= 0x1faff) return true;
    if (cp >= 0x2600 && cp <= 0x27bf) return true;
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true;
  }
  return false;
}

// A small, realistic fixture: grouped totals (to prove the thousands grouping) and
// two locales with distinct per-state rows.
const FIXTURE = {
  version: 1,
  universeHash: 'deadbeefcafef00d',
  scopes: ['main', 'sim'],
  locales: ['es', 'fr_FR'],
  counts: {
    keys: 7380,
    rows: 154980,
    translated: 152939,
    pending: 1825,
    blocked: 216,
    blockedSource: 101,
  },
  perLocale: {
    es: { translated: 7251, pending: 121, blocked: 8 },
    fr_FR: { translated: 7242, pending: 121, blocked: 17 },
  },
};

// Create a throwaway repo-root-shaped workspace; write the summary fixture into
// src/ui when one is given, else leave it absent (the missing-file case).
function makeWorkspace(summary?: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'i18n-cov-'));
  if (summary !== undefined) {
    mkdirSync(path.join(dir, 'src/ui'), { recursive: true });
    writeFileSync(
      path.join(dir, 'src/ui/i18n.status.summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }
  return dir;
}

describe('i18n coverage summary: pure formatter', () => {
  const md = formatCoverageSummary(FIXTURE);

  it('renders an h2 heading and both a totals and a per-locale table', () => {
    expect(md).toContain('## i18n coverage');
    expect(md).toContain('### Totals');
    expect(md).toContain('### Per-locale coverage');
    // GitHub table delimiter rows (hyphen-minus only).
    expect(md).toContain('| --- | ---: |');
  });

  it('carries every headline total with thousands grouping', () => {
    expect(md).toContain('| Keys | 7,380 |');
    expect(md).toContain('| Rows | 154,980 |');
    expect(md).toContain('| Translated | 152,939 |');
    expect(md).toContain('| Pending | 1,825 |');
    expect(md).toContain('| Blocked | 216 |');
    expect(md).toContain('| Blocked source | 101 |');
    expect(md).toContain('deadbeefcafef00d');
  });

  it('emits one per-locale row per locale, in order, with grouped counts', () => {
    expect(md).toContain('| es | 7,251 | 121 | 8 |');
    expect(md).toContain('| fr_FR | 7,242 | 121 | 17 |');
    // Locale order is preserved: es before fr_FR.
    expect(md.indexOf('| es |')).toBeLessThan(md.indexOf('| fr_FR |'));
  });

  it('contains no em dash, en dash, or emoji characters', () => {
    expect(hasBannedGlyph(md)).toBe(false);
  });

  it('groups integers deterministically and independent of sign', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(1825)).toBe('1,825');
    expect(formatInt(154980)).toBe('154,980');
    expect(formatInt(-7380)).toBe('-7,380');
  });

  it('rejects a summary that is missing its counts / rollup', () => {
    expect(() => formatCoverageSummary({ locales: [] })).toThrow(/counts/);
    // Counts present but no rollup: proves the perLocale arm of the guard trips
    // on its own (without it this input returns an empty rollup table instead).
    expect(() => formatCoverageSummary({ counts: FIXTURE.counts, locales: [] })).toThrow(
      /perLocale/,
    );
  });
});

describe('i18n coverage summary: CLI', () => {
  it('appends the coverage markdown to $GITHUB_STEP_SUMMARY when set', () => {
    const dir = makeWorkspace(FIXTURE);
    const stepSummary = path.join(dir, 'step_summary.md');
    try {
      const stdout = execFileSync(process.execPath, [script], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: stepSummary },
      });
      const written = readFileSync(stepSummary, 'utf8');
      expect(written).toContain('## i18n coverage');
      expect(written).toContain('| Translated | 152,939 |');
      expect(written).toContain('| es | 7,251 | 121 | 8 |');
      expect(hasBannedGlyph(written)).toBe(false);
      // The markdown goes to the file, not stdout (stdout is just the confirmation).
      expect(stdout).not.toContain('## i18n coverage');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the markdown to stdout when GITHUB_STEP_SUMMARY is unset', () => {
    const dir = makeWorkspace(FIXTURE);
    try {
      const env = { ...process.env };
      delete env.GITHUB_STEP_SUMMARY;
      const stdout = execFileSync(process.execPath, [script], {
        cwd: dir,
        encoding: 'utf8',
        env,
      });
      expect(stdout).toContain('## i18n coverage');
      expect(stdout).toContain('| Keys | 7,380 |');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits nonzero with a legible error naming npm run i18n:gen when the summary is missing', () => {
    const dir = makeWorkspace(); // no summary written
    try {
      let status: number | null = null;
      let stderr = '';
      try {
        execFileSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
      } catch (err) {
        const e = err as { status?: number | null; stderr?: unknown };
        status = e.status ?? null;
        stderr = String(e.stderr ?? '');
      }
      expect(status).not.toBe(0);
      expect(status).toBe(1);
      expect(stderr).toContain('npm run i18n:gen');
      expect(stderr).toContain('i18n.status.summary.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
