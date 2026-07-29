import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { safeStartupGraphicsPreset } from '../src/game/startup_graphics_safety';

const ULTRA = 4;
const HIGH = 3;
const MEDIUM = 2;

describe('safeStartupGraphicsPreset', () => {
  it('downgrades a saved Ultra preset on iOS Safari (webkit + mobile, not native)', () => {
    expect(safeStartupGraphicsPreset(false, 'webkit', true, ULTRA, ULTRA, HIGH)).toBe(HIGH);
  });

  it('downgrades a saved Ultra preset in the native iOS app shell', () => {
    expect(safeStartupGraphicsPreset(true, 'webkit', true, ULTRA, ULTRA, HIGH)).toBe(HIGH);
  });

  it('leaves desktop Safari alone (webkit but not mobile)', () => {
    expect(safeStartupGraphicsPreset(false, 'webkit', false, ULTRA, ULTRA, HIGH)).toBe(ULTRA);
  });

  it('leaves mobile Chrome alone (mobile but not webkit)', () => {
    expect(safeStartupGraphicsPreset(false, 'chromium', true, ULTRA, ULTRA, HIGH)).toBe(ULTRA);
  });

  it('never touches a preset already below Ultra', () => {
    expect(safeStartupGraphicsPreset(false, 'webkit', true, MEDIUM, ULTRA, HIGH)).toBe(MEDIUM);
  });

  it('keeps Medium selected in the native iOS shell', () => {
    expect(safeStartupGraphicsPreset(true, 'webkit', true, MEDIUM, ULTRA, HIGH)).toBe(MEDIUM);
  });
});

describe('constrained renderer integration', () => {
  it('uses the resolved dynamic-shadow policy for both the WebGL map and sun pass', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain('this.webgl.shadowMap.enabled = GFX.dynamicShadows;');
    expect(source).toContain('sun.castShadow = GFX.dynamicShadows;');
  });
});
