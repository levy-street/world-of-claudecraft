import { describe, expect, it } from 'vitest';
import { BIOME_FOG, BIOME_LIGHT } from '../src/render/outdoor_biome_presets';
import {
  applyLookPatch,
  cycleLookId,
  DEFAULT_ZONE_NIGHT_SELECTIONS,
  DEFAULT_ZONE_SELECTIONS,
  displayFromRadiance,
  fogSceneHex,
  gradeUniformValues,
  hexToSrgb01,
  isNeutralGrade,
  lookDisplayModel,
  lookToShippingSnippet,
  NEUTRAL_GRADE,
  parseSelections,
  radianceForDisplay,
  resolveZoneLookId,
  STOCK_GRADE_GAIN,
  STOCK_LOOK_ID,
  skyUniformValues,
  stockLookFor,
  whiteBalanceGains,
} from '../src/render/palette_lab/zone_look_core';
import { ZONE_LOOKS } from '../src/render/palette_lab/zone_looks';
import { BIOME_PALETTE } from '../src/render/terrain_palette';
import { ZONES } from '../src/sim/data';

const WATER = { deep: 0x0d3a52, shallow: 0x2d8077, sky: 0x7fb2e0, scatter: 0x55a296 };
const BLOOM = { strength: 0.4, threshold: 1.32 };

describe('stock look', () => {
  it('reads every shipped table row, so selecting it restores the release exactly', () => {
    const look = stockLookFor('vale', WATER, BLOOM);
    expect(look.id).toBe(STOCK_LOOK_ID);
    expect(look.ground).toEqual(BIOME_PALETTE.vale);
    expect(look.fog.sceneColor).toBe(BIOME_FOG.vale.color);
    expect(look.fog.near).toBe(BIOME_FOG.vale.near);
    expect(look.fog.far).toBe(BIOME_FOG.vale.far);
    expect(look.light.hemiSky).toBe(BIOME_LIGHT.vale.hemiSky);
    expect(look.light.sunScale).toBe(1);
    expect(look.sky.amount).toBe(0);
    expect(isNeutralGrade(look.grade)).toBe(true);
    // The fog row it writes is the shipped hex verbatim, never a solver round trip.
    expect(fogSceneHex(look, 1.12)).toBe(BIOME_FOG.vale.color);
  });

  it('keeps an optional light scale the table sets', () => {
    expect(stockLookFor('night', WATER, BLOOM).light.sunScale).toBe(BIOME_LIGHT.night.sunScale);
  });

  it('turns the grade arm off entirely (mix 0 keeps the stock GAIN in the shader)', () => {
    const v = gradeUniformValues(NEUTRAL_GRADE);
    expect(v.wb[3]).toBe(0);
  });
});

describe('curated looks over stock', () => {
  const stock = stockLookFor('vale', WATER, BLOOM);

  it('takes every field the patch names and keeps the rest', () => {
    const look = applyLookPatch(stock, {
      id: 'x',
      name: 'X',
      note: 'n',
      ground: { grass: 0x112233 },
      grade: { contrast: 1.2 },
    });
    expect(look.ground.grass).toBe(0x112233);
    expect(look.ground.dirt).toBe(stock.ground.dirt);
    expect(look.grade.contrast).toBe(1.2);
    expect(look.grade.saturation).toBe(1);
    // A look that leaves the fog alone keeps the shipped scene hex.
    expect(look.fog.sceneColor).toBe(stock.fog.sceneColor);
  });

  it('drops the stock scene hex once a look names its own haze colour', () => {
    const look = applyLookPatch(stock, { id: 'x', name: 'X', note: 'n', fog: { color: 0x9cc6ea } });
    expect(look.fog.sceneColor).toBeUndefined();
    expect(look.fog.near).toBe(stock.fog.near);
  });

  it('switches the grade arm on with the look white balance', () => {
    const look = applyLookPatch(stock, {
      id: 'x',
      name: 'X',
      note: 'n',
      grade: { temperature: 0.2 },
    });
    const v = gradeUniformValues(look.grade);
    expect(v.wb[3]).toBe(1);
    expect(v.wb[0]).toBeGreaterThan(v.wb[2]);
  });
});

describe('display model', () => {
  it('white balance is neutral at zero and keeps mid-grey luminance', () => {
    expect(whiteBalanceGains(0, 0)).toEqual([1, 1, 1]);
    const [r, g, b] = whiteBalanceGains(0.5, -0.3);
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 10);
  });

  it('solves a sky colour back to the radiance that displays as it', () => {
    const model = { gain: [1, 1, 1] as const, exposure: 1, celSaturation: 1.12 };
    for (const hex of [0x2f86e6, 0x9cc6ea, 0xf6cf9e, 0x5a3ab0]) {
      const shown = displayFromRadiance(radianceForDisplay(hex, model), model);
      const want = hexToSrgb01(hex);
      for (let ch = 0; ch < 3; ch++) expect(Math.abs(shown[ch] - want[ch])).toBeLessThan(2 / 255);
    }
  });

  it('explains why the stock grade can never show a clean sky blue', () => {
    // The stock GAIN warms every white: blue lands well under red, so a pale
    // cyan haze or sky reads cream under it. Looks replace that gain.
    const stock = { gain: STOCK_GRADE_GAIN, exposure: 1, celSaturation: 1 };
    const neutral = { gain: [1, 1, 1] as const, exposure: 1, celSaturation: 1 };
    const warm = displayFromRadiance([8, 8, 8], stock);
    const clean = displayFromRadiance([8, 8, 8], neutral);
    expect((warm[0] - warm[2]) * 255).toBeGreaterThan(18);
    expect(Math.abs(clean[0] - clean[2]) * 255).toBeLessThan(2);
  });

  it('feeds a look its own model to the sky arm', () => {
    const look = applyLookPatch(stockLookFor('vale', WATER, BLOOM), {
      id: 'x',
      name: 'X',
      note: 'n',
      sky: { zenith: 0x2f86e6, horizon: 0xcdeaf8, amount: 0.8 },
      grade: { temperature: 0.06 },
    });
    const sky = skyUniformValues(look.sky, lookDisplayModel(look, 1.12));
    expect(sky.zenith[3]).toBe(0.8);
    expect(sky.zenith[2]).toBeGreaterThan(sky.zenith[0]);
  });
});

describe('selections', () => {
  it('drops malformed rows and the stock id', () => {
    expect(parseSelections(null)).toEqual({});
    expect(parseSelections('not json')).toEqual({});
    expect(parseSelections('[1,2]')).toEqual({});
    expect(parseSelections('{"a":"x","b":3,"c":"stock"}')).toEqual({ a: 'x' });
  });

  it('cycles with wrap-around in both directions', () => {
    const ids = ['stock', 'a', 'b'];
    expect(cycleLookId(ids, 'stock', 1)).toBe('a');
    expect(cycleLookId(ids, 'b', 1)).toBe('stock');
    expect(cycleLookId(ids, 'stock', -1)).toBe('b');
    expect(cycleLookId(ids, 'missing', 1)).toBe('a');
  });

  it('exports a look as the table rows it ships as', () => {
    const look = stockLookFor('vale', WATER, BLOOM);
    const text = lookToShippingSnippet('eastbrook_vale', 'vale', look);
    expect(text).toContain('BIOME_PALETTE.vale');
    expect(text).toContain(`color: 0x${BIOME_FOG.vale.color.toString(16).padStart(6, '0')}`);
    expect(text).toContain('BIOME_LIGHT.vale');
  });

  it('resolves every default zone selection and switches Thornpeak between Alpine Clear (day) and Sky Island Gold (night)', () => {
    for (const [zoneId, lookId] of Object.entries(DEFAULT_ZONE_SELECTIONS)) {
      const looks = ZONE_LOOKS[zoneId] ?? [];
      expect(
        looks.some((l) => l.id === lookId),
        `${zoneId}/${lookId}`,
      ).toBe(true);
      expect(
        resolveZoneLookId(zoneId, DEFAULT_ZONE_SELECTIONS, DEFAULT_ZONE_NIGHT_SELECTIONS, false),
      ).toBe(lookId);
    }
    for (const [zoneId, lookId] of Object.entries(DEFAULT_ZONE_NIGHT_SELECTIONS)) {
      const looks = ZONE_LOOKS[zoneId] ?? [];
      expect(
        looks.some((l) => l.id === lookId),
        `${zoneId}/${lookId}`,
      ).toBe(true);
    }
    expect(
      resolveZoneLookId(
        'thornpeak_heights',
        DEFAULT_ZONE_SELECTIONS,
        DEFAULT_ZONE_NIGHT_SELECTIONS,
        false,
      ),
    ).toBe('alpine-clear');
    expect(
      resolveZoneLookId(
        'thornpeak_heights',
        DEFAULT_ZONE_SELECTIONS,
        DEFAULT_ZONE_NIGHT_SELECTIONS,
        true,
      ),
    ).toBe('sky-island-gold');
    expect(
      resolveZoneLookId(
        'drakelands',
        DEFAULT_ZONE_SELECTIONS,
        DEFAULT_ZONE_NIGHT_SELECTIONS,
        false,
      ),
    ).toBe('ashfall');
    expect(
      resolveZoneLookId('drakelands', DEFAULT_ZONE_SELECTIONS, DEFAULT_ZONE_NIGHT_SELECTIONS, true),
    ).toBe('obsidian-teal');
    expect(
      resolveZoneLookId('frostveil', DEFAULT_ZONE_SELECTIONS, DEFAULT_ZONE_NIGHT_SELECTIONS, false),
    ).toBe('glacier-teal');
    expect(
      resolveZoneLookId('frostveil', DEFAULT_ZONE_SELECTIONS, DEFAULT_ZONE_NIGHT_SELECTIONS, true),
    ).toBe('violet-whiteout');
    expect(
      resolveZoneLookId('amberfall', DEFAULT_ZONE_SELECTIONS, DEFAULT_ZONE_NIGHT_SELECTIONS, false),
    ).toBe('sky-island-gold');
    expect(
      resolveZoneLookId('amberfall', DEFAULT_ZONE_SELECTIONS, DEFAULT_ZONE_NIGHT_SELECTIONS, true),
    ).toBe('sky-island-gold');
  });
});

describe('curated look data', () => {
  const zoneIds = new Set(ZONES.map((z) => z.id));
  const hexOk = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffffff;

  it('covers every shipped zone with several looks', () => {
    for (const zone of ZONES) {
      expect(ZONE_LOOKS[zone.id]?.length ?? 0, zone.id).toBeGreaterThanOrEqual(4);
    }
  });

  it('keys only real zones, with unique non-stock ids', () => {
    for (const [zone, looks] of Object.entries(ZONE_LOOKS)) {
      expect(zoneIds.has(zone), zone).toBe(true);
      const ids = looks.map((l) => l.id);
      expect(new Set(ids).size, zone).toBe(ids.length);
      expect(ids, zone).not.toContain(STOCK_LOOK_ID);
    }
  });

  it('builds every look into sane values', () => {
    for (const zone of ZONES) {
      const stock = stockLookFor(zone.biome, WATER, BLOOM);
      for (const patch of ZONE_LOOKS[zone.id] ?? []) {
        const look = applyLookPatch(stock, patch);
        const where = `${zone.id}/${look.id}`;
        for (const hex of [
          ...Object.values(look.ground),
          look.fog.color,
          look.light.hemiSky,
          look.light.hemiGround,
          look.light.sun,
          look.sky.zenith,
          look.sky.horizon,
          ...Object.values(look.water),
          look.grade.shadowTint,
          look.grade.highlightTint,
        ]) {
          expect(hexOk(hex), where).toBe(true);
        }
        expect(look.fog.near, where).toBeLessThan(look.fog.far);
        expect(look.fog.far, where).toBeLessThanOrEqual(850);
        expect(look.light.hemiScale, where).toBeGreaterThan(0);
        expect(look.light.hemiScale, where).toBeLessThanOrEqual(6);
        expect(look.sky.amount, where).toBeGreaterThanOrEqual(0);
        expect(look.sky.amount, where).toBeLessThanOrEqual(1);
        expect(look.grade.exposure, where).toBeGreaterThan(0.6);
        expect(look.grade.exposure, where).toBeLessThan(1.5);
        expect(Math.abs(look.grade.greenHue), where).toBeLessThanOrEqual(90);
        expect(look.note.length, where).toBeGreaterThan(10);
        expect(look.note, where).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });
});
