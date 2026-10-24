import { CatmullRomCurve3, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eastbrookWolvesGuide,
  resetWolvesGuideCache,
  WOLF_RUN_CAMP,
  WOLVES_ROUTE,
  type WolvesGuideReader,
} from '../src/render/eastbrook_wolves_guidance_core';
import { isBlocked, pathCrossesFence } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_NPC_PLACEMENTS_BY_ID } from '../src/sim/eastbrook_layout';
import { FERRY_BELL_TOWN_LANDING } from '../src/sim/interactions/ferry_bell';
import { groundHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

function world(state = 'active'): WolvesGuideReader {
  return { player: { pos: { x: -55, z: -102 } }, questLog: new Map([['q_wolves', { state }]]) };
}

describe('wolves guidance geometry and visibility', () => {
  it('resolves the authored forest wolf camp (a content rename degrades to no route, never a throw)', () => {
    expect(WOLF_RUN_CAMP).not.toBeNull();
    expect(WOLVES_ROUTE.length).toBe(8);
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
    // Re-pinned 2026-10 for the Tidehold rebuild: the apothecary's shop stood
    // on the old line north-west out of the square, so the trail followed the
    // north road round its east end. Re-pinned for the World of ClaudeCraft
    // Studio map's arrangement: the smithy stands on that line now, so the
    // trail follows the north road's swing round its forge shelter's west end
    // and back over the rise behind it, west of the road's lamp.
    expect(WOLVES_ROUTE).toEqual([
      EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position,
      { x: 13.5, z: -93.5 },
      { x: 16.3, z: -83 },
      { x: 17.5, z: -76 },
      { x: 14, z: -69 },
      { x: 7.5, z: -61.5 },
      { x: 5, z: -52 },
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

describe('wolves guidance follows Marshal where he stands', () => {
  beforeEach(() => resetWolvesGuideCache());
  afterEach(() => setActiveWorldContent(BUILTIN_WORLD));
  // A map can move Marshal Redbrook (the Studio "Eastbrook and Mirefen
  // changes" map stands him on the quay beside the ferry bell); the golden
  // guidance must lead to the NPC the player can see, not the code layout.
  const MOVED = { x: -86.2, z: -44.4 };
  const marshalAt = (pos: { x: number; z: number }, dead = false) =>
    new Map([
      [7, { kind: 'mob', templateId: 'forest_wolf', pos: { x: -10, z: 6 } }],
      [9, { kind: 'npc', templateId: 'marshal_redbrook', dead, pos }],
    ]);
  const offeredAt = (entities?: ReturnType<typeof marshalAt>) => ({
    ...world(),
    questLog: new Map(),
    questState: () => 'available' as const,
    entities,
  });
  const sampleClear = (points: readonly { x: number; z: number }[], label: string) => {
    for (let segment = 1; segment < points.length; segment++) {
      const a = points[segment - 1];
      const b = points[segment];
      const samples = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 4));
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        expect(
          isBlocked(WORLD_SEED, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.5),
          `${label} segment ${segment} sample ${i}`,
        ).toBe(false);
      }
    }
  };

  it('glows the live Marshal and leads the ferry landing to him', () => {
    const guide = eastbrookWolvesGuide(offeredAt(marshalAt(MOVED)), () => false);
    expect(guide.glowNpcId).toBe('marshal_redbrook');
    expect(guide.glowNpcPos).toEqual(MOVED);
    const points = guide.plan?.points ?? [];
    expect(points[0]).toMatchObject({ x: FERRY_BELL_TOWN_LANDING.x, z: FERRY_BELL_TOWN_LANDING.z });
    expect(points[points.length - 1]).toEqual(MOVED);
    expect(guide.plan?.key.startsWith('wolves:offer')).toBe(true);
    sampleClear(points, 'offer');
  });

  it('routes the wolf hunt from where Marshal stands to the Wolf Run and back', () => {
    const outbound = eastbrookWolvesGuide(
      { ...world('active'), entities: marshalAt(MOVED) },
      () => false,
    );
    const home = eastbrookWolvesGuide(
      { ...world('ready'), entities: marshalAt(MOVED) },
      () => false,
    );
    const points = outbound.plan?.points ?? [];
    expect(points[0]).toEqual(MOVED);
    expect(points[points.length - 1]).toEqual(WOLF_RUN_CAMP);
    expect(points).not.toEqual(WOLVES_ROUTE);
    expect(outbound.areaRing).toEqual(WOLF_RUN_CAMP);
    expect(home.plan?.points).toEqual([...points].reverse());
    expect(home.glowNpcPos).toEqual(MOVED);
    // The leg out of town is walkable; the last stretch ends in the camp's
    // own ring, which the authored route also enters straight.
    sampleClear(points.slice(0, -1), 'hunt');
  });

  it('keeps the authored route while Marshal stands at his layout spot', () => {
    const atLayout = marshalAt(EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position);
    const guide = eastbrookWolvesGuide({ ...world(), entities: atLayout }, () => false);
    expect(guide.plan?.points).toEqual(WOLVES_ROUTE);
  });

  it('falls back to the layout spot when Marshal is missing or dead', () => {
    for (const entities of [undefined, new Map(), marshalAt(MOVED, true)]) {
      const guide = eastbrookWolvesGuide(offeredAt(entities), () => false);
      expect(guide.glowNpcPos).toEqual(EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position);
    }
  });

  it('uses the loaded map position while Marshal is outside entity interest range', () => {
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      npcs: {
        ...BUILTIN_WORLD.npcs,
        marshal_redbrook: { ...BUILTIN_WORLD.npcs.marshal_redbrook, pos: MOVED },
      },
    });
    const guide = eastbrookWolvesGuide(offeredAt(new Map()), () => false);
    expect(guide.glowNpcPos).toEqual(MOVED);
    expect(guide.plan?.points.at(-1)).toEqual(MOVED);
  });

  it('rebuilds the hunt for moved map camps even when Marshal stays at his layout spot', () => {
    const original = eastbrookWolvesGuide(world(), () => false);
    const movedCamp = { mobId: 'forest_wolf', center: { x: 60, z: 70 }, radius: 10, count: 8 };
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      camps: [...BUILTIN_WORLD.camps.filter((camp) => camp.mobId !== 'forest_wolf'), movedCamp],
    });
    const guide = eastbrookWolvesGuide(world(), () => false);
    expect(guide.areaRing).toEqual({ x: 60, z: 70, radius: 10 });
    expect(guide.plan?.points.at(-1)).toEqual(guide.areaRing);
    expect(guide.plan).not.toBe(original.plan);
    expect(eastbrookWolvesGuide(world(), () => false).plan).toBe(guide.plan);
  });

  it('walks the ferry landing to Marshal on the square clear of every collider', () => {
    // The ferry now lands on the quay, so the authored offer trail is the long
    // walk up into town: pin that it never cuts through a building.
    const offered = offeredAt(undefined);
    const points = eastbrookWolvesGuide(offered, () => false).plan?.points ?? [];
    expect(points[0]).toMatchObject({ x: FERRY_BELL_TOWN_LANDING.x, z: FERRY_BELL_TOWN_LANDING.z });
    expect(points[points.length - 1]).toEqual(
      EASTBROOK_NPC_PLACEMENTS_BY_ID.marshal_redbrook.position,
    );
    sampleClear(points, 'layout offer');
  });

  it('scans for an absent Marshal only now and then, not every frame', () => {
    let reads = 0;
    const entities = new Map([
      [1, { kind: 'mob', templateId: 'forest_wolf', pos: { x: 0, z: 0 } }],
    ]);
    const counting = {
      get: (id: number) => entities.get(id),
      [Symbol.iterator]: () => {
        reads++;
        return entities[Symbol.iterator]();
      },
    } as unknown as Map<
      number,
      { kind: string; templateId: string; pos: { x: number; z: number } }
    >;
    for (let frame = 0; frame < 31; frame++) {
      eastbrookWolvesGuide({ ...world(), entities: counting }, () => false);
    }
    expect(reads).toBe(1);
    eastbrookWolvesGuide({ ...world(), entities: counting }, () => false);
    expect(reads).toBe(2);
  });

  it('works the route out once per Marshal position, never per frame', () => {
    const entities = marshalAt({ x: -84, z: -46 });
    const first = eastbrookWolvesGuide({ ...world(), entities }, () => false);
    const again = eastbrookWolvesGuide({ ...world(), entities }, () => false);
    expect(again.plan).toBe(first.plan);
    // A jitter inside the reuse radius keeps the same plan.
    const jitter = eastbrookWolvesGuide(
      { ...world(), entities: marshalAt({ x: -84.4, z: -45.7 }) },
      () => false,
    );
    expect(jitter.plan).toBe(first.plan);
    const moved = eastbrookWolvesGuide(
      { ...world(), entities: marshalAt({ x: -82, z: -47 }) },
      () => false,
    );
    expect(moved.plan).not.toBe(first.plan);
    expect(moved.plan?.key).not.toBe(first.plan?.key);
    // Walking back to the first spot reuses its cached plan.
    const back = eastbrookWolvesGuide({ ...world(), entities }, () => false);
    expect(back.plan).toBe(first.plan);
  });
});
