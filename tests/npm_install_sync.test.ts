import { describe, expect, it } from 'vitest';
import {
  formatInstallSyncFailure,
  parseInstallProblems,
  shouldCheckInstallSync,
} from '../scripts/lib/npm_install_sync.mjs';

describe('parseInstallProblems', () => {
  it('returns an empty list when npm ls reports no problems key at all', () => {
    // A clean `npm ls --depth=0 --json` tree omits `problems` entirely rather
    // than emitting an empty array.
    expect(
      parseInstallProblems(JSON.stringify({ name: 'world-of-claudecraft', version: '1.0.0' })),
    ).toEqual([]);
  });

  it('returns an empty list when problems is an explicit empty array', () => {
    expect(parseInstallProblems(JSON.stringify({ problems: [] }))).toEqual([]);
  });

  it('extracts a real npm ls drift report (three.js drift + a missing dependency)', () => {
    const raw = JSON.stringify({
      problems: [
        'missing: @capgo/capacitor-updater@^8.51.2, required by world-of-claudecraft@0.33.0',
        'invalid: three@0.185.1 /repo/node_modules/three',
      ],
    });
    expect(parseInstallProblems(raw)).toEqual([
      'missing: @capgo/capacitor-updater@^8.51.2, required by world-of-claudecraft@0.33.0',
      'invalid: three@0.185.1 /repo/node_modules/three',
    ]);
  });

  it('drops extraneous-only problems: an unlisted leftover package cannot break tsc or a build', () => {
    const raw = JSON.stringify({
      problems: ['extraneous: leftover@1.0.0 /repo/node_modules/leftover'],
    });
    expect(parseInstallProblems(raw)).toEqual([]);
  });

  it('keeps blocking problems alongside a non-blocking extraneous one', () => {
    const raw = JSON.stringify({
      problems: [
        'extraneous: leftover@1.0.0 /repo/node_modules/leftover',
        'invalid: three@0.185.1 /repo/node_modules/three',
      ],
    });
    expect(parseInstallProblems(raw)).toEqual(['invalid: three@0.185.1 /repo/node_modules/three']);
  });

  it('stringifies a non-string entry rather than silently dropping it for its type', () => {
    // Real npm always emits strings; this is defensive against an unrecognized
    // future shape. It won't start with a blocking prefix once stringified, so it
    // is filtered the same way an unrecognized `extraneous:` problem is: this
    // check only blocks the gate on the two prefixes it can confidently act on.
    const raw = JSON.stringify({ problems: [{ code: 'EUNKNOWN' }] });
    expect(parseInstallProblems(raw)).toEqual([]);
  });

  it('treats a non-array problems field as no problems', () => {
    expect(parseInstallProblems(JSON.stringify({ problems: 'not-an-array' }))).toEqual([]);
  });

  it('throws when npm ls did not produce parseable JSON', () => {
    expect(() => parseInstallProblems('')).toThrow(/did not produce valid JSON/);
    expect(() => parseInstallProblems('not json at all')).toThrow(/did not produce valid JSON/);
  });
});

describe('shouldCheckInstallSync', () => {
  it('is true when npm ran and produced string output, however it exited', () => {
    expect(shouldCheckInstallSync({ error: undefined, stdout: '{}' })).toBe(true);
    expect(
      shouldCheckInstallSync({ error: undefined, stdout: '{"problems":["invalid: x"]}' }),
    ).toBe(true);
  });

  it('is false when npm itself could not be spawned (error set)', () => {
    expect(
      shouldCheckInstallSync({ error: new Error('spawnSync npm ENOENT'), stdout: undefined }),
    ).toBe(false);
  });

  it('is false when spawnSync set BOTH an error and partial stdout (maxBuffer/timeout)', () => {
    // The truncated-fragment case: parsing this would either throw on partial
    // JSON or, worse, succeed on a fragment that happens to be valid JSON.
    expect(shouldCheckInstallSync({ error: new Error('ETIMEDOUT'), stdout: '{"problems":[' })).toBe(
      false,
    );
  });

  it('is false when stdout is not a string at all', () => {
    expect(shouldCheckInstallSync({ error: undefined, stdout: undefined })).toBe(false);
  });
});

describe('formatInstallSyncFailure', () => {
  it('pins the message shape and the pnpm install hint for multiple problems', () => {
    const msg = formatInstallSyncFailure([
      'missing: @capgo/capacitor-updater@^8.51.2, required by world-of-claudecraft@0.33.0',
      'invalid: three@0.185.1 /repo/node_modules/three',
    ]);
    expect(msg).toContain('node_modules does not match what pnpm-lock.yaml would install');
    expect(msg).toContain('2 problems');
    expect(msg).toContain(
      '  - missing: @capgo/capacitor-updater@^8.51.2, required by world-of-claudecraft@0.33.0',
    );
    expect(msg).toContain('  - invalid: three@0.185.1 /repo/node_modules/three');
    expect(msg).toContain(
      'Run `pnpm install --frozen-lockfile` to reinstall exactly what the lockfile pins',
    );
  });

  it('uses the singular "problem" for exactly one finding', () => {
    const msg = formatInstallSyncFailure(['invalid: three@0.185.1 /repo/node_modules/three']);
    expect(msg).toContain('1 problem):');
    expect(msg).not.toContain('1 problems');
  });
});
