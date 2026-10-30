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
  groundKey,
  hexToLinear,
  hexToSrgb01,
  isNeutralGrade,
  type LookPatch,
  lookDisplayModel,
  lookToPatchSnippet,
  lookToShippingSnippet,
  NEUTRAL_GRADE,
  parseSelections,
  radianceForDisplay,
  resolveZoneLookId,
  STOCK_GRADE_GAIN,
  STOCK_LOOK_ID,
  STOCK_RENDER,
  skyUniformValues,
  stockLookFor,
  whiteBalanceGains,
  type ZoneLook,
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

describe('Eastbrook Vale painted look', () => {
  const stock = stockLookFor('vale', WATER, BLOOM);
  const eastbrook = (id: string): ZoneLook => {
    const patch = (ZONE_LOOKS.eastbrook_vale ?? []).find((l) => l.id === id);
    if (!patch) throw new Error(`eastbrook_vale has no look ${id}`);
    return applyLookPatch(stock, patch);
  };
  const day = eastbrook('painted-vale');
  const night = eastbrook('painted-vale-night');
  const highKey = eastbrook('skyward-isles');
  const luminance = (hex: number): number => {
    const [r, g, b] = hexToLinear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // What a hemisphere actually pours in: its scale times its colour's level.
  const fill = (look: ZoneLook): number => look.light.hemiScale * luminance(look.light.hemiSky);
  // The vale's painted sky (sky.ts) pours about this share of the retired photo
  // sky's IBL energy (the sky workstream's measurement), so its envScale reads
  // against today's looks only after this factor.
  const PAINTED_SKY_IBL = 0.46;
  const hue = (hex: number): number => {
    const [r, g, b] = hexToSrgb01(hex);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const warmth = (hex: number): number => {
    const [r, , b] = hexToLinear(hex);
    return r / Math.max(b, 1e-6);
  };

  it('resolves Eastbrook to Painted Vale by day and its night companion after dark', () => {
    expect(DEFAULT_ZONE_SELECTIONS.eastbrook_vale).toBe('painted-vale');
    expect(DEFAULT_ZONE_NIGHT_SELECTIONS.eastbrook_vale).toBe('painted-vale-night');
    const resolve = (zone: string, isNight: boolean) =>
      resolveZoneLookId(zone, DEFAULT_ZONE_SELECTIONS, DEFAULT_ZONE_NIGHT_SELECTIONS, isNight);
    expect(resolve('eastbrook_vale', false)).toBe('painted-vale');
    expect(resolve('eastbrook_vale', true)).toBe('painted-vale-night');
    // The other two Skyward Isles zones keep it day and night.
    for (const zone of ['proving_shore', 'galecrest']) {
      expect(resolve(zone, false), zone).toBe('skyward-isles');
      expect(resolve(zone, true), zone).toBe('skyward-isles');
    }
  });

  it('leaves every other zone on the look it already shipped', () => {
    const { eastbrook_vale: _day, ...otherDay } = DEFAULT_ZONE_SELECTIONS;
    expect(otherDay).toEqual({
      proving_shore: 'skyward-isles',
      mirefen_marsh: 'jade-wetland',
      thornpeak_heights: 'alpine-clear',
      farshore_isle: 'tropic-lagoon',
      galecrest: 'skyward-isles',
      evergarden: 'afternoon-reverie',
      willowfen: 'spring-watercolour',
      palmreach: 'lagoon-turquoise',
      veiled_hollow: 'rosewater-twilight',
      nightbloom: 'fae-pink',
      drakelands: 'ashfall',
      frostveil: 'glacier-teal',
      amberfall: 'sky-island-gold',
    });
    const { eastbrook_vale: _night, ...otherNight } = DEFAULT_ZONE_NIGHT_SELECTIONS;
    expect(otherNight).toEqual({
      thornpeak_heights: 'sky-island-gold',
      drakelands: 'obsidian-teal',
      frostveil: 'violet-whiteout',
      amberfall: 'sky-island-gold',
    });
  });

  it('is darker and moodier than the high-key look it replaces', () => {
    // Tuned by eye in game against the reference frames: the shade deepens
    // hard (a quarter to under half the high key's sky fill, less image light)
    // while the warm key rises, for the light-pool contrast those frames have.
    expect(fill(day)).toBeLessThan(fill(highKey) * 0.45);
    expect(fill(day)).toBeGreaterThan(fill(highKey) * 0.25);
    // The image light, in the retired photo sky's units (the painted vale sky
    // pours PAINTED_SKY_IBL of its energy): well under the high key's, never mud.
    const ibl = day.light.envScale * PAINTED_SKY_IBL;
    expect(ibl).toBeLessThan(highKey.light.envScale * 0.6);
    expect(ibl).toBeGreaterThanOrEqual(0.6);
    expect(day.grade.exposure).toBeLessThanOrEqual(1);
    expect(day.grade.exposure).toBeGreaterThanOrEqual(0.85);
    // The key is BRIGHTER than the old one (the warmer hex carries less
    // luminance, and its scale more than makes up for it): lit pools pop
    // against the deeper shade.
    const key = (look: ZoneLook) => look.light.sunScale * luminance(look.light.sun);
    expect(key(day) / key(highKey)).toBeGreaterThan(1.1);
    expect(key(day) / key(highKey)).toBeLessThan(1.4);
    expect(day.grade.contrast).toBeGreaterThanOrEqual(1.04);
    expect(day.grade.contrast).toBeLessThanOrEqual(1.16);
    expect(day.grade.saturation).toBeGreaterThanOrEqual(0.98);
    expect(day.grade.saturation).toBeLessThanOrEqual(1.06);
    expect(day.grade.vibrance).toBeLessThanOrEqual(0.15);
    expect(day.bloom.strength).toBeLessThanOrEqual(0.35);
    expect(day.bloom.threshold).toBeGreaterThanOrEqual(1.2);
  });

  it('lights warm and shades cool, with earthy painted ground', () => {
    expect(warmth(day.light.sun)).toBeGreaterThan(2);
    expect(warmth(day.light.hemiSky)).toBeLessThan(0.7);
    expect(warmth(day.grade.highlightTint)).toBeGreaterThan(1.5);
    expect(warmth(day.grade.shadowTint)).toBeLessThan(0.5);
    expect(day.grade.shadowAmt).toBeGreaterThanOrEqual(0.3);
    expect(day.grade.shadowAmt).toBeLessThanOrEqual(0.5);
    expect(day.grade.highlightAmt).toBeGreaterThanOrEqual(0.1);
    expect(day.grade.highlightAmt).toBeLessThanOrEqual(0.15);
    expect(day.grade.greenHue).toBeLessThan(0);
    expect(day.grade.greenHue).toBeGreaterThanOrEqual(-8);
    // Yellow-green grass in the light, teal-green in the lush shade, ochre dirt.
    expect(hue(day.ground.grass)).toBeGreaterThan(75);
    expect(hue(day.ground.grass)).toBeLessThan(110);
    expect(hue(day.ground.grassYellow)).toBeGreaterThan(50);
    expect(hue(day.ground.grassYellow)).toBeLessThan(hue(day.ground.grass));
    expect(hue(day.ground.grassDark)).toBeGreaterThan(130);
    expect(hue(day.ground.grassDark)).toBeLessThan(170);
    expect(hue(day.ground.dirt)).toBeGreaterThan(20);
    expect(hue(day.ground.dirt)).toBeLessThan(45);
    // A soft blue-teal haze, a painted horizon's distance.
    expect(hue(day.fog.color)).toBeGreaterThan(175);
    expect(hue(day.fog.color)).toBeLessThan(215);
    expect(day.fog.near).toBeGreaterThanOrEqual(90);
    expect(day.fog.near).toBeLessThanOrEqual(120);
    expect(day.fog.far).toBeGreaterThanOrEqual(600);
    expect(day.fog.far).toBeLessThanOrEqual(700);
  });

  it('leaves the painted sky and the meadow to their own work, with a small warm rim', () => {
    for (const look of [day, night]) {
      // The gradient arm at zero: the dome's painted sky is never repainted.
      expect(look.sky.amount, look.id).toBe(0);
      expect(look.render.meadowCoverage, look.id).toBe(STOCK_RENDER.meadowCoverage);
      expect(look.render.meadowHeight, look.id).toBe(STOCK_RENDER.meadowHeight);
      expect(look.render.meadowWidth, look.id).toBe(STOCK_RENDER.meadowWidth);
      expect(look.render.rim, look.id).toBeGreaterThan(0);
      expect(look.render.rim, look.id).toBeLessThanOrEqual(0.35);
    }
    expect(day.render.rimColor).not.toBeNull();
    expect(warmth(day.render.rimColor ?? 0)).toBeGreaterThan(1.5);
  });

  it('switches to night without a re-bake, a water snap or a grass re-place', () => {
    expect(groundKey(night.ground)).toBe(groundKey(day.ground));
    expect(night.water).toEqual(day.water);
    expect(night.fog.near).toBe(day.fog.near);
    expect(night.fog.far).toBe(day.fog.far);
    expect(night.render.meadowCoverage).toBe(day.render.meadowCoverage);
    expect(night.render.meadowHeight).toBe(day.render.meadowHeight);
    expect(night.render.meadowWidth).toBe(day.render.meadowWidth);
  });

  it('keeps the night moonlit blue, warm at the lamps and readable', () => {
    // More fill than the day look: the renderer's night already halves it.
    expect(fill(night)).toBeGreaterThan(fill(day));
    expect(fill(night)).toBeLessThan(fill(highKey));
    expect(night.light.envScale).toBeGreaterThanOrEqual(day.light.envScale);
    expect(night.light.envScale * PAINTED_SKY_IBL).toBeLessThan(highKey.light.envScale);
    expect(warmth(night.light.hemiSky)).toBeLessThan(warmth(day.light.hemiSky));
    expect(warmth(night.light.sun)).toBeLessThan(1);
    expect(warmth(night.grade.shadowTint)).toBeLessThan(0.5);
    expect(warmth(night.grade.highlightTint)).toBeGreaterThan(1.5);
    // Never crushed black: a real lift, no extra contrast, no exposure cut.
    expect(night.grade.lift).toBeGreaterThanOrEqual(0.08);
    expect(night.grade.contrast).toBeLessThanOrEqual(1);
    expect(night.grade.exposure).toBeGreaterThanOrEqual(1);
    expect(night.godRays).toBe(0);
  });
});

describe('lookToPatchSnippet (paste a tuned look back into zone_looks.ts)', () => {
  const stock = stockLookFor('vale', WATER, BLOOM);
  const parse = (snippet: string): LookPatch =>
    new Function(`return ${snippet.trim().replace(/,$/, '')};`)() as LookPatch;

  it('round-trips a curated look exactly, every field resolved', () => {
    for (const id of ['painted-vale', 'painted-vale-night']) {
      const patch = (ZONE_LOOKS.eastbrook_vale ?? []).find((l) => l.id === id);
      expect(patch, id).toBeDefined();
      const look = applyLookPatch(stock, patch as LookPatch);
      const snippet = lookToPatchSnippet(look);
      expect(snippet.startsWith('{\n')).toBe(true);
      expect(snippet.endsWith('},')).toBe(true);
      expect(applyLookPatch(stock, parse(snippet))).toEqual(look);
    }
  });

  it('keeps a look on its shipped haze by leaving the fog colour out, and quotes text safely', () => {
    const look = applyLookPatch(stock, {
      id: 'x',
      name: "Jo's Look",
      note: "A note with a \\ backslash and a quote: '",
      grade: { contrast: 1.2 },
    });
    const snippet = lookToPatchSnippet(look);
    expect(snippet).toContain('fog: { near: ');
    const back = applyLookPatch(stock, parse(snippet));
    expect(back).toEqual(look);
    expect(back.fog.sceneColor).toBe(BIOME_FOG.vale.color);
    expect(back.name).toBe("Jo's Look");
  });
});
