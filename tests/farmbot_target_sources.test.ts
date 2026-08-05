import { describe, expect, it } from 'vitest';
import {
  defaultTargetResolverDeps,
  lakeShoreSpots,
  resolveTarget,
  scanShoreSpots,
  type TargetResolverDeps,
} from '../farmbot/target_sources';
import type { InvSlot } from '../src/sim/types';

// Real tables, varying only the character context (bags, proficiency, level).
function depsFor(over: Partial<TargetResolverDeps> = {}): TargetResolverDeps {
  return {
    ...defaultTargetResolverDeps({ inventory: [], proficiencies: {}, playerLevel: 3 }),
    ...over,
  };
}

const bag = (...ids: string[]): InvSlot[] => ids.map((itemId) => ({ itemId, count: 1 }));
const STARTER_TOOLS = bag('copper_mining_pick', 'simple_fishing_pole');

describe('farmbot target_sources resolveTarget (phase 16)', () => {
  it('copper_ore resolves to the eastbrook ore nodes', () => {
    const sources = resolveTarget('copper_ore', depsFor({ inventory: STARTER_TOOLS }));
    expect(sources.length).toBe(1);
    const s = sources[0];
    expect(s.kind).toBe('gather');
    if (s.kind !== 'gather') return;
    expect(s.zoneId).toBe('eastbrook_vale');
    expect(s.nodeType).toBe('ore');
    expect(s.nodeIds.length).toBeGreaterThan(0);
    expect(s.minTier).toBe(1);
    expect(s.score).toBeGreaterThan(0);
  });

  it('gates the gather source on the tool (no pick, no copper)', () => {
    expect(resolveTarget('copper_ore', depsFor({ inventory: [] }))).toEqual([]);
    // a fishing pole is not a mining pick
    expect(resolveTarget('copper_ore', depsFor({ inventory: bag('simple_fishing_pole') }))).toEqual(
      [],
    );
  });

  it('raw_marsh_pike needs a tier-2 rod for mirefen water', () => {
    // simple pole (effective tier 1): mirefen is gated out entirely
    expect(
      resolveTarget('raw_marsh_pike', depsFor({ inventory: bag('simple_fishing_pole') })),
    ).toEqual([]);
    // ironreel (tier 2), proficiency band 0: the band-0 mirefen cell at 22%
    const sources = resolveTarget(
      'raw_marsh_pike',
      depsFor({ inventory: bag('ironreel_fishing_rod') }),
    );
    expect(sources.length).toBe(1);
    const s = sources[0];
    expect(s.kind).toBe('fish');
    if (s.kind !== 'fish') return;
    expect(s.zoneId).toBe('mirefen_marsh');
    expect(s.band).toBe(0);
    expect(s.weightShare).toBeCloseTo(0.22, 5);
    expect(s.spots.length).toBeGreaterThan(0); // mirefen lakes, hub-side
  });

  it('fishes the effective band cell: band 1 mirefen pays 42%', () => {
    const sources = resolveTarget(
      'raw_marsh_pike',
      depsFor({ inventory: bag('ironreel_fishing_rod'), proficiencies: { fishing: 100 } }),
    );
    expect(sources.length).toBe(1);
    const s = sources[0];
    if (s.kind !== 'fish') throw new Error('expected a fish source');
    expect(s.band).toBe(1);
    expect(s.weightShare).toBeCloseTo(0.42, 5);
  });

  it('raw_mirror_trout fishes eastbrook on the simple pole', () => {
    const sources = resolveTarget(
      'raw_mirror_trout',
      depsFor({ inventory: bag('simple_fishing_pole') }),
    );
    const s = sources[0];
    if (s.kind !== 'fish') throw new Error('expected a fish source');
    expect(s.zoneId).toBe('eastbrook_vale');
    expect(s.weightShare).toBeCloseTo(0.46, 5);
  });

  it('linen_scrap resolves to mob sources, best drop chance first', () => {
    const sources = resolveTarget('linen_scrap', depsFor({ playerLevel: 10 }));
    // a common scrap drops from many mobs; the best score (chance x camp
    // count) ranks first
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(s.kind).toBe('mob');
    const top = sources[0];
    if (top.kind !== 'mob') return;
    expect(top.chance).toBeGreaterThan(0);
    expect(top.camps.length).toBeGreaterThan(0);
    expect(top.levelDiff).not.toBeNull();
    expect(sources.some((s) => s.kind === 'mob' && s.mobId === 'mogger' && s.chance === 1)).toBe(
      true,
    );
  });

  it('unknown items resolve to nothing', () => {
    expect(resolveTarget('not_a_real_item', depsFor({ inventory: STARTER_TOOLS }))).toEqual([]);
  });

  it('ranks best score first with a deterministic kind tiebreak', () => {
    // Synthetic deps: one item available from all three source kinds.
    const deps = depsFor({
      nodes: [
        { id: 'n1', zoneId: 'z', type: 'ore', pos: { x: 0, z: 0 }, level: 1, tier: 1 },
      ] as TargetResolverDeps['nodes'],
      nodeMaterialTable: {
        ore: { z: { itemId: 'mat', qtyByRarity: { common: 2 } } },
        wood: {},
        herb: {},
      } as TargetResolverDeps['nodeMaterialTable'],
      fishingTables: [{ z: [{ itemId: 'mat', weight: 10 }] }],
      mobs: {
        m: { id: 'm', minLevel: 1, maxLevel: 2, loot: [{ itemId: 'mat', chance: 0.5 }] },
      } as unknown as TargetResolverDeps['mobs'],
      camps: [{ mobId: 'm', center: { x: 0, z: 0 }, radius: 10, count: 3 }],
      zones: [
        {
          id: 'z',
          zMin: -100,
          zMax: 100,
          hub: { x: 0, z: 0, radius: 10, name: 'hub' },
          lakes: [{ x: 10, z: 10, radius: 8 }],
        },
      ] as unknown as TargetResolverDeps['zones'],
      inventory: bag('copper_mining_pick', 'simple_fishing_pole'),
    });
    const sources = resolveTarget('mat', deps);
    expect(sources.map((s) => s.kind)).toEqual(['fish', 'mob', 'gather']);
    // scores: fish 10/10 = 1.0 > mob 0.5*3/60 = 0.025 > gather 1*2/240
    expect(sources[0].score).toBeCloseTo(1, 5);
  });
});

describe('farmbot target_sources scanShoreSpots', () => {
  it('takes the first dry probed point per arc, only where the probe passes', () => {
    const lake = { x: 0, z: 0, radius: 10 };
    const hub = { x: 100, z: 0 };
    const isLand = (x: number, z: number) => Math.hypot(x, z) >= 9;
    // water fishes only on the hub (east) side
    const probe = (x: number) => x > 0;
    const spots = scanShoreSpots(lake, hub, isLand, probe);
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.length).toBeLessThanOrEqual(3);
    for (const s of spots) {
      expect(isLand(s.x, s.z)).toBe(true);
      expect(s.x).toBeGreaterThan(0); // the dead west side yields nothing
    }
  });

  it('returns nothing when no arc stands and fishes', () => {
    const lake = { x: 0, z: 0, radius: 10 };
    expect(
      scanShoreSpots(
        lake,
        { x: 0, z: 0 },
        () => true,
        () => false,
      ),
    ).toEqual([]);
  });
});

describe('farmbot target_sources lakeShoreSpots', () => {
  it('emits three hub-side arc points just outside the waterline, center first', () => {
    const spots = lakeShoreSpots({ x: 0, z: 0, radius: 10 }, { x: 100, z: 0 });
    expect(spots.length).toBe(3);
    // hub is due +x: every point sits ~12 from the center (0.1 rounding), x > 0
    for (const s of spots) {
      expect(Math.hypot(s.x, s.z)).toBeGreaterThan(11.9);
      expect(Math.hypot(s.x, s.z)).toBeLessThan(12.1);
      expect(s.x).toBeGreaterThan(0);
    }
    // the direct hub-side point leads (the reachable shoreline in practice)
    expect(spots[0]).toEqual({ x: 12, z: 0 });
  });
});
