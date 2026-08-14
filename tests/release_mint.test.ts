import { describe, expect, it } from 'vitest';
import { parseReleaseMintArgs, requiredChecksCoverage } from '../scripts/lib/release_mint.mjs';

const RELEASE_REF = 'refs/heads/release/v0.38.0';

function ruleset(
  include: string[] = ['refs/heads/release/**'],
  exclude: string[] = [],
  enforcement = 'active',
) {
  return {
    target: 'branch',
    enforcement,
    conditions: { ref_name: { include, exclude } },
    rules: [{ type: 'required_status_checks' }],
  };
}

describe('release mint argument parsing', () => {
  it('accepts one exact version and an optional dry-run flag in either order', () => {
    expect(parseReleaseMintArgs(['v0.38.0'])).toEqual({
      version: 'v0.38.0',
      dryRun: false,
      releaseRef: RELEASE_REF,
    });
    expect(parseReleaseMintArgs(['v0.38.0', '--dry-run']).dryRun).toBe(true);
    expect(parseReleaseMintArgs(['--dry-run', 'v0.38.0']).dryRun).toBe(true);
  });

  it.each([
    { args: [] },
    { args: ['0.38.0'] },
    { args: ['v0.38'] },
    { args: ['v0.38.0', '--dry-rnu'] },
    { args: ['v0.38.0', 'v0.39.0'] },
    { args: ['v0.38.0', '--dry-run', '--dry-run'] },
    { args: ['v0.38.0', 'extra'] },
  ])('rejects ambiguous or unknown argv before any gh call: $args', ({ args }) => {
    expect(() => parseReleaseMintArgs(args)).toThrow(/usage: node scripts\/release_mint\.mjs/);
  });
});

describe('required-check ruleset coverage', () => {
  it('accepts an active wildcard or exact include with unrelated exclusions', () => {
    expect(requiredChecksCoverage(ruleset(), RELEASE_REF).covered).toBe(true);
    expect(
      requiredChecksCoverage(ruleset([RELEASE_REF], ['refs/heads/release/archive/**']), RELEASE_REF)
        .covered,
    ).toBe(true);
  });

  it.each(['disabled', 'evaluate'])('rejects %s enforcement', (enforcement) => {
    const result = requiredChecksCoverage(ruleset(undefined, undefined, enforcement), RELEASE_REF);
    expect(result.covered).toBe(false);
    expect(result.reason).toContain('enforcement');
  });

  it.each([
    { exclude: [RELEASE_REF] },
    { exclude: ['refs/heads/release/**'] },
    { exclude: ['refs/heads/**/release/v0.38.0'] },
    { exclude: ['refs/heads/**/v0.38.0'] },
    { exclude: ['refs/heads/*/v0.38.0'] },
    { exclude: ['~ALL'] },
  ])('rejects an exclusion that covers the release ref: $exclude', ({ exclude }) => {
    const result = requiredChecksCoverage(ruleset(undefined, exclude), RELEASE_REF);
    expect(result.covered).toBe(false);
    expect(result.reason).toContain('exclude');
  });

  it('fails closed on an exclusion pattern it cannot prove unrelated', () => {
    const result = requiredChecksCoverage(
      ruleset(undefined, ['refs/heads/release/v0.[0-9].0']),
      RELEASE_REF,
    );
    expect(result.covered).toBe(false);
    expect(result.reason).toContain('cannot be proven');
    expect(
      requiredChecksCoverage(ruleset(undefined, ['refs/heads/****/release/v0.38.0']), RELEASE_REF)
        .covered,
    ).toBe(false);
    expect(
      requiredChecksCoverage(ruleset(['refs/heads/****/release/v0.38.0']), RELEASE_REF).covered,
    ).toBe(false);
  });

  it('rejects a missing include or malformed response', () => {
    expect(requiredChecksCoverage(ruleset(['refs/heads/main']), RELEASE_REF).covered).toBe(false);
    expect(requiredChecksCoverage(null, RELEASE_REF).covered).toBe(false);
    expect(
      requiredChecksCoverage(
        { ...ruleset(), conditions: { ref_name: { include: ['refs/heads/release/**'] } } },
        RELEASE_REF,
      ).covered,
    ).toBe(false);
    expect(
      requiredChecksCoverage(
        {
          ...ruleset(),
          conditions: {
            ref_name: { include: ['refs/heads/release/**'], exclude: 'refs/heads/main' },
          },
        },
        RELEASE_REF,
      ).covered,
    ).toBe(false);
  });

  it('keeps single-star FNM_PATHNAME segment boundaries', () => {
    expect(requiredChecksCoverage(ruleset(undefined, ['refs/heads/*']), RELEASE_REF).covered).toBe(
      true,
    );
    expect(requiredChecksCoverage(ruleset(undefined, ['refs/heads/**']), RELEASE_REF).covered).toBe(
      true,
    );
    expect(requiredChecksCoverage(ruleset(['refs/heads/**']), RELEASE_REF).covered).toBe(false);
  });

  it('rejects a non-branch ruleset or one without required status checks', () => {
    expect(requiredChecksCoverage({ ...ruleset(), target: 'tag' }, RELEASE_REF).covered).toBe(
      false,
    );
    expect(requiredChecksCoverage({ ...ruleset(), rules: [] }, RELEASE_REF).covered).toBe(false);
  });
});
