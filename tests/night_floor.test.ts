// An authored night floor (MapLighting.nightFloor): how much of the map's own
// daylight the deepest night keeps. A map that runs the world clock had nights
// that read "dark and overcast" (SPACEY); the floor lifts the whole grade's night
// end (key, ambient, sky, fog) while the lamps and the aurora keep the true
// clock, so the map stays dynamic - just never murky.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { dayNightGrade } from '../src/render/day_night_core';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const LIGHTING = {
  sunIntensity: 1.9,
  sunColor: 0xfff1d6,
  hemiIntensity: 1.05,
  skyColor: 0x9fc9ee,
  envScale: 1.35,
  sunAzimuthDeg: 118,
  sunElevationDeg: 48,
};

function sourceOf(relativePath: string): string {
  return codeWithoutLineComments(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('night floor', () => {
  it('rides the lighting record only when it lifts something, clamped to 0..1', () => {
    const map = newFlatCustomMap('Night Test', 'map_night_test', 1752710400000, {
      width: 60,
      height: 60,
    });
    map.lighting = { ...LIGHTING, nightFloor: 1.4 };
    expect(sanitizeMapDoc(JSON.parse(JSON.stringify(map)))?.lighting?.nightFloor).toBe(1);
    map.lighting = { ...LIGHTING, nightFloor: 0.35 };
    expect(sanitizeMapDoc(JSON.parse(JSON.stringify(map)))?.lighting?.nightFloor).toBe(0.35);
    map.lighting = { ...LIGHTING, nightFloor: 0 };
    expect(sanitizeMapDoc(JSON.parse(JSON.stringify(map)))?.lighting?.nightFloor).toBeUndefined();
    map.lighting = { ...LIGHTING };
    expect(sanitizeMapDoc(JSON.parse(JSON.stringify(map)))?.lighting?.nightFloor).toBeUndefined();
  });

  it('lifts every channel of the night grade, and leaves day alone', () => {
    // the renderer feeds the grade floor + (1 - floor) * dayness
    const lift = (floor: number, e: number) => floor + (1 - floor) * e;
    const night = dayNightGrade(lift(0, 0));
    const lifted = dayNightGrade(lift(0.35, 0));
    expect(lifted.lightScale).toBeGreaterThan(night.lightScale);
    expect(lifted.ambientScale).toBeGreaterThan(night.ambientScale);
    expect(lifted.nightAmt).toBeLessThan(night.nightAmt);
    for (let i = 0; i < 3; i++) {
      expect(lifted.sky[i]).toBeGreaterThanOrEqual(night.sky[i]);
      expect(lifted.fog[i]).toBeGreaterThanOrEqual(night.fog[i]);
    }
    // noon is the identity either way
    expect(dayNightGrade(lift(0.35, 1))).toEqual(dayNightGrade(lift(0, 1)));
  });

  it('is wired from the map through the Studio slider into the grade', () => {
    const renderer = sourceOf('../src/render/renderer.ts');
    expect(renderer).toContain('const floor = this.authoredLighting.override?.nightFloor ?? 0');
    expect(renderer).toContain(
      'const lifted = floor + (1 - floor) * effectiveDayness(gday, biome)',
    );
    expect(renderer).toContain('dayNightGrade(lifted, biome, moonLit)');
    // the lamps/aurora clock is NOT lifted: it still reads the world's night
    expect(renderer).toContain('this.dnGlobalNight = nightLightAmount(1 - gday, true)');
    const inspector = sourceOf('../src/editor/inspector.ts');
    expect(inspector).toContain("live('editor.lighting.nightFloor', p.nightFloor ?? 0, 0, 1, 0.05");
  });
});
