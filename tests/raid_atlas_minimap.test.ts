// The raid atlas on the round minimap (src/ui/hud/raid_atlas/raid_atlas_minimap_core.ts):
// the crop of a page raster round the player, the detail tile's coverage and density,
// the room-name policy by zoom, and the idle-skip key.
import { describe, expect, it } from 'vitest';
import {
  minimapBlit,
  minimapDetailTile,
  minimapRoomLabels,
  minimapScreen,
  minimapWantsDetail,
  RAID_ATLAS_MINIMAP_TILE_SPAN,
  type RaidAtlasMinimapState,
  raidAtlasMinimapKey,
  rasterCovers,
  tileMatchesScale,
} from '../src/ui/hud/raid_atlas/raid_atlas_minimap_core';
import { MINIMAP_ZOOM_LEVELS } from '../src/ui/minimap_zoom';

const plate = { k: 2, offU: 0, offV: 0, w: 400, h: 400 }; // a 200-yard page

describe('minimapBlit', () => {
  it('crops the view round the player inside the page', () => {
    // 162 px at 1.62 px/yd shows 100 yd: centred on (100, 80) it spans u 50..150, v 30..130.
    expect(minimapBlit(plate, 100, 80, 162, 1.62)).toEqual({
      sx: 100,
      sy: 60,
      sw: 200,
      sh: 200,
      dx: 0,
      dy: 0,
      dw: 162,
      dh: 162,
    });
  });

  it('clips at the page edge and lands the remainder at the right offset', () => {
    const b = minimapBlit(plate, 20, 190, 100, 1);
    // u spans -30..70 (page from 0), v spans 140..240 (page to 200).
    expect(b).toEqual({ sx: 0, sy: 280, sw: 140, sh: 120, dx: 30, dy: 0, dw: 70, dh: 60 });
  });

  it('reads a detail tile through its own offset and density', () => {
    const tile = { k: 4, offU: 40, offV: 40, w: 400, h: 400 };
    const b = minimapBlit(tile, 90, 90, 50, 2);
    expect(b).toEqual({ sx: 150, sy: 150, sw: 100, sh: 100, dx: 0, dy: 0, dw: 50, dh: 50 });
  });

  it('returns null when nothing of the raster is in view or the scale is broken', () => {
    expect(minimapBlit(plate, 900, 900, 162, 1.7)).toBeNull();
    expect(minimapBlit(plate, 100, 100, 162, 0)).toBeNull();
    expect(minimapBlit({ ...plate, k: 0 }, 100, 100, 162, 1.7)).toBeNull();
  });
});

describe('the detail tile', () => {
  it('is wanted only when the plate is too coarse for the canvas density', () => {
    expect(minimapWantsDetail(1.7, 1, 3.1)).toBe(false);
    expect(minimapWantsDetail(5.1, 1, 3.1)).toBe(true);
    // A dense screen asks for detail sooner.
    expect(minimapWantsDetail(1.7 * 1.5, 2, 3.1)).toBe(true);
    expect(minimapWantsDetail(1.7 * 3, 1, 8.2)).toBe(false);
  });

  it('is device dense, centred on the player and a few minimap diameters wide', () => {
    const tile = minimapDetailTile(120, 60, 162, 5.1, 2);
    expect(tile.k).toBeCloseTo(10.2);
    expect(tile.w).toBe(Math.ceil(162 * 2 * RAID_ATLAS_MINIMAP_TILE_SPAN));
    expect(tile.h).toBe(tile.w);
    expect(tile.offU + tile.w / tile.k / 2).toBeCloseTo(120);
    expect(tile.offV + tile.h / tile.k / 2).toBeCloseTo(60);
    expect(rasterCovers(tile, 120, 60, 162, 5.1)).toBe(true);
    expect(tileMatchesScale(tile, 5.1, 2)).toBe(true);
    expect(tileMatchesScale(tile, 3.4, 2)).toBe(false);
  });

  it('stays valid for a short walk and is dropped once the view leaves it', () => {
    const tile = minimapDetailTile(120, 60, 162, 5.1, 1);
    // The tile holds (span - 1) / 2 minimap diameters of slack each way.
    const slack = ((RAID_ATLAS_MINIMAP_TILE_SPAN - 1) / 2) * (162 / 5.1);
    expect(rasterCovers(tile, 120 + slack * 0.9, 60, 162, 5.1)).toBe(true);
    expect(rasterCovers(tile, 120, 60 - slack * 0.9, 162, 5.1)).toBe(true);
    expect(rasterCovers(tile, 120 + slack * 1.1, 60, 162, 5.1)).toBe(false);
    expect(rasterCovers(tile, 120, 60 - slack * 1.1, 162, 5.1)).toBe(false);
  });
});

describe('minimap projection and labels', () => {
  it('puts the player at the centre and mirrors the page axes like the dungeon minimap', () => {
    expect(minimapScreen(100, 50, 100, 50, 162, 1.7)).toEqual({ sx: 81, sy: 81 });
    const east = minimapScreen(110, 50, 100, 50, 162, 1.7);
    expect(east.sx).toBeCloseTo(81 + 17);
    expect(east.sy).toBe(81);
  });

  it('shows room names only at the close zoom presets', () => {
    const shown = MINIMAP_ZOOM_LEVELS.map((z) => minimapRoomLabels(z));
    expect(shown).toEqual(['none', 'none', 'major', 'major']);
  });
});

describe('raidAtlasMinimapKey', () => {
  const base: RaidAtlasMinimapState = {
    floor: 'veins',
    lx: 10,
    lz: -40,
    facing: 0.5,
    pxPerYard: 1.7,
    backing: 162,
    bosses: 'aaaaa',
    engaged: false,
    members: [{ x: 4, z: -30, cls: 'mage', dead: false }],
    marks: [{ kind: 'mob', cx: 40, cy: 50, aggro: false }],
    pins: '',
    settled: false,
    plateReady: true,
  };
  const key = (patch: Partial<RaidAtlasMinimapState>) => raidAtlasMinimapKey({ ...base, ...patch });

  it('is stable for an unchanged minimap and below a quarter pixel of drift', () => {
    expect(key({})).toBe(key({}));
    expect(key({ lx: 10 + 0.05 / 1.7 })).toBe(key({}));
  });

  it('changes with every input that moves a pixel', () => {
    const k0 = key({});
    const changed: Partial<RaidAtlasMinimapState>[] = [
      { floor: 'heart' },
      { lx: 11 },
      { lz: -39 },
      { facing: 0.6 },
      { pxPerYard: 2.55 },
      { backing: 324 },
      { bosses: 'daaaa' },
      { members: [{ x: 6, z: -30, cls: 'mage', dead: false }] },
      { members: [{ x: 4, z: -30, cls: 'mage', dead: true }] },
      { members: [] },
      { marks: [{ kind: 'mob', cx: 42, cy: 50, aggro: false }] },
      { marks: [{ kind: 'mob', cx: 40, cy: 50, aggro: true }] },
      { marks: [{ kind: 'loot', cx: 40, cy: 50 }] },
      { pins: '1fb' },
      { settled: true },
      { plateReady: false },
    ];
    for (const patch of changed) expect(key(patch), JSON.stringify(patch)).not.toBe(k0);
  });

  it('never skips while a boss fights (its pulse animates)', () => {
    expect(key({ engaged: true })).toBeNull();
  });
});
