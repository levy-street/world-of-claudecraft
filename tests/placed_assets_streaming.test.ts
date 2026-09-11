// Game-side placement residency streaming (placed_assets.ts): a game host on
// a big authored map materializes only the placements around the player and
// reconciles as they travel, the editor's zone-stream discipline. Editor
// hosts (rebuildAll) never stream.
import { describe, expect, it } from 'vitest';
import { PlacedAssetsView } from '../src/render/placed_assets';
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
});

describe('the region cull (setCullBeyond)', () => {
  /** updateLod skips an entry whose GLB has not resolved, which in Node is all
   *  of them. Stand a minimal model in each one so the sweep has something to
   *  hide; nothing below reads anything else off it. */
  function withModels(view: PlacedAssetsView): Map<number, { model: { visible: boolean } }> {
    const entries = (view as unknown as { entries: Map<number, { model: unknown }> }).entries;
    for (const entry of entries.values()) entry.model = { visible: true };
    return entries as unknown as Map<number, { model: { visible: boolean } }>;
  }

  /** A row of placements across z, all within LOD range of the origin. */
  function acrossZ(): PlacedAsset[] {
    const out: PlacedAsset[] = [];
    for (let i = 0; i < 40; i++) out.push(fakePlacement(0, i * 10)); // z = 0..390
    return out;
  }

  const shown = (entries: Map<number, { model: { visible: boolean } }>): number => {
    let n = 0;
    for (const e of entries.values()) if (e.model.visible) n++;
    return n;
  };

  it('drops everything past the line and keeps everything short of it', () => {
    const view = new PlacedAssetsView(acrossZ(), 1);
    const entries = withModels(view);
    // No plane: the whole row is inside the asset range from the origin.
    view.updateLod(0, 0, 600);
    expect(shown(entries)).toBe(40);

    // z >= 155 goes: placements 16..39 (z 160..390), 16 kept.
    view.setCullBeyond({ nx: 0, nz: 1, d: 155 });
    view.updateLod(0, 0, 600);
    expect(shown(entries)).toBe(16);
    expect(entries.get(15)?.model.visible).toBe(true); // z 150, short of the line
    expect(entries.get(16)?.model.visible).toBe(false); // z 160, past it

    // ...and clearing it brings the row back.
    view.setCullBeyond(null);
    view.updateLod(0, 0, 600);
    expect(shown(entries)).toBe(40);
  });

  it('culls by the line alone, with no hysteresis band to sit in', () => {
    // The distance cull keeps a hidden placement hidden until it is well
    // inside the range again, which is right for a fog plane the player walks
    // across. A wall is not a fog plane: a placement is behind it or it is not.
    const view = new PlacedAssetsView([fakePlacement(0, 100)], 1);
    const entries = withModels(view);
    view.setCullBeyond({ nx: 0, nz: 1, d: 99.9 });
    view.updateLod(0, 0, 600);
    expect(entries.get(0)?.model.visible).toBe(false);
    view.setCullBeyond({ nx: 0, nz: 1, d: 100.1 });
    view.updateLod(0, 0, 600);
    expect(entries.get(0)?.model.visible).toBe(true);
  });

  it('takes an arbitrary bearing, not just the z axis', () => {
    const view = new PlacedAssetsView([fakePlacement(100, 0), fakePlacement(-100, 0)], 1);
    const entries = withModels(view);
    view.setCullBeyond({ nx: 1, nz: 0, d: 50 });
    view.updateLod(0, 0, 600);
    expect(entries.get(0)?.model.visible).toBe(false); // x 100, past the line
    expect(entries.get(1)?.model.visible).toBe(true); // x -100, behind it
  });
});

describe('region residency (reconcileCullRegion)', () => {
  /** 400 placements across z: index i sits at z = i * 2, so z >= 300 is the
   *  back half. Wide enough that a budgeted pass takes several frames. */
  function acrossZ(): PlacedAsset[] {
    const out: PlacedAsset[] = [];
    for (let i = 0; i < 400; i++) out.push(fakePlacement(0, i * 2));
    return out;
  }

  const resident = (view: PlacedAssetsView): Map<number, unknown> =>
    (view as unknown as { entries: Map<number, unknown> }).entries;

  it('releases what the line hides, a budgeted slice at a time, and stops there', () => {
    const view = new PlacedAssetsView(acrossZ(), 1);
    expect(resident(view).size).toBe(400);

    view.setCullBeyond({ nx: 0, nz: 1, d: 300 }); // indices 150..399 go
    view.reconcileCullRegion();
    const afterOne = resident(view).size;
    // One frame releases its budget and no more: releasing 250 at once is the
    // stutter every strided sweep in this file exists to avoid.
    expect(400 - afterOne).toBeGreaterThan(0);
    expect(400 - afterOne).toBeLessThanOrEqual(48);

    for (let frame = 0; frame < 40; frame++) view.reconcileCullRegion();
    expect(resident(view).size).toBe(150);
    // Everything left is short of the line, and it settles there rather than
    // eating into the near half.
    for (const index of resident(view).keys()) expect(index).toBeLessThan(150);
    for (let frame = 0; frame < 10; frame++) view.reconcileCullRegion();
    expect(resident(view).size).toBe(150);
  });

  it('rebuilds exactly what it released once the line clears', () => {
    const view = new PlacedAssetsView(acrossZ(), 1);
    view.setCullBeyond({ nx: 0, nz: 1, d: 300 });
    for (let frame = 0; frame < 40; frame++) view.reconcileCullRegion();
    expect(resident(view).size).toBe(150);

    view.setCullBeyond(null);
    view.reconcileCullRegion();
    const afterOne = resident(view).size;
    expect(afterOne).toBeGreaterThan(150);
    expect(afterOne - 150).toBeLessThanOrEqual(32);

    for (let frame = 0; frame < 40; frame++) view.reconcileCullRegion();
    expect(resident(view).size).toBe(400);
    // ...and it adds nothing it did not take away: a further pass is inert.
    for (let frame = 0; frame < 5; frame++) view.reconcileCullRegion();
    expect(resident(view).size).toBe(400);
  });

  it('never pulls the selected placement out from under the maker', () => {
    const view = new PlacedAssetsView(acrossZ(), 1);
    view.setSelected(399); // the far end, well past the line
    view.setCullBeyond({ nx: 0, nz: 1, d: 300 });
    for (let frame = 0; frame < 40; frame++) view.reconcileCullRegion();
    expect(resident(view).has(399)).toBe(true);
    expect(resident(view).size).toBe(151);
  });

  it('keeps the residency stream from putting back what the region released', () => {
    // The two systems are independent; only their agreement on the line test
    // stops the streamer walking a placement back in behind the region's back.
    const view = new PlacedAssetsView(acrossZ(), 1, { streamAround: { x: 0, z: 0 } });
    view.setCullBeyond({ nx: 0, nz: 1, d: 300 });
    for (let frame = 0; frame < 60; frame++) {
      view.reconcileCullRegion();
      view.streamResidency(0, 0);
    }
    for (const index of resident(view).keys()) expect(index).toBeLessThan(150);
  });
});
