import { describe, expect, it } from 'vitest';
import { logRequireCandidates } from '../electron/logging.cjs';
import { updaterRequireCandidates } from '../electron/updater.cjs';

// A packaged app must load its main-process deps ONLY from the in-asar vendor
// bundle: the bare-specifier fallback walks Node's module paths out of the
// asar into the install directory, which is user-writable on a per-user
// install (re-verification audit finding). The fallback exists solely for a
// bare `electron .` checkout, where node_modules is the only place the deps
// live. This pins the packaged-only order so a refactor cannot silently
// reintroduce the fallback for packaged builds.
describe('vendor require candidates (packaged builds never leave the asar)', () => {
  it('updater: packaged is vendor-only; unpackaged may fall back to node_modules', () => {
    expect(updaterRequireCandidates(true)).toEqual(['./vendor/electron_updater.cjs']);
    expect(updaterRequireCandidates(false)).toEqual([
      './vendor/electron_updater.cjs',
      'electron-updater',
    ]);
    expect(updaterRequireCandidates(undefined)).toEqual([
      './vendor/electron_updater.cjs',
      'electron-updater',
    ]);
  });

  it('logging: packaged is vendor-only; unpackaged may fall back to node_modules', () => {
    expect(logRequireCandidates(true)).toEqual(['./vendor/electron_log_main.cjs']);
    expect(logRequireCandidates(false)).toEqual([
      './vendor/electron_log_main.cjs',
      'electron-log/main',
    ]);
    expect(logRequireCandidates(undefined)).toEqual([
      './vendor/electron_log_main.cjs',
      'electron-log/main',
    ]);
  });
});
