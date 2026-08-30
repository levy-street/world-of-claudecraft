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
