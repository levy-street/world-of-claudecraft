import { describe, expect, it } from 'vitest';
import { appVersionInfo, formatFooterVersion } from '../src/ui/app_version';

// The version formatter is shared by the page footer (main.ts) and the settings
// panel (options_window.ts). Pin its exact behavior so both stay byte-identical
// to the historical footer form that tests/release_version.test.ts asserts.
describe('formatFooterVersion', () => {
  it('trims a trailing .0 (a x.y.0 release shows as x.y)', () => {
    expect(formatFooterVersion('0.23.0')).toBe('0.23');
  });
  it('leaves a non-.0 patch untouched', () => {
    expect(formatFooterVersion('1.2.3')).toBe('1.2.3');
  });
  it('only trims the final .0, not an interior one', () => {
    expect(formatFooterVersion('1.0.4')).toBe('1.0.4');
  });
});

describe('appVersionInfo', () => {
  it('does not throw when the Vite __APP_* globals are absent (browser-test / non-Vite context)', () => {
    // Here (plain Node, no Vite define) the globals are undefined; the typeof guard
    // must fall back instead of dereferencing a bare identifier and throwing, so the
    // options window can render under the standalone browser-test config.
    expect(() => appVersionInfo()).not.toThrow();
    const info = appVersionInfo();
    expect(typeof info.version).toBe('string');
    expect(typeof info.build).toBe('string');
    expect(info.version.length).toBeGreaterThan(0);
  });
});
