import { describe, expect, it } from 'vitest';
import { RuntimeRouter } from '../server/runtime/router';
import {
  instanceRuntimeKey,
  overworldRuntimeKey,
  parseRuntimeKey,
} from '../server/runtime/runtime_key';

describe('runtime keys and routing', () => {
  it('builds stable overworld and isolated instance keys', () => {
    expect(overworldRuntimeKey('alpha')).toBe('alpha/overworld/world');
    expect(overworldRuntimeKey('Area 52')).toBe('Area 52/overworld/world');
    expect(parseRuntimeKey("Mal'Ganis/overworld/world")).toEqual({
      realm: "Mal'Ganis",
      kind: 'overworld',
      claimId: 'world',
    });
    expect(overworldRuntimeKey('alpha', 'vale')).toBe('alpha/overworld/zone:vale');
    expect(instanceRuntimeKey('alpha', 'dungeon', 77)).toBe('alpha/dungeon/77');
    expect(instanceRuntimeKey('alpha', 'dungeon', 78)).not.toBe(
      instanceRuntimeKey('alpha', 'dungeon', 77),
    );
    expect(parseRuntimeKey('alpha/delve/claim:8')).toEqual({
      realm: 'alpha',
      kind: 'delve',
      claimId: 'claim:8',
    });
  });

  it('rejects malformed and ambiguous keys', () => {
    expect(() => parseRuntimeKey('alpha/world')).toThrow(RangeError);
    expect(() => parseRuntimeKey('alpha/other/2')).toThrow(RangeError);
    expect(() => parseRuntimeKey('alpha/overworld/2')).toThrow(RangeError);
    expect(parseRuntimeKey('alpha/overworld/zone:vale')).toEqual({
      realm: 'alpha',
      kind: 'overworld',
      claimId: 'zone:vale',
    });
    expect(() => instanceRuntimeKey('bad/realm', 'arena', 1)).toThrow(RangeError);
  });

  it('keeps sticky routes and increments epochs only when authority moves', () => {
    const router = new RuntimeRouter();
    const world = router.assign('char-1', overworldRuntimeKey('alpha'));
    const same = router.assign('char-1', overworldRuntimeKey('alpha'));
    const instance = router.assign('char-1', instanceRuntimeKey('alpha', 'dungeon', 7));

    expect(world.changed).toBe(true);
    expect(same.changed).toBe(false);
    expect(same.route).toBe(world.route);
    expect(instance.route.routeEpoch).toBe(world.route.routeEpoch + 1);
  });

  it('reserves unique epochs and never reuses an aborted handoff epoch', () => {
    const router = new RuntimeRouter();
    const world = router.assign('char-1', overworldRuntimeKey('alpha')).route;
    const firstTargetEpoch = router.reserveEpoch('char-1');
    const secondTargetEpoch = router.reserveEpoch('char-1');

    expect(firstTargetEpoch).toBe(world.routeEpoch + 1);
    expect(secondTargetEpoch).toBe(firstTargetEpoch + 1);
    expect(router.current('char-1')).toBe(world);

    const target = router.commit(
      'char-1',
      world.routeEpoch,
      instanceRuntimeKey('alpha', 'dungeon', 7),
      secondTargetEpoch,
    );
    expect(target.routeEpoch).toBe(secondTargetEpoch);
  });

  it('rejects stale runtime output and stale detach operations', () => {
    const router = new RuntimeRouter();
    const world = router.assign('char-1', overworldRuntimeKey('alpha')).route;
    const instance = router.assign('char-1', instanceRuntimeKey('alpha', 'arena', 9)).route;

    expect(
      router.accepts({
        characterId: 'char-1',
        runtimeKey: world.runtimeKey,
        routeEpoch: world.routeEpoch,
      }),
    ).toBe(false);
    expect(
      router.accepts({
        characterId: 'char-1',
        runtimeKey: world.runtimeKey,
        routeEpoch: instance.routeEpoch,
      }),
    ).toBe(false);
    expect(
      router.accepts({
        characterId: 'char-1',
        runtimeKey: instance.runtimeKey,
        routeEpoch: instance.routeEpoch,
      }),
    ).toBe(true);
    expect(router.detach('char-1', world.routeEpoch)).toBe(false);
    expect(router.detach('char-1', instance.routeEpoch)).toBe(true);
  });
});
