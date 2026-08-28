import { describe, expect, it, vi } from 'vitest';
import {
  applyGpuBackendSwitches,
  decideGpuBackendLaunch,
  GPU_BACKEND_ENV,
  GPU_BACKEND_SETTINGS,
  hasGetGpuInfoEvidence,
  judgeVulkanLaunch,
  relaunchAfterFailedTrial,
  VULKAN_BACKEND_SWITCHES,
  VULKAN_PARALLEL_COMPILE_SWITCH,
  VULKAN_TRIAL_RELAUNCH_MARKER,
  VULKAN_TRIAL_RELAUNCH_PLAIN,
  VULKAN_VERDICTS,
  vulkanVerdictAfterGpuCrash,
} from '../electron/gpu_backend.cjs';
import { spawnDetachedSelf } from '../electron/gpu_preference.cjs';

// Real renderer strings as app.getGPUInfo('complete') reports them.
const VULKAN_OK =
  'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3090 (0x00002204)), NVIDIA)';
const VULKAN_SOFTWARE =
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const OPENGL = 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3090/PCIe/SSE2, OpenGL 4.5.0)';

const auto = (vulkanVerdict: string) => ({ gpuBackend: 'auto', vulkanVerdict });

describe('GPU backend constants (load-bearing literals)', () => {
  it('pins the setting and verdict lists', () => {
    expect(GPU_BACKEND_SETTINGS).toEqual(['auto', 'vulkan', 'opengl']);
    expect(VULKAN_VERDICTS).toEqual(['untested', 'ok', 'ok-plain', 'failed']);
    expect(GPU_BACKEND_ENV).toBe('WOC_GPU_BACKEND');
    expect(VULKAN_TRIAL_RELAUNCH_MARKER).toBe('WOC_VULKAN_TRIAL_RELAUNCHED');
    expect(VULKAN_TRIAL_RELAUNCH_PLAIN).toBe('plain');
  });

  it('pins the three Vulkan switches, the parallel-compile feature apart, and nothing wider', () => {
    // The verified minimal set. --ignore-gpu-blocklist and
    // --disable-gpu-driver-bug-workarounds widen the blast radius on drivers the
    // blocklist exists for, and --disable-vulkan-surface is headless-only. The
    // ANGLE feature is the one that exposes KHR_parallel_shader_compile on the
    // Vulkan backend (opt-in in ANGLE); without it every gate is inert there. It
    // is its own switch because the trial ladder drops it on the second rung.
    expect(VULKAN_BACKEND_SWITCHES).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'vulkan'],
      ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
    ]);
    expect(VULKAN_PARALLEL_COMPILE_SWITCH).toEqual([
      'enable-angle-features',
      'enableParallelCompileAndLink',
    ]);
    const names = VULKAN_BACKEND_SWITCHES.map(([name]) => name);
    expect(names).not.toContain('ignore-gpu-blocklist');
    expect(names).not.toContain('disable-gpu-driver-bug-workarounds');
    expect(names).not.toContain('disable-vulkan-surface');
  });
});

describe('decideGpuBackendLaunch', () => {
  it('leaves every non-Linux platform on its default, whatever the prefs say', () => {
    for (const platform of ['win32', 'darwin', 'freebsd']) {
      const launch = decideGpuBackendLaunch({
        platform,
        env: { [GPU_BACKEND_ENV]: 'vulkan' },
        prefs: { gpuBackend: 'vulkan', vulkanVerdict: 'ok' },
      });
      expect(launch).toEqual({
        backend: 'default',
        parallel: false,
        trial: false,
        reason: 'platform default',
      });
    }
  });

  it('honors the no-GPU-lever rescue env ahead of the stored setting and the trial', () => {
    const launch = decideGpuBackendLaunch({
      platform: 'linux',
      env: { WOC_DISABLE_GPU_FORCE: '1' },
      prefs: { gpuBackend: 'vulkan', vulkanVerdict: 'ok' },
    });
    expect(launch).toEqual({
      backend: 'default',
      parallel: false,
      trial: false,
      reason: 'WOC_DISABLE_GPU_FORCE=1',
    });
    // The explicit env override still wins over the rescue: that is how Vulkan
    // is tried with every other GPU lever (PRIME, the discrete force) off.
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { WOC_DISABLE_GPU_FORCE: '1', [GPU_BACKEND_ENV]: 'vulkan' },
        prefs: auto('failed'),
      }),
    ).toEqual({
      backend: 'vulkan',
      parallel: true,
      trial: false,
      reason: `${GPU_BACKEND_ENV}=vulkan`,
    });
    // Strict '1': a stray value cannot half-arm the rescue.
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { WOC_DISABLE_GPU_FORCE: 'true' },
        prefs: auto('ok'),
      }).backend,
    ).toBe('vulkan');
  });

  it('takes the env override as explicit: never a trial, ahead of the setting', () => {
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { [GPU_BACKEND_ENV]: 'opengl' },
        prefs: { gpuBackend: 'vulkan', vulkanVerdict: 'ok' },
      }),
    ).toEqual({
      backend: 'default',
      parallel: false,
      trial: false,
      reason: 'WOC_GPU_BACKEND=opengl',
    });
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { [GPU_BACKEND_ENV]: 'vulkan' },
        prefs: { gpuBackend: 'opengl', vulkanVerdict: 'failed' },
      }),
    ).toEqual({
      backend: 'vulkan',
      parallel: true,
      trial: false,
      reason: 'WOC_GPU_BACKEND=vulkan',
    });
  });

  it('ignores an unknown env override value and falls through to the setting', () => {
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { [GPU_BACKEND_ENV]: 'metal' },
        prefs: { gpuBackend: 'opengl', vulkanVerdict: 'untested' },
      }).backend,
    ).toBe('default');
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { [GPU_BACKEND_ENV]: '' },
        prefs: auto('untested'),
      }).trial,
    ).toBe(true);
  });

  it('takes an explicit setting as explicit: never a trial, whatever the verdict', () => {
    for (const vulkanVerdict of VULKAN_VERDICTS) {
      expect(
        decideGpuBackendLaunch({
          platform: 'linux',
          env: {},
          prefs: { gpuBackend: 'opengl', vulkanVerdict },
        }),
      ).toEqual({ backend: 'default', parallel: false, trial: false, reason: 'setting opengl' });
      expect(
        decideGpuBackendLaunch({
          platform: 'linux',
          env: {},
          prefs: { gpuBackend: 'vulkan', vulkanVerdict },
        }),
      ).toEqual({ backend: 'vulkan', parallel: true, trial: false, reason: 'setting vulkan' });
    }
  });

  it('auto: a failed trial stays on the default, a passed one forces Vulkan without a trial', () => {
    expect(decideGpuBackendLaunch({ platform: 'linux', env: {}, prefs: auto('failed') })).toEqual({
      backend: 'default',
      parallel: false,
      trial: false,
      reason: 'auto, last Vulkan trial failed',
    });
    expect(decideGpuBackendLaunch({ platform: 'linux', env: {}, prefs: auto('ok') })).toEqual({
      backend: 'vulkan',
      parallel: true,
      trial: false,
      reason: 'auto, Vulkan trial passed',
    });
  });

  it('auto + untested is the one and only trial launch', () => {
    expect(decideGpuBackendLaunch({ platform: 'linux', env: {}, prefs: auto('untested') })).toEqual(
      { backend: 'vulkan', parallel: true, trial: true, reason: 'auto, Vulkan trial' },
    );
    // Missing env or prefs reads as the fresh-install state, not as a crash.
    expect(decideGpuBackendLaunch({ platform: 'linux' }).trial).toBe(true);
  });

  it('auto + ok-plain forces plain Vulkan, without the feature and without a trial', () => {
    expect(decideGpuBackendLaunch({ platform: 'linux', env: {}, prefs: auto('ok-plain') })).toEqual(
      {
        backend: 'vulkan',
        parallel: false,
        trial: false,
        reason: 'auto, Vulkan trial passed without parallel compile',
      },
    );
  });

  it('auto + untested in the child of a failed parallel rung trials plain Vulkan once', () => {
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: VULKAN_TRIAL_RELAUNCH_PLAIN },
        prefs: auto('untested'),
      }),
    ).toEqual({
      backend: 'vulkan',
      parallel: false,
      trial: true,
      reason: 'auto, plain Vulkan trial after a failed parallel one',
    });
  });

  it('auto + untested in a relaunched child never trials (the loop lock)', () => {
    // The stored 'failed' verdict is the first lock; this is the second, for the
    // case where the verdict could not be written: the child spawned after the
    // failed trial must not trial again, else it would relaunch again.
    const launch = decideGpuBackendLaunch({
      platform: 'linux',
      env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: '1' },
      prefs: auto('untested'),
    });
    expect(launch).toEqual({
      backend: 'default',
      parallel: false,
      trial: false,
      reason: 'auto, relaunched after a failed Vulkan trial',
    });
    // The marker only closes the trial arm: a stored 'ok' and an explicit
    // setting still win (an updater restart inherits the env, marker included).
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: '1' },
        prefs: auto('ok'),
      }).backend,
    ).toBe('vulkan');
    expect(
      decideGpuBackendLaunch({
        platform: 'linux',
        env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: '1' },
        prefs: { gpuBackend: 'vulkan', vulkanVerdict: 'untested' },
      }).backend,
    ).toBe('vulkan');
  });
});

describe('applyGpuBackendSwitches', () => {
  function fakeApp() {
    const switches: Array<[string, string]> = [];
    return {
      switches,
      app: {
        commandLine: {
          appendSwitch: (name: string, value: string) => switches.push([name, value]),
        },
      },
    };
  }

  it('appends the three Vulkan switches plus the feature for a parallel launch, three alone for a plain one', () => {
    const { app, switches } = fakeApp();
    applyGpuBackendSwitches(app, {
      backend: 'vulkan',
      parallel: true,
      trial: true,
      reason: 'auto, Vulkan trial',
    });
    expect(switches).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'vulkan'],
      ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
      ['enable-angle-features', 'enableParallelCompileAndLink'],
    ]);
    const plain = fakeApp();
    applyGpuBackendSwitches(plain.app, {
      backend: 'vulkan',
      parallel: false,
      trial: false,
      reason: 'auto, Vulkan trial passed without parallel compile',
    });
    expect(plain.switches).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'vulkan'],
      ['enable-features', 'Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'],
    ]);
  });

  it('appends nothing for a default launch, or for no launch at all', () => {
    const { app, switches } = fakeApp();
    applyGpuBackendSwitches(app, {
      backend: 'default',
      parallel: false,
      trial: false,
      reason: 'platform default',
    });
    applyGpuBackendSwitches(app, null);
    applyGpuBackendSwitches(app, undefined);
    expect(switches).toEqual([]);
  });
});

describe('judgeVulkanLaunch', () => {
  it('reads the rung and the reported extension: ok, ok-plain, or the rung kept when unknown', () => {
    const base = { glRenderer: VULKAN_OK, softwareRendering: false };
    expect(judgeVulkanLaunch({ ...base, parallel: true, parallelCompile: true })).toBe('ok');
    // The switch did not take: plain Vulkan from now on.
    expect(judgeVulkanLaunch({ ...base, parallel: true, parallelCompile: false })).toBe('ok-plain');
    // An older game build reports the string alone: the rung is kept.
    expect(judgeVulkanLaunch({ ...base, parallel: true })).toBe('ok');
    expect(judgeVulkanLaunch({ ...base, parallel: false, parallelCompile: true })).toBe('ok-plain');
    expect(judgeVulkanLaunch({ ...base, parallel: false })).toBe('ok-plain');
    // Failure ignores the rung entirely.
    expect(
      judgeVulkanLaunch({ glRenderer: OPENGL, softwareRendering: false, parallel: true }),
    ).toBe('failed');
  });

  it('passes a hardware Vulkan renderer', () => {
    expect(
      judgeVulkanLaunch({ glRenderer: VULKAN_OK, softwareRendering: false, parallel: true }),
    ).toBe('ok');
    // softwareRendering absent (an older reading shape) is not a failure by itself.
    expect(judgeVulkanLaunch({ glRenderer: VULKAN_OK, parallel: true })).toBe('ok');
  });

  it('fails the SwiftShader device even though its renderer string says Vulkan', () => {
    expect(judgeVulkanLaunch({ glRenderer: VULKAN_SOFTWARE, softwareRendering: true })).toBe(
      'failed',
    );
    // The string alone is decisive: Chromium's own flag is not needed to catch it.
    expect(judgeVulkanLaunch({ glRenderer: VULKAN_SOFTWARE, softwareRendering: false })).toBe(
      'failed',
    );
  });

  it('fails when Chromium reports software rendering, whatever the string says', () => {
    expect(judgeVulkanLaunch({ glRenderer: VULKAN_OK, softwareRendering: true })).toBe('failed');
  });

  it('fails a renderer that is not Vulkan (the switches did not take)', () => {
    expect(judgeVulkanLaunch({ glRenderer: OPENGL, softwareRendering: false })).toBe('failed');
  });

  it('fails a missing or empty renderer string', () => {
    expect(judgeVulkanLaunch({ glRenderer: '', softwareRendering: false })).toBe('failed');
    expect(judgeVulkanLaunch({ glRenderer: undefined, softwareRendering: false })).toBe('failed');
    expect(judgeVulkanLaunch({ glRenderer: 42, softwareRendering: false })).toBe('failed');
    expect(judgeVulkanLaunch({})).toBe('failed');
  });

  it('matches the Vulkan and SwiftShader tokens case-insensitively', () => {
    expect(
      judgeVulkanLaunch({
        glRenderer: 'ANGLE (AMD, VULKAN 1.3 (RADV NAVI31), AMD)',
        parallel: true,
      }),
    ).toBe('ok');
    expect(judgeVulkanLaunch({ glRenderer: 'ANGLE (Google, vulkan (swiftshader device))' })).toBe(
      'failed',
    );
  });
});

describe('vulkanVerdictAfterGpuCrash', () => {
  it('steps one rung down, never up, and leaves the rest alone', () => {
    expect(vulkanVerdictAfterGpuCrash('ok')).toBe('ok-plain');
    expect(vulkanVerdictAfterGpuCrash('ok-plain')).toBe('failed');
    expect(vulkanVerdictAfterGpuCrash('failed')).toBe('failed');
    expect(vulkanVerdictAfterGpuCrash('untested')).toBe('untested');
    expect(vulkanVerdictAfterGpuCrash(undefined)).toBe(undefined);
  });
});

describe('hasGetGpuInfoEvidence', () => {
  it('counts a non-empty renderer string as evidence, whatever it says', () => {
    expect(hasGetGpuInfoEvidence({ glRenderer: VULKAN_OK, softwareRendering: false })).toBe(true);
    expect(hasGetGpuInfoEvidence({ glRenderer: OPENGL })).toBe(true);
    expect(hasGetGpuInfoEvidence({ glRenderer: VULKAN_SOFTWARE, softwareRendering: false })).toBe(
      true,
    );
  });

  it("counts Chromium's software flag as evidence even without a renderer string", () => {
    expect(hasGetGpuInfoEvidence({ glRenderer: '', softwareRendering: true })).toBe(true);
    expect(hasGetGpuInfoEvidence({ softwareRendering: true })).toBe(true);
  });

  it('reads an empty or missing renderer string with no software flag as NO evidence', () => {
    // The live Linux reading: a healthy ANGLE Vulkan session whose getGPUInfo
    // glRenderer is empty. Judging it would write 'failed' for a working GPU.
    expect(hasGetGpuInfoEvidence({ glRenderer: '', softwareRendering: false })).toBe(false);
    expect(hasGetGpuInfoEvidence({ glRenderer: undefined })).toBe(false);
    expect(hasGetGpuInfoEvidence({ glRenderer: 42, softwareRendering: 'yes' })).toBe(false);
    expect(hasGetGpuInfoEvidence({})).toBe(false);
    expect(hasGetGpuInfoEvidence(null)).toBe(false);
    expect(hasGetGpuInfoEvidence(undefined)).toBe(false);
  });
});

describe('relaunchAfterFailedTrial', () => {
  function fakeSpawn() {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const unref = vi.fn();
    const spawn = vi.fn((command: string, args: string[], options?: unknown) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      return { unref };
    });
    return { spawn, calls, unref };
  }

  it('re-execs the same binary and argv, detached, with the marker on the child', () => {
    const { spawn, calls, unref } = fakeSpawn();
    const info = vi.fn();
    const result = relaunchAfterFailedTrial({
      spawn,
      env: { UNRELATED: 'x', WOC_PRIME_RELAUNCHED: '1' },
      execPath: '/usr/bin/world-of-claudecraft',
      argv: ['--some-flag', '--ozone-platform=x11'],
      log: { info },
    });
    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('/usr/bin/world-of-claudecraft');
    // Argv passes through untouched: the PRIME-relaunched child's explicit
    // ozone flag survives, so the child does not re-exec for PRIME either.
    expect(calls[0].args).toEqual(['--some-flag', '--ozone-platform=x11']);
    // Full options pin: the env is the parent's (PRIME marker included) plus
    // our own marker, nothing else changes spawn semantics.
    expect(calls[0].options).toEqual({
      env: { UNRELATED: 'x', WOC_PRIME_RELAUNCHED: '1', WOC_VULKAN_TRIAL_RELAUNCHED: '1' },
      stdio: 'inherit',
      detached: true,
    });
    expect(unref).toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('failed Vulkan trial'), {
      spawnTarget: '/usr/bin/world-of-claudecraft',
    });
  });

  it('spawns the outer AppImage (env.APPIMAGE), never execPath, inside an AppImage', () => {
    const { spawn, calls } = fakeSpawn();
    relaunchAfterFailedTrial({
      spawn,
      env: { APPIMAGE: '/home/p/Applications/world-of-claudecraft.AppImage' },
      execPath: '/tmp/.mount_worldXYZ/binary',
      argv: [],
    });
    expect(calls[0].command).toBe('/home/p/Applications/world-of-claudecraft.AppImage');
  });

  it('ignores a non-absolute APPIMAGE value and falls back to execPath', () => {
    const { spawn, calls } = fakeSpawn();
    relaunchAfterFailedTrial({
      spawn,
      env: { APPIMAGE: 'relative/evil.AppImage' },
      execPath: '/usr/bin/woc',
      argv: [],
    });
    expect(calls[0].command).toBe('/usr/bin/woc');
  });

  it('marks the child with the rung it relaunches to, and never repeats a rung', () => {
    const { spawn, calls } = fakeSpawn();
    const base = { env: { HOME: '/h' }, argv: ['--x'], execPath: '/bin/app', spawn };
    expect(relaunchAfterFailedTrial(base, VULKAN_TRIAL_RELAUNCH_PLAIN)).toBe(true);
    expect((calls[0].options.env as Record<string, string>)[VULKAN_TRIAL_RELAUNCH_MARKER]).toBe(
      'plain',
    );
    // The plain child may relaunch once more, to the default (marker '1')...
    const plainChild = { ...base, env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: 'plain' } };
    expect(relaunchAfterFailedTrial(plainChild, '1')).toBe(true);
    expect((calls[1].options.env as Record<string, string>)[VULKAN_TRIAL_RELAUNCH_MARKER]).toBe(
      '1',
    );
    // ... but never to plain again, and a '1' child never relaunches at all.
    expect(relaunchAfterFailedTrial(plainChild, VULKAN_TRIAL_RELAUNCH_PLAIN)).toBe(false);
    const lastChild = { ...base, env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: '1' } };
    expect(relaunchAfterFailedTrial(lastChild, VULKAN_TRIAL_RELAUNCH_PLAIN)).toBe(false);
    expect(relaunchAfterFailedTrial(lastChild, '1')).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('never relaunches a process that already carries the marker', () => {
    const { spawn } = fakeSpawn();
    const result = relaunchAfterFailedTrial({
      spawn,
      env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: '1' },
      execPath: '/usr/bin/woc',
      argv: [],
    });
    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    // Strict '1', like every other marker in the shell.
    expect(
      relaunchAfterFailedTrial({
        spawn,
        env: { [VULKAN_TRIAL_RELAUNCH_MARKER]: 'yes' },
        execPath: '/usr/bin/woc',
        argv: [],
      }),
    ).toBe(true);
  });

  it('does not mutate the environment object passed in', () => {
    const { spawn } = fakeSpawn();
    const env = { UNRELATED: 'x' };
    relaunchAfterFailedTrial({ spawn, env, execPath: '/usr/bin/woc', argv: [] });
    expect(env).toEqual({ UNRELATED: 'x' });
  });

  it('returns false and logs a warning when spawn itself throws', () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn EACCES');
    });
    const warn = vi.fn();
    const result = relaunchAfterFailedTrial({
      spawn,
      env: {},
      execPath: '/usr/bin/woc',
      argv: [],
      log: { warn },
    });
    expect(result).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('spawnDetachedSelf (the shared self-relaunch spawn)', () => {
  it('spawns detached with inherited stdio, unrefs, and answers the target it chose', () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));
    const target = spawnDetachedSelf({
      env: { APPIMAGE: '/apps/woc.AppImage', A: '1' },
      argv: ['--x'],
      execPath: '/mount/binary',
      spawn,
    });
    expect(target).toBe('/apps/woc.AppImage');
    expect(spawn).toHaveBeenCalledWith('/apps/woc.AppImage', ['--x'], {
      env: { APPIMAGE: '/apps/woc.AppImage', A: '1' },
      stdio: 'inherit',
      detached: true,
    });
    expect(unref).toHaveBeenCalled();
  });

  it('tolerates a child handle without unref and propagates a spawn failure', () => {
    expect(spawnDetachedSelf({ env: {}, argv: [], execPath: '/bin/woc', spawn: () => ({}) })).toBe(
      '/bin/woc',
    );
    expect(() =>
      spawnDetachedSelf({
        env: {},
        argv: [],
        execPath: '/bin/woc',
        spawn: () => {
          throw new Error('spawn ENOENT');
        },
      }),
    ).toThrow('spawn ENOENT');
  });
});
