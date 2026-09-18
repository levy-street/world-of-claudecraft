import { CatmullRomCurve3, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  eastbrookWolvesGuide,
  WOLF_RUN_CAMP,
  WOLVES_ROUTE,
  type WolvesGuideReader,
} from '../src/render/eastbrook_wolves_guidance_core';
import { isBlocked, pathCrossesFence } from '../src/sim/colliders';
import { EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../src/sim/eastbrook_layout';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

function world(state = 'active'): WolvesGuideReader {
  return { player: { pos: { x: -55, z: -102 } }, questLog: new Map([['q_wolves', { state }]]) };
}

describe('wolves guidance geometry and visibility', () => {
  it('resolves the authored forest wolf camp (a content rename degrades to no route, never a throw)', () => {
    expect(WOLF_RUN_CAMP).not.toBeNull();
    expect(WOLVES_ROUTE.length).toBe(4);
  });

  it('answers a finished quest from questsDone before the zone scan or any questState read', () => {
    const questState = vi.fn(() => 'available' as const);
    const done = {
      ...world(),
      questLog: new Map(),
      questsDone: new Set(['q_wolves']),
      questState,
    };
    expect(eastbrookWolvesGuide(done, () => false)).toBe(eastbrookWolvesGuide(done, () => true));
    expect(eastbrookWolvesGuide(done, () => false).plan).toBeNull();
    expect(questState).not.toHaveBeenCalled();
  });

  it('reads the dismissal thunk only after the free guards, never for a veteran or off-zone player', () => {
    const isDismissed = vi.fn(() => false);
    const done = { ...world(), questLog: new Map(), questsDone: new Set(['q_wolves']) };
    eastbrookWolvesGuide(done, isDismissed);
    const away = { ...world(), player: { pos: { x: 0, z: 300 } } };
    eastbrookWolvesGuide(away, isDismissed);
    expect(isDismissed).not.toHaveBeenCalled();
    eastbrookWolvesGuide(world(), isDismissed);
    expect(isDismissed).toHaveBeenCalledOnce();
  });

  it('never reads questState for a character outside Eastbrook Vale', () => {
    const questState = vi.fn(() => 'available' as const);
    const away = { ...world(), questLog: new Map(), player: { pos: { x: 0, z: 300 } }, questState };
    expect(eastbrookWolvesGuide(away, () => false).plan).toBeNull();
    expect(questState).not.toHaveBeenCalled();
  });

  it('keeps the rendered curve clear of fences, deep water and steep terrain', () => {
    const curve = new CatmullRomCurve3(
      [...WOLVES_ROUTE].map((p) => new Vector3(p.x, 0, p.z)),
      false,
      'centripetal',
    );
    let last = curve.getPoint(0);
    for (let i = 1; i <= 2000; i++) {
      const p = curve.getPoint(i / 2000);
      const h = groundHeight(p.x, p.z, WORLD_SEED);
      const distance = Math.hypot(p.x - last.x, p.z - last.z);
      expect(isBlocked(WORLD_SEED, p.x, p.z, 0.7), `curve sample ${i}`).toBe(false);
      expect(pathCrossesFence(last.x, last.z, p.x, p.z, 0.7)).toBe(false);
      expect(h).toBeGreaterThanOrEqual(waterLevelAt(p.x, p.z, WORLD_SEED) - 0.8);
      expect(Math.abs(h - groundHeight(last.x, last.z, WORLD_SEED)) / distance).toBeLessThan(1.5);
      last = p;
    }
  });
  it('marks Marshal in gold before acceptance without showing a wolf objective', () => {
    const offered = { ...world(), questLog: new Map(), questState: () => 'available' as const };
    const guide = eastbrookWolvesGuide(offered, () => false);
    expect(guide.glowNpcId).toBe('marshal_redbrook');
    expect(guide.glowNpcPos).toEqual(EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position);
    expect(guide.areaRing).toBeNull();
    expect(guide.plan?.key).toBe('wolves:offer');
    expect(eastbrookWolvesGuide(offered, () => true).plan).toBeNull();
  });
  it('guides toward the full authored wolf area and reverses toward Marshal for hand-in', () => {
    const outbound = eastbrookWolvesGuide(world(), () => false);
    const home = eastbrookWolvesGuide(world('ready'), () => false);
    if (!outbound.plan) throw new Error('Expected active wolves route');
    expect(WOLF_RUN_CAMP).toEqual({ x: -10, z: 6, radius: 28.5 });
    expect(outbound.plan?.points).toEqual(WOLVES_ROUTE);
    expect(WOLVES_ROUTE).toEqual([
      EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position,
      { x: -14.5, z: -72.5 },
      { x: -14.5, z: -53.5 },
      WOLF_RUN_CAMP,
    ]);
    expect(outbound.areaRing).toEqual(WOLF_RUN_CAMP);
    expect(home.plan?.points).toEqual([...outbound.plan.points].reverse());
    expect(home.glowNpcId).toBe('marshal_redbrook');
    expect(home.areaRing).toBeNull();
    for (let segment = 1; segment < outbound.plan.points.length; segment++) {
      const a = outbound.plan.points[segment - 1];
      const b = outbound.plan.points[segment];
      const samples = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 4);
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        expect(
          isBlocked(WORLD_SEED, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.5),
          `route segment ${segment} sample ${i}`,
        ).toBe(false);
      }
    }
  });

  it.each([
    null,
    { pos: { x: -55, z: -102 }, dead: true },
    { pos: { x: -55, z: -102 }, ghost: true },
    { pos: { x: 0, z: 300 } },
    { pos: { x: 10000, z: 0 } },
    { pos: { x: -300, z: -100 } },
  ])('hides away from a living Eastbrook character: %j', (player) => {
    expect(eastbrookWolvesGuide({ ...world(), player }, () => false).plan).toBeNull();
  });
});
