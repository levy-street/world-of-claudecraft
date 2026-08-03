import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProfileMode } from '../scripts/lib/profile_mode.mjs';
import {
  scenarioCombat,
  scenarioFps,
  scenarioFreeze,
  scenarioPlay,
  scenarioTiers,
  scenarioTour,
  scenarioWalk,
} from '../scripts/profile.mjs';
import {
  enterOnlineProfilerCharacter,
  Profiler,
  requireOnlineProfilerCapability,
} from '../scripts/profiler/harness.mjs';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete globalThis.window;
  delete globalThis.document;
});

function fakeOnlineEntryPage({ surface = 'charcreate-panel', rowMode = null } = {}) {
  const state = {
    actions: [],
    classSelected: false,
    name: '',
    rowMode,
    surface,
    worldReady: false,
  };
  const entryButton = {
    classList: { contains: (name) => name === 'take-over-btn' && state.rowMode === 'takeover' },
    click: () => {
      state.actions.push(state.rowMode);
      state.worldReady = true;
    },
  };
  const row = {
    querySelector: (selector) => {
      if (selector === '.char-name') return { textContent: state.name };
      if (selector === '.enter-world-btn, .take-over-btn') return entryButton;
      return null;
    },
  };
  globalThis.window = {};
  Object.defineProperty(globalThis.window, '__game', {
    configurable: true,
    get: () => (state.worldReady ? { world: { player: {} } } : undefined),
  });
  globalThis.document = {
    body: {
      dataset: {
        get startPanel() {
          return state.surface;
        },
      },
    },
    querySelector: (selector) => {
      if (selector === '#btn-new-character') {
        return {
          click: () => {
            state.actions.push('new-character');
            state.surface = 'charcreate-panel';
          },
        };
      }
      if (selector === '#new-char-name') {
        return {
          dispatchEvent: () => {},
          set value(value) {
            state.name = value;
          },
        };
      }
      if (selector.startsWith('#charcreate-panel .mini-class')) {
        return { click: () => (state.classSelected = true) };
      }
      if (selector === '#btn-create-char') {
        return {
          click: () => {
            state.actions.push('create');
            state.rowMode = 'enter';
            state.surface = 'charselect-panel';
          },
        };
      }
      return null;
    },
    querySelectorAll: (selector) =>
      selector === '.char-row' && state.rowMode !== null ? [row] : [],
  };
  return {
    state,
    page: {
      evaluate: vi.fn(async (callback, ...args) => callback(...args)),
      waitForFunction: vi.fn(async (callback, _options, ...args) => {
        if (!callback(...args)) throw new Error('fake entry condition was not met');
      }),
    },
  };
}

describe('resolveProfileMode', () => {
  it('accepts only an enabled profiler-invulnerability capability', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ profiler_invulnerability: true }), { status: 200 }),
    );

    await expect(
      requireOnlineProfilerCapability('https://realm.example', fetchImpl),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://realm.example/api/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects an old server whose status lacks the capability', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ dev_commands: true }), { status: 200 }),
    );

    await expect(
      requireOnlineProfilerCapability('https://realm.example', fetchImpl),
    ).rejects.toThrow('does not support profiler invulnerability');
  });

  it('rejects a supporting server with dev commands off', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ profiler_invulnerability: false }), { status: 200 }),
    );

    await expect(
      requireOnlineProfilerCapability('https://realm.example', fetchImpl),
    ).rejects.toThrow('start it with ALLOW_DEV_COMMANDS=1');
  });

  it('rejects an unavailable status endpoint before online entry', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 404 }));

    await expect(
      requireOnlineProfilerCapability('https://realm.example', fetchImpl),
    ).rejects.toThrow('/api/status returned HTTP 404');
  });

  it('checks the capability before registration or browser entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ profiler_invulnerability: false }), { status: 200 }),
      ),
    );
    const profiler = new Profiler({
      browserPath: '/unused',
      server: 'https://realm.example',
    });
    profiler.page = { goto: vi.fn() };

    await expect(profiler.enter({ mode: 'online' })).rejects.toThrow(
      'start it with ALLOW_DEV_COMMANDS=1',
    );
    expect(profiler.page.goto).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://realm.example/api/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('honors online mode without requiring a graphics tier', () => {
    expect(resolveProfileMode('online')).toBe('online');
  });

  it('defaults invalid or absent values to offline', () => {
    expect(resolveProfileMode(undefined)).toBe('offline');
    expect(resolveProfileMode('bogus')).toBe('offline');
  });

  it('lets an online-only scenario override the requested mode', () => {
    expect(resolveProfileMode('offline', true)).toBe('online');
  });

  it('drives every tier through the requested online mode', async () => {
    const entries = [];
    const profiler = {
      enter: async (options) => entries.push(options),
      teleport: async () => {},
      setMove: async () => {},
      sample: async ({ label }) => ({ label }),
      stopMove: async () => {},
    };

    const results = await scenarioTiers(profiler, 'online');
    expect(entries).toEqual(
      ['low', 'medium', 'high', 'ultra', 'insane'].map((tier) => ({ mode: 'online', tier })),
    );
    expect(results.map((result) => result.label)).toEqual([
      'tier-low',
      'tier-medium',
      'tier-high',
      'tier-ultra',
      'tier-insane',
    ]);
  });

  it.each([
    ['fps', scenarioFps],
    ['tour', scenarioTour],
    ['combat', scenarioCombat],
    ['freeze', scenarioFreeze],
    ['walk', scenarioWalk],
    ['play', scenarioPlay],
  ])('drives the %s scenario through the requested online mode', async (_name, run) => {
    const entries = [];
    const profiler = {
      combat: async () => {},
      enter: async (options) => entries.push(options),
      play: async () => ({ label: 'play' }),
      sample: async ({ label }) => ({ label }),
      setMove: async () => {},
      stopMove: async () => {},
      teleport: async () => {},
      walk: async () => ({ label: 'walk' }),
    };

    await run(profiler, 'online');
    expect(entries).toEqual([{ mode: 'online', tier: undefined }]);
  });

  it('creates once, then advances through a repeated online takeover', async () => {
    const { page, state } = fakeOnlineEntryPage();
    const first = await enterOnlineProfilerCharacter(page, { name: 'Pcamprobe', cls: 'warrior' });
    expect(first).toBe('created');
    expect(state.classSelected).toBe(true);
    expect(state.actions).toEqual(['create', 'enter']);

    state.worldReady = false;
    state.surface = 'charselect-panel';
    state.rowMode = 'takeover';
    const repeated = await enterOnlineProfilerCharacter(page, {
      name: 'Pcamprobe',
      cls: 'warrior',
    });
    expect(repeated).toBe('takeover');
    expect(state.actions).toEqual(['create', 'enter', 'takeover']);
  });

  it('accepts an already resumed online world without touching character creation', async () => {
    const { page, state } = fakeOnlineEntryPage({ surface: '', rowMode: null });
    state.worldReady = true;
    const action = await enterOnlineProfilerCharacter(page, {
      name: 'Pcamprobe',
      cls: 'warrior',
    });
    expect(action).toBe('resumed');
    expect(state.actions).toEqual([]);
  });

  it('uses the authoritative dev command and waits for its echo online', async () => {
    vi.useFakeTimers();
    const devCmd = vi.fn();
    globalThis.window = {
      __game: {
        online: { devCmd },
        input: { camYaw: 0 },
      },
    };
    const page = {
      evaluate: vi.fn(async (callback, ...args) => callback(...args)),
      waitForFunction: vi.fn(async () => {}),
    };
    const profiler = new Profiler({ browserPath: '/unused' });
    profiler.mode = 'online';
    profiler.page = page;

    const pending = profiler.teleport(12, 34, 1.5);
    await vi.runAllTimersAsync();
    await pending;

    expect(devCmd).toHaveBeenCalledWith({ cmd: 'dev_teleport', x: 12, z: 34 });
    expect(globalThis.window.__game.input.camYaw).toBe(1.5);
    expect(page.waitForFunction).toHaveBeenCalledTimes(1);
  });

  it('keeps the direct offline teleport arm local to the offline world', async () => {
    vi.useFakeTimers();
    const devCmd = vi.fn();
    globalThis.window = {
      __game: {
        input: { camYaw: 0 },
        online: { devCmd },
        world: { player: { facing: 0, pos: { x: 0, z: 0 } } },
      },
    };
    const profiler = new Profiler({ browserPath: '/unused' });
    profiler.mode = 'offline';
    profiler.page = { evaluate: vi.fn(async (callback, ...args) => callback(...args)) };

    const pending = profiler.teleport(12, 34, 1.5);
    await vi.runAllTimersAsync();
    await pending;

    expect(globalThis.window.__game.world.player).toMatchObject({
      facing: 1.5,
      pos: { x: 12, z: 34 },
    });
    expect(globalThis.window.__game.input.camYaw).toBe(1.5);
    expect(devCmd).not.toHaveBeenCalled();
  });

  it('arms authoritative online profiler invulnerability once per entity', async () => {
    const devCmd = vi.fn();
    globalThis.window = { __game: { online: { devCmd } } };
    const profiler = new Profiler({ browserPath: '/unused' });
    profiler.mode = 'online';
    profiler.page = { evaluate: vi.fn(async (callback) => callback()) };

    await profiler._startProfilerInvulnerability();
    await profiler._startProfilerInvulnerability();

    expect(devCmd).toHaveBeenCalledTimes(1);
    expect(devCmd).toHaveBeenCalledWith({ cmd: 'dev_profiler_invulnerable' });

    profiler.onlineInvulnerabilityArmed = false;
    await profiler._startProfilerInvulnerability();
    expect(devCmd).toHaveBeenCalledTimes(2);
    expect(devCmd).toHaveBeenLastCalledWith({ cmd: 'dev_profiler_invulnerable' });
  });
});
