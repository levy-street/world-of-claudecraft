import { describe, expect, it, vi } from 'vitest';
import type { ClientSession, GameServer, RuntimePlacement } from '../server/game';
import {
  AuthoritativeRuntimeCoordinator,
  placementRuntimeKey,
} from '../server/runtime/coordinator';

function session(characterId = 7): ClientSession {
  return { characterId } as ClientSession;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('AuthoritativeRuntimeCoordinator', () => {
  it('routes live input and changes epochs after authoritative placement changes', async () => {
    let placement: RuntimePlacement = { kind: 'overworld', claimId: 'vale' };
    const game = {
      runtimePlacement: vi.fn(() => placement),
      handleMessage: vi.fn(() => {
        placement = { kind: 'dungeon', claimId: 'crypt:3' };
      }),
      socketClosed: vi.fn(() => true),
    } as unknown as GameServer;
    const coordinator = new AuthoritativeRuntimeCoordinator(game, 'alpha', 'inline');
    const live = session();
    coordinator.attach(live);
    await flush();
    const source = coordinator.gateway.router.current('7');

    coordinator.handleMessage(live, '{cmd:enter_dungeon}');
    await flush();
    const target = coordinator.gateway.router.current('7');

    expect(game.handleMessage).toHaveBeenCalledWith(live, '{cmd:enter_dungeon}');
    expect(source?.runtimeKey).toBe('alpha/overworld/zone:vale');
    expect(target?.runtimeKey).toBe('alpha/dungeon/crypt:3');
    expect(target?.routeEpoch).toBe((source?.routeEpoch ?? 0) + 1);
    expect(coordinator.stats().handoffs).toBe(1);
  });

  it('keeps a linkdead route and detaches only when the game ends the session', async () => {
    const game = {
      runtimePlacement: vi.fn(() => ({ kind: 'overworld', claimId: 'vale' })),
      handleMessage: vi.fn(),
      socketClosed: vi.fn(() => true),
    } as unknown as GameServer;
    const coordinator = new AuthoritativeRuntimeCoordinator(game, 'alpha', 'inline');
    const live = session();
    coordinator.attach(live);
    await flush();

    expect(coordinator.socketClosed(live, {} as never)).toBe(true);
    expect(coordinator.gateway.router.current('7')).not.toBeNull();
    coordinator.detached(live);
    await flush();
    expect(coordinator.gateway.router.current('7')).toBeNull();
  });

  it('derives stable zone and instance keys', () => {
    expect(placementRuntimeKey('alpha', { kind: 'overworld', claimId: 'vale' })).toBe(
      'alpha/overworld/zone:vale',
    );
    expect(placementRuntimeKey('alpha', { kind: 'arena', claimId: 'arena:42' })).toBe(
      'alpha/arena/arena:42',
    );
  });
});
