import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  hasSkyClouds,
  SKY_CLOUD_ATLAS_SIZE,
  SKY_CLOUD_ATLAS_URL,
  SKY_CLOUD_COUNT,
  SKY_CLOUD_FADE_SEC,
  SKY_CLOUD_INSTANCES,
  SKY_CLOUD_MAX_Y,
  SKY_CLOUD_MIN_Y,
  SKY_CLOUD_NIGHT,
  SKY_CLOUD_SPRITES,
  SKY_CLOUDS_DECLARATIONS,
  SKY_CLOUDS_FUNCTIONS,
  SKY_CLOUDS_GLSL,
  SKY_CLOUDS_NIGHT_GLSL,
  SKY_CLOUDS_STAR_VEIL_CLOSE,
  SKY_CLOUDS_STAR_VEIL_OPEN,
  skyCloudArmWeight,
  skyCloudAspect,
  skyCloudPositions,
  skyCloudRects,
  stepSkyCloudFade,
  wrapAngle,
} from '../src/render/sky_clouds_core';

const RAD = Math.PI / 180;
const LAYOUT = JSON.parse(
  readFileSync('scripts/assets/vale_painted_clouds.layout.json', 'utf8'),
) as { size: [number, number]; sprites: { u0: number; v0: number; du: number; dv: number }[] };

describe('the painted cloud atlas', () => {
  it('matches the layout the build measured, sprite for sprite', () => {
    expect([...SKY_CLOUD_ATLAS_SIZE]).toEqual(LAYOUT.size);
    expect(SKY_CLOUD_SPRITES).toHaveLength(LAYOUT.sprites.length);
    SKY_CLOUD_SPRITES.forEach((s, i) => {
      const m = LAYOUT.sprites[i];
      expect([s.u0, s.v0, s.du, s.dv]).toEqual([m.u0, m.v0, m.du, m.dv]);
    });
  });

  it('keeps every sprite inside the atlas and clear of the others', () => {
    for (const s of SKY_CLOUD_SPRITES) {
      expect(s.u0).toBeGreaterThanOrEqual(0);
      expect(s.v0).toBeGreaterThanOrEqual(0);
      expect(s.u0 + s.du).toBeLessThanOrEqual(1);
      expect(s.v0 + s.dv).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < SKY_CLOUD_SPRITES.length; i++) {
      for (let j = i + 1; j < SKY_CLOUD_SPRITES.length; j++) {
        const a = SKY_CLOUD_SPRITES[i];
        const b = SKY_CLOUD_SPRITES[j];
        const apart =
          a.u0 + a.du <= b.u0 || b.u0 + b.du <= a.u0 || a.v0 + a.dv <= b.v0 || b.v0 + b.dv <= a.v0;
        expect(apart, `sprites ${i} and ${j} overlap`).toBe(true);
      }
    }
  });

  it('ships as a manifest-tracked asset', () => {
    expect(SKY_CLOUD_ATLAS_URL).toBe('/env/vale_painted_clouds.ktx2');
    expect(Object.keys(MEDIA_ASSETS)).toContain(SKY_CLOUD_ATLAS_URL.slice(1));
  });
});

describe('the clouds in the sky', () => {
  it('sits every cloud over the horizon fog and under the zenith, in the band the shader runs', () => {
    const pos = skyCloudPositions(0);
    for (let i = 0; i < SKY_CLOUD_COUNT; i++) {
      const el = pos[i * 4 + 1];
      const halfH = pos[i * 4 + 3];
      // the bottom clears the horizon (the fog band fades a low cloud in), the top stays
      // inside the elevation band the shader block runs in
      expect(el - halfH, `cloud ${i} dips under the horizon`).toBeGreaterThan(3 * RAD);
      expect(Math.sin(el + halfH), `cloud ${i} reaches past the band`).toBeLessThan(
        SKY_CLOUD_MAX_Y,
      );
      expect(Math.sin(el - halfH)).toBeGreaterThan(SKY_CLOUD_MIN_Y);
    }
  });

  it('spreads the clouds round the whole circle, no quarter of the sky left empty', () => {
    for (let q = 0; q < 4; q++) {
      const inQuarter = SKY_CLOUD_INSTANCES.filter((c) => {
        const az = ((c.azDeg % 360) + 360) % 360;
        return az >= q * 90 && az < (q + 1) * 90;
      });
      expect(inQuarter.length, `quarter ${q}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('drifts slowly and one way, nearer (higher) clouds faster and in front', () => {
    const speeds = SKY_CLOUD_INSTANCES.map((c) => c.speedDegPerSec);
    for (const v of speeds) {
      expect(v).toBeGreaterThan(0.15);
      expect(v).toBeLessThan(0.75);
    }
    // parallax: listed low to high (the shader draws later clouds in front), each one faster
    // than every cloud below it, and the spread wide enough to see the layers slide past
    for (let i = 1; i < SKY_CLOUD_COUNT; i++) {
      const lo = SKY_CLOUD_INSTANCES[i - 1];
      const hi = SKY_CLOUD_INSTANCES[i];
      expect(hi.elDeg, `cloud ${i} sits lower than cloud ${i - 1}`).toBeGreaterThanOrEqual(
        lo.elDeg,
      );
      expect(hi.speedDegPerSec, `cloud ${i}`).toBeGreaterThan(lo.speedDegPerSec);
    }
    expect(Math.max(...speeds) / Math.min(...speeds)).toBeGreaterThan(2.5);
    const a = skyCloudPositions(0);
    const b = skyCloudPositions(10);
    for (let i = 0; i < SKY_CLOUD_COUNT; i++) {
      const moved = wrapAngle(b[i * 4] - a[i * 4]);
      expect(moved).toBeCloseTo(SKY_CLOUD_INSTANCES[i].speedDegPerSec * 10 * RAD, 4);
      // elevation and size never change
      expect(b[i * 4 + 1]).toBe(a[i * 4 + 1]);
      expect(b[i * 4 + 2]).toBe(a[i * 4 + 2]);
    }
  });

  it('is deterministic in time, wraps its azimuth and survives hours of play', () => {
    const t = 6 * 3600 + 17.25;
    expect(skyCloudPositions(t)).toEqual(skyCloudPositions(t));
    for (const v of skyCloudPositions(t).filter((_, i) => i % 4 === 0)) {
      expect(v).toBeGreaterThanOrEqual(-Math.PI);
      expect(v).toBeLessThan(Math.PI);
    }
    expect([...skyCloudPositions(Number.NaN)]).toEqual([...skyCloudPositions(0)]);
  });

  it('keeps each cloud its painted aspect, and mirrors a flipped one in the atlas', () => {
    const pos = skyCloudPositions(0);
    const rects = skyCloudRects();
    SKY_CLOUD_INSTANCES.forEach((c, i) => {
      const s = SKY_CLOUD_SPRITES[c.sprite];
      // the positions are float32: the aspect survives to float precision
      expect(pos[i * 4 + 3] / pos[i * 4 + 2]).toBeCloseTo(skyCloudAspect(s), 6);
      expect(rects[i * 4 + 2]).toBeCloseTo(c.flip ? -s.du : s.du, 6);
      expect(rects[i * 4]).toBeCloseTo(c.flip ? s.u0 + s.du : s.u0, 6);
    });
    expect(SKY_CLOUD_INSTANCES.some((c) => c.flip)).toBe(true);
  });
});

describe('where the layer shows', () => {
  it('rides the painted vale sky and the beach that aliases it, nothing else', () => {
    expect(hasSkyClouds('vale')).toBe(true);
    expect(hasSkyClouds('beach')).toBe(true);
    for (const key of ['marsh', 'peaks', 'desert', 'volcano', 'cave', 'farshore']) {
      expect(hasSkyClouds(key)).toBe(false);
      expect(skyCloudArmWeight(key, 1)).toBe(0);
    }
    expect(skyCloudArmWeight('vale', 0.4)).toBe(0.4);
  });

  it('fades in over its window once bound and drops at once when unbound', () => {
    let fade = 0;
    fade = stepSkyCloudFade(fade, true, SKY_CLOUD_FADE_SEC / 2);
    expect(fade).toBeCloseTo(0.5, 9);
    fade = stepSkyCloudFade(fade, true, SKY_CLOUD_FADE_SEC);
    expect(fade).toBe(1);
    expect(stepSkyCloudFade(fade, false, 0.016)).toBe(0);
    expect(stepSkyCloudFade(0.3, true, Number.NaN)).toBe(0.3);
  });
});

describe('the clouds at night', () => {
  it('grades them moonlit: dark blue-violet bodies through a blue mid to silver tops', () => {
    const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const { body, mid, top } = SKY_CLOUD_NIGHT;
    expect(luma(body)).toBeLessThan(luma(mid));
    expect(luma(mid)).toBeLessThan(luma(top));
    for (const c of [body, mid, top]) {
      // blue leads every stop: moonlight, never a warm or a green cast
      expect(c[2]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[0]);
      expect(Math.max(...c)).toBeLessThan(0.6);
    }
    expect(SKY_CLOUD_NIGHT.lumLo).toBeLessThan(SKY_CLOUD_NIGHT.lumHi);
    // the bulk stays blue: silver only on the brightest strokes, past where the mid is reached
    expect(SKY_CLOUD_NIGHT.topFrom).toBeGreaterThanOrEqual(SKY_CLOUD_NIGHT.midTo);
    expect(SKY_CLOUD_NIGHT.topFrom).toBeGreaterThan(0.8);
    expect(SKY_CLOUD_NIGHT.topFrom).toBeLessThan(1);
  });

  it('lays the same clouds over the painted night share, so they drift on through the night', () => {
    expect(SKY_CLOUDS_NIGHT_GLSL).toContain(
      'if (paintedCloud.a > 0.0) night = night * (1.0 - paintedCloud.a)',
    );
    expect(SKY_CLOUDS_NIGHT_GLSL).toContain('paintedMoonClouds(paintedCloud) * nightShare');
    expect(SKY_CLOUDS_FUNCTIONS).toContain('vec3 paintedMoonClouds(vec4 cloud)');
    // the day pass leaves the weighted sample for the night pass and the star veil
    expect(SKY_CLOUDS_GLSL).toContain('vec4 paintedCloud = vec4(0.0);');
    expect(SKY_CLOUDS_GLSL).toContain('paintedCloud = paintedSkyClouds(dir) * cloudW;');
  });

  it('veils the stars behind a cloud by its coverage', () => {
    expect(SKY_CLOUDS_STAR_VEIL_OPEN).toContain('vec3 paintedPreStars = c;');
    expect(SKY_CLOUDS_STAR_VEIL_CLOSE).toContain(
      'c = paintedPreStars + (c - paintedPreStars) * (1.0 - paintedCloud.a);',
    );
  });
});

describe('the GLSL', () => {
  it('declares one uniform array slot per cloud and loops over exactly that many', () => {
    expect(SKY_CLOUDS_DECLARATIONS).toContain(`uniform vec4 uCloudPos[${SKY_CLOUD_COUNT}];`);
    expect(SKY_CLOUDS_DECLARATIONS).toContain(`uniform vec4 uCloudRect[${SKY_CLOUD_COUNT}];`);
    expect(SKY_CLOUDS_FUNCTIONS).toContain(`for (int i = 0; i < ${SKY_CLOUD_COUNT}; i++)`);
  });

  it('samples level 0 only, inside the per-cloud rectangle test', () => {
    expect(SKY_CLOUDS_FUNCTIONS).toContain('textureLod(uClouds,');
    expect(SKY_CLOUDS_FUNCTIONS).not.toContain('texture2D(uClouds');
    const test = SKY_CLOUDS_FUNCTIONS.indexOf('abs(q.x) < 1.0 && abs(q.y) < 1.0');
    expect(test).toBeGreaterThan(-1);
    expect(SKY_CLOUDS_FUNCTIONS.indexOf('textureLod(uClouds,')).toBeGreaterThan(test);
  });

  it('skips the whole block on a uniform weight and outside the elevation band', () => {
    expect(SKY_CLOUDS_GLSL).toContain('cloudW > 0.001');
    expect(SKY_CLOUDS_GLSL).toContain('dir.y > 0.02');
    expect(SKY_CLOUDS_GLSL).toContain('dir.y < 0.92');
    for (const src of [
      SKY_CLOUDS_DECLARATIONS,
      SKY_CLOUDS_FUNCTIONS,
      SKY_CLOUDS_GLSL,
      SKY_CLOUDS_NIGHT_GLSL,
      SKY_CLOUDS_STAR_VEIL_OPEN,
      SKY_CLOUDS_STAR_VEIL_CLOSE,
    ]) {
      let depth = 0;
      for (const ch of src) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    }
  });
});
