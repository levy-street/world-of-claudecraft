// The farm patch render core: the pure visual decisions behind the beds and
// the growth-stage meshes. Plain Node Vitest, no three.js and no DOM, which is
// the whole point of the core living apart from the adapter.
import { describe, expect, it } from 'vitest';
import {
  FARM_ACCENT_MATERIAL_NAME,
  FARM_ACCENT_MESH_NAME,
  FARM_BED_MODEL_URL,
  FARM_BIOME_PALETTES,
  FARM_COMPOST_BIN_MODEL_URL,
  FARM_COMPOST_BIN_OFFSET,
  FARM_CROP_ACCENT,
  FARM_CROP_FAMILY,
  FARM_FALLBACK_ACCENT,
  FARM_FALLBACK_FAMILY,
  FARM_SOIL_SOCKET_NAME,
  FARM_SPROUT_MODEL_URL,
  FARM_WET_BAND_1_MS,
  FARM_WET_BAND_2_MS,
  farmBiomePalette,
  farmCompostBinPosition,
  farmCropAccent,
  farmCropFamily,
  farmModelUrls,
  farmPlotKeyMatches,
  farmStageModelUrl,
  farmWetBand,
  resolveFarmPlotVisual,
} from '../src/render/farm_patches_core';
import { FARM_CROP_IDS } from '../src/sim/content/farm_crops';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import type { FarmPlotView } from '../src/world_api/farming';

// A one-hour growth window starting at t=0, so a stage boundary is a round
// number: seedling at 1/3 (20 min), maturing at 2/3 (40 min), ready at 60 min.
const HOUR = 60 * 60 * 1000;

function plot(over: Partial<FarmPlotView> = {}): FarmPlotView {
  return {
    bedId: 'bed_eastbrook_1',
    cropId: 'vale_wheat',
    plantedAtMs: 0,
    readyAtMs: HOUR,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    status: 'growing',
    ...over,
  };
}

describe('farm crop families', () => {
  it('gives EVERY live crop an explicit family row (a ninth crop reds this)', () => {
    for (const id of FARM_CROP_IDS) {
      expect(
        Object.hasOwn(FARM_CROP_FAMILY, id),
        `crop ${id} has no FARM_CROP_FAMILY row, so it would silently take the fallback`,
      ).toBe(true);
    }
    // ...and no row survives for a crop the table no longer ships.
    for (const id of Object.keys(FARM_CROP_FAMILY)) {
      expect(FARM_CROP_IDS.has(id), `FARM_CROP_FAMILY names a retired crop ${id}`).toBe(true);
    }
    expect(Object.keys(FARM_CROP_FAMILY).length).toBe(FARM_CROP_IDS.size);
  });

  it('spreads the eight crops across all three families', () => {
    const families = new Set(Object.values(FARM_CROP_FAMILY));
    expect([...families].sort()).toEqual(['gourd', 'grain', 'rootleaf']);
  });

  it('resolves each live crop to its own row, and an unknown id to the fallback', () => {
    expect(farmCropFamily('vale_wheat')).toBe('grain');
    expect(farmCropFamily('brook_carrot')).toBe('rootleaf');
    expect(farmCropFamily('frost_gourd')).toBe('gourd');
    expect(farmCropFamily('no_such_crop')).toBe(FARM_FALLBACK_FAMILY);
  });

  it('gives EVERY live crop an explicit accent, all of them distinct', () => {
    for (const id of FARM_CROP_IDS) {
      expect(Object.hasOwn(FARM_CROP_ACCENT, id), `crop ${id} has no accent row`).toBe(true);
    }
    expect(Object.keys(FARM_CROP_ACCENT).length).toBe(FARM_CROP_IDS.size);
    const accents = Object.values(FARM_CROP_ACCENT);
    expect(new Set(accents).size, 'two crops sharing an accent are indistinguishable').toBe(
      accents.length,
    );
    // Every accent is a real 24-bit colour, and none is the fallback grey.
    for (const [id, hex] of Object.entries(FARM_CROP_ACCENT)) {
      expect(Number.isInteger(hex), `${id} accent is not an integer`).toBe(true);
      expect(hex, `${id} accent out of range`).toBeGreaterThanOrEqual(0);
      expect(hex, `${id} accent out of range`).toBeLessThanOrEqual(0xffffff);
      expect(hex, `${id} accent collides with the unknown-crop fallback`).not.toBe(
        FARM_FALLBACK_ACCENT,
      );
    }
    expect(farmCropAccent('no_such_crop')).toBe(FARM_FALLBACK_ACCENT);
  });
});

describe('farm biome palettes', () => {
  it('covers EXACTLY the four live patch zones', () => {
    const live = FARM_PATCHES.map((p) => p.zoneId).sort();
    expect(Object.keys(FARM_BIOME_PALETTES).sort()).toEqual(live);
    expect(live.length).toBe(4);
  });

  it('resolves each live zone to its own palette, and an unknown zone to the fallback', () => {
    const seen = new Set<string>();
    for (const patch of FARM_PATCHES) {
      const palette = farmBiomePalette(patch.zoneId);
      expect(palette).toBe(FARM_BIOME_PALETTES[patch.zoneId]);
      seen.add(`${palette.soil}:${palette.wood}:${palette.trim}`);
    }
    expect(seen.size, 'two patches sharing a palette read as the same garden').toBe(
      FARM_PATCHES.length,
    );
    const fallback = farmBiomePalette('no_such_zone');
    expect(Object.keys(FARM_BIOME_PALETTES)).not.toContain('no_such_zone');
    expect(fallback.soil).toBeGreaterThan(0);
  });
});

describe('stage mesh mapping', () => {
  it('walks sprout, stage2, stage3, stage4 across the growth window', () => {
    expect(resolveFarmPlotVisual(plot(), 0).stageMesh).toBe('sprout');
    expect(resolveFarmPlotVisual(plot(), HOUR / 3 - 1).stageMesh).toBe('sprout');
    expect(resolveFarmPlotVisual(plot(), HOUR / 3).stageMesh).toBe('stage2');
    expect(resolveFarmPlotVisual(plot(), (2 * HOUR) / 3 - 1).stageMesh).toBe('stage2');
    expect(resolveFarmPlotVisual(plot(), (2 * HOUR) / 3).stageMesh).toBe('stage3');
    expect(resolveFarmPlotVisual(plot(), HOUR - 1).stageMesh).toBe('stage3');
    expect(resolveFarmPlotVisual(plot(), HOUR).stageMesh).toBe('stage4');
  });

  it('lets the authority status override the fraction in BOTH directions', () => {
    // Withered wins even at a fraction that would read as sprout...
    expect(resolveFarmPlotVisual(plot({ status: 'withered' }), 0).stageMesh).toBe('withered');
    expect(resolveFarmPlotVisual(plot({ status: 'withered' }), HOUR * 5).stageMesh).toBe(
      'withered',
    );
    // ...and ready wins even before the window has elapsed (the authority is
    // the only thing that decides a plot is harvestable).
    expect(resolveFarmPlotVisual(plot({ status: 'ready' }), 0).stageMesh).toBe('stage4');
  });

  it('holds stage4 forever after the deadline (nothing rots)', () => {
    expect(resolveFarmPlotVisual(plot(), HOUR * 1000).stageMesh).toBe('stage4');
  });

  it('reads a zero-length window as ready', () => {
    expect(resolveFarmPlotVisual(plot({ readyAtMs: 0 }), 0).stageMesh).toBe('stage4');
  });

  it('carries the crop family and accent through to the visual', () => {
    const v = resolveFarmPlotVisual(plot({ cropId: 'gilded_sunmelon' }), 0);
    expect(v.family).toBe('gourd');
    expect(v.accent).toBe(FARM_CROP_ACCENT.gilded_sunmelon);
  });

  it('takes NO quality, preset or tier argument (the fairness contract)', () => {
    // A growth stage is actionable, so the shed cannot reach it. Pinned as an
    // arity fact: adding a quality parameter would move this number.
    expect(resolveFarmPlotVisual.length).toBe(2);
  });
});

describe('wet bands', () => {
  it('bands the soil at 10 minutes and one hour', () => {
    const p = plot({ plantedAtMs: 1_000_000 });
    expect(farmWetBand(p, 1_000_000)).toBe(2);
    expect(farmWetBand(p, 1_000_000 + FARM_WET_BAND_2_MS - 1)).toBe(2);
    expect(farmWetBand(p, 1_000_000 + FARM_WET_BAND_2_MS)).toBe(1);
    expect(farmWetBand(p, 1_000_000 + FARM_WET_BAND_1_MS - 1)).toBe(1);
    expect(farmWetBand(p, 1_000_000 + FARM_WET_BAND_1_MS)).toBe(0);
    expect(farmWetBand(p, 1_000_000 + FARM_WET_BAND_1_MS * 100)).toBe(0);
  });

  it('reads a plot planted in the future as freshly watered, not dry', () => {
    expect(farmWetBand(plot({ plantedAtMs: 5_000_000 }), 0)).toBe(2);
  });
});

describe('plot rebuild key', () => {
  const base = plot();
  // The key a built plot would carry, as the adapter stores it.
  const keyOf = (p: FarmPlotView, now = 0) => {
    const v = resolveFarmPlotVisual(p, now);
    return { cropId: p.cropId, status: p.status, stageMesh: v.stageMesh, wetBand: v.wetBand };
  };

  it('matches for identical inputs', () => {
    expect(farmPlotKeyMatches(keyOf(base), plot(), 0)).toBe(true);
    // Two different nowMs inside the SAME stage and wet band still match,
    // which is what keeps a sync from rebuilding anything in the steady state.
    expect(farmPlotKeyMatches(keyOf(base, 1), base, 2)).toBe(true);
  });

  it('stops matching when the crop changes', () => {
    expect(farmPlotKeyMatches(keyOf(base), plot({ cropId: 'bog_beet' }), 0)).toBe(false);
  });

  it('stops matching when the stage mesh changes', () => {
    expect(farmPlotKeyMatches(keyOf(base, 0), base, (2 * HOUR) / 3)).toBe(false);
  });

  it('stops matching when the wet band changes', () => {
    // Same stage (still sprout at 10 min of a 100-hour window), different band.
    const slow = plot({ readyAtMs: HOUR * 100 });
    expect(resolveFarmPlotVisual(slow, FARM_WET_BAND_2_MS).stageMesh).toBe('sprout');
    expect(farmPlotKeyMatches(keyOf(slow, 0), slow, FARM_WET_BAND_2_MS)).toBe(false);
  });

  it('stops matching when the status changes', () => {
    // Ready and withered differ, and both differ from growing at the same time.
    const ready = plot({ status: 'ready' });
    expect(farmPlotKeyMatches(keyOf(ready, HOUR), plot({ status: 'withered' }), HOUR)).toBe(false);
    expect(farmPlotKeyMatches(keyOf(base, 0), ready, 0)).toBe(false);
  });

  it('allocates nothing: it is a predicate over fields, not a minted key', () => {
    // Arity and return type are the contract the adapter's hot path relies on.
    expect(farmPlotKeyMatches.length).toBe(3);
    expect(typeof farmPlotKeyMatches(keyOf(base), base, 0)).toBe('boolean');
  });
});

describe('model urls', () => {
  it('names the 15 authored GLBs, all distinct and all under props/', () => {
    const urls = farmModelUrls();
    expect(urls.length).toBe(15);
    expect(new Set(urls).size).toBe(15);
    for (const url of urls) expect(url.startsWith('/models/props/farm_')).toBe(true);
    expect(urls).toContain(FARM_BED_MODEL_URL);
    expect(urls).toContain(FARM_SPROUT_MODEL_URL);
    expect(urls).toContain(FARM_COMPOST_BIN_MODEL_URL);
  });

  it('maps each family and stage to its own file, with sprout shared', () => {
    expect(farmStageModelUrl('grain', 'stage2')).toBe('/models/props/farm_grain_stage2.glb');
    expect(farmStageModelUrl('rootleaf', 'stage4')).toBe('/models/props/farm_rootleaf_stage4.glb');
    expect(farmStageModelUrl('gourd', 'withered')).toBe('/models/props/farm_gourd_withered.glb');
    // The sprout is family-independent: every family resolves to one file.
    expect(farmStageModelUrl('gourd', 'sprout')).toBe(FARM_SPROUT_MODEL_URL);
    expect(farmStageModelUrl('grain', 'sprout')).toBe(FARM_SPROUT_MODEL_URL);
  });

  it('pins the authored node and material names the adapter looks up', () => {
    // These are contract with the exporter: a rename on either side silently
    // stops the stage meshes mounting or the accent tinting.
    expect(FARM_SOIL_SOCKET_NAME).toBe('Socket_Soil');
    expect(FARM_ACCENT_MESH_NAME).toBe('CropAccent');
    expect(FARM_ACCENT_MATERIAL_NAME).toBe('crop_accent');
  });
});

describe('compost bin placement', () => {
  it('is deterministic: the same patch gives the same position', () => {
    for (const patch of FARM_PATCHES) {
      expect(farmCompostBinPosition(patch)).toEqual(farmCompostBinPosition(patch));
    }
  });

  it('stands west of the grid, on the first row, for every live patch', () => {
    for (const patch of FARM_PATCHES) {
      const bin = farmCompostBinPosition(patch);
      const minX = Math.min(...patch.beds.map((b) => b.x));
      expect(bin.x).toBe(minX - FARM_COMPOST_BIN_OFFSET);
      expect(bin.z).toBe(patch.beds[0].z);
      expect(bin.x, 'the bin must sit outside the grid, not inside it').toBeLessThan(minX);
    }
  });

  it('never lands on a bed, in any patch', () => {
    for (const patch of FARM_PATCHES) {
      const bin = farmCompostBinPosition(patch);
      for (const bed of patch.beds) {
        const d = Math.hypot(bin.x - bed.x, bin.z - bed.z);
        expect(d, `${patch.id} bin overlaps ${bed.id}`).toBeGreaterThanOrEqual(
          FARM_COMPOST_BIN_OFFSET,
        );
      }
    }
  });

  it('falls back to the patch anchor for a bedless patch', () => {
    const bare = { id: 'p', zoneId: 'z', tier: 1 as const, x: 7, z: 9, beds: [] };
    expect(farmCompostBinPosition(bare)).toEqual({ x: 7, z: 9 });
  });
});
