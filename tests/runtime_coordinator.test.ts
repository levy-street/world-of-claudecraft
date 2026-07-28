import { describe, expect, it, vi } from 'vitest';
import type { ClientSession, GameServer } from '../server/game';
import { AuthoritativeRuntimeCoordinator } from '../server/runtime/coordinator';

function session(characterId = 7): ClientSession {
  return { characterId } as ClientSession;
}

describe('AuthoritativeRuntimeCoordinator', () => {
  it('routes steady input synchronously through one realm host without reconciliation churn', async () => {
    const game = {
      handleMessage: vi.fn(),
      socketClosed: vi.fn(() => true),
    } as unknown as GameServer;
    const coordinator = new AuthoritativeRuntimeCoordinator(game, 'Area 52', 'inline');
    const live = session();
    await coordinator.start();
    await coordinator.attach(live);
    const route = coordinator.gateway.router.current('7');

    for (let i = 0; i < 40; i++) coordinator.handleMessage(live, `move:${i}`);

    expect(game.handleMessage).toHaveBeenCalledTimes(40);
    expect(route?.runtimeKey).toBe('Area 52/overworld/world');
    expect(coordinator.gateway.router.current('7')).toBe(route);
    expect(coordinator.stats()).toMatchObject({ hosts: 1, routes: 1, handoffs: 0 });
    await coordinator.stop();
    expect(coordinator.stats()).toMatchObject({ hosts: 0, routes: 0 });
  });

  it('keeps a linkdead route and detaches only when the game ends the session', async () => {
    const game = {
      handleMessage: vi.fn(),
      socketClosed: vi.fn(() => true),
    } as unknown as GameServer;
    const coordinator = new AuthoritativeRuntimeCoordinator(game, 'alpha', 'inline');
    const live = session();
    await coordinator.start();
    await coordinator.attach(live);

    expect(coordinator.socketClosed(live, {} as never)).toBe(true);
    expect(coordinator.gateway.router.current('7')).not.toBeNull();
    coordinator.detached(live);
    await coordinator.stop();
    expect(coordinator.gateway.router.current('7')).toBeNull();
  });

  it('fails closed if inactive worker mode bypasses boot config', () => {
    const game = { handleMessage: vi.fn(), socketClosed: vi.fn() } as unknown as GameServer;
    expect(() => new AuthoritativeRuntimeCoordinator(game, 'alpha', 'instance-workers')).toThrow(
      /instance-workers.*not configured/,
    );
  });
});
