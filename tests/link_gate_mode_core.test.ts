import { describe, expect, it } from 'vitest';
import { parseLinkGateOverride, resolveLinkGateMode } from '../src/render/link_gate_mode_core';

const base = { compileAsync: true, parallelExtension: false, engine: 'chromium', override: null };

describe('link gate mode', () => {
  it('the parallel extension means parallel gates on every engine, whatever the override', () => {
    for (const engine of ['chromium', 'webkit', 'gecko', 'unknown']) {
      expect(resolveLinkGateMode({ ...base, engine, parallelExtension: true })).toBe('parallel');
      expect(
        resolveLinkGateMode({ ...base, engine, parallelExtension: true, override: 'off' }),
      ).toBe('parallel');
    }
  });

  it('Chromium without the extension gates in deferred mode (its GPU process links)', () => {
    expect(resolveLinkGateMode(base)).toBe('deferred');
  });

  it('other engines without the extension keep the gates off', () => {
    for (const engine of ['webkit', 'gecko', 'unknown']) {
      expect(resolveLinkGateMode({ ...base, engine })).toBe('none');
    }
  });

  it('no compileAsync means no gates, even with the extension or an override', () => {
    expect(resolveLinkGateMode({ ...base, compileAsync: false, parallelExtension: true })).toBe(
      'none',
    );
    expect(resolveLinkGateMode({ ...base, compileAsync: false, override: 'deferred' })).toBe(
      'none',
    );
  });

  it('?linkgate=off restores the old switch-off; ?linkgate=deferred forces deferred', () => {
    expect(resolveLinkGateMode({ ...base, override: 'off' })).toBe('none');
    expect(resolveLinkGateMode({ ...base, engine: 'webkit', override: 'deferred' })).toBe(
      'deferred',
    );
  });

  it('parses only the two override values', () => {
    expect(parseLinkGateOverride('off')).toBe('off');
    expect(parseLinkGateOverride('deferred')).toBe('deferred');
    expect(parseLinkGateOverride('on')).toBeNull();
    expect(parseLinkGateOverride('')).toBeNull();
    expect(parseLinkGateOverride(null)).toBeNull();
  });
});
