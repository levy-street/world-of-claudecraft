import { describe, expect, it } from 'vitest';
import {
  FLOWERLESS_BIOMES as FOLIAGE_FLOWERLESS,
  GRASS_BIOME_DENSITY,
} from '../src/render/foliage';
import { BIOME_FOG, BIOME_LIGHT } from '../src/render/outdoor_biome_presets';
import {
  BLADELESS_BIOMES,
  FLOWERLESS_BIOMES,
  STORYBOOK_GRASS_RENDER,
  storybookGrassForBiome,
  storybookRampFor,
} from '../src/render/palette_lab/storybook_grass_core';
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
import { STOCK_WITH_GRASS_ID, ZONE_LOOKS } from '../src/render/palette_lab/zone_looks';
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

describe('Storybook Meadow (Eastbrook, the art bible look)', () => {
  const stock = stockLookFor('vale', WATER, BLOOM);

  it('is Eastbrook Vale default day look', () => {
    expect(DEFAULT_ZONE_SELECTIONS.eastbrook_vale).toBe('storybook-meadow');
    expect(
      resolveZoneLookId(
        'eastbrook_vale',
        DEFAULT_ZONE_SELECTIONS,
        DEFAULT_ZONE_NIGHT_SELECTIONS,
        true,
      ),
    ).toBe('storybook-meadow');
  });

  it('draws no world ink, paints cumulus and lowers the dome horizon band', () => {
    const patch = (ZONE_LOOKS.eastbrook_vale ?? []).find((l) => l.id === 'storybook-meadow');
    expect(patch).toBeDefined();
    const look = applyLookPatch(stock, patch!);
    expect(look.render.ink).toBe(0);
    expect(look.sky.clouds).toBeGreaterThan(0);
    expect(look.sky.band).toBeGreaterThan(0);
    expect(look.sky.band).toBeLessThan(0.36);
    const sky = skyUniformValues(look.sky, lookDisplayModel(look, 1));
    expect(sky.clouds).toBe(look.sky.clouds);
    expect(sky.band).toBe(look.sky.band);
  });

  it('leaves the stock look and every other zone default on the shipped ink, clouds and band', () => {
    expect(stock.render.ink).toBe(1);
    expect(stock.sky.clouds).toBe(0);
    expect(stock.sky.band).toBe(0);
    for (const [zoneId, lookId] of Object.entries(DEFAULT_ZONE_SELECTIONS)) {
      if (zoneId === 'eastbrook_vale') continue;
      const patch = (ZONE_LOOKS[zoneId] ?? []).find((l) => l.id === lookId);
      const look = applyLookPatch(stock, patch!);
      expect(look.render.ink, `${zoneId}/${lookId}`).toBe(1);
      expect(look.sky.clouds, `${zoneId}/${lookId}`).toBe(0);
      expect(look.sky.band, `${zoneId}/${lookId}`).toBe(0);
    }
  });
});

describe('the storybook meadow grass in every zone', () => {
  const stock = stockLookFor('vale', WATER, BLOOM);

  it('stock is the shipped blade, ramp and ink', () => {
    expect(stock.render.bladeWidth).toBe(1);
    expect(stock.render.bladeBase).toBe(1);
    expect(stock.render.rampSoft).toBe(0);
    expect(stock.render.ink).toBe(1);
  });

  it('Storybook Meadow thins and deepens the blades and softens the ramp', () => {
    const patch = (ZONE_LOOKS.eastbrook_vale ?? []).find((l) => l.id === 'storybook-meadow');
    const look = applyLookPatch(stock, patch!);
    expect(look.render.bladeWidth).toBeLessThan(1);
    expect(look.render.bladeBase).toBeLessThan(1);
    expect(look.render.rampSoft).toBeGreaterThan(0);
  });

  it('every grass zone default grows the storybook blades in its own colours', () => {
    for (const [zoneId, lookId] of Object.entries(DEFAULT_ZONE_SELECTIONS)) {
      if (zoneId === 'eastbrook_vale') continue;
      const biome = ZONES.find((z) => z.id === zoneId)?.biome;
      if (!biome || BLADELESS_BIOMES.has(biome)) continue;
      const patch = (ZONE_LOOKS[zoneId] ?? []).find((l) => l.id === lookId);
      const look = applyLookPatch(stock, patch!);
      const tag = `${zoneId}/${lookId}`;
      expect(look.render.bladeWidth, tag).toBe(STORYBOOK_GRASS_RENDER.bladeWidth);
      expect(look.render.bladeExtra, tag).toBe(1);
      expect(look.render.rampStrength, tag).toBe(STORYBOOK_GRASS_RENDER.rampStrength);
      expect(look.render.flowerShare, tag).toBe(
        FLOWERLESS_BIOMES.has(biome) ? 0 : STORYBOOK_GRASS_RENDER.flowerShare,
      );
      // the ramp is the zone's own grass, not Eastbrook's greens
      const ramp = storybookRampFor(
        patch?.ground?.grass ?? BIOME_PALETTE[biome].grass,
        patch?.ground?.grassDark ?? BIOME_PALETTE[biome].grassDark,
      );
      expect(look.render.rampShadow, tag).toBe(ramp.rampShadow);
      expect(look.render.rampLight, tag).toBe(ramp.rampLight);
      // the grass block never brings the meadow's rim or ink with it
      expect(look.render.ink, tag).toBe(1);
    }
  });

  it('bladeless zones keep the shipped blade and ramp', () => {
    let seen = 0;
    for (const zone of ZONES) {
      if (!BLADELESS_BIOMES.has(zone.biome)) continue;
      for (const patch of ZONE_LOOKS[zone.id] ?? []) {
        const look = applyLookPatch(stock, patch);
        const tag = `${zone.id}/${patch.id}`;
        expect(look.render.bladeExtra, tag).toBe(0);
        expect(look.render.rampStrength, tag).toBe(0);
        expect(look.render.paintTip, tag).toBe(0);
        expect(look.render.bladeFar, tag).toBe(0);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('night defaults grow the storybook blades too', () => {
    let seen = 0;
    for (const [zoneId, lookId] of Object.entries(DEFAULT_ZONE_NIGHT_SELECTIONS)) {
      const biome = ZONES.find((z) => z.id === zoneId)?.biome;
      if (!biome || BLADELESS_BIOMES.has(biome)) continue;
      const patch = (ZONE_LOOKS[zoneId] ?? []).find((l) => l.id === lookId);
      const look = applyLookPatch(stock, patch!);
      expect(look.render.bladeExtra, `${zoneId}/${lookId}`).toBe(1);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('Eastbrook keeps its own authored ramp over the derived one', () => {
    const patch = (ZONE_LOOKS.eastbrook_vale ?? []).find((l) => l.id === 'storybook-meadow');
    expect(patch?.render?.rampShadow).toBe(0x2c7442);
    expect(patch?.render?.rampLight).toBe(0x8ec462);
    expect(patch?.render?.ink).toBe(0);
    expect(patch?.render?.rim).toBe(0.3);
  });

  it('Wraithwood ships the stock look with the storybook grass and nothing else', () => {
    expect(DEFAULT_ZONE_SELECTIONS.wraithwood).toBe(STOCK_WITH_GRASS_ID);
    const patch = (ZONE_LOOKS.wraithwood ?? []).find((l) => l.id === STOCK_WITH_GRASS_ID);
    expect(patch?.grade).toBeUndefined();
    expect(patch?.ground).toBeUndefined();
    expect(patch?.sky).toBeUndefined();
    const p = BIOME_PALETTE.haunt;
    expect(patch?.render).toEqual(storybookGrassForBiome('haunt', p.grass, p.grassDark));
  });

  it('the no-blade and no-flower biome lists match the foliage tables', () => {
    const bladeless = Object.entries(GRASS_BIOME_DENSITY)
      .filter(([, d]) => d === 0)
      .map(([b]) => b)
      .sort();
    expect([...BLADELESS_BIOMES].sort()).toEqual(bladeless);
    expect([...FLOWERLESS_BIOMES].sort()).toEqual([...FOLIAGE_FLOWERLESS].sort());
  });
});
