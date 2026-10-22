import { afterEach, describe, expect, it } from 'vitest';
import { compileLayoutStreetlamps } from '../src/editor/world_layout_streetlamps';
import { isBlocked, streetlampPlacements } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { MapDoc, MapPlacement } from '../src/sim/map_doc';
import { placeLayoutScenery } from '../src/sim/world_layout/scenery';
import { placeLayoutStreetlamps } from '../src/sim/world_layout/streetlamps';

const source: MapPlacement = {
  uid: 'lamp',
  assetId: 'props/streetlamp_eastbrook_civic',
  x: 20,
  z: 20,
  rotY: 0,
  scale: 2.5,
  collide: true,
  collisionMode: 'basic',
  collideRadius: 0.45,
};
const target = { ...source, x: 80, z: 50, rotY: 1.2, detached: true, groundY: 10, y: 0.5 };
function compile(
  placement = target,
  baseline: MapPlacement[] = [source],
  absentSourceReason?: string,
) {
  const errors: string[] = [],
    used = new Set<string>(),
    reserved = new Set<number>();
  const lamps = compileLayoutStreetlamps(
    { placements: [placement] } as MapDoc,
    [{ uid: 'lamp', source, reason: 'Reviewed authored move.', absentSourceReason }],
    baseline,
    used,
    reserved,
    (_id, reason) => errors.push(reason),
  );
  return { lamps, errors, used, reserved };
}
afterEach(() => setActiveWorldContent(null));

describe('authored streetlamps', () => {
  it('retains native lights and solid posts at the authored fixed seat and yaw', () => {
    const { lamps, errors } = compile();
    expect(errors).toEqual([]);
    setActiveWorldContent(placeLayoutScenery({ ...BUILTIN_WORLD, roads: [] }, { lamps }));
    const site = streetlampPlacements(0).find((p) => p.x === 80 && p.z === 50);
    expect(site).toMatchObject({
      y: 10.5,
      fixtureYaw: 1.2,
      style: 'eastbrook_civic',
      authored: true,
    });
    expect(isBlocked(0, 80, 50, 0.3)).toBe(true);
  });

  it('replaces the exact old post, keeps other road lamps and clears overlapping generated posts', () => {
    const { lamps } = compile();
    const old = {
      x: 20,
      z: 20,
      y: 0,
      roadYaw: 0,
      areaId: 'eastbrook_vale',
      style: 'eastbrook_civic' as const,
    };
    const unrelated = { ...old, x: 140 };
    const overlap = { ...old, x: 80.1, z: 50 };
    const result = placeLayoutStreetlamps([old, unrelated, overlap], lamps, () => 300);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(unrelated);
    expect(result[1]).toMatchObject({ x: 80, z: 50, y: 10.5, fixtureYaw: 1.2 });
    const grounded = compile({ ...target, detached: false });
    expect(placeLayoutStreetlamps([], grounded.lamps, () => 7)[0].y).toBe(7.5);
  });

  it('requires an explicit decision for a source absent from the current road plan', () => {
    expect(compile(target, []).lamps).toEqual([]);
    const accepted = compile(
      target,
      [],
      'Historical anchor is absent after canonical road changes.',
    );
    expect(accepted.errors).toEqual([]);
    expect(accepted.lamps).toHaveLength(1);
  });

  it('removes only a reviewed historical lamp whose UID was deleted, retaining later lamps', () => {
    const errors: string[] = [];
    const binding = {
      uid: 'lamp',
      source,
      remove: true as const,
      reason: 'Confirmed source deletion.',
    };
    const lamps = compileLayoutStreetlamps(
      { placements: [] } as unknown as MapDoc,
      [binding],
      [source],
      new Set(),
      new Set(),
      (_id, reason) => errors.push(reason),
    );
    expect(errors).toEqual([]);
    const old = { x: 20, z: 20, y: 0, roadYaw: 0, areaId: null, style: 'eastbrook_civic' as const };
    const later = { ...old, x: 21 };
    expect(placeLayoutStreetlamps([old, later], lamps, () => 0)).toEqual([later]);
    const refused = compileLayoutStreetlamps(
      { placements: [source] } as MapDoc,
      [binding],
      [source],
      new Set(),
      new Set(),
      (_id, reason) => errors.push(reason),
    );
    expect(refused).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it.each([
    { scale: 3 },
    { rotX: 0.2 },
    { tint: 0xff0000 },
    { collide: false, collisionMode: 'none' as const },
  ])('refuses unsupported native fixture changes without consuming the UID: %j', (patch) => {
    const result = compile({ ...target, ...patch });
    expect(result.lamps).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.used.size).toBe(0);
    expect(result.reserved.size).toBe(0);
  });
});
