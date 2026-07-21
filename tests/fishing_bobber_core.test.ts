// Pure-core pins for the fishing bobber anchor selection (Professions 2.0
// Phase 12b): the bobber must land on the FIRST facing-forward sample of the
// sim's own FISHING_SAMPLE_DISTANCES ring that clears the sim's fishable-depth
// rule, so the visual always agrees with where startFishing validated the
// cast. Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { describe, expect, it } from 'vitest';
import { type BobberAnchor, bobberAnchorInto } from '../src/render/fishing_bobber_core';
import { LAKE } from '../src/sim/content/zone1';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { FISHING_SAMPLE_DISTANCES } from '../src/sim/professions/fishing';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 1;

// The sim's depth rule, restated independently so the core cannot drift from
// it without this suite noticing.
function fishableAt(x: number, z: number): boolean {
  return groundHeight(x, z, SEED) < waterLevelAt(x, z) - PLAYER_SWIM_DEPTH;
}

// A shore spot near Mirror Lake facing open water (the sim.test.ts
// mirrorLakeFishingSpot hunt, restated over the render-core inputs).
function lakeShoreSpot(): { x: number; z: number; facing: number } {
  for (let r = LAKE.radius * 0.7; r <= LAKE.radius * 1.8; r += 1) {
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const x = LAKE.x + Math.cos(a) * r;
      const z = LAKE.z + Math.sin(a) * r;
      if (groundHeight(x, z, SEED) < waterLevelAt(x, z)) continue;
      const facing = Math.atan2(LAKE.x - x, LAKE.z - z);
      const sin = Math.sin(facing);
      const cos = Math.cos(facing);
      if (FISHING_SAMPLE_DISTANCES.some((d) => fishableAt(x + sin * d, z + cos * d))) {
        return { x, z, facing };
      }
    }
  }
  throw new Error('no fishable Mirror Lake shore spot at the test seed');
}

describe('fishing bobber anchor core (Phase 12b)', () => {
  it('anchors on the FIRST fishable sample of the sim ring, on the water line', () => {
    const spot = lakeShoreSpot();
    const out: BobberAnchor = { x: 0, y: 0, z: 0 };
    expect(bobberAnchorInto(out, spot.x, spot.z, spot.facing, SEED)).toBe(true);
    // The expected first distance, computed independently of the core.
    const sin = Math.sin(spot.facing);
    const cos = Math.cos(spot.facing);
    const firstD = FISHING_SAMPLE_DISTANCES.find((d) =>
      fishableAt(spot.x + sin * d, spot.z + cos * d),
    );
    expect(firstD).toBeDefined();
    const d = firstD as number;
    expect(out.x).toBeCloseTo(spot.x + sin * d, 10);
    expect(out.z).toBeCloseTo(spot.z + cos * d, 10);
    expect(out.y).toBeCloseTo(waterLevelAt(out.x, out.z), 10);
  });

  it('reports no anchor when the angler faces away from fishable water', () => {
    const spot = lakeShoreSpot();
    const away = spot.facing + Math.PI;
    const sin = Math.sin(away);
    const cos = Math.cos(away);
    // Only a meaningful negative when the reversed ring is genuinely dry;
    // the hunt above starts on the shore facing the lake center, so the
    // landward ring is dry at the shipped terrain. Guard it explicitly so a
    // future terrain change fails loudly instead of silently weakening this.
    const anyWet = FISHING_SAMPLE_DISTANCES.some((d) =>
      fishableAt(spot.x + sin * d, spot.z + cos * d),
    );
    expect(anyWet).toBe(false);
    const out: BobberAnchor = { x: 0, y: 0, z: 0 };
    expect(bobberAnchorInto(out, spot.x, spot.z, away, SEED)).toBe(false);
  });

  it('walks the sim ring by identity, not a copy', () => {
    // The core imports FISHING_SAMPLE_DISTANCES from the sim module; this
    // membership pin keeps the shipped ring itself from silently changing
    // shape without a conscious re-pin here (the bobber and the cast
    // validation must always walk the same ring).
    expect(FISHING_SAMPLE_DISTANCES).toEqual([4, 8, 12, 16, 20, 24]);
  });
});
