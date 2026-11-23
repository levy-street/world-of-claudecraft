// Grass sways only while it is VISIBLE, not to a fixed 50 yd (SPACEY,
// 2026-09-24: "for the grass we dont need animations at 50 yds only when they
// are visiable"): each grass system's own fade or cull gates its wind, and
// every one runs on the slowed clock (tree_sway.ts GRASS_WIND_TIME_SCALE).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bladeSwayGlsl } from '../src/render/blade_grass';
import { grassTuftWindGlsl } from '../src/render/grass_tuft_wind';
import { GRASS_WIND_TIME_SCALE } from '../src/render/tree_sway';

const src = (file: string): string =>
  readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');

describe('grass wind is gated by visibility', () => {
  it('runs on the slowed clock', () => {
    expect(GRASS_WIND_TIME_SCALE).toBeCloseTo(0.49, 5);
  });

  it('blade carpet and far band: one sway, branched around once the fade collapses a blade', () => {
    const sway = bladeSwayGlsl(false);
    expect(sway).toContain('if (bgFade > 0.0)');
    expect(sway).toContain(`uTime * ${GRASS_WIND_TIME_SCALE.toFixed(4)}`);
    for (const file of ['blade_grass.ts', 'blade_grass_band.ts']) {
      const s = src(file);
      // the variant is resolved per world at build, and named in the program key
      expect(s, file).toContain('bladeSwayGlsl(classicSway)}');
      expect(s, file).toContain('const classicSway = isBuiltinWorldActive();');
      expect(s, file).toContain("blade-sway:${classicSway ? 'classic' : 'wind'}");
    }
    // the band's old full-speed copy of the carpet sway is gone: one source
    expect(src('blade_grass_band.ts')).not.toContain('sin(uTime * 2.1');
  });

  it('the built-in world keeps the blade sway it shipped with', () => {
    const classic = bladeSwayGlsl(true);
    expect(classic).toContain('sin(uTime * 2.1 + bgPhase)');
    expect(classic).toContain('transformed.z += bgSway * 0.7;');
    expect(classic).not.toContain('bgFade > 0.0');
    expect(classic).not.toContain('GRASS_WIND_TIME_SCALE');
  });

  it('ambient tufts: sway only inside their own alpha-fade radius, on the slowed clock', () => {
    // source pins: the tuft material paints a canvas texture, which no test
    // DOM provides, so its program is compile-checked in the engine instead
    const s = src('foliage.ts');
    const body = s.slice(
      s.indexOf('function applyGrassShader('),
      s.indexOf('export function createGrassTuftMaterial'),
    );
    expect(body).toContain('grassTuftWindGlsl(classicWind, GRASS_WIND_STRENGTH)');
    expect(body).toContain('const classicWind = isBuiltinWorldActive();');
    const wind = grassTuftWindGlsl(false, 0.16);
    expect(wind).toContain('if (distance(tuftBase, uPlayerPos) < uFadeFar) {');
    expect(wind).toContain(`float grassT = uTime * ${GRASS_WIND_TIME_SCALE.toFixed(4)};`);
    expect(wind).not.toContain('sin(uTime * 1.7');
    // the player uniform is declared once, whether or not the cap card exists
    expect(body.match(/uniform vec2 uPlayerPos;/g)?.length).toBe(1);
    expect(body).toContain('uniform float uFadeFar;');
  });

  it('the built-in world keeps the tuft sway it shipped with', () => {
    const classic = grassTuftWindGlsl(true, 0.16);
    expect(classic).toContain('sin(uTime * 1.7 + windPhase)');
    expect(classic).toContain('* windGust * 0.160 *');
    expect(classic).not.toContain('uFadeFar');
    expect(classic).not.toContain('grassT');
  });

  it('painted patches: no fade, so the cull is the gate; on the slowed clock', () => {
    const s = src('grass_patch.ts');
    expect(s).toContain('float grassT = uTime * $' + '{GRASS_WIND_TIME_SCALE.toFixed(4)};');
    expect(s).not.toContain('sin(uTime * 1.7');
  });
});
