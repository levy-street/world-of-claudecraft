// The Fire and Fly arena's render plan (src/render/fire_and_fly_arena_core.ts)
// and its thin painter: the ground, trees and rocks drawn from the sim's own
// field leaf, the hills beyond the wall, the golden-hour sky hold, and the
// open-field builder registry dungeon.ts dispatches through.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildFireAndFlyArenaInterior } from '../src/render/fire_and_fly_arena';
import {
  arenaHash,
  createArenaGroundPaint,
  FIRE_AND_FLY_BARE_FOOT,
  FIRE_AND_FLY_CLEARING_TUFT_MAX,
  FIRE_AND_FLY_GROUND_RADIUS,
  FIRE_AND_FLY_GROUND_SEGMENTS,
  FIRE_AND_FLY_SKY_ANCHOR,
  FIRE_AND_FLY_SKY_HOLD,
  FIRE_AND_FLY_SUN_DIRECTION,
  FIRE_AND_FLY_TREE_ROW_KEEP,
  fireAndFlyBackdropCrowns,
  fireAndFlyDrawnTrees,
  fireAndFlyFlowerSpots,
  fireAndFlyGrassSpots,
  fireAndFlyGroundPaint,
  fireAndFlyGroundRings,
  fireAndFlyLeafTone,
  fireAndFlyMotes,
  fireAndFlyRenderHeight,
  fireAndFlyRockPlacement,
  fireAndFlyTreeCastsIntoClearing,
  fireAndFlyTreeDensity,
  fireAndFlyTreePlacement,
  fireAndFlyUnderstorySpots,
  isFireAndFlyArenaAt,
} from '../src/render/fire_and_fly_arena_core';
import { SUN_ANCHOR } from '../src/render/gfx';
import { setSkyCamera } from '../src/render/hoard_valley_frame';
import { createOwnedInteriorResourceRegistry } from '../src/render/interior_resource_lifecycle';
import {
  attachOpenFieldInterior,
  type OpenFieldInteriorDeps,
  openFieldInteriorBuilder,
} from '../src/render/open_field_interiors';
import type { SkyCycleHold } from '../src/render/sky';
import { skyBiomesAt } from '../src/render/sky';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  FIRE_AND_FLY_CLEARING_RADIUS,
  FIRE_AND_FLY_EDGE_TREES,
  FIRE_AND_FLY_FOREST_RADIUS,
  FIRE_AND_FLY_ROCKS,
  FIRE_AND_FLY_TREE_RING,
  FIRE_AND_FLY_TREE_ROWS,
  FIRE_AND_FLY_TREES,
  FIRE_AND_FLY_WALL_REACH,
  fireAndFlyColliders,
  fireAndFlyFieldHeight,
  fireAndFlyTrunkRadius,
} from '../src/sim/fire_and_fly_field';

const ARENA_INDEX = DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index;

function polar(r: number, angle: number): { x: number; z: number } {
  return { x: Math.sin(angle) * r, z: Math.cos(angle) * r };
}

describe('the drawn ground', () => {
  it('is the sim field under the whole forest, and hills only past it', () => {
    for (let r = 0; r <= FIRE_AND_FLY_FOREST_RADIUS; r += 2.5) {
      for (let k = 0; k < 24; k++) {
        const { x, z } = polar(r, (k / 24) * Math.PI * 2);
        expect(fireAndFlyRenderHeight(x, z)).toBe(fireAndFlyFieldHeight(x, z));
      }
    }
    for (let k = 0; k < 48; k++) {
      const { x, z } = polar(215, (k / 48) * Math.PI * 2);
      // The crest stands well above the forest floor, closing the horizon.
      expect(fireAndFlyRenderHeight(x, z) - fireAndFlyFieldHeight(x, z)).toBeGreaterThan(3);
    }
  });

  it('lifts into the hills without a step at the hill foot', () => {
    for (let k = 0; k < 36; k++) {
      const angle = (k / 36) * Math.PI * 2;
      for (let r = FIRE_AND_FLY_FOREST_RADIUS; r < 140; r += 0.5) {
        const a = polar(r, angle);
        const b = polar(r + 0.5, angle);
        const step = Math.abs(fireAndFlyRenderHeight(b.x, b.z) - fireAndFlyRenderHeight(a.x, a.z));
        expect(step).toBeLessThan(0.3);
      }
    }
  });

  it('rings the disc fine at the tower foot and the clearing, coarse on the hills', () => {
    const rings = fireAndFlyGroundRings();
    expect(rings[0]).toBe(0);
    expect(rings.at(-1)).toBe(FIRE_AND_FLY_GROUND_RADIUS);
    for (let i = 1; i < rings.length; i++) {
      const gap = rings[i] - rings[i - 1];
      expect(gap).toBeGreaterThan(0);
      if (rings[i] <= 64) expect(gap).toBeLessThanOrEqual(1.25 + 1e-9);
    }
    expect(FIRE_AND_FLY_GROUND_SEGMENTS).toBeGreaterThanOrEqual(128);
  });

  it('paints the tower foot bare, the clearing green and the forest floor in litter', () => {
    const paint = createArenaGroundPaint();
    let grassy = 0;
    let samples = 0;
    for (let r = 0; r < 100; r += 1) {
      for (let k = 0; k < 32; k++) {
        const { x, z } = polar(r, (k / 32) * Math.PI * 2);
        fireAndFlyGroundPaint(x, z, paint);
        for (const weight of [paint.dirt, paint.dry, paint.lush, paint.shade]) {
          expect(weight).toBeGreaterThanOrEqual(0);
          expect(weight).toBeLessThanOrEqual(1);
        }
        if (r < 2) expect(paint.dirt).toBeGreaterThan(0.95);
        if (r >= 12 && r <= 48) {
          samples++;
          if (paint.dirt < 0.5) grassy++;
        }
        if (r >= 72) expect(paint.dirt).toBeGreaterThan(0.5);
      }
    }
    expect(grassy / samples).toBeGreaterThan(0.8);
  });
});

describe('the ground cover', () => {
  const grass = fireAndFlyGrassSpots(1.2);

  it('is deterministic', () => {
    expect(fireAndFlyGrassSpots(1.2)).toEqual(grass);
    expect(fireAndFlyFlowerSpots()).toEqual(fireAndFlyFlowerSpots());
    expect(fireAndFlyUnderstorySpots()).toEqual(fireAndFlyUnderstorySpots());
  });

  it('is planned once per step, not again for every slot the arena is built in', () => {
    expect(fireAndFlyGrassSpots(1.2)).toBe(grass);
    expect(fireAndFlyGrassSpots(1.8)).toBe(fireAndFlyGrassSpots(1.8));
    expect(fireAndFlyGrassSpots(1.8)).not.toBe(grass);
    expect(fireAndFlyFlowerSpots()).toBe(fireAndFlyFlowerSpots());
    expect(fireAndFlyUnderstorySpots()).toBe(fireAndFlyUnderstorySpots());
    expect(fireAndFlyGrassSpots(1.8, 'medium')).toBe(fireAndFlyGrassSpots(1.8, 'medium'));
    expect(fireAndFlyUnderstorySpots('medium')).toBe(fireAndFlyUnderstorySpots('medium'));
    expect(fireAndFlyUnderstorySpots('medium')).not.toBe(fireAndFlyUnderstorySpots());
  });

  it('leaves no bare patch where a thinner tier drops a tree, and adds none in a drawn trunk', () => {
    const key = (spot: { x: number; z: number }) => `${spot.x}:${spot.z}`;
    const nearDropped = (spot: { x: number; z: number }, drawn: Set<unknown>) =>
      FIRE_AND_FLY_TREES.some(
        (tree) =>
          !drawn.has(tree) &&
          Math.hypot(spot.x - tree.x, spot.z - tree.z) < fireAndFlyTrunkRadius(tree) + 0.9,
      );
    for (const density of ['medium', 'low'] as const) {
      const drawn = new Set<unknown>(fireAndFlyDrawnTrees(density));
      for (const [full, thin] of [
        [fireAndFlyGrassSpots(1.8), fireAndFlyGrassSpots(1.8, density)],
        [fireAndFlyUnderstorySpots(), fireAndFlyUnderstorySpots(density)],
      ] as const) {
        const had = new Set(full.map(key));
        const added = thin.filter((spot) => !had.has(key(spot)));
        // The thinner scatter is the full one plus cover where a dropped trunk stood.
        expect(thin.length).toBe(full.length + added.length);
        expect(added.length).toBeGreaterThan(0);
        for (const spot of added) {
          expect(nearDropped(spot, drawn)).toBe(true);
          for (const tree of fireAndFlyDrawnTrees(density)) {
            expect(Math.hypot(spot.x - tree.x, spot.z - tree.z)).toBeGreaterThan(
              fireAndFlyTrunkRadius(tree),
            );
          }
        }
      }
    }
  });

  it('carries the ground paint under each tuft, so the painter never paints it twice', () => {
    const paint = createArenaGroundPaint();
    for (const spot of grass) {
      fireAndFlyGroundPaint(spot.x, spot.z, paint);
      expect(spot.dry).toBe(paint.dry);
      expect(spot.lush).toBe(paint.lush);
    }
  });

  it('keeps the tower foot and every rock clear, and seats each tuft on the field', () => {
    expect(grass.length).toBeGreaterThan(6000);
    expect(grass.length).toBeLessThan(16000);
    for (const spot of grass) {
      expect(Math.hypot(spot.x, spot.z)).toBeGreaterThanOrEqual(FIRE_AND_FLY_BARE_FOOT);
      expect(spot.y).toBe(fireAndFlyFieldHeight(spot.x, spot.z));
      for (const rock of FIRE_AND_FLY_ROCKS) {
        expect(Math.hypot(spot.x - rock.x, spot.z - rock.z)).toBeGreaterThan(rock.radius);
      }
    }
  });

  it('grows no tuft inside a drawn trunk on any tier, the inner row included', () => {
    for (const [step, density] of [
      [1.2, 'full'],
      [1.8, 'medium'],
    ] as const) {
      const trees = fireAndFlyDrawnTrees(density);
      const inside = fireAndFlyGrassSpots(step, density).filter((spot) =>
        trees.some(
          (tree) => Math.hypot(spot.x - tree.x, spot.z - tree.z) <= fireAndFlyTrunkRadius(tree),
        ),
      );
      expect(inside).toEqual([]);
    }
  });

  it('keeps the grass short where the monsters walk, so a ground marker is never buried', () => {
    const inner = grass.filter((spot) => Math.hypot(spot.x, spot.z) < 46);
    expect(inner.length).toBeGreaterThan(1000);
    for (const spot of inner)
      expect(spot.scale).toBeLessThanOrEqual(FIRE_AND_FLY_CLEARING_TUFT_MAX);
  });

  it('grows flowers in the clearing and the understory at the forest edge, clear of trunks', () => {
    const flowers = fireAndFlyFlowerSpots();
    expect(flowers.length).toBeGreaterThan(50);
    for (const spot of flowers) {
      expect(Math.hypot(spot.x, spot.z)).toBeLessThanOrEqual(FIRE_AND_FLY_CLEARING_RADIUS + 1);
    }
    const understory = fireAndFlyUnderstorySpots();
    expect(understory.some((spot) => spot.kind === 'fern')).toBe(true);
    expect(understory.some((spot) => spot.kind === 'bush')).toBe(true);
    for (const spot of understory) {
      expect(Math.hypot(spot.x, spot.z)).toBeGreaterThan(FIRE_AND_FLY_CLEARING_RADIUS);
      for (const tree of FIRE_AND_FLY_TREES) {
        expect(Math.hypot(spot.x - tree.x, spot.z - tree.z)).toBeGreaterThan(
          fireAndFlyTrunkRadius(tree),
        );
      }
    }
  });
});

describe('the trees, rocks and hills', () => {
  it('draws one tree per sim trunk, at the collider, standing on the field', () => {
    for (const tree of FIRE_AND_FLY_TREES) {
      const at = fireAndFlyTreePlacement(tree);
      expect(at.x).toBe(tree.x);
      expect(at.z).toBe(tree.z);
      expect(at.yaw).toBe(tree.rot);
      expect(at.scale).toBeGreaterThan(tree.scale);
      const ground = fireAndFlyFieldHeight(tree.x, tree.z);
      expect(at.y).toBeLessThanOrEqual(ground);
      expect(at.y).toBeGreaterThan(ground - 0.2);
      expect(['pine', 'oak', 'goldenOak']).toContain(fireAndFlyLeafTone(tree));
    }
  });

  it('casts shadows into the clearing from the sun-side inner rows only', () => {
    const casting = FIRE_AND_FLY_TREES.filter(fireAndFlyTreeCastsIntoClearing);
    expect(casting.length).toBeGreaterThan(40);
    expect(casting.length).toBeLessThan(FIRE_AND_FLY_TREES.length / 2);
    for (const tree of casting) {
      expect(Math.hypot(tree.x, tree.z)).toBeLessThanOrEqual(82);
      expect(
        tree.x * FIRE_AND_FLY_SUN_DIRECTION.x + tree.z * FIRE_AND_FLY_SUN_DIRECTION.z,
      ).toBeGreaterThan(-0.2 * Math.hypot(tree.x, tree.z));
    }
  });

  it('seats every rock on the field at its collider', () => {
    for (const rock of FIRE_AND_FLY_ROCKS) {
      const at = fireAndFlyRockPlacement(rock);
      expect(at.x).toBe(rock.x);
      expect(at.z).toBe(rock.z);
      expect(at.ground).toBe(fireAndFlyFieldHeight(rock.x, rock.z));
      expect(at.sx).toBeGreaterThan(0);
      expect(at.sz).toBeGreaterThan(0);
    }
  });

  it('plants the canopy of the hills beyond the forest only, on the drawn hills', () => {
    const crowns = fireAndFlyBackdropCrowns();
    // Each crown is one merged 80-triangle shape: this bound is the hills' budget.
    expect(crowns.length).toBeLessThan(2600);
    expect(crowns.some((crown) => crown.near)).toBe(true);
    expect(crowns.some((crown) => !crown.near)).toBe(true);
    for (const crown of crowns) {
      const r = Math.hypot(crown.x, crown.z);
      expect(r).toBeGreaterThan(FIRE_AND_FLY_TREE_RING.outer);
      expect(r).toBeGreaterThan(FIRE_AND_FLY_FOREST_RADIUS - 2);
      expect(r).toBeLessThan(FIRE_AND_FLY_GROUND_RADIUS);
      expect(crown.y).toBeCloseTo(fireAndFlyRenderHeight(crown.x, crown.z) - 0.6, 9);
      expect(crown.height).toBeGreaterThan(crown.radius);
    }
  });

  it('indexes the canopy: each crown shares its corners, a fifth of the unindexed vertices', () => {
    const crowns = fireAndFlyBackdropCrowns();
    const origin = instanceOrigin(ARENA_INDEX, 2);
    const hills = buildFireAndFlyArenaInterior({ lowGfx: true, origin }).getObjectByName(
      'fireAndFlyBackdrop',
    )!;
    let corners = 0;
    let vertices = 0;
    for (const mesh of hills.children as THREE.Mesh[]) {
      const index = mesh.geometry.getIndex();
      expect(index).not.toBeNull();
      corners += index!.count;
      vertices += mesh.geometry.getAttribute('position').count;
    }
    // The low tier's crown is a twenty-face icosahedron: 60 corners on 12 shared vertices.
    expect(corners).toBe(crowns.length * 60);
    expect(vertices).toBe(crowns.length * 12);
  });

  it('hangs pollen over the meadow and the sunlit forest edge, above the ground', () => {
    const motes = fireAndFlyMotes(300);
    expect(motes).toHaveLength(300);
    expect(fireAndFlyMotes(300)).toEqual(motes);
    for (const mote of motes) {
      expect(Math.hypot(mote.x, mote.z)).toBeLessThan(FIRE_AND_FLY_TREE_RING.inner + 4);
      expect(mote.y).toBeGreaterThan(fireAndFlyFieldHeight(mote.x, mote.z));
    }
  });

  it('hashes deterministically in 0..1', () => {
    for (let i = 0; i < 200; i++) {
      const value = arenaHash(i, i * 3, 7);
      expect(value).toBe(arenaHash(i, i * 3, 7));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('the tree ring per tier', () => {
  const rows = FIRE_AND_FLY_TREE_ROWS;

  it("groups the sim's trees into their rows, from the clearing outward", () => {
    expect(rows.length).toBe(FIRE_AND_FLY_TREE_ROW_KEEP.full.length);
    expect(rows.flat()).toEqual([...FIRE_AND_FLY_TREES]);
    const mean = (row: readonly { x: number; z: number }[]) =>
      row.reduce((sum, tree) => sum + Math.hypot(tree.x, tree.z), 0) / row.length;
    for (let k = 1; k < rows.length; k++)
      expect(mean(rows[k])).toBeGreaterThan(mean(rows[k - 1]) + 5);
  });

  it('reads the static preset tier: high and above draw the whole ring, medium and low thin it', () => {
    expect(fireAndFlyTreeDensity('insane')).toBe('full');
    expect(fireAndFlyTreeDensity('ultra')).toBe('full');
    expect(fireAndFlyTreeDensity('high')).toBe('full');
    expect(fireAndFlyTreeDensity('medium')).toBe('medium');
    expect(fireAndFlyTreeDensity('low')).toBe('low');
    expect(fireAndFlyDrawnTrees('full')).toEqual([...FIRE_AND_FLY_TREES]);
  });

  it('draws about 60 percent of the ring on medium and 35 percent on low', () => {
    const total = FIRE_AND_FLY_TREES.length;
    expect(fireAndFlyDrawnTrees('medium').length).toBe(197);
    expect(fireAndFlyDrawnTrees('low').length).toBe(113);
    expect(fireAndFlyDrawnTrees('medium').length / total).toBeCloseTo(0.6, 1);
    expect(fireAndFlyDrawnTrees('low').length / total).toBeCloseTo(0.35, 1);
    // Both species stay in the mix.
    for (const density of ['medium', 'low'] as const) {
      const drawn = fireAndFlyDrawnTrees(density);
      const pines = drawn.filter((tree) => tree.kind === 'pine').length;
      expect(pines / drawn.length).toBeGreaterThan(0.35);
      expect(pines / drawn.length).toBeLessThan(0.6);
    }
  });

  it('keeps the inner row whole and thins the far rows first, evenly around each row', () => {
    for (const density of ['full', 'medium', 'low'] as const) {
      const drawn = new Set(fireAndFlyDrawnTrees(density));
      expect(drawn.size).toBe(fireAndFlyDrawnTrees(density).length);
      const kept = rows.map((row) => row.filter((tree) => drawn.has(tree)));
      expect(kept[0]).toEqual(rows[0]);
      for (let k = 1; k < rows.length; k++) {
        expect(kept[k].length / rows[k].length).toBeLessThanOrEqual(
          kept[k - 1].length / rows[k - 1].length,
        );
        // No bare arc: the widest gap in a row stays within its even spacing
        // plus the sim's own jitter and one slot of rounding.
        const angles = kept[k].map((tree) => Math.atan2(tree.x, tree.z)).sort((a, b) => a - b);
        let widest = 0;
        for (let i = 0; i < angles.length; i++) {
          const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
          widest = Math.max(widest, next - angles[i]);
        }
        const slot = (2 * Math.PI) / rows[k].length;
        expect(widest).toBeLessThan((2 * Math.PI) / angles.length + 1.6 * slot);
      }
    }
  });

  it('draws every trunk a thrown body can reach on every tier: no difference inside the wall', () => {
    const trunks = fireAndFlyColliders(0).filter(
      (c) => c.type === 'circle' && c.moveTopY === undefined,
    );
    expect(trunks).toHaveLength(FIRE_AND_FLY_EDGE_TREES.length);
    for (const density of ['full', 'medium', 'low'] as const) {
      const drawn = new Set(fireAndFlyDrawnTrees(density));
      for (const tree of FIRE_AND_FLY_TREES) {
        const reachable =
          Math.hypot(tree.x, tree.z) - fireAndFlyTrunkRadius(tree) <= FIRE_AND_FLY_WALL_REACH;
        expect(FIRE_AND_FLY_EDGE_TREES.includes(tree)).toBe(reachable);
        if (reachable) expect(drawn.has(tree)).toBe(true);
      }
    }
  });

  it('is deterministic and planned once per density', async () => {
    const indices = (trees: readonly { x: number; z: number }[]) =>
      trees.map((tree) => FIRE_AND_FLY_TREES.findIndex((t) => t.x === tree.x && t.z === tree.z));
    const planned = { medium: fireAndFlyDrawnTrees('medium'), low: fireAndFlyDrawnTrees('low') };
    expect(fireAndFlyDrawnTrees('low')).toBe(planned.low);
    vi.resetModules();
    const fresh = await import('../src/render/fire_and_fly_arena_core');
    for (const density of ['medium', 'low'] as const) {
      expect(indices(fresh.fireAndFlyDrawnTrees(density))).toEqual(indices(planned[density]));
    }
  });
});

describe('the golden hour', () => {
  it('lights from the HDRIs sun azimuth, low over the tree line', () => {
    const d = FIRE_AND_FLY_SUN_DIRECTION;
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    const elevation = (Math.asin(d.y) * 180) / Math.PI;
    expect(elevation).toBeGreaterThan(15);
    expect(elevation).toBeLessThan(30);
    expect(Math.atan2(d.x, d.z)).toBeCloseTo(Math.atan2(SUN_ANCHOR.x, SUN_ANCHOR.z), 9);
  });

  it('anchors the dome on the amber sunset sky', () => {
    expect(skyBiomesAt(FIRE_AND_FLY_SKY_ANCHOR.x, FIRE_AND_FLY_SKY_ANCHOR.z)).toEqual(['amber']);
    expect(FIRE_AND_FLY_SKY_HOLD.sunDirection).toBe(FIRE_AND_FLY_SUN_DIRECTION);
    expect(FIRE_AND_FLY_SKY_HOLD.nightDesat).toBe(0);
  });

  it('holds the dome on its sky and hour inside the arena, and releases it outside', () => {
    const calls: { pos: [number, number][]; holds: (SkyCycleHold | null)[] } = {
      pos: [],
      holds: [],
    };
    const sky = {
      setCameraPos: (x: number, z: number) => {
        calls.pos.push([x, z]);
      },
      holdCycle: (hold: SkyCycleHold | null) => {
        calls.holds.push(hold);
      },
    };
    const arena = instanceOrigin(ARENA_INDEX, 3);
    setSkyCamera(sky, null, { x: arena.x + 12, z: arena.z - 5 }, 0.016);
    expect(calls.pos.at(-1)).toEqual([FIRE_AND_FLY_SKY_ANCHOR.x, FIRE_AND_FLY_SKY_ANCHOR.z]);
    expect(calls.holds.at(-1)).toBe(FIRE_AND_FLY_SKY_HOLD);
    setSkyCamera(sky, null, { x: 40, z: -30 }, 0.016);
    expect(calls.pos.at(-1)).toEqual([40, -30]);
    expect(calls.holds.at(-1)).toBeNull();
  });

  it('knows the arena band by x alone', () => {
    expect(isFireAndFlyArenaAt(instanceOrigin(ARENA_INDEX, 0).x)).toBe(true);
    expect(isFireAndFlyArenaAt(instanceOrigin(ARENA_INDEX, 23).x + 40)).toBe(true);
    expect(isFireAndFlyArenaAt(0)).toBe(false);
    const wildheart = Object.values(DUNGEONS).find((d) => d.interior === 'wildheart');
    expect(wildheart).toBeDefined();
    if (wildheart) expect(isFireAndFlyArenaAt(instanceOrigin(wildheart.index, 0).x)).toBe(false);
  });
});

function fieldDeps(origin: { x: number; z: number }): OpenFieldInteriorDeps {
  return { lowGfx: true, flames: [], fireLights: {} as never, origin };
}

describe('the open-field builder registry', () => {
  it('routes the two open fields to their builders and every room-kit interior to none', () => {
    expect(openFieldInteriorBuilder('fire_and_fly')?.standInFirst).toBe(true);
    expect(openFieldInteriorBuilder('wildheart')?.standInFirst).toBe(false);
    for (const interior of ['crypt', 'arena', 'lastkeep', 'toString', '__proto__']) {
      expect(openFieldInteriorBuilder(interior)).toBeNull();
    }
    expect(DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].interior).toBe('fire_and_fly');
  });

  it('seats the arena at the slot origin, the ground first and the rest behind it', () => {
    const origin = instanceOrigin(ARENA_INDEX, 2);
    const group = openFieldInteriorBuilder('fire_and_fly')?.build(fieldDeps(origin));
    expect(group?.name).toBe('fireAndFlyArena');
    expect(group?.position.toArray()).toEqual([origin.x, 0, origin.z]);
    expect(group?.userData.renderCategory).toBe('dungeon');
    expect(group?.children.map((child) => child.name)).toEqual([
      'fireAndFlyGround',
      'fireAndFlyDressing',
    ]);
  });
});

describe('the open-field attach', () => {
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  it('shows the ground on its own link while the rest of the arena is still linking', async () => {
    const field = openFieldInteriorBuilder('fire_and_fly');
    if (!field) throw new Error('no arena row');
    const group = field.build(fieldDeps(instanceOrigin(ARENA_INDEX, 4)));
    const ground = group.getObjectByName('fireAndFlyGround');
    const dressing = group.getObjectByName('fireAndFlyDressing');
    const settle = new Map<THREE.Object3D, () => void>();
    const gate = (target: THREE.Object3D) =>
      new Promise<void>((resolve) => settle.set(target, resolve));
    const scene = new THREE.Scene();
    const registry = createOwnedInteriorResourceRegistry();
    const attached = attachOpenFieldInterior(scene, group, field, gate, registry);
    // The ground's one program is queued ahead of the rest.
    expect([...settle.keys()]).toEqual([ground, dressing]);
    expect(group.parent).toBe(scene);
    expect(group.visible).toBe(false);
    settle.get(ground as THREE.Object3D)?.();
    await flush();
    expect(group.visible).toBe(true);
    expect(ground?.visible).toBe(true);
    expect(dressing?.visible).toBe(false);
    settle.get(dressing as THREE.Object3D)?.();
    await attached;
    expect(dressing?.visible).toBe(true);
    expect(dressing?.parent).toBe(group);
  });

  it('gates a field without a stand-in as one root', async () => {
    const group = new THREE.Group();
    group.add(new THREE.Group(), new THREE.Group());
    const targets: THREE.Object3D[] = [];
    const gate = (target: THREE.Object3D) => {
      targets.push(target);
      return Promise.resolve();
    };
    await attachOpenFieldInterior(
      new THREE.Scene(),
      group,
      { build: () => group, standInFirst: false },
      gate,
      createOwnedInteriorResourceRegistry(),
    );
    expect(targets).toEqual([group]);
    expect(group.visible).toBe(true);
  });
});

describe('the arena painter (lean tier, no foliage models loaded)', () => {
  const origin = instanceOrigin(ARENA_INDEX, 5);
  const group = buildFireAndFlyArenaInterior({ lowGfx: true, origin });
  group.position.set(origin.x, 0, origin.z);
  group.updateMatrixWorld(true);

  it('names every material it makes, so a live-program event reads', () => {
    group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh && !(node as THREE.Points).isPoints) return;
      expect((mesh.material as THREE.Material).name).toMatch(/^fireAndFly:/);
    });
  });

  it('draws every slot with the same materials and geometries', () => {
    const other = buildFireAndFlyArenaInterior({
      lowGfx: true,
      origin: instanceOrigin(ARENA_INDEX, 6),
    });
    const resources = (root: THREE.Object3D) => {
      const found: unknown[] = [];
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) found.push(mesh.material, mesh.geometry);
      });
      return found;
    };
    const mine = resources(group);
    const theirs = resources(other);
    expect(theirs.length).toBeGreaterThanOrEqual(4);
    expect(theirs).toHaveLength(mine.length);
    theirs.forEach((resource, i) => {
      expect(resource).toBe(mine[i]);
    });
  });

  it('builds the ground disc from the plan and no light of its own', () => {
    expect(group.name).toBe('fireAndFlyArena');
    const ground = group.getObjectByName('fireAndFlyGround') as THREE.Mesh;
    const rings = fireAndFlyGroundRings();
    expect(ground.geometry.getAttribute('position').count).toBe(
      1 + (rings.length - 1) * FIRE_AND_FLY_GROUND_SEGMENTS,
    );
    let lights = 0;
    group.traverse((node) => {
      if ((node as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(0);
  });

  it('seats the foliage kit at world positions for the per-instance collapse', () => {
    const kit = group.getObjectByName('fireAndFlyFoliageKit');
    expect(kit).toBeDefined();
    const world = new THREE.Vector3().setFromMatrixPosition(
      kit?.matrixWorld ?? new THREE.Matrix4(),
    );
    expect(world.length()).toBeCloseTo(0, 6);
  });

  it('marks every geometry and material renderer-owned, so no teardown releases them', () => {
    let meshes = 0;
    group.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh && !(node as THREE.Points).isPoints) return;
      meshes++;
      expect(mesh.geometry.userData.sharedRendererResource).toBe(true);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) expect(material.userData.sharedRendererResource).toBe(true);
    });
    expect(meshes).toBeGreaterThanOrEqual(3);
  });
});
