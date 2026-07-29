import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { safeStartupGraphicsPreset } from '../src/game/startup_graphics_safety';

const ULTRA = 4;
const HIGH = 3;
const MEDIUM = 2;

function closingBrace(source: string, openBrace: number): number {
  let depth = 0;
  for (let index = openBrace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] !== '}') continue;
    depth--;
    if (depth === 0) return index;
  }
  throw new Error('unterminated source block');
}

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
    const prewarmMethod = source.indexOf(
      'private async compileSkinnedShadowPrograms(root: THREE.Object3D)',
    );
    const prewarmGuard = source.indexOf(
      'if (!GFX.dynamicShadows || !this.asyncCompileSupported) return;',
      prewarmMethod,
    );
    const prewarmTraversal = source.indexOf('root.traverse((obj) => {', prewarmMethod);

    expect(source).toContain('this.webgl.shadowMap.enabled = GFX.dynamicShadows;');
    expect(source).toContain('sun.castShadow = GFX.dynamicShadows;');
    expect(prewarmMethod).toBeGreaterThanOrEqual(0);
    expect(prewarmGuard).toBeGreaterThan(prewarmMethod);
    expect(prewarmGuard).toBeLessThan(prewarmTraversal);
  });

  it('gates shadow-only CPU work while retaining the crowd animation bands', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    // The band plan is filled into a renderer-owned object rather than
    // allocated per frame; what this test guards is that it is still computed
    // from the live rig count, not which of the two entry points computes it.
    expect(source).toContain(`const lodBands = characterLodBandsInto(
      this.characterLodPlan,
      this.lastVisibleRigCount,`);
    expect(source).toContain(`const shadowRangeSq = lodBands.shadowRangeSq;
    const shadowsEnabled = this.sun.castShadow;`);
    const remoteViews = source.indexOf('visibleRigCount++; // crowd-density signal');
    const shadowGate = source.indexOf('if (shadowsEnabled) {', remoteViews);
    const shadowGateEnd = closingBrace(source, source.indexOf('{', shadowGate));
    const cadence = source.indexOf('const cadence = animCadenceFrames(d2, lodBands);');
    expect(remoteViews).toBeGreaterThan(-1);
    expect(shadowGate).toBeGreaterThan(remoteViews);
    expect(cadence).toBeGreaterThan(shadowGateEnd);
    expect(source.slice(shadowGate, shadowGateEnd)).toContain('v.visual?.setProxyShadow(');
    expect(source.slice(shadowGate, shadowGateEnd)).toContain(
      'v.mountVisual?.setShadow(wantFormShadow);',
    );
    for (const condition of ['if (shadowsEnabled) {', 'if (this.sun.castShadow) {']) {
      let conditionAt = source.indexOf(condition);
      while (conditionAt >= 0) {
        const blockEnd = closingBrace(source, source.indexOf('{', conditionAt));
        expect(source.slice(conditionAt, blockEnd)).not.toContain(
          'animCadenceFrames(d2, lodBands)',
        );
        conditionAt = source.indexOf(condition, blockEnd);
      }
    }
    // sun.castShadow is assigned GFX.dynamicShadows and never reassigned, so the
    // prewarm gate above pins the same policy through the static preset knob.
    expect(source).toContain('if (!GFX.dynamicShadows || !this.asyncCompileSupported) return;');
    expect(source).toContain('if (this.lowGfx && !this.sun.castShadow) return;');
    expect(
      source.match(/if \(this\.sun\.castShadow\) \{\n\s+this\.shadowLightDirection\.subVectors/g),
    ).toHaveLength(2);
  });

  it('keys fixed LOW daylight by biome and invalidates it for developer overrides', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (this.lowGfx && DAY_ONLY && phaseOverride === null) {');
    expect(source).toContain('if (this.fixedLowDayBiome !== biome) {');
    expect(source).toContain('this.fixedLowDayBiome = biome;');
    expect(source).toContain(`} else {
      this.fixedLowDayBiome = null;`);
    expect(
      source.match(
        /this\.skyView\.setCameraPos\(this\.camera\.position\.x, this\.camera\.position\.z, dt\);\n\s+if \(!this\.lowGfx\) \{/g,
      ),
    ).toHaveLength(2);
  });
});
