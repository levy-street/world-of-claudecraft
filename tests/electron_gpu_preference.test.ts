import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  alreadyHighPerformance,
  buildLinuxPrimeEnv,
  buildRegQueryArgs,
  buildRegWriteArgs,
  forceHighPerformanceGpu,
  HIGH_PERF_GPU_SWITCHES,
  HIGH_PERFORMANCE_PREFERENCE,
  hasExplicitOzonePlatformArg,
  hasUnparseableValueType,
  isLinuxHybridGpu,
  LINUX_OZONE_X11_ARG,
  LINUX_PRIME_ENV,
  mergeHighPerformancePreference,
  PRIME_RELAUNCH_MARKER,
  parseRegQueryData,
  relaunchForLinuxPrime,
  shouldRelaunchForLinuxPrime,
  summarizeGpuDevices,
  USER_GPU_PREFERENCES_KEY,
} from '../electron/gpu_preference.cjs';

const EXE =
  'C:\\Users\\p\\AppData\\Local\\Programs\\world-of-claudecraft\\World of ClaudeCraft.exe';

/** The error execFileSync surfaces when reg.exe exits 1 (value or key not found). */
function missingValueError(): Error {
  return Object.assign(new Error('ERROR: unable to find the specified registry key or value'), {
    status: 1,
  });
}

function fakeApp({ isPackaged = true }: { isPackaged?: boolean } = {}) {
  const switches: string[] = [];
  return {
    switches,
    app: {
      isPackaged,
      commandLine: { appendSwitch: (name: string) => switches.push(name) },
      getPath: (name: string) => (name === 'exe' ? EXE : ''),
    },
  };
}

/** A realistic `reg query /v <exe>` stdout for the given stored data. */
function regQueryOutput(data: string): string {
  return `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\DirectX\\UserGpuPreferences\r\n    ${EXE}    REG_SZ    ${data}\r\n\r\n`;
}

describe('GPU preference constants (load-bearing literals)', () => {
  it('appends BOTH the hyphen and underscore switch spellings', () => {
    // The hyphen form is the real Chromium 150 switch name; the underscore form is what
    // Electron's docs list. Chromium matches switch names exactly, so both must ship.
    expect(HIGH_PERF_GPU_SWITCHES).toEqual([
      'force-high-performance-gpu',
      'force_high_performance_gpu',
    ]);
  });

  it('targets the Windows per-app graphics-preference key with the high-performance value', () => {
    expect(USER_GPU_PREFERENCES_KEY).toBe('HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences');
    // 2 = high performance (discrete); 1 = power saving (integrated); 0 = let Windows decide.
    expect(HIGH_PERFORMANCE_PREFERENCE).toBe('GpuPreference=2;');
  });

  it('pins the Linux PRIME env, ozone flag, and relaunch marker to their literal values', () => {
    // Every value here is a wire token a driver, glvnd, or Chromium parses; asserting them
    // against themselves elsewhere would let a typo (say, ozone-platform=wayland, which
    // reintroduces the GPU-process crash-loop) ship with green tests.
    expect(LINUX_PRIME_ENV).toEqual({
      DRI_PRIME: '1',
      __NV_PRIME_RENDER_OFFLOAD: '1',
      __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
      __EGL_VENDOR_LIBRARY_FILENAMES: '/usr/share/glvnd/egl_vendor.d/10_nvidia.json',
      __VK_LAYER_NV_optimus: 'NVIDIA_only',
    });
    expect(LINUX_OZONE_X11_ARG).toBe('--ozone-platform=x11');
    expect(PRIME_RELAUNCH_MARKER).toBe('WOC_PRIME_RELAUNCHED');
  });
});

describe('buildRegQueryArgs / buildRegWriteArgs', () => {
  it('queries this exe path under the preferences key', () => {
    expect(buildRegQueryArgs(EXE)).toEqual(['query', USER_GPU_PREFERENCES_KEY, '/v', EXE]);
  });

  it('writes the high-performance data as a REG_SZ keyed by the exe path, forced', () => {
    expect(buildRegWriteArgs(EXE)).toEqual([
      'add',
      USER_GPU_PREFERENCES_KEY,
      '/v',
      EXE,
      '/t',
      'REG_SZ',
      '/d',
      'GpuPreference=2;',
      '/f',
    ]);
  });

  it('passes explicit merged data through verbatim', () => {
    const data = 'SwapEffectUpgradeEnable=1;GpuPreference=2;';
    expect(buildRegWriteArgs(EXE, data)[7]).toBe(data);
  });
});

describe('parseRegQueryData', () => {
  it('extracts the stored data from real reg query output (exe path contains spaces)', () => {
    expect(parseRegQueryData(regQueryOutput('SwapEffectUpgradeEnable=1;GpuPreference=0;'))).toBe(
      'SwapEffectUpgradeEnable=1;GpuPreference=0;',
    );
  });

  it('accepts a hand-edited REG_EXPAND_SZ value type', () => {
    expect(parseRegQueryData(`    ${EXE}    REG_EXPAND_SZ    GpuPreference=1;`)).toBe(
      'GpuPreference=1;',
    );
  });

  it('returns empty for missing, empty, or unrecognized output', () => {
    expect(parseRegQueryData('')).toBe('');
    expect(parseRegQueryData(undefined)).toBe('');
    expect(parseRegQueryData(null)).toBe('');
    expect(parseRegQueryData('ERROR: unable to find the specified registry value')).toBe('');
  });

  it('accepts a Buffer, which is what execFileSync returns without an encoding option', () => {
    // Production passes execFileSync stdout straight in; without { encoding } that is a
    // Buffer, and only the String() coercion inside the parser makes it work. A refactor
    // that matched on the raw stdout would fail here instead of silently parsing nothing
    // (and then taking the write-from-empty path).
    expect(
      parseRegQueryData(Buffer.from(regQueryOutput('SwapEffectUpgradeEnable=1;GpuPreference=0;'))),
    ).toBe('SwapEffectUpgradeEnable=1;GpuPreference=0;');
  });
});

describe('hasUnparseableValueType', () => {
  it('flags value types the writer cannot round-trip', () => {
    expect(hasUnparseableValueType(`    ${EXE}    REG_MULTI_SZ    A\\0B`)).toBe(true);
    expect(hasUnparseableValueType(`    ${EXE}    REG_DWORD    0x2`)).toBe(true);
    expect(hasUnparseableValueType(`    ${EXE}    REG_BINARY    0BADF00D`)).toBe(true);
  });

  it('accepts the two parseable string types and empty output', () => {
    expect(hasUnparseableValueType(regQueryOutput('GpuPreference=1;'))).toBe(false);
    expect(hasUnparseableValueType(`    ${EXE}    REG_EXPAND_SZ    GpuPreference=1;`)).toBe(false);
    expect(hasUnparseableValueType('')).toBe(false);
    expect(hasUnparseableValueType(undefined)).toBe(false);
  });
});

describe('mergeHighPerformancePreference', () => {
  it('writes the plain high-performance preference when nothing is stored', () => {
    expect(mergeHighPerformancePreference('')).toBe('GpuPreference=2;');
    expect(mergeHighPerformancePreference(undefined)).toBe('GpuPreference=2;');
  });

  it('replaces the GpuPreference token in place, preserving every sibling token', () => {
    // The one per-app value packs OTHER settings too: "Optimizations for windowed games"
    // stores SwapEffectUpgradeEnable, per-app Auto HDR stores AutoHDREnable. A wholesale
    // replace would silently delete them.
    expect(mergeHighPerformancePreference('SwapEffectUpgradeEnable=1;GpuPreference=0;')).toBe(
      'SwapEffectUpgradeEnable=1;GpuPreference=2;',
    );
    expect(
      mergeHighPerformancePreference('GpuPreference=1;SwapEffectUpgradeEnable=1;AutoHDREnable=1;'),
    ).toBe('GpuPreference=2;SwapEffectUpgradeEnable=1;AutoHDREnable=1;');
  });

  it('appends the token when the stored value has no GpuPreference yet', () => {
    expect(mergeHighPerformancePreference('SwapEffectUpgradeEnable=1;')).toBe(
      'SwapEffectUpgradeEnable=1;GpuPreference=2;',
    );
  });

  it('matches the token case-insensitively and collapses duplicates, so one token survives', () => {
    expect(mergeHighPerformancePreference('gpupreference=1;')).toBe('GpuPreference=2;');
    expect(
      mergeHighPerformancePreference('GpuPreference=1;SwapEffectUpgradeEnable=1;GpuPreference=0;'),
    ).toBe('GpuPreference=2;SwapEffectUpgradeEnable=1;');
  });

  it('tolerates stray whitespace between tokens', () => {
    expect(mergeHighPerformancePreference('SwapEffectUpgradeEnable=1; GpuPreference=0;')).toBe(
      'SwapEffectUpgradeEnable=1;GpuPreference=2;',
    );
  });

  it('normalizes a bogus GpuPreference value (=20) instead of concatenating next to it', () => {
    // The prefix match replaces the WHOLE token, so a corrupt stored value can never
    // survive alongside the forced one.
    expect(mergeHighPerformancePreference('SwapEffectUpgradeEnable=1;GpuPreference=20;')).toBe(
      'SwapEffectUpgradeEnable=1;GpuPreference=2;',
    );
  });
});

describe('alreadyHighPerformance', () => {
  it('is true only when the stored value holds a whole GpuPreference=2 token', () => {
    expect(alreadyHighPerformance(regQueryOutput('GpuPreference=2;'))).toBe(true);
    // A combined multi-token value that already pins 2 needs no write either.
    expect(
      alreadyHighPerformance(regQueryOutput('SwapEffectUpgradeEnable=1;GpuPreference=2;')),
    ).toBe(true);
    expect(alreadyHighPerformance('    REG_SZ    GpuPreference=1;')).toBe(false); // power saving
    expect(alreadyHighPerformance('    REG_SZ    GpuPreference=0;')).toBe(false); // let Windows decide
    expect(alreadyHighPerformance(regQueryOutput('GpuPreference=20;'))).toBe(false); // not a real value
    expect(alreadyHighPerformance('')).toBe(false);
    expect(alreadyHighPerformance(undefined)).toBe(false);
    expect(alreadyHighPerformance(null)).toBe(false);
  });

  it('matches whole tokens case-insensitively, in lockstep with the merge tokenizer', () => {
    // A hand-edited lowercase token is still "already pinned" (the merge treats it as the
    // same token, so rewriting it would be pure churn) ...
    expect(alreadyHighPerformance(regQueryOutput('gpupreference=2;'))).toBe(true);
    // ... while a sibling token that merely ENDS in "GpuPreference=2" must not short-circuit
    // the write (the old whole-stdout substring match did).
    expect(alreadyHighPerformance(regQueryOutput('XyzGpuPreference=2;'))).toBe(false);
  });

  it('accepts Buffer stdout like the real execFileSync produces', () => {
    expect(alreadyHighPerformance(Buffer.from(regQueryOutput('GpuPreference=2;')))).toBe(true);
  });
});

describe('summarizeGpuDevices', () => {
  it('flags the hybrid wrong-adapter case: discrete present but inactive, iGPU active', () => {
    const { devices, discreteInactive } = summarizeGpuDevices([
      { vendorId: 0x8086, deviceId: 0x9a49, active: true },
      { vendorId: 0x10de, deviceId: 0x24dd, active: false },
    ]);
    expect(discreteInactive).toBe(true);
    expect(devices).toEqual([
      { vendorId: '0x8086', deviceId: '0x9a49', active: true },
      { vendorId: '0x10de', deviceId: '0x24dd', active: false },
    ]);
  });

  it('flags an inactive AMD discrete adapter behind the WARP software device too', () => {
    expect(
      summarizeGpuDevices([
        { vendorId: 0x1414, deviceId: 0x008c, active: true },
        { vendorId: 0x1002, deviceId: 0x73ff, active: false },
      ]).discreteInactive,
    ).toBe(true);
  });

  it('stays quiet when the discrete adapter is the active one (levers worked)', () => {
    expect(
      summarizeGpuDevices([
        { vendorId: 0x8086, deviceId: 0x9a49, active: false },
        { vendorId: 0x10de, deviceId: 0x24dd, active: true },
      ]).discreteInactive,
    ).toBe(false);
  });

  it('stays quiet on an AMD APU + NVIDIA rig (deliberately conservative: AMD is never proof of an iGPU)', () => {
    expect(
      summarizeGpuDevices([
        { vendorId: 0x1002, deviceId: 0x164e, active: true },
        { vendorId: 0x10de, deviceId: 0x24dd, active: false },
      ]).discreteInactive,
    ).toBe(false);
  });

  it('stays quiet on an integrated-only machine (no discrete adapter present at all)', () => {
    // Isolates the present-but-inactive-discrete dimension: an ordinary Intel-only laptop
    // satisfies the active-iGPU half, so without this pin the discrete-presence clause
    // could be dropped and every integrated-only machine would false-alarm.
    expect(
      summarizeGpuDevices([{ vendorId: 0x8086, deviceId: 0x9a49, active: true }]).discreteInactive,
    ).toBe(false);
  });

  it('handles a missing or malformed device list', () => {
    expect(summarizeGpuDevices(undefined)).toEqual({ devices: [], discreteInactive: false });
    expect(summarizeGpuDevices('nope')).toEqual({ devices: [], discreteInactive: false });
    expect(summarizeGpuDevices([{}]).devices).toEqual([
      { vendorId: '0x0000', deviceId: '0x0000', active: false },
    ]);
  });
});

// The default fileExists is the real fs.existsSync probing the NVIDIA ICD json, which
// differs per machine (present with the NVIDIA driver, absent everywhere else), so every
// test injects it to stay hermetic.
const eglJsonPresent = () => true;
const eglJsonAbsent = (path: string) => {
  expect(path).toBe('/usr/share/glvnd/egl_vendor.d/10_nvidia.json');
  return false;
};

describe('buildLinuxPrimeEnv', () => {
  it('offers all five PRIME offload variables against an empty environment', () => {
    expect(buildLinuxPrimeEnv({}, eglJsonPresent)).toEqual(LINUX_PRIME_ENV);
  });

  it('omits __EGL_VENDOR_LIBRARY_FILENAMES when the NVIDIA EGL ICD json does not exist', () => {
    // glvnd treats that variable as a REPLACEMENT of its vendor list: naming a missing
    // file leaves EGL with zero vendors and no GL at all, so on a machine without the
    // NVIDIA driver (where the json is absent) the entry must not be set.
    const additions = buildLinuxPrimeEnv({}, eglJsonAbsent);
    expect(additions).not.toHaveProperty('__EGL_VENDOR_LIBRARY_FILENAMES');
    expect(additions).toEqual({
      DRI_PRIME: '1',
      __NV_PRIME_RENDER_OFFLOAD: '1',
      __GLX_VENDOR_LIBRARY_NAME: 'nvidia',
      __VK_LAYER_NV_optimus: 'NVIDIA_only',
    });
  });

  it('never overrides a variable the caller already set', () => {
    // A player who already launches via their own `prime-run`, or who hand-picked a
    // vendor library, keeps their own value; we only fill in what is missing.
    const existing = { __GLX_VENDOR_LIBRARY_NAME: 'mesa', UNRELATED: 'x' };
    const additions = buildLinuxPrimeEnv(existing, eglJsonPresent);
    expect(additions).toEqual({
      DRI_PRIME: '1',
      __NV_PRIME_RENDER_OFFLOAD: '1',
      __EGL_VENDOR_LIBRARY_FILENAMES: '/usr/share/glvnd/egl_vendor.d/10_nvidia.json',
      __VK_LAYER_NV_optimus: 'NVIDIA_only',
    });
    expect(additions).not.toHaveProperty('__GLX_VENDOR_LIBRARY_NAME');
  });

  it('does not mutate the environment object passed in', () => {
    const existing = { FOO: 'bar' };
    buildLinuxPrimeEnv(existing, eglJsonPresent);
    expect(existing).toEqual({ FOO: 'bar' });
  });
});

describe('hasExplicitOzonePlatformArg', () => {
  it('matches the explicit flag in both spellings', () => {
    expect(hasExplicitOzonePlatformArg(['--ozone-platform=wayland'])).toBe(true);
    expect(hasExplicitOzonePlatformArg(['--ozone-platform'])).toBe(true);
  });

  it('does NOT count --ozone-platform-hint as an explicit choice', () => {
    // A hint is a preference Chromium lets an explicit flag override; treating it as a
    // choice would suppress the x11 append and reintroduce the Wayland crash-loop.
    expect(hasExplicitOzonePlatformArg(['--ozone-platform-hint=auto'])).toBe(false);
    expect(hasExplicitOzonePlatformArg([])).toBe(false);
    expect(hasExplicitOzonePlatformArg(undefined)).toBe(false);
  });
});

describe('isLinuxHybridGpu', () => {
  it('is true when /sys/class/drm exposes two or more card devices', () => {
    const readdir = (path: string) => {
      expect(path).toBe('/sys/class/drm');
      return ['card0', 'card0-eDP-1', 'card1', 'renderD128', 'renderD129', 'version'];
    };
    expect(isLinuxHybridGpu(readdir)).toBe(true);
  });

  it('is false on a single-GPU machine (render nodes and connectors do not count)', () => {
    expect(isLinuxHybridGpu(() => ['card0', 'card0-eDP-1', 'renderD128', 'version'])).toBe(false);
  });

  it('is false when /sys is unreadable (impose nothing when we cannot tell)', () => {
    expect(
      isLinuxHybridGpu(() => {
        throw new Error('ENOENT');
      }),
    ).toBe(false);
  });
});

describe('shouldRelaunchForLinuxPrime', () => {
  it('is true when at least one PRIME variable is missing', () => {
    expect(shouldRelaunchForLinuxPrime({}, [], eglJsonPresent)).toBe(true);
  });

  it('is false with no marker once every PRIME variable is already present', () => {
    // That environment is wholly the player's own (their prime-run wrapper), flag or not.
    expect(shouldRelaunchForLinuxPrime({ ...LINUX_PRIME_ENV }, [], eglJsonPresent)).toBe(false);
  });

  it('is false for a marked process whose argv carries an explicit ozone choice', () => {
    // The normal relaunched child: env half AND argv half both present.
    expect(
      shouldRelaunchForLinuxPrime(
        { ...LINUX_PRIME_ENV, WOC_PRIME_RELAUNCHED: '1' },
        ['--ozone-platform=x11'],
        eglJsonPresent,
      ),
    ).toBe(false);
  });

  it('is TRUE for a marked process whose argv lost the ozone flag (updater restart)', () => {
    // electron-updater's restart-to-update respawns with the current env (marker and PRIME
    // vars included) but EMPTY argv; without this arm the updated process would run PRIME
    // on the session default backend, the documented Wayland crash-loop. Loop-safe: the
    // relaunch it triggers always yields a child WITH an explicit ozone arg.
    expect(
      shouldRelaunchForLinuxPrime(
        { ...LINUX_PRIME_ENV, WOC_PRIME_RELAUNCHED: '1' },
        [],
        eglJsonPresent,
      ),
    ).toBe(true);
  });
});

describe('relaunchForLinuxPrime', () => {
  function fakeSpawn() {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const unref = vi.fn();
    const spawn = vi.fn((command: string, args: string[], options?: unknown) => {
      calls.push({ command, args, options: options as Record<string, unknown> });
      return { unref };
    });
    return { spawn, calls, unref };
  }

  // Hermetic defaults: a hybrid machine with the NVIDIA EGL json installed. Individual
  // tests override the arms they exercise.
  function deps(overrides: Record<string, unknown> = {}) {
    return { platform: 'linux', isHybridGpu: () => true, fileExists: eglJsonPresent, ...overrides };
  }

  it('does nothing on a non-Linux platform', () => {
    const { spawn } = fakeSpawn();
    expect(relaunchForLinuxPrime(deps({ platform: 'win32', spawn, env: {} }))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does nothing on a single-GPU machine (hybrid gate)', () => {
    // A non-hybrid machine gets neither the extra spawn nor a forced X11 backend.
    const { spawn } = fakeSpawn();
    const result = relaunchForLinuxPrime(deps({ spawn, env: {}, isHybridGpu: () => false }));
    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does nothing when every PRIME variable is already present without the marker', () => {
    const { spawn } = fakeSpawn();
    const env = { ...LINUX_PRIME_ENV };
    expect(relaunchForLinuxPrime(deps({ spawn, env, argv: [] }))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does nothing for a relaunched child (marker plus explicit ozone argv)', () => {
    const { spawn } = fakeSpawn();
    const env = { ...LINUX_PRIME_ENV, WOC_PRIME_RELAUNCHED: '1' };
    const result = relaunchForLinuxPrime(deps({ spawn, env, argv: ['--ozone-platform=x11'] }));
    expect(result).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('re-execs the same binary and argv with the PRIME env baked in, and unrefs the child', () => {
    const { spawn, calls, unref } = fakeSpawn();
    const env = { UNRELATED: 'x' };
    const result = relaunchForLinuxPrime(
      deps({
        spawn,
        env,
        execPath: '/usr/bin/world-of-claudecraft',
        argv: ['--some-flag'],
        log: { info: vi.fn() },
      }),
    );
    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('/usr/bin/world-of-claudecraft');
    expect(calls[0].args).toEqual(['--some-flag', '--ozone-platform=x11']);
    // Full options pin (not a subset match): a stray option here changes spawn semantics.
    expect(calls[0].options).toEqual({
      env: {
        ...LINUX_PRIME_ENV,
        UNRELATED: 'x',
        WOC_PRIME_RELAUNCHED: '1',
      },
      stdio: 'inherit',
      detached: true,
    });
    expect(unref).toHaveBeenCalled();
  });

  it('re-execs a marked-but-flagless process to restore the argv half (updater restart)', () => {
    // The post-auto-update state: env inherited from the relaunched child (marker and all
    // PRIME vars present), argv empty. The relaunch must fire again purely to restore
    // --ozone-platform=x11, and the marker stays set on the new child.
    const { spawn, calls } = fakeSpawn();
    const env = { ...LINUX_PRIME_ENV, WOC_PRIME_RELAUNCHED: '1' };
    const result = relaunchForLinuxPrime(deps({ spawn, env, execPath: 'x', argv: [] }));
    expect(result).toBe(true);
    expect(calls[0].args).toEqual(['--ozone-platform=x11']);
    const childEnv = calls[0].options.env as Record<string, string>;
    expect(childEnv.WOC_PRIME_RELAUNCHED).toBe('1');
  });

  it('spawns the outer AppImage (env.APPIMAGE), never execPath, inside an AppImage', () => {
    // execPath points inside the runtime's FUSE mount, which dies the moment this process
    // exits; the outer file survives and brings up a fresh runtime + mount (the same
    // source electron-updater restarts from).
    const { spawn, calls } = fakeSpawn();
    const env = { APPIMAGE: '/home/p/Applications/world-of-claudecraft.AppImage' };
    relaunchForLinuxPrime(deps({ spawn, env, execPath: '/tmp/.mount_worldXYZ/binary', argv: [] }));
    expect(calls[0].command).toBe('/home/p/Applications/world-of-claudecraft.AppImage');
  });

  it('ignores a non-absolute APPIMAGE value and falls back to execPath', () => {
    const { spawn, calls } = fakeSpawn();
    const env = { APPIMAGE: 'relative/evil.AppImage' };
    relaunchForLinuxPrime(deps({ spawn, env, execPath: '/usr/bin/woc', argv: [] }));
    expect(calls[0].command).toBe('/usr/bin/woc');
  });

  it('never overrides a variable the caller already set in the child env', () => {
    const { spawn, calls } = fakeSpawn();
    const env = { __GLX_VENDOR_LIBRARY_NAME: 'mesa' };
    relaunchForLinuxPrime(deps({ spawn, env, execPath: 'x', argv: [] }));
    const childEnv = calls[0].options.env as Record<string, string>;
    expect(childEnv.__GLX_VENDOR_LIBRARY_NAME).toBe('mesa');
    expect(childEnv.DRI_PRIME).toBe('1');
  });

  it('omits the EGL vendor replacement when the NVIDIA ICD json is absent on this machine', () => {
    const { spawn, calls } = fakeSpawn();
    relaunchForLinuxPrime(
      deps({ spawn, env: {}, execPath: 'x', argv: [], fileExists: () => false }),
    );
    const childEnv = calls[0].options.env as Record<string, string>;
    expect(childEnv).not.toHaveProperty('__EGL_VENDOR_LIBRARY_FILENAMES');
    expect(childEnv.__NV_PRIME_RENDER_OFFLOAD).toBe('1');
  });

  it('appends --ozone-platform=x11 to the relaunch argv (Wayland GPU-process crash-loop guard)', () => {
    const { spawn, calls } = fakeSpawn();
    relaunchForLinuxPrime(deps({ spawn, env: {}, execPath: 'x', argv: ['--some-flag'] }));
    expect(calls[0].args).toEqual(['--some-flag', '--ozone-platform=x11']);
  });

  it('never overrides a player-supplied explicit --ozone-platform argv flag', () => {
    const { spawn, calls } = fakeSpawn();
    relaunchForLinuxPrime(
      deps({ spawn, env: {}, execPath: 'x', argv: ['--ozone-platform=wayland'] }),
    );
    expect(calls[0].args).toEqual(['--ozone-platform=wayland']);
  });

  it('still appends the explicit flag when argv only carries an ozone HINT', () => {
    // --ozone-platform-hint is a preference, not a choice; Chromium lets the explicit
    // flag we append override it, and honoring a wayland hint under PRIME would recreate
    // the crash-loop.
    const { spawn, calls } = fakeSpawn();
    relaunchForLinuxPrime(
      deps({ spawn, env: {}, execPath: 'x', argv: ['--ozone-platform-hint=auto'] }),
    );
    expect(calls[0].args).toEqual(['--ozone-platform-hint=auto', '--ozone-platform=x11']);
  });

  it('returns false and logs a warning when spawn itself throws', () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn EACCES');
    });
    const warn = vi.fn();
    const result = relaunchForLinuxPrime(deps({ spawn, env: {}, log: { warn } }));
    expect(result).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('forceHighPerformanceGpu', () => {
  it('appends both switches on non-Windows and never touches the registry', () => {
    const { app, switches } = fakeApp();
    const execFileSync = vi.fn();
    forceHighPerformanceGpu({ app, platform: 'darwin', execFileSync });
    expect(switches).toEqual(['force-high-performance-gpu', 'force_high_performance_gpu']);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('appends the switches on Linux too, and never touches the registry (relaunch is a separate call)', () => {
    // forceHighPerformanceGpu no longer touches process.env on Linux at all: an in-process
    // mutation here never reaches the GPU process (see gpu_preference.cjs lever 3), so that
    // job belongs entirely to relaunchForLinuxPrime, called earlier by main.cjs.
    const { app, switches } = fakeApp();
    const execFileSync = vi.fn();
    const env = {};
    forceHighPerformanceGpu({ app, platform: 'linux', execFileSync, env });
    expect(switches).toEqual(['force-high-performance-gpu', 'force_high_performance_gpu']);
    expect(env).toEqual({});
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('appends the switches but skips the registry in an unpackaged (dev) run', () => {
    // An unpackaged run resolves the exe to the checkout's node_modules electron binary:
    // the entry would be an orphan per worktree AND would steer every other app launched
    // from that shared binary. Only the stable installed exe path is worth pinning.
    const { app, switches } = fakeApp({ isPackaged: false });
    const execFileSync = vi.fn();
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(switches).toEqual(['force-high-performance-gpu', 'force_high_performance_gpu']);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('fails closed when isPackaged is missing entirely (gate is strictly === true)', () => {
    // A fake or partial app object without the isPackaged boolean must skip the registry
    // lever too, so the gate can only ever fail closed.
    const app = {
      commandLine: { appendSwitch: () => {} },
      getPath: () => EXE,
    };
    const execFileSync = vi.fn();
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('writes the high-performance preference on Windows when no value is stored yet', () => {
    const { app, switches } = fakeApp();
    // reg query exits 1 (value/key absent) -> reg add runs.
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') throw missingValueError();
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(switches).toContain('force-high-performance-gpu');
    const writeCall = execFileSync.mock.calls.find((c) => c[1][0] === 'add');
    expect(writeCall).toBeTruthy();
    expect(writeCall?.[1]).toEqual(buildRegWriteArgs(EXE, 'GpuPreference=2;'));
  });

  it('does NOT rewrite when the preference is already high performance', () => {
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') return regQueryOutput('GpuPreference=2;');
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(execFileSync.mock.calls.some((c) => c[1][0] === 'add')).toBe(false);
  });

  it('overwrites an existing power-saving (integrated) preference with high performance', () => {
    // Deliberate: a stored GpuPreference=1 is exactly what produces the 13 FPS reports.
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') return regQueryOutput('GpuPreference=1;');
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    const writeCall = execFileSync.mock.calls.find((c) => c[1][0] === 'add');
    expect(writeCall?.[1]).toEqual(buildRegWriteArgs(EXE, 'GpuPreference=2;'));
  });

  it('preserves sibling per-app graphics tokens when forcing the preference', () => {
    // Regression: a stored SwapEffectUpgradeEnable=1;GpuPreference=0; must NOT lose the
    // windowed-games optimization token when we force GpuPreference=2.
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') return regQueryOutput('SwapEffectUpgradeEnable=1;GpuPreference=0;');
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    const writeCall = execFileSync.mock.calls.find((c) => c[1][0] === 'add');
    expect(writeCall?.[1]).toEqual(
      buildRegWriteArgs(EXE, 'SwapEffectUpgradeEnable=1;GpuPreference=2;'),
    );
  });

  it('runs reg with bounded, windowless, least-privilege exec options', () => {
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') throw missingValueError();
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    const queryCall = execFileSync.mock.calls.find((c) => c[1][0] === 'query');
    const writeCall = execFileSync.mock.calls.find((c) => c[1][0] === 'add');
    // toEqual pins the whole option object: a dropped timeout or a shell:true would fail.
    // The 1500 ms timeout is load-bearing: both calls are synchronous on the boot path, so
    // it bounds the worst-case startup stall at about 3 s total.
    expect(queryCall?.[2]).toEqual({
      timeout: 1500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(writeCall?.[2]).toEqual({ timeout: 1500, windowsHide: true, stdio: 'ignore' });
  });

  it('parses Buffer stdout from the query (execFileSync without encoding returns a Buffer)', () => {
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query')
        return Buffer.from(regQueryOutput('SwapEffectUpgradeEnable=1;GpuPreference=0;'));
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    const writeCall = execFileSync.mock.calls.find((c) => c[1][0] === 'add');
    expect(writeCall?.[1]).toEqual(
      buildRegWriteArgs(EXE, 'SwapEffectUpgradeEnable=1;GpuPreference=2;'),
    );
  });

  it('still writes when the value exists but its REG_SZ data is empty (nothing to lose)', () => {
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') return regQueryOutput('');
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    const writeCall = execFileSync.mock.calls.find((c) => c[1][0] === 'add');
    expect(writeCall?.[1]).toEqual(buildRegWriteArgs(EXE, 'GpuPreference=2;'));
  });

  it('skips the write when the query timed out (stored value unknown, not absent)', () => {
    // The destructive path this guards: a query timeout used to fall through to a write
    // from an assumed-empty state, wholesale-replacing the value and silently deleting the
    // user's sibling tokens (SwapEffectUpgradeEnable, AutoHDREnable). Unknown must mean
    // skip-this-launch, never overwrite.
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query')
        throw Object.assign(new Error('spawnSync reg.exe ETIMEDOUT'), {
          status: null,
          signal: 'SIGTERM',
          killed: true,
        });
      return '';
    });
    const warn = vi.fn();
    forceHighPerformanceGpu({
      app,
      platform: 'win32',
      execFileSync,
      regExe: 'reg.exe',
      log: { warn },
    });
    expect(execFileSync.mock.calls.some((c) => c[1][0] === 'add')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('skips the write when reg exited 1 but was killed (status alone is not proof of absence)', () => {
    // A kill can surface alongside any status; only a clean, unkilled, unsignaled exit 1
    // means "value absent". Pins the killed/signal guards in isRegValueAbsent.
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query')
        throw Object.assign(new Error('killed mid-query'), {
          status: 1,
          killed: true,
          signal: 'SIGTERM',
        });
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(execFileSync.mock.calls.some((c) => c[1][0] === 'add')).toBe(false);
  });

  it('skips the write when reg.exe itself cannot run (no status at all)', () => {
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query')
        throw Object.assign(new Error('spawnSync reg.exe ENOENT'), { code: 'ENOENT' });
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(execFileSync.mock.calls.some((c) => c[1][0] === 'add')).toBe(false);
  });

  it('skips the write when the stored value has a type the writer cannot round-trip', () => {
    // A hand-edited REG_MULTI_SZ parses to '', and overwriting would both flip the type to
    // REG_SZ and destroy the data. Leave it alone.
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') return `\r\n    ${EXE}    REG_MULTI_SZ    GpuPreference=1;\r\n`;
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(execFileSync.mock.calls.some((c) => c[1][0] === 'add')).toBe(false);
  });

  it('falls back to process.execPath when app.getPath throws', () => {
    const switches: string[] = [];
    const app = {
      isPackaged: true,
      commandLine: { appendSwitch: (name: string) => switches.push(name) },
      getPath: (): string => {
        throw new Error('getPath unavailable');
      },
    };
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') throw new Error('missing');
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    const queryCall = execFileSync.mock.calls.find((c) => c[1][0] === 'query');
    expect(queryCall?.[1]).toEqual(buildRegQueryArgs(process.execPath));
  });

  it('skips the registry entirely when the exe path resolves empty', () => {
    const app = {
      isPackaged: true,
      commandLine: { appendSwitch: () => {} },
      getPath: () => '',
    };
    const execFileSync = vi.fn();
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('never throws if the registry write fails, so the app still boots', () => {
    const { app } = fakeApp();
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query') return regQueryOutput('GpuPreference=1;');
      throw new Error('reg add refused');
    });
    expect(() =>
      forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' }),
    ).not.toThrow();
    // The write path really was reached and really did fail.
    expect(execFileSync.mock.calls.some((c) => c[1][0] === 'add')).toBe(true);
  });

  it('resolves reg.exe under System32 from SystemRoot by default', () => {
    const { app } = fakeApp();
    const calls: string[] = [];
    const execFileSync = vi.fn((cmd: string, args: string[], _opts?: unknown) => {
      calls.push(cmd);
      if (args[0] === 'query') throw missingValueError();
      return '';
    });
    forceHighPerformanceGpu({
      app,
      platform: 'win32',
      execFileSync,
      env: { SystemRoot: 'D:\\Windows' },
    });
    // Both the query and the write must resolve the same absolute reg.exe; an empty calls
    // array would make .every() pass vacuously, so pin the count first.
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c === 'D:\\Windows\\System32\\reg.exe')).toBe(true);
  });
});

describe('main.cjs gpu wiring pin', () => {
  // main.cjs is the electron entry and cannot run under vitest, so pin the wiring
  // textually (same approach as the updater wiring pin in electron_updater_track.test.ts).
  const source = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

  it('calls forceHighPerformanceGpu at module scope, before app.whenReady', () => {
    // Moving the call inside whenReady is the most damaging silent regression: the
    // appendSwitch pair becomes a no-op (switches must land before 'ready') and the GPU
    // process can beat the registry write, reverting the whole fix while every unit test
    // above stays green. Module scope = the call sits at column 0.
    expect(source).toMatch(/^forceHighPerformanceGpu\(\{ app, log \}\);/m);
    const callAt = source.indexOf('forceHighPerformanceGpu({ app, log });');
    const readyAt = source.indexOf('app.whenReady()');
    expect(callAt).toBeGreaterThan(-1);
    expect(readyAt).toBeGreaterThan(-1);
    expect(callAt).toBeLessThan(readyAt);
  });

  it('guards the whole startup behind relaunchForLinuxPrime, exiting the parent immediately', () => {
    // The Linux fix only works as a re-exec BEFORE any Electron startup: the guard must
    // sit at module scope (column 0), run before forceHighPerformanceGpu and before any
    // logging or window setup, and the parent must stop executing via process.exit(0).
    // Any of these moving (into whenReady, below initLogging, losing the exit) silently
    // kills the fix while the pure-function tests above stay green.
    // One regex pins the whole shape: guard at column 0 with process.exit(0) as the block
    // body (comments aside) and nothing else inside.
    expect(source).toMatch(
      /^if \(relaunchForLinuxPrime\(\{ log: console \}\)\) \{\n(?:\s*\/\/[^\n]*\n)*\s*process\.exit\(0\);\n\}/m,
    );
    const guardAt = source.indexOf('if (relaunchForLinuxPrime({ log: console })) {');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(source.indexOf('forceHighPerformanceGpu({ app, log });'));
    expect(guardAt).toBeLessThan(source.indexOf('initLogging('));
  });

  it('logs the PRIME-relaunched-child line the docs verification checklist points at', () => {
    // The parent exits before file logging exists, so the CHILD records the durable
    // evidence; docs/desktop-release.md tells the release verifier to grep main.log for
    // exactly this line.
    expect(source).toContain('[gpu] running as PRIME-relaunched child');
    expect(source).toContain('process.env[PRIME_RELAUNCH_MARKER]');
  });

  it('re-logs GPU status on every load, not just the first (crash-recovery reloads)', () => {
    // A GPU-process crash followed by the recovery auto-reload is exactly when the adapter
    // can flip to the WARP software fallback; .once would keep only the pre-crash reading.
    expect(source).toContain("webContents.on('did-finish-load', logGpuStatus)");
    expect(source).not.toContain("webContents.once('did-finish-load', logGpuStatus)");
  });

  it('logs the adapter list so a hybrid-laptop wrong-adapter case is visible in main.log', () => {
    // Beyond symbol presence: the discreteInactive verdict must actually be consumed and
    // the wrong-adapter warning must exist, so gutting the warn path cannot pass.
    expect(source).toContain('summarizeGpuDevices');
    expect(source).toContain('discreteInactive');
    expect(source).toContain('discrete GPU is present but INACTIVE');
  });
});

describe('electron-dev.mjs PRIME pre-apply pin', () => {
  // The dev orchestrator kills Vite the moment its electron child exits, so on a Linux
  // hybrid machine the main.cjs relaunch would tear down the dev server under the
  // detached grandchild. The dev spawn therefore pre-applies the exact configuration the
  // relaunch would have produced (env additions + marker + explicit ozone flag), which
  // suppresses the relaunch entirely. Pin that wiring textually, same approach as the
  // main.cjs block above.
  const source = readFileSync(new URL('../scripts/electron-dev.mjs', import.meta.url), 'utf8');

  it('pre-applies the PRIME env, marker, and ozone flag using the module predicates', () => {
    expect(source).toContain("createRequire(import.meta.url)('../electron/gpu_preference.cjs')");
    expect(source).toContain('shouldRelaunchForLinuxPrime(process.env, [])');
    expect(source).toContain('isLinuxHybridGpu()');
    expect(source).toContain("[PRIME_RELAUNCH_MARKER]: '1'");
    expect(source).toContain('[LINUX_OZONE_X11_ARG]');
  });

  it('feeds the pre-applied config into the electron spawn (env and argv both)', () => {
    expect(source).toContain("spawn(electronCommand, ['.', ...prime.args]");
    expect(source).toContain('...prime.env,');
  });
});
