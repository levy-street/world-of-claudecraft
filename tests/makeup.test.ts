import { describe, expect, it } from 'vitest';
import {
  blushCoverage,
  eyeshadowCoverage,
  MAKEUP_REGION,
  MAKEUP_TEX_SIZE,
  makeupTextureData,
} from '../src/render/characters/makeup';
import {
  BLUSH_SHADES,
  blushColor,
  DEFAULT_APPEARANCE,
  defaultLashes,
  KNIGHT_FULL,
  LIP_SHADES,
  lipColor,
  type ModularAppearance,
  makeupKey,
  makeupSelection,
  normalizeAppearance,
  randomizeAppearance,
  SHADOW_SHADES,
  shadowColor,
  wearsFaceDecal,
  wearsMakeup,
} from '../src/render/characters/modular';
import { decalUv } from '../src/render/characters/stubble';

const app = (over: Partial<ModularAppearance> = {}): ModularAppearance =>
  normalizeAppearance({ ...DEFAULT_APPEARANCE, ...over });

// Every landmark below was MEASURED off the shipped head, not invented, the
// morph targets via tmp/_head_feats.mjs and the parts projected into the head's
// own angles via tmp/_head_map.mjs. They agree on both heads.
const EYE = { minTheta: 90, maxTheta: 100, minAz: 20, maxAz: 40 };
const BROW = { minTheta: 63, maxTheta: 80, minAz: 10, maxAz: 50 };
const EAR_AZ = 85; // the ear starts here and runs outward
const MOUTH = { minTheta: 120, maxTheta: 127, maxAz: 20 };
const NOSE_TIP = { theta: 108, az: 0 };

describe('makeup shades', () => {
  it('is off by default and off after a randomize', () => {
    for (const a of [DEFAULT_APPEARANCE, randomizeAppearance(DEFAULT_APPEARANCE)]) {
      expect(a.lipstick).toBe('none');
      expect(a.blush).toBe('none');
      expect(a.eyeshadow).toBe('none');
      expect(wearsMakeup(makeupSelection(a))).toBe(false);
      expect(makeupKey(a)).toBe('');
    }
    // ...on a female body too, makeup is opt-in on every body
    const fem = randomizeAppearance(app({ gender: 'female' }));
    expect([fem.lipstick, fem.blush, fem.eyeshadow]).toEqual(['none', 'none', 'none']);
  });

  it('gives every shade but `none` a colour, and `none` no colour', () => {
    expect(lipColor('none')).toBeNull();
    expect(blushColor('none')).toBeNull();
    expect(shadowColor('none')).toBeNull();
    for (const s of LIP_SHADES) if (s !== 'none') expect(lipColor(s)).toBeGreaterThan(0);
    for (const s of BLUSH_SHADES) if (s !== 'none') expect(blushColor(s)).toBeGreaterThan(0);
    for (const s of SHADOW_SHADES) if (s !== 'none') expect(shadowColor(s)).toBeGreaterThan(0);
  });

  it('falls back rather than throwing on a hand-edited save', () => {
    const a = normalizeAppearance({ lipstick: 'neon' as never, blush: 42 as never });
    expect(a.lipstick).toBe('none');
    expect(a.blush).toBe('none');
  });

  // Lipstick is a material tint on the mouth PART, so a look wearing it alone
  // adds no mesh. Getting this wrong costs a draw call on every made-up
  // character for a decal with nothing painted on it.
  it('only reaches the decal for blush and eyeshadow', () => {
    expect(wearsFaceDecal(makeupSelection(app({ lipstick: 'ruby' })))).toBe(false);
    expect(wearsMakeup(makeupSelection(app({ lipstick: 'ruby' })))).toBe(true);
    expect(wearsFaceDecal(makeupSelection(app({ blush: 'rose' })))).toBe(true);
    expect(wearsFaceDecal(makeupSelection(app({ eyeshadow: 'teal' })))).toBe(true);
  });

  // Every KayKit helm in the set is open at the face, so the lips, cheeks and
  // lids makeup paints are all still on screen under one. It used to be dropped
  // and that made a character's face come and go with their headgear.
  it('survives a helm, because the helms are open at the face', () => {
    const made = app({ lipstick: 'ruby', blush: 'rose', eyeshadow: 'plum' });
    expect(wearsMakeup(makeupSelection(made))).toBe(true);
    expect(wearsMakeup(makeupSelection(made, KNIGHT_FULL))).toBe(true);
    expect(makeupSelection(made, KNIGHT_FULL)).toEqual(makeupSelection(made));
    expect(makeupKey(made, KNIGHT_FULL)).toBe(makeupKey(made));
    expect(makeupKey(made, KNIGHT_FULL)).not.toBe('');
  });
});

describe('makeup footprints', () => {
  it('puts eyeshadow on the lid, under the brow, over the eye', () => {
    // strongest somewhere in the gap between the brow's bottom and the eye's top
    let best = 0;
    let bestTheta = 0;
    for (let th = 60; th < 110; th += 0.5) {
      const c = eyeshadowCoverage(th, 29);
      if (c > best) {
        best = c;
        bestTheta = th;
      }
    }
    expect(best).toBeGreaterThan(0.5);
    expect(bestTheta).toBeGreaterThan(BROW.maxTheta);
    expect(bestTheta).toBeLessThan(EYE.maxTheta);
    // never down the cheek, never onto the mouth, never off at the ear
    expect(eyeshadowCoverage(MOUTH.minTheta, 0)).toBe(0);
    expect(eyeshadowCoverage(NOSE_TIP.theta, NOSE_TIP.az)).toBe(0);
    expect(eyeshadowCoverage(90, EAR_AZ)).toBe(0);
    // and not on the bridge of the nose: it is a LID, so it stops before the
    // midline rather than meeting its twin
    expect(eyeshadowCoverage(88, 0)).toBe(0);
  });

  it('puts blush on the cheek, below the eye and inboard of the ear', () => {
    let best = 0;
    let bestTheta = 0;
    for (let th = 80; th < 140; th += 0.5) {
      const c = blushCoverage(th, 55);
      if (c > best) {
        best = c;
        bestTheta = th;
      }
    }
    expect(best).toBeGreaterThan(0.5);
    expect(bestTheta).toBeGreaterThan(EYE.maxTheta);
    expect(bestTheta).toBeLessThan(MOUTH.minTheta);
    // clear of the ear, and never on the lips
    expect(blushCoverage(105, EAR_AZ)).toBe(0);
    expect(blushCoverage(MOUTH.minTheta + 3, MOUTH.maxAz)).toBe(0);
    // not on the nose either: blush at the midline is a clown
    expect(blushCoverage(NOSE_TIP.theta, NOSE_TIP.az)).toBe(0);
  });

  it('is symmetric across the midline', () => {
    for (let az = 0; az <= 180; az += 6) {
      expect(eyeshadowCoverage(88, az)).toBeCloseTo(eyeshadowCoverage(88, -az), 10);
      expect(blushCoverage(110, az)).toBeCloseTo(blushCoverage(110, -az), 10);
    }
  });

  it('fits inside the region the decal is cut from', () => {
    for (let th = 0; th <= 180; th += 1) {
      for (let az = -180; az <= 180; az += 3) {
        const covered = eyeshadowCoverage(th, az) > 0 || blushCoverage(th, az) > 0;
        if (!covered) continue;
        expect(th, `theta ${th}`).toBeGreaterThanOrEqual(MAKEUP_REGION.minTheta);
        expect(th, `theta ${th}`).toBeLessThanOrEqual(MAKEUP_REGION.maxTheta);
        expect(Math.abs(az), `az ${az}`).toBeLessThanOrEqual(MAKEUP_REGION.maxAz);
      }
    }
  });
});

describe('the makeup map', () => {
  const SIZE = 256;
  const alphaAt = (sel: { blush: string; eyeshadow: string }, theta: number, az: number) => {
    const data = makeupTextureData(sel as never, SIZE);
    const [u, v] = decalUv(theta, az);
    const col = Math.min(SIZE - 1, Math.max(0, Math.round(u * SIZE - 0.5)));
    const row = Math.min(SIZE - 1, Math.max(0, Math.round(v * SIZE - 0.5)));
    return data[(row * SIZE + col) * 4 + 3];
  };

  it('is entirely empty when nothing is worn', () => {
    const data = makeupTextureData({ blush: 'none', eyeshadow: 'none' }, SIZE);
    let maxA = 0;
    for (let i = 0; i < SIZE * SIZE; i++) maxA = Math.max(maxA, data[i * 4 + 3]);
    expect(maxA).toBe(0);
  });

  // three multiplies the whole texel into the fragment, so a transparent texel
  // left at black bleeds through bilinear filtering and rings the patch with a
  // dark halo. The colour channel has to stay valid OUTSIDE the shape too.
  it('carries a valid colour in every texel, painted or not', () => {
    const data = makeupTextureData({ blush: 'rose', eyeshadow: 'plum' }, SIZE);
    let black = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (data[i * 4] === 0 && data[i * 4 + 1] === 0 && data[i * 4 + 2] === 0) black++;
    }
    expect(black).toBe(0);
  });

  it('paints each layer only where that layer goes', () => {
    const lid = { theta: 88, az: 29 };
    const cheek = { theta: 110, az: 55 };
    expect(alphaAt({ blush: 'none', eyeshadow: 'plum' }, lid.theta, lid.az)).toBeGreaterThan(40);
    expect(alphaAt({ blush: 'none', eyeshadow: 'plum' }, cheek.theta, cheek.az)).toBe(0);
    expect(alphaAt({ blush: 'rose', eyeshadow: 'none' }, cheek.theta, cheek.az)).toBeGreaterThan(
      20,
    );
    expect(alphaAt({ blush: 'rose', eyeshadow: 'none' }, lid.theta, lid.az)).toBe(0);
  });

  it('paints each layer in its OWN shade, not the material tint', () => {
    // Unlike the stubble map (white, tinted by the material) this one carries
    // two layers in two colours, so the colour has to be in the texels.
    const data = makeupTextureData({ blush: 'rose', eyeshadow: 'teal' }, SIZE);
    const at = (theta: number, az: number) => {
      const [u, v] = decalUv(theta, az);
      const col = Math.min(SIZE - 1, Math.max(0, Math.round(u * SIZE - 0.5)));
      const row = Math.min(SIZE - 1, Math.max(0, Math.round(v * SIZE - 0.5)));
      const i = (row * SIZE + col) * 4;
      return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    };
    expect(at(88, 29)).toBe(shadowColor('teal'));
    expect(at(110, 55)).toBe(blushColor('rose'));
  });

  it('never paints outside the unwrap disc', () => {
    const data = makeupTextureData({ blush: 'rose', eyeshadow: 'plum' }, SIZE);
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const u = (col + 0.5) / SIZE - 0.5;
        const v = (row + 0.5) / SIZE - 0.5;
        if (Math.sqrt(u * u + v * v) <= 0.5) continue;
        expect(data[(row * SIZE + col) * 4 + 3]).toBe(0);
      }
    }
  });

  it('sizes the map smaller than the stubble one', () => {
    // the patches cover a few hundred square degrees between them, not a head
    expect(MAKEUP_TEX_SIZE).toBeLessThan(1024);
  });
});

describe('eyelashes are the female standard', () => {
  it('defaults off on the male body and on for the female', () => {
    expect(defaultLashes('male')).toBe(false);
    expect(defaultLashes('female')).toBe(true);
    expect(DEFAULT_APPEARANCE.gender).toBe('male');
    expect(DEFAULT_APPEARANCE.lashes).toBe(false);
  });

  it('is never rolled onto a male body and always onto a female one', () => {
    for (let i = 0; i < 40; i++) {
      expect(randomizeAppearance(app({ gender: 'male' })).lashes).toBe(false);
      expect(randomizeAppearance(app({ gender: 'female' })).lashes).toBe(true);
    }
  });

  it('fills a save with no opinion from that save’s own gender', () => {
    expect(normalizeAppearance({ gender: 'female' }).lashes).toBe(true);
    expect(normalizeAppearance({ gender: 'male' }).lashes).toBe(false);
    // an explicit choice still wins either way
    expect(normalizeAppearance({ gender: 'male', lashes: true }).lashes).toBe(true);
    expect(normalizeAppearance({ gender: 'female', lashes: false }).lashes).toBe(false);
  });
});
