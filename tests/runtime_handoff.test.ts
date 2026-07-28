import { describe, expect, it } from 'vitest';
import {
  abortHandoff,
  beginHandoff,
  commitHandoff,
  markHandoffPrepared,
} from '../server/runtime/handoff';
import { RuntimeRouter } from '../server/runtime/router';
import { instanceRuntimeKey, overworldRuntimeKey } from '../server/runtime/runtime_key';

describe('runtime handoff', () => {
  it('keeps the source authoritative until prepare and commit complete', () => {
    const router = new RuntimeRouter();
    const source = router.assign('char-1', overworldRuntimeKey('alpha')).route;
    const handoff = beginHandoff(router, source, instanceRuntimeKey('alpha', 'dungeon', 31));

    expect(router.current('char-1')).toBe(source);
    expect(() => commitHandoff(router, handoff)).toThrow('not prepared');
    markHandoffPrepared(handoff);
    expect(router.current('char-1')).toBe(source);

    const target = commitHandoff(router, handoff);
    expect(target.runtimeKey).toBe('alpha/dungeon/31');
    expect(target.routeEpoch).toBe(handoff.targetEpoch);
    expect(handoff.state).toBe('committed');
    expect(
      router.accepts({
        characterId: 'char-1',
        runtimeKey: source.runtimeKey,
        routeEpoch: source.routeEpoch,
      }),
    ).toBe(false);
  });

  it('aborts without moving authority', () => {
    const router = new RuntimeRouter();
    const source = router.assign('char-1', overworldRuntimeKey('alpha')).route;
    const handoff = beginHandoff(router, source, instanceRuntimeKey('alpha', 'arena', 4));
    markHandoffPrepared(handoff);
    abortHandoff(handoff);

    expect(router.current('char-1')).toBe(source);
    expect(handoff.state).toBe('aborted');
    expect(() => commitHandoff(router, handoff)).toThrow('not prepared');
  });

  it('fails closed when the route changes during preparation', () => {
    const router = new RuntimeRouter();
    const source = router.assign('char-1', overworldRuntimeKey('alpha')).route;
    const handoff = beginHandoff(router, source, instanceRuntimeKey('alpha', 'delve', 2));
    markHandoffPrepared(handoff);
    router.assign('char-1', instanceRuntimeKey('alpha', 'arena', 7));

    expect(() => commitHandoff(router, handoff)).toThrow('changed before handoff');
    expect(router.current('char-1')?.runtimeKey).toBe('alpha/arena/7');
  });
});
