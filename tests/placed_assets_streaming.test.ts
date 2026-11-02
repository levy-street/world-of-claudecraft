// Game-side placement residency streaming (placed_assets.ts): a game host on
// a big authored map materializes only the placements around the player and
// reconciles as they travel, the editor's zone-stream discipline. Editor
// hosts (rebuildAll) never stream.
import { describe, expect, it } from 'vitest';
import { PlacedAssetsView } from '../src/render/placed_assets';
import { GRASS_PATCH_PATH } from '../src/sim/map_doc';
import type { PlacedAsset } from '../src/sim/types';

function fakePlacement(x: number, z: number): PlacedAsset {
  return { path: '/models/props/crate_a.glb', x, z, rotY: 0, scale: 1 };
}

/** 2,000 placements on a line: index i sits at x = i * 10. */
function linePlacements(): PlacedAsset[] {
  const out: PlacedAsset[] = [];
  for (let i = 0; i < 2000; i++) out.push(fakePlacement(i * 10, 0));
  return out;
}

function residentCount(view: PlacedAssetsView): number {
  return (view as unknown as { entries: Map<number, unknown> }).entries.size;
}

describe('placed-asset residency streaming', () => {
  it('boots only the spawn area on a streaming host and follows the player', () => {
    const view = new PlacedAssetsView(linePlacements(), 1, { streamAround: { x: 0, z: 0 } });
    // STREAM_RADIUS 650 over 10yd spacing: ~66 of 2,000 resident at boot.
    const atBoot = residentCount(view);
    expect(atBoot).toBeGreaterThan(50);
    expect(atBoot).toBeLessThan(120);

    // Travel to the far end: the amortized per-frame slices swap the whole
    // set within a few dozen reconciles (nothing 2km away survives the
    // hysteresis band; the far end streams in).
    for (let frame = 0; frame < 60; frame++) view.streamResidency(19_990, 0);
    const atFarEnd = residentCount(view);
    expect(atFarEnd).toBeGreaterThan(50);
    expect(atFarEnd).toBeLessThan(120);
    const entries = (view as unknown as { entries: Map<number, unknown> }).entries;
    expect(entries.has(0)).toBe(false);
    expect(entries.has(1999)).toBe(true);

    // One reconcile slice never exceeds its op budget (the stutter guard).
    for (let frame = 0; frame < 60; frame++) view.streamResidency(0, 0);
    const midSwap = residentCount(view);
    view.streamResidency(19_990, 0);
    expect(Math.abs(residentCount(view) - midSwap)).toBeLessThanOrEqual(24);
  });

  it('never streams on an editor host (rebuildAll owns residency)', () => {
    const view = new PlacedAssetsView(linePlacements(), 1, { streamAround: { x: 0, z: 0 } });
    view.rebuildAll(linePlacements());
    expect(residentCount(view)).toBe(2000);
    // The stream source is cleared: a later reconcile must not evict anything.
    view.streamResidency(0, 0, undefined, true);
    expect(residentCount(view)).toBe(2000);
  });

  it('small maps skip streaming entirely', () => {
    const view = new PlacedAssetsView([fakePlacement(0, 0), fakePlacement(5000, 0)], 1, {
      streamAround: { x: 0, z: 0 },
    });
    expect(residentCount(view)).toBe(2);
  });

  it('settles all resolved placements immediately on the first updateLod pass', () => {
    const placements: PlacedAsset[] = Array.from({ length: 600 }, (_, i) => ({
      path: GRASS_PATCH_PATH,
      x: i === 0 ? 0 : 2000 + i * 5,
      z: 0,
      rotY: 0,
      scale: 1,
    }));
    const view = new PlacedAssetsView(placements, 1);
    view.updateLod(0, 0, 240, 500, 1200);
    const internals = view as unknown as {
      entries: Map<number, { lodHidden: boolean; model: { visible: boolean } | null }>;
      fades: Map<number, unknown>;
    };
    expect(internals.fades.size).toBe(0);
    expect(internals.entries.get(0)?.lodHidden).toBe(false);
    for (let i = 1; i < 600; i++) {
      expect(internals.entries.get(i)?.lodHidden).toBe(true);
      expect(internals.entries.get(i)?.model?.visible).toBe(false);
    }
    view.dispose();
  });
});
