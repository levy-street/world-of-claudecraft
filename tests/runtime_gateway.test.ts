import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHost } from '../server/runtime/contract';
import { RuntimeGateway } from '../server/runtime/gateway';
import { overworldRuntimeKey } from '../server/runtime/runtime_key';

function host(runtimeKey: string): RuntimeHost<string, string> {
  return {
    runtimeKey,
    start: vi.fn(),
    stop: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    handle: vi.fn(),
  };
}

describe('RuntimeGateway', () => {
  it('routes joins, messages, output, and leave through one sticky epoch', async () => {
    const sent: unknown[] = [];
    const gateway = new RuntimeGateway<string, string>((outbound) => sent.push(outbound));
    const world = host(overworldRuntimeKey('alpha'));
    gateway.register(world);

    const route = await gateway.join('char-1', world.runtimeKey, 'join-input');
    expect(world.join).toHaveBeenCalledWith({
      characterId: 'char-1',
      routeEpoch: route.routeEpoch,
      input: 'join-input',
    });
    await gateway.handle('char-1', 'move');
    expect(world.handle).toHaveBeenCalledWith('char-1', route.routeEpoch, 'move');

    const output = { characterId: 'char-1', routeEpoch: route.routeEpoch, payload: 'snap' };
    expect(gateway.deliver(output)).toBe(true);
    expect(sent).toEqual([output]);
    await gateway.leave('char-1');
    expect(world.leave).toHaveBeenCalledWith('char-1', route.routeEpoch);
    expect(gateway.deliver(output)).toBe(false);
  });

  it('rolls back a new route when the target join fails', async () => {
    const gateway = new RuntimeGateway<string, string>(() => undefined);
    const world = host(overworldRuntimeKey('alpha'));
    vi.mocked(world.join).mockRejectedValueOnce(new Error('target failed'));
    gateway.register(world);
    await expect(gateway.join('char-1', world.runtimeKey, 'input')).rejects.toThrow(
      'target failed',
    );
    expect(gateway.router.current('char-1')).toBeNull();
  });

  it('prepares a target before atomically moving authority and retiring the source', async () => {
    const gateway = new RuntimeGateway<string, string>(() => undefined);
    const world = host(overworldRuntimeKey('alpha'));
    const instance = host('alpha/dungeon/crypt:2');
    gateway.register(world);
    gateway.register(instance);
    const source = await gateway.join('char-1', world.runtimeKey, 'world-state');

    const target = await gateway.move('char-1', instance.runtimeKey, 'transfer-state');

    expect(target.routeEpoch).toBe(source.routeEpoch + 1);
    expect(instance.join).toHaveBeenCalledWith({
      characterId: 'char-1',
      routeEpoch: target.routeEpoch,
      input: 'transfer-state',
    });
    expect(world.leave).toHaveBeenCalledWith('char-1', source.routeEpoch);
    expect(gateway.router.current('char-1')).toBe(target);
  });

  it('keeps source authority when target preparation fails', async () => {
    const gateway = new RuntimeGateway<string, string>(() => undefined);
    const world = host(overworldRuntimeKey('alpha'));
    const instance = host('alpha/delve/litany:1');
    vi.mocked(instance.join).mockRejectedValueOnce(new Error('worker unavailable'));
    gateway.register(world);
    gateway.register(instance);
    const source = await gateway.join('char-1', world.runtimeKey, 'world-state');

    await expect(gateway.move('char-1', instance.runtimeKey, 'transfer-state')).rejects.toThrow(
      'worker unavailable',
    );
    expect(gateway.router.current('char-1')).toBe(source);
    expect(world.leave).not.toHaveBeenCalled();
  });

  it('retires a prepared target when another route wins before commit', async () => {
    const gateway = new RuntimeGateway<string, string>(() => undefined);
    const world = host(overworldRuntimeKey('alpha'));
    const instance = host('alpha/delve/litany:1');
    const winner = host('alpha/arena/arena:9');
    gateway.register(world);
    gateway.register(instance);
    gateway.register(winner);
    await gateway.join('char-1', world.runtimeKey, 'world-state');
    vi.mocked(instance.join).mockImplementationOnce(() => {
      gateway.router.assign('char-1', winner.runtimeKey);
    });

    await expect(gateway.move('char-1', instance.runtimeKey, 'transfer-state')).rejects.toThrow(
      'changed before handoff',
    );
    expect(instance.leave).toHaveBeenCalledWith('char-1', 2);
    expect(gateway.router.current('char-1')?.runtimeKey).toBe(winner.runtimeKey);
  });
});
