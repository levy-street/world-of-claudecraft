import { describe, expect, it, vi } from 'vitest';
import {
  alreadyHighPerformance,
  buildRegQueryArgs,
  buildRegWriteArgs,
  forceHighPerformanceGpu,
  HIGH_PERF_GPU_SWITCHES,
  HIGH_PERFORMANCE_PREFERENCE,
  mergeHighPerformancePreference,
  parseRegQueryData,
  USER_GPU_PREFERENCES_KEY,
} from '../electron/gpu_preference.cjs';

const EXE =
  'C:\\Users\\p\\AppData\\Local\\Programs\\world-of-claudecraft\\World of ClaudeCraft.exe';

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
});

describe('alreadyHighPerformance', () => {
  it('is true only when the stored value is exactly high performance (2)', () => {
    expect(alreadyHighPerformance(regQueryOutput('GpuPreference=2;'))).toBe(true);
    // A combined multi-token value that already pins 2 needs no write either.
    expect(
      alreadyHighPerformance(regQueryOutput('SwapEffectUpgradeEnable=1;GpuPreference=2;')),
    ).toBe(true);
    expect(alreadyHighPerformance('    REG_SZ    GpuPreference=1;')).toBe(false); // power saving
    expect(alreadyHighPerformance('    REG_SZ    GpuPreference=0;')).toBe(false); // let Windows decide
    expect(alreadyHighPerformance('GpuPreference=20;')).toBe(false); // not a real value; lookahead guard
    expect(alreadyHighPerformance('')).toBe(false);
    expect(alreadyHighPerformance(undefined)).toBe(false);
    expect(alreadyHighPerformance(null)).toBe(false);
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
    // reg query throws (value/key absent) -> reg add runs.
    const execFileSync = vi.fn((_cmd: string, args: string[], _opts?: unknown) => {
      if (args[0] === 'query')
        throw new Error('ERROR: unable to find the specified registry value');
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
      if (args[0] === 'query') throw new Error('missing');
      return '';
    });
    forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' });
    const queryCall = execFileSync.mock.calls.find((c) => c[1][0] === 'query');
    const writeCall = execFileSync.mock.calls.find((c) => c[1][0] === 'add');
    // toEqual pins the whole option object: a dropped timeout or a shell:true would fail.
    expect(queryCall?.[2]).toEqual({
      timeout: 4000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(writeCall?.[2]).toEqual({ timeout: 4000, windowsHide: true, stdio: 'ignore' });
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
    const execFileSync = vi.fn(() => {
      throw new Error('reg unavailable');
    });
    expect(() =>
      forceHighPerformanceGpu({ app, platform: 'win32', execFileSync, regExe: 'reg.exe' }),
    ).not.toThrow();
  });

  it('resolves reg.exe under System32 from SystemRoot by default', () => {
    const { app } = fakeApp();
    const calls: string[] = [];
    const execFileSync = vi.fn((cmd: string, args: string[], _opts?: unknown) => {
      calls.push(cmd);
      if (args[0] === 'query') throw new Error('missing');
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
