import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assetsReady } from '../../src/render/assets/preload';
import { DEFAULT_APPEARANCE } from '../../src/render/characters/modular';
import {
  cachedPortraitByKey,
  cachedPortraitDataUrl,
  resetPortraitRendererForGraphicsRebuild,
  visualPortraitDataUrl,
  visualPortraitKey,
} from '../../src/render/characters/portrait';

/** Alpha coverage of a captured portrait: how it is framed, read off the pixels. */
async function coverageOf(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('portrait readback requires a 2D canvas');
  context.drawImage(image, 0, 0);
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const solid = (x: number, y: number) => data[(y * width + x) * 4 + 3] >= 32;
  let firstRow = height;
  let upperMass = 0;
  let upperX = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      firstRow = Math.min(firstRow, y);
      if (y < height / 2) {
        upperMass++;
        upperX += x;
      }
    }
  }
  let bottomSpan = 0;
  for (let x = 0; x < width; x++) if (solid(x, height - 2)) bottomSpan++;
  return {
    width,
    height,
    /** The first row anything draws in: the clear space above the hair. */
    firstRow,
    /** The upper half's horizontal centre of mass (the head), 0..1. */
    upperCenter: upperMass ? upperX / upperMass / width : 0,
    /** How much of the bottom edge the shoulders and chest cover, 0..1. */
    bottomCover: bottomSpan / width,
  };
}

/** The head-first framing, on the real capture: the whole hairstyle under the top
 *  edge, the head centred, the collar and shoulder line along the bottom. */
function expectHeadAndShoulders(c: Awaited<ReturnType<typeof coverageOf>>, label: string): void {
  // the old height-fraction crop cut the helm off at row 0
  expect(c.firstRow, `${label}: clear space above the hair`).toBeGreaterThanOrEqual(
    Math.round(0.03 * c.height),
  );
  expect(Math.abs(c.upperCenter - 0.5), `${label}: head centred`).toBeLessThan(0.06);
  // a close headshot (the owner's 2026-09-30 call): the collar and shoulder line, not
  // the chest, run along the bottom
  expect(c.bottomCover, `${label}: collar and shoulders across the bottom`).toBeGreaterThan(0.4);
}

describe('WOC portrait capture frames the visible character', () => {
  beforeAll(async () => {
    await assetsReady();
  }, 30_000);
  afterAll(() => resetPortraitRendererForGraphicsRebuild());

  const keys = [
    'warrior',
    'paladin',
    'hunter',
    'rogue',
    'mage',
    'priest',
    'warlock',
    'druid',
    'shaman',
  ].flatMap((cls) => [`player_${cls}`, `player_${cls}_female`]);
  it.each(keys)(
    'captures a centered head and shoulders for %s',
    async (key) => {
      // A WOC body streams its files first; the portrait contract is to ask again once they
      // land (onPortraitUpdate), which a mounted chip does and this loop stands in for.
      await vi.waitFor(
        () => {
          visualPortraitDataUrl(key);
          expect(cachedPortraitDataUrl(key)).toBeTruthy();
        },
        { timeout: 45_000, interval: 100 },
      );
      const url = cachedPortraitDataUrl(key);
      expect(url).toBeTruthy();
      const image = new Image();
      image.src = url ?? '';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('portrait readback requires a 2D canvas');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0;
      let topHalf = 0;
      let center = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (data[(y * canvas.width + x) * 4 + 3] < 32) continue;
          opaque++;
          if (y < canvas.height / 2) topHalf++;
          if (x >= 96 && x < 160 && y >= 96 && y < 160) center++;
        }
      }
      // The bad cached skin bounds put the entire head below y=210 and left
      // only ~1,928 alpha pixels in this 256px portrait. Check the rendered
      // output, not a source-string pin or a substituted framing helper.
      expect(opaque).toBeGreaterThan(6000);
      expect(topHalf).toBeGreaterThan(2000);
      expect(center).toBeGreaterThan(1200);
      expectHeadAndShoulders(await coverageOf(url ?? ''), key);
    },
    30_000,
  );

  // The tallest hairstyle of each head type, in the player's own head (the head-keyed
  // capture): the frame lowers the eyes or pulls back, and never crops the hair.
  const tall: Array<[string, Record<string, unknown>]> = [
    ['player_warrior', { ...DEFAULT_APPEARANCE, headHair: 'topknot', headBeard: 'long' }],
    ['player_mage', { ...DEFAULT_APPEARANCE, headHair: 'mohawk', headBeard: 'handlebar' }],
    [
      'player_priest_female',
      { ...DEFAULT_APPEARANCE, gender: 'female', headHair: 'curls', headBeard: 'none' },
    ],
    [
      'player_paladin_female',
      { ...DEFAULT_APPEARANCE, gender: 'female', headHair: 'ponytail', headBeard: 'goatee' },
    ],
  ];
  it.each(tall)(
    'frames a tall hairstyle whole in the player head for %s',
    async (key, head) => {
      const cacheKey = visualPortraitKey(key, 0, 'headshot', head);
      expect(cacheKey).toContain(':head:');
      await vi.waitFor(
        () => {
          visualPortraitDataUrl(key, 0, 'headshot', head);
          expect(cachedPortraitByKey(cacheKey)).toBeTruthy();
        },
        { timeout: 45_000, interval: 100 },
      );
      expectHeadAndShoulders(await coverageOf(cachedPortraitByKey(cacheKey) ?? ''), key);
    },
    30_000,
  );
});
