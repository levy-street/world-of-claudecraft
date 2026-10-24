import { describe, expect, it } from 'vitest';
import {
  type MinimapCaptureFrame,
  minimapCaptureBlitRect,
  minimapVisibleHalfYards,
} from '../src/render/minimap_capture';
import { MINIMAP_BASE_SCALE, MINIMAP_SIZE } from '../src/ui/minimap_painter';

// The marker projection the painter draws every dot and arrow with
// (minimap_markers.ts): +X is map-left, +Z is map-up.
function markerX(worldX: number, playerX: number, pxPerYard: number): number {
  return MINIMAP_SIZE / 2 - (worldX - playerX) * pxPerYard;
}
function markerY(worldZ: number, playerZ: number, pxPerYard: number): number {
  return MINIMAP_SIZE / 2 - (worldZ - playerZ) * pxPerYard;
}

/** Where a world point lands on the minimap by way of the CAPTURE: into the
 *  capture image's own pixel space, then through the blit rect. */
function viaCapture(
  frame: MinimapCaptureFrame,
  world: { x: number; z: number },
  player: { x: number; z: number },
  pxPerYard: number,
  capturePx: number,
): { x: number; y: number } {
  const k = capturePx / (2 * frame.halfYards); // capture pixels per yard
  const u = capturePx / 2 - (world.x - frame.centerX) * k;
  const v = capturePx / 2 - (world.z - frame.centerZ) * k;
  const at = minimapCaptureBlitRect(frame, player.x, player.z, MINIMAP_SIZE, pxPerYard);
  const scale = at.size / capturePx;
  return { x: at.x + u * scale, y: at.y + v * scale };
}

describe('minimapVisibleHalfYards', () => {
  it('is half the disc converted back into yards', () => {
    expect(minimapVisibleHalfYards(MINIMAP_SIZE, MINIMAP_BASE_SCALE)).toBeCloseTo(47.65, 2);
    // Zooming in shows less ground.
    expect(minimapVisibleHalfYards(MINIMAP_SIZE, MINIMAP_BASE_SCALE * 3)).toBeCloseTo(15.88, 2);
  });

  it('never divides by zero on a degenerate scale', () => {
    expect(Number.isFinite(minimapVisibleHalfYards(MINIMAP_SIZE, 0))).toBe(true);
  });
});

describe('minimapCaptureBlitRect', () => {
  const pxPerYard = MINIMAP_BASE_SCALE;
  const capturePx = 384;

  it('centres a capture taken at the player', () => {
    const player = { x: 120, z: -40 };
    const frame: MinimapCaptureFrame = {
      canvas: null as unknown as HTMLCanvasElement,
      centerX: player.x,
      centerZ: player.z,
      halfYards: 56,
    };
    const at = minimapCaptureBlitRect(frame, player.x, player.z, MINIMAP_SIZE, pxPerYard);
    expect(at.x + at.size / 2).toBeCloseTo(MINIMAP_SIZE / 2, 6);
    expect(at.y + at.size / 2).toBeCloseTo(MINIMAP_SIZE / 2, 6);
  });

  it('puts world points exactly where their markers go, even on a stale capture', () => {
    // The player has walked 9 yards north-east since the capture was taken.
    const player = { x: 129, z: -47 };
    const frame: MinimapCaptureFrame = {
      canvas: null as unknown as HTMLCanvasElement,
      centerX: 120,
      centerZ: -40,
      halfYards: 56,
    };
    for (const world of [
      { x: 120, z: -40 },
      { x: 150, z: -10 },
      { x: 96, z: -71 },
      { x: 129, z: -47 }, // the player themselves: dead centre
    ]) {
      const shot = viaCapture(frame, world, player, pxPerYard, capturePx);
      expect(shot.x).toBeCloseTo(markerX(world.x, player.x, pxPerYard), 6);
      expect(shot.y).toBeCloseTo(markerY(world.z, player.z, pxPerYard), 6);
    }
  });

  it('agrees at every zoom preset', () => {
    const player = { x: -14, z: 802 };
    for (const zoom of [1, 1.5, 2, 3]) {
      const s = MINIMAP_BASE_SCALE * zoom;
      const frame: MinimapCaptureFrame = {
        canvas: null as unknown as HTMLCanvasElement,
        centerX: player.x - 2,
        centerZ: player.z + 1,
        halfYards: minimapVisibleHalfYards(MINIMAP_SIZE, s) * 1.18,
      };
      const world = { x: player.x + 7, z: player.z - 5 };
      const shot = viaCapture(frame, world, player, s, capturePx);
      expect(shot.x, `zoom ${zoom}`).toBeCloseTo(markerX(world.x, player.x, s), 6);
      expect(shot.y, `zoom ${zoom}`).toBeCloseTo(markerY(world.z, player.z, s), 6);
    }
  });

  it('resolves enough capture pixels to cover a retina disc at every zoom', () => {
    // 384px over the captured span has to beat what a DPR-2 display asks for
    // across the visible disc, or the capture would be an upscale of its own.
    for (const zoom of [1, 1.5, 2, 3]) {
      const s = MINIMAP_BASE_SCALE * zoom;
      const halfYards = minimapVisibleHalfYards(MINIMAP_SIZE, s) * 1.18;
      const capturePxPerYard = capturePx / (2 * halfYards);
      expect(capturePxPerYard, `zoom ${zoom}`).toBeGreaterThanOrEqual(s * 2);
    }
  });
});
