import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  alreadyHighPerformance,
  buildRegQueryArgs,
  buildRegWriteArgs,
  forceHighPerformanceGpu,
  HIGH_PERF_GPU_SWITCHES,
  HIGH_PERFORMANCE_PREFERENCE,
  hasUnparseableValueType,
  mergeHighPerformancePreference,
  parseRegQueryData,
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

describe('forceHighPerformanceGpu', () => {
  it('appends both switches on non-Windows and never touches the registry', () => {
    const { app, switches } = fakeApp();
    const execFileSync = vi.fn();
    forceHighPerformanceGpu({ app, platform: 'darwin', execFileSync });
    expect(switches).toEqual(['force-high-performance-gpu', 'force_high_performance_gpu']);
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
