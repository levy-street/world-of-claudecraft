import { describe, expect, it, vi } from 'vitest';
import {
  type CharacterStreamKickDependencies,
  kickCharacterPreloadStream,
  type PostEntryWarmupDependencies,
  runPostEntryWarmups,
} from '../src/game/post_entry_warmups_core';

function dependencies(
  overrides: Partial<PostEntryWarmupDependencies> = {},
): PostEntryWarmupDependencies {
  return {
    settleFarVista: vi.fn().mockResolvedValue(true),
    onFarVistaSettled: vi.fn(),
    onWarmupError: vi.fn(),
    ...overrides,
  };
}

function kickDependencies(
  overrides: Partial<CharacterStreamKickDependencies> = {},
): CharacterStreamKickDependencies {
  return {
    startCharacterPreloads: vi.fn().mockReturnValue(3),
    onCharacterPreloadsStarted: vi.fn(),
    ...overrides,
  };
}

describe('kickCharacterPreloadStream', () => {
  it('starts the deferred character stream and reports the count', () => {
    const deps = kickDependencies();

    kickCharacterPreloadStream(deps);

    expect(deps.startCharacterPreloads).toHaveBeenCalledOnce();
    expect(deps.onCharacterPreloadsStarted).toHaveBeenCalledWith(3);
  });

  it('is decoupled from the post-reveal warmups so main.ts can run it at first paint', () => {
    // The wiring contract behind the reviewer's iOS pop-in finding: the mob-body
    // stream must be startable WITHOUT the far-vista settle or the background
    // preload lane, because those wait for the reveal while the creature fetches
    // begin on the first painted frame.
    const deps = kickDependencies({ startCharacterPreloads: vi.fn().mockReturnValue(0) });

    kickCharacterPreloadStream(deps);

    expect(deps.onCharacterPreloadsStarted).toHaveBeenCalledWith(0);
  });
});

describe('runPostEntryWarmups', () => {
  it('settles only the far vista without automatic secondary-context work', async () => {
    const deps = dependencies();

    await runPostEntryWarmups(deps);
    await Promise.resolve();

    expect(deps.settleFarVista).toHaveBeenCalledOnce();
    expect(deps.onFarVistaSettled).toHaveBeenCalledWith(true);
    expect(deps.onWarmupError).not.toHaveBeenCalled();
  });

  it('reports a far-vista rejection without blocking the other warmups', async () => {
    const failure = new Error('far vista failed');
    const deps = dependencies({ settleFarVista: vi.fn().mockRejectedValue(failure) });

    await runPostEntryWarmups(deps);
    await Promise.resolve();

    expect(deps.onWarmupError).toHaveBeenCalledWith('far-vista', failure);
  });

  it('reports a synchronous far-vista failure without blocking the other warmups', async () => {
    const failure = new Error('far vista threw');
    const deps = dependencies({
      settleFarVista: vi.fn(() => {
        throw failure;
      }),
    });

    await runPostEntryWarmups(deps);

    expect(deps.onWarmupError).toHaveBeenCalledWith('far-vista', failure);
  });
});
