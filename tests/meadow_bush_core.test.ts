import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  eastbrookGrassExclusions,
  insideAnyBuildingFootprint,
  insideDressingExclusion,
  insideEastbrookGrassExclusion,
} from '../src/render/foliage_core';
import {
  MEADOW_BUSH_ANCHOR_SCALE,
  MEADOW_BUSH_DOOR_CLEAR,
  MEADOW_BUSH_INTERACT_CLEAR,
  MEADOW_BUSH_MEMBER_SCALE,
  MEADOW_BUSH_MIN_SPACING,
  MEADOW_BUSH_ROAD_CLEAR,
  MEADOW_BUSH_VERGE_FAR,
  MEADOW_ROCK_RADIUS_PER_SCALE,
  MEADOW_TRUNK_RADIUS_PER_SCALE,
  meadowBushPlacements,
  meadowBushSpots,
} from '../src/render/meadow_bush_core';
import {
  meadowScopeDecorations,
  meadowScopeFor,
  meadowScopeWeight,
} from '../src/render/meadow_scope_core';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  BUILTIN_WORLD,
  setActiveWorldContent,
  touchActiveWorldContent,
  WORLD_MIN_Z,
} from '../src/sim/data';
import { farmPatchesFor, gatherNodesFor } from '../src/sim/moved_objects';
import type { WorldContent } from '../src/sim/types';
import { roadDistance, terrainHeight, terrainSteepness, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// generateDressing reads the live GFX profile at call time: a LIVE settings
// object the tests swap tiers on (the foliage_dressing_profile.test.ts idiom)
vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  return { ...actual, GFX: actual.gfxInternalsForTest.settingsFor('low') };
});

afterEach(() => setActiveWorldContent(null));

const spots = () => meadowBushPlacements(WORLD_SEED, BUILTIN_WORLD);

describe('meadow bush core: placement', () => {
  it('is deterministic and modest', () => {
    const a = spots();
    expect(spots()).toBe(a);
    touchActiveWorldContent();
    const b = spots();
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
    // sparse dressing, not a hedge maze: a few hundred instances at most
    expect(a.length).toBeGreaterThan(120);
    expect(a.length).toBeLessThan(400);
    expect(meadowBushSpots(WORLD_SEED, BUILTIN_WORLD).length).toBe(a.length);
  });

  it('uses only the existing dressing models, at sizes under the base scatter', () => {
    const kinds = new Set(spots().map((s) => s.kind));
    expect([...kinds].sort()).toEqual(['bush', 'bushFlowers', 'fern']);
    for (const s of spots()) {
      expect(s.scale).toBeGreaterThanOrEqual(MEADOW_BUSH_MEMBER_SCALE[0] * 0.92 - 1e-9);
      expect(s.scale).toBeLessThanOrEqual(MEADOW_BUSH_ANCHOR_SCALE[1] + 1e-9);
      // the base scatter's own ceiling is 1.6 (0.9 + 0.7): stay under it
      expect(s.scale).toBeLessThan(1.6);
    }
  });

  it('grows along verges, wall bases, rocks and tree feet', () => {
    const bySite = new Map<string, number>();
    for (const s of spots()) bySite.set(s.site, (bySite.get(s.site) ?? 0) + 1);
    expect(bySite.get('verge') ?? 0).toBeGreaterThan(50);
    expect(bySite.get('wall') ?? 0).toBeGreaterThan(20);
    expect(bySite.get('rock') ?? 0).toBeGreaterThan(8);
    expect(bySite.get('tree') ?? 0).toBeGreaterThan(8);
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    if (!scope) throw new Error('scope expected');
    const { rocks, trees } = meadowScopeDecorations(scope);
    for (const s of spots()) {
      if (s.site === 'verge') {
        const rd = roadDistance(s.x, s.z);
        expect(rd).toBeLessThan(MEADOW_BUSH_VERGE_FAR + 3.5);
      } else if (s.site === 'rock') {
        const near = rocks.some(
          (r) => Math.hypot(s.x - r.x, s.z - r.z) < r.scale * MEADOW_ROCK_RADIUS_PER_SCALE + 1.6,
        );
        expect(near).toBe(true);
      } else if (s.site === 'tree') {
        const near = trees.some(
          (t) => Math.hypot(s.x - t.x, s.z - t.z) < t.scale * MEADOW_TRUNK_RADIUS_PER_SCALE + 1.8,
        );
        expect(near).toBe(true);
      }
    }
  });

  it('clusters instead of scattering evenly', () => {
    const list = spots();
    const nn = list.map((a) => {
      let best = Number.POSITIVE_INFINITY;
      for (const b of list) {
        if (a === b) continue;
        best = Math.min(best, Math.hypot(a.x - b.x, a.z - b.z));
      }
      return best;
    });
    nn.sort((a, b) => a - b);
    const median = nn[Math.floor(nn.length / 2)];
    // an even scatter of this many spots over the vale would sit about
    // 0.5 / sqrt(density) apart (~ 11 yards); clusters sit a couple of yards
    const density = list.length / (360 * 360);
    expect(median).toBeLessThan(0.25 * (0.5 / Math.sqrt(density)));
    expect(median).toBeLessThan(3);
    // and never interpenetrate
    expect(nn[0]).toBeGreaterThanOrEqual(MEADOW_BUSH_MIN_SPACING - 1e-9);
  });
});

describe('meadow bush core: gameplay gates', () => {
  it('never stands on a road, a doorway, the strand, a slope or inside a building', () => {
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    const content = BUILTIN_WORLD;
    const exclusions = eastbrookGrassExclusions(
      content.props.buildings,
      true,
      content.services?.noticeboards ?? [],
    );
    const aprons = exclusions.filter((ex) => ex.kind === 'circle' && /apron$/i.test(ex.id));
    expect(aprons.length).toBeGreaterThan(4);
    for (const s of spots()) {
      expect(meadowScopeWeight(scope, s.x, s.z)).toBeGreaterThanOrEqual(0.6);
      expect(roadDistance(s.x, s.z)).toBeGreaterThanOrEqual(MEADOW_BUSH_ROAD_CLEAR);
      for (const a of aprons) {
        expect(Math.hypot(s.x - a.x, s.z - a.z)).toBeGreaterThanOrEqual(MEADOW_BUSH_DOOR_CLEAR);
      }
      expect(insideEastbrookGrassExclusion(exclusions, s.x, s.z, 0.8)).toBe(false);
      expect(insideAnyBuildingFootprint(content.props.buildings, s.x, s.z, 0.8)).toBe(false);
      expect(insideDressingExclusion(content.zones, content.camps, s.x, s.z)).toBe(false);
      expect(terrainHeight(s.x, s.z, WORLD_SEED)).toBeGreaterThanOrEqual(WATER_LEVEL + 3);
      expect(terrainSteepness(s.x, s.z, WORLD_SEED)).toBeLessThanOrEqual(0.62);
    }
  });

  it('keeps clear of everything a player clicks and of rocks and trunks', () => {
    const content = BUILTIN_WORLD;
    const points: { x: number; z: number }[] = [
      ...Object.values(content.npcs).map((n) => n.pos),
      ...content.groundObjects.flatMap((o) => o.positions),
      // the shipped rows AND wherever this world's touch-up moved them
      ...GATHER_NODES.map((n) => n.pos),
      ...gatherNodesFor(content.objectMoves, GATHER_NODES).map((n) => n.pos),
      ...FARM_PATCHES.flatMap((p) => p.beds),
      ...farmPatchesFor(content.objectMoves, FARM_PATCHES).flatMap((p) => p.beds),
      ...(content.services?.stations ?? []).map((s) => s.pos),
      ...(content.services?.mailboxes ?? []),
      ...(content.services?.noticeboards ?? []),
    ];
    for (const s of spots()) {
      for (const p of points) {
        expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeGreaterThanOrEqual(MEADOW_BUSH_INTERACT_CLEAR);
      }
    }
    const scope = meadowScopeFor(WORLD_SEED, BUILTIN_WORLD);
    if (!scope) throw new Error('scope expected');
    const { rocks, trees } = meadowScopeDecorations(scope);
    for (const s of spots()) {
      for (const r of rocks) {
        expect(Math.hypot(s.x - r.x, s.z - r.z)).toBeGreaterThanOrEqual(
          r.scale * MEADOW_ROCK_RADIUS_PER_SCALE,
        );
      }
      for (const t of trees) {
        expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeGreaterThanOrEqual(
          t.scale * MEADOW_TRUNK_RADIUS_PER_SCALE + 0.3,
        );
      }
    }
  });

  it('places nothing off the built-in world or when the maker owns the scatter', () => {
    const authored: WorldContent = { ...BUILTIN_WORLD, zones: [...BUILTIN_WORLD.zones] };
    expect(meadowBushPlacements(WORLD_SEED, authored)).toEqual([]);
    const empty: WorldContent = { ...BUILTIN_WORLD, decorationsMode: 'empty' };
    expect(meadowBushPlacements(WORLD_SEED, empty)).toEqual([]);
  });

  it('is purely visual: no collider, no GFX read', () => {
    const src = readFileSync(new URL('../src/render/meadow_bush_core.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/gfx'/);
    expect(src).not.toMatch(/\bGFX\./);
    // it reads the collider field's decorations to keep clear of them, but
    // never builds or registers a body of its own
    expect(src).not.toMatch(/from '\.\.\/sim\/(colliders|decoration_collider)'/);
    expect(src).not.toMatch(/\bCollider\b/);
  });
});

describe('meadow bush core: dressing integration', () => {
  // foliage.ts buckets dressing spots by 240-yard z band and an x column
  // (two halves, or 240-yard columns on the lean profile); each bucket draws
  // one instanced mesh per (kind, part). Pinned against the source below so a
  // change to the bucketing reds here instead of silently drifting.
  const BUCKET_DEPTH = 240;
  const bucketKey = (x: number, z: number, lean: boolean, kind: string): string =>
    `${Math.floor((z - WORLD_MIN_Z) / BUCKET_DEPTH)}:${lean ? Math.floor(x / BUCKET_DEPTH) : x < 0 ? 0 : 1}:${kind}`;

  it('pins the dressing bucket key this test mirrors', () => {
    const foliage = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
    expect(foliage).toContain('const BUCKET_DEPTH = 240;');
    expect(foliage).toContain(
      'const col = GFX.leanFoliage ? Math.floor(spot.x / BUCKET_DEPTH) : spot.x < 0 ? 0 : 1;',
    );
    expect(foliage).toMatch(
      /const key = `\$\{Math\.floor\(\(spot\.z - WORLD_MIN_Z\) \/ BUCKET_DEPTH\)\}:\$\{col\}`;/,
    );
    expect(foliage).toContain('const maxKinds = 4;');
  });

  it('joins the dressing scatter on every tier, the same spots, adding no draw call', async () => {
    const gfx = await import('../src/render/gfx');
    const { generateDressing } = await import('../src/render/foliage_dressing_spots');
    const live = gfx.GFX as unknown as Record<string, unknown>;
    const snapshot = { ...live };
    const meadow = spots().map((s) => ({ x: s.x, z: s.z, kind: s.kind, scale: s.scale }));
    const profiles = {
      low: gfx.gfxInternalsForTest.settingsFor('low'),
      medium: gfx.gfxInternalsForTest.settingsFor('medium'),
      high: gfx.gfxInternalsForTest.settingsFor('high'),
      ultra: gfx.gfxInternalsForTest.settingsFor('ultra'),
      leanDense: {
        ...gfx.gfxInternalsForTest.settingsFor('medium'),
        leanFoliage: true,
        denseDressing: true,
      },
    };
    try {
      for (const [name, profile] of Object.entries(profiles)) {
        Object.assign(live, profile);
        const all = generateDressing(WORLD_SEED);
        const key = (s: { x: number; z: number; kind: string; scale: number }) =>
          `${s.kind}:${s.x}:${s.z}:${s.scale}`;
        const keys = new Set(all.map(key));
        // every clustered bush is in the scatter, identical on every tier
        for (const s of meadow) expect(keys.has(key(s)), `${name} ${key(s)}`).toBe(true);
        // and each one lands in a bucket whose mesh for that kind already
        // exists from the base scatter: instances, never a new draw call
        const meadowKeys = new Set(meadow.map(key));
        const lean = profile.leanFoliage === true;
        const baseBuckets = new Set(
          all.filter((s) => !meadowKeys.has(key(s))).map((s) => bucketKey(s.x, s.z, lean, s.kind)),
        );
        for (const s of meadow) {
          expect(baseBuckets.has(bucketKey(s.x, s.z, lean, s.kind)), `${name} ${s.kind}`).toBe(
            true,
          );
        }
      }
    } finally {
      Object.assign(live, snapshot);
    }
  });
});
