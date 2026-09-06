// Settings that take effect at the next launch (electron/launch_settings.cjs):
// the frozen snapshot of what this process started with, and the restart that
// applies a changed one from an environment the shell's own relaunch levers
// have not planted anything in.

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { GPU_BACKEND_RESCUE_ENV } from '../electron/gpu_backend.cjs';
import {
  LINUX_OZONE_X11_ARG,
  LINUX_PRIME_ENV,
  PRIME_RELAUNCH_ADDED_ENV,
  PRIME_RELAUNCH_MARKER,
  relaunchForLinuxPrime,
} from '../electron/gpu_preference.cjs';
import {
  launchSettingsSnapshot,
  restartApp,
  restartArgv,
  restartEnv,
} from '../electron/launch_settings.cjs';

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { unref(): void };
  child.unref = vi.fn();
  return child;
}

describe('launchSettingsSnapshot', () => {
  it('carries the two next-launch settings, normalized to what the launch read', () => {
    expect(launchSettingsSnapshot({ gpuForceOptOut: true, gpuBackend: 'opengl' })).toEqual({
      gpuForceOptOut: true,
      gpuBackend: 'opengl',
    });
    // An unknown backend launches as auto, so it compares as auto; a missing
    // opt-out is no opt-out.
    expect(launchSettingsSnapshot({ gpuBackend: 'metal' })).toEqual({
      gpuForceOptOut: false,
      gpuBackend: 'auto',
    });
    expect(launchSettingsSnapshot(undefined)).toEqual({
      gpuForceOptOut: false,
      gpuBackend: 'auto',
    });
  });

  it('is frozen: a setter that moves the prefs later cannot move it', () => {
    const prefs = { gpuForceOptOut: false, gpuBackend: 'auto' };
    const snapshot = launchSettingsSnapshot(prefs);
    prefs.gpuBackend = 'opengl';
    expect(snapshot.gpuBackend).toBe('auto');
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});

describe('restartEnv', () => {
  it('always drops the rescue marker: a restart is a fresh decision, not a chain', () => {
    const env = restartEnv({ HOME: '/home/p', [GPU_BACKEND_RESCUE_ENV]: 'opengl' });
    expect(env).toEqual({ HOME: '/home/p' });
  });

  it('drops exactly the PRIME offload variables the relaunch recorded planting', () => {
    // The player exported DRI_PRIME themselves; the relaunch added the NVIDIA set
    // around it and said so. The restart takes back what the shell added and
    // leaves the player's variable, plus both markers.
    const planted = {
      HOME: '/home/p',
      DRI_PRIME: '1',
      __NV_PRIME_RENDER_OFFLOAD: '1',
      __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
      [PRIME_RELAUNCH_MARKER]: '1',
      [PRIME_RELAUNCH_ADDED_ENV]: '__NV_PRIME_RENDER_OFFLOAD,__GLX_VENDOR_LIBRARY_NAME',
    };
    expect(restartEnv(planted)).toEqual({ HOME: '/home/p', DRI_PRIME: '1' });
    // A player's own DRI_PRIME, no marker: theirs to keep.
    const own = { HOME: '/home/p', DRI_PRIME: '1' };
    expect(restartEnv(own)).toEqual(own);
  });

  it('with the marker but no record, takes back everything the lever can plant', () => {
    const planted = { HOME: '/home/p', [PRIME_RELAUNCH_MARKER]: '1', ...LINUX_PRIME_ENV };
    expect(restartEnv(planted)).toEqual({ HOME: '/home/p' });
  });

  it("leaves the caller's object alone", () => {
    const env = { [GPU_BACKEND_RESCUE_ENV]: 'opengl' };
    restartEnv(env);
    expect(env[GPU_BACKEND_RESCUE_ENV]).toBe('opengl');
  });
});

describe('restartArgv', () => {
  it('drops the X11 ozone argument only when the PRIME relaunch recorded appending it', () => {
    const argv = ['.', '--foo', LINUX_OZONE_X11_ARG];
    const appended = {
      [PRIME_RELAUNCH_MARKER]: '1',
      [PRIME_RELAUNCH_ADDED_ENV]: `DRI_PRIME,${LINUX_OZONE_X11_ARG}`,
    };
    expect(restartArgv(argv, appended)).toEqual(['.', '--foo']);
    // The player's own --ozone-platform, which the relaunch saw and left alone.
    const playerOwn = { [PRIME_RELAUNCH_MARKER]: '1', [PRIME_RELAUNCH_ADDED_ENV]: 'DRI_PRIME' };
    expect(restartArgv(argv, playerOwn)).toEqual(argv);
    // No marker: the argument is the player's own choice.
    expect(restartArgv(argv, {})).toEqual(argv);
    expect(restartArgv(argv, {})).not.toBe(argv);
    // The marker alone (no record): the lever's addition is assumed.
    expect(restartArgv(argv, { [PRIME_RELAUNCH_MARKER]: '1' })).toEqual(['.', '--foo']);
  });
});

describe('a two-hop PRIME relaunch chain', () => {
  // The chain the header names: the first relaunch plants the offload variables and the
  // ozone argument, then electron-updater's restart-to-update respawns with that
  // environment and an EMPTY argv, and THAT process relaunches once more purely to
  // restore the argument. The second hop plants no variable (every name is already
  // present), so a record it replaced rather than accumulated would tell the restart that
  // only the argument was the shell's, and hand the child the offload env of a player who
  // just turned the discrete-GPU force off.
  it('records every hop, so the restart takes back the whole chain', () => {
    const spawned: Array<{ argv: string[]; env: Record<string, string | undefined> }> = [];
    const spawn = vi.fn((_file: string, argv: string[], options?: unknown) => {
      spawned.push({ argv, env: (options as { env: Record<string, string> }).env });
      return { unref: vi.fn() };
    });
    // No NVIDIA EGL json on this machine, so the lever plants the four offload variables.
    const hop = (env: Record<string, string | undefined>, argv: string[]) =>
      relaunchForLinuxPrime({
        platform: 'linux',
        isHybridGpu: () => true,
        fileExists: () => false,
        execPath: '/opt/woc/woc',
        spawn,
        env,
        argv,
      });

    expect(hop({ HOME: '/home/p' }, [])).toBe(true);
    const child = spawned[0];
    expect(hop(child.env, [])).toBe(true);
    const grandchild = spawned[1];

    expect(grandchild.argv).toEqual([LINUX_OZONE_X11_ARG]);
    const record = String(grandchild.env[PRIME_RELAUNCH_ADDED_ENV]).split(',');
    expect(record).toContain(LINUX_OZONE_X11_ARG);
    for (const name of [
      'DRI_PRIME',
      '__NV_PRIME_RENDER_OFFLOAD',
      '__GLX_VENDOR_LIBRARY_NAME',
      '__VK_LAYER_NV_optimus',
    ]) {
      expect(grandchild.env[name], `the grandchild still carries ${name}`).toBeDefined();
      expect(record, `the record still names ${name}`).toContain(name);
    }

    // What the restart strip hands the next launch: nothing of the chain's own.
    expect(restartEnv(grandchild.env)).toEqual({ HOME: '/home/p' });
    expect(restartArgv(grandchild.argv, grandchild.env)).toEqual([]);
  });
});

describe('restartApp', () => {
  const deps = (child: EventEmitter) => {
    const spawn = vi.fn(() => child);
    const log = { info: vi.fn(), warn: vi.fn() };
    const onSpawned = vi.fn();
    return { spawn, log, onSpawned };
  };

  it('spawns this program detached from the cleaned env and argv, and resolves true on spawn', async () => {
    const child = fakeChild();
    const { spawn, log, onSpawned } = deps(child);
    const env = {
      HOME: '/home/p',
      [GPU_BACKEND_RESCUE_ENV]: 'opengl',
      [PRIME_RELAUNCH_MARKER]: '1',
      [PRIME_RELAUNCH_ADDED_ENV]: [...Object.keys(LINUX_PRIME_ENV), LINUX_OZONE_X11_ARG].join(','),
      ...LINUX_PRIME_ENV,
    };
    const settled = restartApp({
      env,
      argv: ['.', LINUX_OZONE_X11_ARG],
      execPath: '/opt/woc/woc',
      spawn,
      log,
      onSpawned,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, argv, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string>; detached: boolean },
    ];
    expect(file).toBe('/opt/woc/woc');
    expect(argv).toEqual(['.']);
    expect(options.detached).toBe(true);
    expect(options.env).toEqual({ HOME: '/home/p' });
    // Not settled on spawn() returning: the child's existence is the 'spawn' event.
    expect(onSpawned).not.toHaveBeenCalled();
    child.emit('spawn');
    expect(onSpawned).toHaveBeenCalledTimes(1);
    await expect(settled).resolves.toBe(true);
    expect(log.info).toHaveBeenCalledWith(
      "[shell] restarting at the player's request",
      expect.objectContaining({ spawnTarget: '/opt/woc/woc' }),
    );
  });

  it('resolves false when the child never starts, this process still running', async () => {
    const child = fakeChild();
    const { spawn, log, onSpawned } = deps(child);
    const settled = restartApp({ env: {}, argv: [], execPath: '/x', spawn, log, onSpawned });
    child.emit('error', new Error('ENOENT'));
    await expect(settled).resolves.toBe(false);
    expect(onSpawned).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('resolves false when the spawn handle has no event surface', async () => {
    // Defence in depth: nothing can be learned from a handle that emits nothing, and a
    // promise left unsettled would keep the strip on "Restarting" for the whole session.
    const { spawn, log, onSpawned } = deps({ unref: vi.fn() } as never);
    await expect(
      restartApp({ env: {}, argv: [], execPath: '/x', spawn, log, onSpawned }),
    ).resolves.toBe(false);
    expect(onSpawned).not.toHaveBeenCalled();
  });

  it('refuses to restart under the dev server, where quitting takes Vite down with it', async () => {
    // npm run electron:dev: this process is one child of an orchestrator that owns Vite
    // (scripts/electron-dev.mjs), which tears it down when this child exits, so the
    // detached child would load a dead origin. False is what the strip already renders as
    // "the restart did not happen".
    const child = fakeChild();
    const { spawn, log, onSpawned } = deps(child);
    await expect(
      restartApp({
        env: {},
        devServerUrl: 'http://127.0.0.1:5173',
        argv: [],
        execPath: '/x',
        spawn,
        log,
        onSpawned,
      }),
    ).resolves.toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(onSpawned).not.toHaveBeenCalled();
  });

  it('reads an empty dev-server URL as no dev server, and restarts', async () => {
    // The refusal is the ORCHESTRATOR's presence, which the caller's URL carries; the
    // raw variable is never read here, so a packaged launch whose environment names it
    // (main.cjs hands undefined when packaged) is not refused a restart that the strip
    // would otherwise keep offering.
    const child = fakeChild();
    const { spawn, log, onSpawned } = deps(child);
    const settled = restartApp({
      env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
      devServerUrl: '',
      argv: [],
      execPath: '/x',
      spawn,
      log,
      onSpawned,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    child.emit('spawn');
    await expect(settled).resolves.toBe(true);
    expect(onSpawned).toHaveBeenCalledTimes(1);
  });

  it('resolves false when spawn itself throws', async () => {
    const spawn = vi.fn(() => {
      throw new Error('EACCES');
    });
    const log = { info: vi.fn(), warn: vi.fn() };
    await expect(restartApp({ env: {}, argv: [], execPath: '/x', spawn, log })).resolves.toBe(
      false,
    );
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
