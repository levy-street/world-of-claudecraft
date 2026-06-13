import { beforeEach, describe, expect, it } from 'vitest';
import { Settings, SETTING_RANGES } from '../src/game/settings';

function installStorage(): void {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

beforeEach(() => installStorage());

describe('Settings', () => {
  it('starts at the documented defaults (camera calmer than the old 1.0)', () => {
    const s = new Settings();
    expect(s.get('cameraSpeed')).toBe(SETTING_RANGES.cameraSpeed.def);
    expect(s.get('cameraSpeed')).toBeLessThan(1); // addresses the "too fast" complaint
    expect(s.get('sfxVolume')).toBe(SETTING_RANGES.sfxVolume.def);
    expect(s.get('renderScale')).toBe(1);
  });

  it('clamps out-of-range values to the slider bounds', () => {
    const s = new Settings();
    expect(s.set('cameraSpeed', 99)).toBe(SETTING_RANGES.cameraSpeed.max);
    expect(s.set('cameraSpeed', -5)).toBe(SETTING_RANGES.cameraSpeed.min);
    expect(s.set('sfxVolume', 0.5)).toBe(0.5);
  });

  it('ignores non-finite input, keeping a valid value', () => {
    const s = new Settings();
    s.set('brightness', NaN);
    expect(Number.isFinite(s.get('brightness'))).toBe(true);
  });

  it('persists across instances', () => {
    const a = new Settings();
    a.set('cameraSpeed', 0.4);
    a.set('musicVolume', 0.2);
    const b = new Settings();
    expect(b.get('cameraSpeed')).toBe(0.4);
    expect(b.get('musicVolume')).toBe(0.2);
  });

  it('falls back to defaults for missing/corrupt keys', () => {
    localStorage.setItem('woc_settings', JSON.stringify({ cameraSpeed: 0.5 }));
    const s = new Settings();
    expect(s.get('cameraSpeed')).toBe(0.5);
    expect(s.get('brightness')).toBe(SETTING_RANGES.brightness.def); // missing -> default
  });

  it('reset() restores every default', () => {
    const s = new Settings();
    s.set('cameraSpeed', 1.2);
    s.set('renderScale', 0.5);
    s.reset();
    expect(s.get('cameraSpeed')).toBe(SETTING_RANGES.cameraSpeed.def);
    expect(s.get('renderScale')).toBe(SETTING_RANGES.renderScale.def);
  });

  it('all() returns an independent snapshot', () => {
    const s = new Settings();
    const snap = s.all();
    snap.cameraSpeed = 99;
    expect(s.get('cameraSpeed')).not.toBe(99);
  });
});
