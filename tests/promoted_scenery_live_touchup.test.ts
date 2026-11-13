// The built-in world's live touch-up document stands the hand-painted square dressing of
// Eastbrook and Fenbridge and the weekly vault's strong-house as placements, so the town
// views stand their own copies down for it (render/promoted_scenery_gate.ts
// activeWorldStandsLiveTouchup). Any other world carries no touch-up, and must keep the
// towns' own dressing and vault hall: gated on a constant, a Studio map lost them all.
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeWorldPromoted,
  activeWorldStandsLiveTouchup,
} from '../src/render/promoted_scenery_gate';
import { BASE_WORLD, BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { activeFenbridgeLayout } from '../src/sim/fenbridge_touchup';

describe('the live touch-up gate', () => {
  afterEach(() => setActiveWorldContent(null));

  it('answers yes in the built-in world, which really carries the painted pieces', () => {
    setActiveWorldContent(null);
    expect(activeWorldStandsLiveTouchup()).toBe(true);
    const painted = (BUILTIN_WORLD.placements ?? []).filter((placement) =>
      placement.path.startsWith('/models/eastbrook_houses/'),
    );
    expect(painted.length).toBeGreaterThan(0);
  });

  it('stands a painted placement on the spot of every piece the town views stand down', () => {
    // The gate asks only which world is active, so this is what keeps it honest: each
    // record a town view skips for the touch-up (eastbrook_town.ts, fenbridge_town.ts,
    // eastbrook_weekly_vault.ts) has its painted piece in the document, where the record
    // stands. A piece dropped from the document would leave a collider with nothing drawn
    // on it (for the vault, a door hanging in the air).
    setActiveWorldContent(null);
    const placements = BUILTIN_WORLD.placements ?? [];
    const at = (model: string, x: number, z: number): boolean =>
      placements.some(
        (placement) =>
          placement.path === `/models/eastbrook_houses/${model}.glb` &&
          Math.hypot(placement.x - x, placement.z - z) < 0.05,
      );
    const vault = EASTBROOK_LAYOUT.weeklyVault;
    expect(at('vault_house', vault.x, vault.z), 'the weekly vault').toBe(true);
    expect(EASTBROOK_LAYOUT.civic.benches.length).toBeGreaterThan(0);
    for (const bench of EASTBROOK_LAYOUT.civic.benches) {
      expect(at('square_bench', bench.position.x, bench.position.z), bench.id).toBe(true);
    }
    expect(EASTBROOK_LAYOUT.market.stalls.length).toBeGreaterThan(0);
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      expect(
        at('market_stall_a', stall.position.x, stall.position.z) ||
          at('market_stall_b', stall.position.x, stall.position.z),
        stall.id,
      ).toBe(true);
    }
    // a fence record is a run: every run carries at least one painted length on its line
    const lengths = placements.filter(
      (placement) => placement.path === '/models/eastbrook_houses/yard_fence.glb',
    );
    expect(EASTBROOK_LAYOUT.fences.length).toBeGreaterThan(0);
    for (const fence of EASTBROOK_LAYOUT.fences) {
      const dx = fence.end.x - fence.start.x;
      const dz = fence.end.z - fence.start.z;
      const onRun = lengths.filter((placement) => {
        const t =
          ((placement.x - fence.start.x) * dx + (placement.z - fence.start.z) * dz) /
          (dx * dx + dz * dz);
        const off = Math.hypot(
          placement.x - (fence.start.x + dx * t),
          placement.z - (fence.start.z + dz * t),
        );
        return t >= 0 && t <= 1 && off < 0.3;
      });
      expect(onRun.length, fence.id).toBeGreaterThan(0);
    }
    // Fenbridge's square stands where the document moved it (activeFenbridgeLayout)
    const { cistern, provisionStall, musterBoard } = activeFenbridgeLayout().civic;
    expect(at('cistern', cistern.position.x, cistern.position.z), cistern.id).toBe(true);
    expect(
      at('market_stall_a', provisionStall.position.x, provisionStall.position.z),
      provisionStall.id,
    ).toBe(true);
    expect(at('muster_board', musterBoard.position.x, musterBoard.position.z), musterBoard.id).toBe(
      true,
    );
  });

  it('answers no in a Studio map or custom world, even one that owns no dressing', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, placements: [] });
    expect(activeWorldStandsLiveTouchup()).toBe(false);
    // and nothing else stands the town dressing down there
    expect(activeWorldPromoted('authoredTownDressing')).toBe(false);
    expect(activeWorldPromoted('eastbrookVault')).toBe(false);
  });

  it('answers yes in the Studio preview of the live world and in the base world', () => {
    setActiveWorldContent({ ...BUILTIN_WORLD, liveWorldPreview: true });
    expect(activeWorldStandsLiveTouchup()).toBe(true);
    // the touch-up-less base is built-in too (sim/data.ts isBuiltinWorldContent): only
    // tests activate it, and the town views must draw there what they draw in the game
    setActiveWorldContent(BASE_WORLD);
    expect(activeWorldStandsLiveTouchup()).toBe(true);
  });
});
