import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, win32 } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { clampText } from '../electron/diagnostics.cjs';
import {
  APP_EXE_NAME_RE,
  appExeNameFor,
  assembleHostDiagReport,
  BROWSER_EXE_NAMES,
  buildHostDiagArgs,
  collectElectronHostInfo,
  flattenSwitchPairs,
  GAME_INFO_KEYS,
  HOST_DIAG_KIND,
  HOST_DIAG_MANIFEST,
  HOST_DIAG_MAX_STDOUT_BYTES,
  HOST_DIAG_SCHEMA_VERSION,
  HOST_DIAG_SPAWN_OPTIONS,
  HOST_DIAG_TIMEOUT_MS,
  hostDiagFileName,
  hostDiagScriptPath,
  powershellExe,
  runHostDiag,
  runNativeHostDiag,
  sanitizeGameInfo,
  sanitizeShellState,
  verifyHostDiagScript,
} from '../electron/host_diag.cjs';
import { DEFAULT_SHELL_STRINGS } from '../electron/shell_strings.cjs';

// The host diagnostic's shell side. Nothing here spawns a real process: the one
// exception is the committed-bundle hash check at the bottom, which reads real
// bytes off disk but still starts nothing.

const SCRIPT = 'C:\\Program Files\\World of ClaudeCraft\\resources\\host-diag\\HostDiag.ps1';

/** A minimal report that satisfies the envelope contract in
 *  electron/host_diag/SCHEMA.md (numeric schemaVersion + object collectors). */
const REPORT = {
  schemaVersion: 2,
  tool: { name: 'host-diag', version: '0.3.0' },
  collectors: { system: { status: 'ok', durationMs: 12, data: { isLaptop: true } } },
};

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

/** A fake spawn plus the manual clock and timer seams runNativeHostDiag takes,
 *  so the timeout and the byte cap are driven rather than waited on. */
function harness({ verdictBytes = 'script' }: { verdictBytes?: string } = {}) {
  const child = fakeChild();
  const spawn = vi.fn(() => child);
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let clock = 1_000;
  return {
    child,
    spawn,
    timers,
    fire: () => timers[0]?.fn(),
    advance: (ms: number) => {
      clock += ms;
    },
    deps: {
      platform: 'win32' as const,
      scriptPath: SCRIPT,
      env: { SystemRoot: 'C:\\Windows' },
      execPath: 'C:\\Program Files\\World of ClaudeCraft\\World of ClaudeCraft.exe',
      spawn,
      readFileSync: () => Buffer.from(verdictBytes),
      sha256Hex: () => HOST_DIAG_MANIFEST.sha256,
      now: () => clock,
      setTimeout: (fn: () => void, ms: number) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimeout: () => {},
    },
  };
}

describe('powershellExe / hostDiagScriptPath', () => {
  it('resolves the interpreter absolutely from SystemRoot, never through PATH', () => {
    // Same idiom as defaultRegExe in gpu_preference.cjs: a PATH lookup could be
    // shadowed by a per-user entry, and win32.join keeps the path right on a
    // POSIX host running these tests.
    expect(powershellExe({ SystemRoot: 'D:\\Windows' })).toBe(
      win32.join('D:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    // No SystemRoot at all still yields an absolute path, never a bare name.
    expect(powershellExe({})).toBe(
      win32.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    expect(powershellExe(undefined)).toContain('System32');
  });

  it('reads the packaged script from resources/host-diag and the dev one from the checkout', () => {
    expect(hostDiagScriptPath({ isPackaged: true, resourcesPath: '/app/resources' })).toBe(
      join('/app/resources', 'host-diag', 'HostDiag.ps1'),
    );
    // `electron .` (scripts/electron-dev.mjs) makes getAppPath() the repo root.
    expect(hostDiagScriptPath({ isPackaged: false, appPath: '/repo' })).toBe(
      join('/repo', 'electron', 'host_diag', 'dist', 'HostDiag.ps1'),
    );
    // Anything but a strict true is the dev path: an undefined isPackaged must
    // not resolve a packaged path against an empty resourcesPath.
    expect(hostDiagScriptPath({ appPath: '/repo' })).toContain('host_diag');
  });
});

describe('buildHostDiagArgs (the FIXED argv)', () => {
  it('pins the exact argv, in order: this game first, then the fixed browser list', () => {
    expect(
      buildHostDiagArgs({ scriptPath: SCRIPT, appExeName: 'World of ClaudeCraft.exe' }),
    ).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SCRIPT,
      '-StdoutJson',
      '-Apps',
      'World of ClaudeCraft.exe,chrome.exe,msedge.exe,firefox.exe,brave.exe,opera.exe',
    ]);
  });

  it('never skips the browsers collector: browser players send this same report', () => {
    // The game is played in a web browser too. What answers a slow browser
    // session is the browser's own NVIDIA profile and Windows GPU preference plus
    // the browsers collector, so neither may quietly drop out of the shipped run.
    expect(BROWSER_EXE_NAMES).toEqual([
      'chrome.exe',
      'msedge.exe',
      'firefox.exe',
      'brave.exe',
      'opera.exe',
    ]);
    for (const appExeName of ['World of ClaudeCraft.exe', 'nope', undefined]) {
      const args = buildHostDiagArgs({ scriptPath: SCRIPT, appExeName });
      expect(args, `for ${String(appExeName)}`).not.toContain('-Skip');
    }
  });

  it('leaves out a name it cannot vouch for and keeps the explicit browser list', () => {
    // Never sanitized, and -Apps is never OMITTED either: the list the player is
    // told about is the one written in host_diag.cjs, not the tool's own default.
    for (const name of [
      '..\\..\\evil.exe',
      'C:\\Windows\\System32\\cmd.exe',
      'a/b.exe',
      '"quoted".exe',
      '   .exe',
      'game.exe; calc.exe',
      'game.exe,calc.exe',
      `${'x'.repeat(61)}.exe`,
      'game.bat',
      'game',
      '',
    ]) {
      expect(
        buildHostDiagArgs({ scriptPath: SCRIPT, appExeName: name }),
        `accepted ${JSON.stringify(name)}`,
      ).toEqual([
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT,
        '-StdoutJson',
        '-Apps',
        'chrome.exe,msedge.exe,firefox.exe,brave.exe,opera.exe',
      ]);
    }
    const noName = buildHostDiagArgs({ scriptPath: SCRIPT });
    expect(noName[noName.indexOf('-Apps') + 1]).toBe(
      'chrome.exe,msedge.exe,firefox.exe,brave.exe,opera.exe',
    );
  });

  it('accepts the real shipped exe names and refuses a path or a quote', () => {
    expect(APP_EXE_NAME_RE.test('World of ClaudeCraft.exe')).toBe(true);
    expect(APP_EXE_NAME_RE.test('electron.exe')).toBe(true);
    expect(APP_EXE_NAME_RE.test('woc-1.2.3_beta.exe')).toBe(true);
    expect(APP_EXE_NAME_RE.test('a\\b.exe')).toBe(false);
    expect(APP_EXE_NAME_RE.test("it's.exe")).toBe(false);
    expect(appExeNameFor('C:\\games\\World of ClaudeCraft.exe')).toBe('World of ClaudeCraft.exe');
    expect(appExeNameFor('/usr/lib/woc/woc')).toBe(null);
    expect(appExeNameFor(undefined as unknown as string)).toBe(null);
  });
});

describe('verifyHostDiagScript (the gate before any spawn)', () => {
  it('answers ok only when the bytes hash to the manifest pin', () => {
    const read = () => Buffer.from('bytes');
    expect(
      verifyHostDiagScript(SCRIPT, HOST_DIAG_MANIFEST, {
        readFileSync: read,
        sha256Hex: () => HOST_DIAG_MANIFEST.sha256,
      }),
    ).toBe('ok');
    expect(
      verifyHostDiagScript(SCRIPT, HOST_DIAG_MANIFEST, {
        readFileSync: read,
        sha256Hex: () => 'deadbeef',
      }),
    ).toBe('hash-mismatch');
    expect(
      verifyHostDiagScript(SCRIPT, HOST_DIAG_MANIFEST, {
        readFileSync: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBe('missing');
  });

  it('never passes a manifest with no pin (a dropped sha256 must not read as ok)', () => {
    expect(
      verifyHostDiagScript(
        SCRIPT,
        { file: 'HostDiag.ps1', sha256: '', toolVersion: '0', schemaVersion: 0 },
        { readFileSync: () => Buffer.from('bytes'), sha256Hex: () => 'abc' },
      ),
    ).toBe('hash-mismatch');
  });
});

describe('runNativeHostDiag', () => {
  it('spawns the absolute interpreter with the fixed argv and the WHOLE options object', async () => {
    const h = harness();
    const run = runNativeHostDiag(h.deps);
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const [exe, args, options] = h.spawn.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(exe).toBe(
      win32.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    );
    expect(args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SCRIPT,
      '-StdoutJson',
      '-Apps',
      'World of ClaudeCraft.exe,chrome.exe,msedge.exe,firefox.exe,brave.exe,opera.exe',
    ]);
    // toEqual on the WHOLE object: an added `shell: true`, a dropped
    // windowsHide (a console window flashing over a full-screen game), or a
    // widened stdio must fail here. This is the control the malware-scan
    // exception for this file names.
    expect(options).toEqual({ windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    expect(options).toBe(HOST_DIAG_SPAWN_OPTIONS);
    h.child.stdout.emit('data', Buffer.from(JSON.stringify(REPORT)));
    h.advance(4_800);
    h.child.emit('close', 0);
    await expect(run).resolves.toEqual({
      status: 'ok',
      exitCode: 0,
      durationMs: 4_800,
      report: REPORT,
    });
  });

  it('refuses to spawn at all when the script is missing or fails its hash check', async () => {
    for (const [sha, reason] of [
      ['deadbeef', 'hash-mismatch'],
      [HOST_DIAG_MANIFEST.sha256, 'missing'],
    ] as const) {
      const h = harness();
      const result = await runNativeHostDiag({
        ...h.deps,
        sha256Hex: () => sha,
        readFileSync:
          reason === 'missing'
            ? () => {
                throw new Error('ENOENT');
              }
            : h.deps.readFileSync,
      });
      expect(result).toEqual({ status: 'unavailable', reason, durationMs: 0 });
      // The whole point of the check: nothing ran.
      expect(h.spawn).not.toHaveBeenCalled();
    }
  });

  it('never spawns off Windows, and says so rather than reporting a failure', async () => {
    const h = harness();
    await expect(runNativeHostDiag({ ...h.deps, platform: 'darwin' })).resolves.toEqual({
      status: 'unsupported-platform',
      durationMs: 0,
    });
    await expect(runNativeHostDiag({ ...h.deps, platform: 'linux' })).resolves.toEqual({
      status: 'unsupported-platform',
      durationMs: 0,
    });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('kills the child on the timeout and answers a stable reason', async () => {
    // The literal, not only the constant against itself: this is how long the
    // main process may hold a spawned PowerShell.
    expect(HOST_DIAG_TIMEOUT_MS).toBe(120_000);
    const h = harness();
    const run = runNativeHostDiag(h.deps);
    expect(h.timers[0]?.ms).toBe(HOST_DIAG_TIMEOUT_MS);
    h.advance(HOST_DIAG_TIMEOUT_MS);
    h.fire();
    await expect(run).resolves.toEqual({
      status: 'error',
      reason: 'timeout',
      durationMs: HOST_DIAG_TIMEOUT_MS,
    });
    // A wedged PowerShell must not outlive the run: the tool bounds its own
    // collectors, so reaching this means the process itself is stuck.
    expect(h.child.kill).toHaveBeenCalledTimes(1);
  });

  it('kills the child and answers too-large once stdout passes the cap', async () => {
    const h = harness();
    const run = runNativeHostDiag({ ...h.deps, maxStdoutBytes: 64 });
    h.child.stdout.emit('data', Buffer.alloc(40));
    expect(h.child.kill).not.toHaveBeenCalled();
    h.child.stdout.emit('data', Buffer.alloc(40));
    await expect(run).resolves.toEqual({
      status: 'error',
      reason: 'too-large',
      durationMs: 0,
    });
    expect(h.child.kill).toHaveBeenCalledTimes(1);
    // The cap is a real bound, not a formality.
    expect(HOST_DIAG_MAX_STDOUT_BYTES).toBe(2 * 1024 * 1024);
  });

  it('answers bad-json for anything that is not the documented envelope', async () => {
    const cases: Array<[string, number]> = [
      ['not json at all', 0],
      ['', 0],
      ['[{"schemaVersion":2,"collectors":{}}]', 0],
      ['{"collectors":{}}', 0],
      ['{"schemaVersion":2}', 0],
      ['{"schemaVersion":"2","collectors":{}}', 0],
      ['{"schemaVersion":2,"collectors":[]}', 1],
    ];
    for (const [stdout, code] of cases) {
      const h = harness();
      const run = runNativeHostDiag(h.deps);
      if (stdout !== '') h.child.stdout.emit('data', Buffer.from(stdout));
      h.child.emit('close', code);
      await expect(run, stdout).resolves.toEqual({
        status: 'error',
        reason: 'bad-json',
        exitCode: code,
        durationMs: 0,
      });
    }
  });

  it('strips a BOM before parsing (PowerShell UTF-8 output carries one)', async () => {
    const h = harness();
    const run = runNativeHostDiag(h.deps);
    h.child.stdout.emit('data', Buffer.from(`\ufeff${JSON.stringify(REPORT)}`, 'utf8'));
    h.child.emit('close', 0);
    await expect(run).resolves.toMatchObject({ status: 'ok', report: REPORT });
  });

  it('treats exit code 1 as partial success and keeps the report', async () => {
    // SCHEMA.md: 1 means at least one collector failed and the document is still
    // whole, which is the common case (no NVIDIA card, a blocked WMI).
    const h = harness();
    const run = runNativeHostDiag(h.deps);
    h.child.stdout.emit('data', Buffer.from(JSON.stringify(REPORT)));
    h.child.emit('close', 1);
    await expect(run).resolves.toEqual({
      status: 'partial',
      exitCode: 1,
      durationMs: 0,
      report: REPORT,
    });
  });

  it('returns a whole report from any other exit code too, flagged', async () => {
    // Exit 2 is the fatalError arm: exactly the machine worth reading about, so
    // the document is kept and the code is carried beside it.
    const h = harness();
    const run = runNativeHostDiag(h.deps);
    h.child.stdout.emit('data', Buffer.from(JSON.stringify(REPORT)));
    h.child.emit('close', 2);
    await expect(run).resolves.toEqual({
      status: 'partial',
      reason: 'exit-code',
      exitCode: 2,
      durationMs: 0,
      report: REPORT,
    });
  });

  it('answers spawn-failed on both the async error event and a synchronous throw', async () => {
    const h = harness();
    const run = runNativeHostDiag(h.deps);
    h.child.emit('error', new Error('EACCES C:\\Users\\player\\...'));
    // The reason is a stable CODE: an OS error message would carry the player's
    // install path into a value that crosses to the renderer.
    await expect(run).resolves.toEqual({
      status: 'error',
      reason: 'spawn-failed',
      durationMs: 0,
    });

    const thrower = harness();
    await expect(
      runNativeHostDiag({
        ...thrower.deps,
        spawn: () => {
          throw new Error('EPERM');
        },
      }),
    ).resolves.toEqual({ status: 'error', reason: 'spawn-failed', durationMs: 0 });
  });

  it('settles once: a close after a timeout kill changes nothing', async () => {
    const h = harness();
    const run = runNativeHostDiag(h.deps);
    h.fire();
    h.child.stdout.emit('data', Buffer.from(JSON.stringify(REPORT)));
    h.child.emit('close', 0);
    await expect(run).resolves.toMatchObject({ status: 'error', reason: 'timeout' });
  });
});

describe('sanitizeGameInfo (the renderer is untrusted here)', () => {
  it('keeps the whitelisted scalars and drops everything else', () => {
    const clean = sanitizeGameInfo({
      sessionId: 'abc-123',
      zone: 'Eastbrook',
      renderScale: 0.75,
      targetFps: 60,
      gfxTier: 2,
      // Not on the list: a path, a name, a token. None may reach the file.
      userName: 'player',
      savePath: 'C:\\Users\\player\\AppData',
      authToken: 'secret',
      __proto__: { polluted: true },
    });
    expect(clean).toEqual({
      sessionId: 'abc-123',
      zone: 'Eastbrook',
      renderScale: 0.75,
      targetFps: 60,
      gfxTier: 2,
    });
    expect('userName' in clean).toBe(false);
    expect('savePath' in clean).toBe(false);
    expect(Object.keys(clean).every((key) => GAME_INFO_KEYS.includes(key))).toBe(true);
  });

  it('pins the whole key list, so a key dropped from main AND preload is caught', () => {
    expect([...GAME_INFO_KEYS]).toEqual([
      'sessionId',
      'releaseVersion',
      'buildId',
      'graphicsPreset',
      'gfxTier',
      'glRenderer',
      'glVendor',
      'renderScale',
      'targetFps',
      'zone',
      'locale',
    ]);
  });

  it('clamps strings to 128 and flattens control characters through the shell clamp', () => {
    const clean = sanitizeGameInfo({ zone: 'x'.repeat(400), locale: 'fr\nFR' });
    expect(clean.zone).toBe(clampText('x'.repeat(400), 128));
    expect((clean.zone as string).length).toBeLessThanOrEqual(131);
    expect(clean.locale).toBe('fr FR');
  });

  it('refuses NaN, Infinity, objects, arrays, and junk input', () => {
    expect(sanitizeGameInfo({ targetFps: Number.NaN })).toEqual({});
    expect(sanitizeGameInfo({ renderScale: Number.POSITIVE_INFINITY })).toEqual({});
    expect(sanitizeGameInfo({ zone: { toString: () => 'x' } })).toEqual({});
    expect(sanitizeGameInfo({ zone: ['Eastbrook'] })).toEqual({});
    expect(sanitizeGameInfo({ zone: '' })).toEqual({});
    expect(sanitizeGameInfo(null)).toEqual({});
    expect(sanitizeGameInfo('a string')).toEqual({});
    expect(sanitizeGameInfo(undefined)).toEqual({});
  });

  it('the preload pre-caps the SAME key list (it cannot require this module, sandboxed)', () => {
    const preload = readFileSync(join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
    const block = preload.slice(
      preload.indexOf('const HOST_DIAG_GAME_KEYS = ['),
      preload.indexOf('];', preload.indexOf('const HOST_DIAG_GAME_KEYS = [')),
    );
    for (const key of GAME_INFO_KEYS) {
      expect(block, `preload copy is missing ${key}`).toContain(`'${key}'`);
    }
    // And no EXTRA key on the preload side: main would drop it, so a key only
    // there is a contract that silently does nothing.
    const copied = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(copied.sort()).toEqual([...GAME_INFO_KEYS].sort());
  });
});

describe('sanitizeShellState / flattenSwitchPairs', () => {
  it('keeps scalars and nulls, drops objects and arrays, and caps the key count', () => {
    expect(
      sanitizeShellState({
        distribution: 'website',
        gpuForceOptOut: false,
        gpuBackendActive: '',
        displayFrequency: 60,
        nested: { a: 1 },
        list: [1, 2],
        missing: null,
        nope: Number.NaN,
      }),
    ).toEqual({
      distribution: 'website',
      gpuForceOptOut: false,
      gpuBackendActive: '',
      displayFrequency: 60,
      missing: null,
    });
    expect(sanitizeShellState(null)).toBe(null);
    expect(sanitizeShellState('nope')).toBe(null);
    const wide: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) wide[`k${i}`] = i;
    expect(Object.keys(sanitizeShellState(wide) ?? {})).toHaveLength(40);
  });

  it('flattens Chromium switch pairs into one string the scalar filter keeps', () => {
    expect(
      flattenSwitchPairs([
        ['use-angle', 'vulkan'],
        ['enable-features', 'Vulkan'],
        ['disable-gpu-driver-bug-workarounds'],
      ]),
    ).toBe('use-angle=vulkan enable-features=Vulkan disable-gpu-driver-bug-workarounds');
    expect(flattenSwitchPairs([])).toBe('');
    expect(flattenSwitchPairs(undefined)).toBe('');
  });
});

describe('collectElectronHostInfo', () => {
  const displays = [
    {
      id: 1,
      size: { width: 3840, height: 2160 },
      scaleFactor: 1.5,
      displayFrequency: 144,
      internal: false,
    },
    {
      id: 2,
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
      displayFrequency: 60,
      internal: true,
    },
  ];

  function fakeDeps() {
    return {
      app: {
        getVersion: () => '0.43.2',
        getAppMetrics: () => [
          {
            type: 'Browser',
            name: 'a renderer document title',
            memory: { workingSetSize: 120_000, peakWorkingSetSize: 130_000, privateBytes: 1 },
            cpu: { percentCPUUsage: 12.3456, idleWakeupsPerSecond: 2 },
          },
          {
            type: 'GPU',
            memory: { workingSetSize: 80_000, peakWorkingSetSize: 90_000 },
            cpu: { percentCPUUsage: 1 },
          },
        ],
        getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled', webgl: 'enabled' }),
        getGPUInfo: () =>
          Promise.resolve({
            gpuDevice: [
              {
                vendorId: 4318,
                deviceId: 8712,
                active: true,
                driverVendor: 'NVIDIA',
                driverVersion: '580.0',
                deviceString: 'NVIDIA GeForce RTX 3090',
                // Neither of these is on the whitelist, and both are exactly
                // what must never land in a file a player mails out.
                userName: 'player',
                path: 'C:\\Users\\player\\AppData\\Local\\Programs',
              },
            ],
            auxAttributes: {
              glRenderer: 'ANGLE (NVIDIA, Vulkan 1.4.312)',
              glVendor: 'Google Inc.',
              directComposition: true,
              maxMsaaSamples: '8',
              machineModelName: 'Player-Laptop-15',
              userName: 'player',
              nested: { path: 'C:\\Users\\player' },
            },
            auxUnknown: 'dropped',
          }),
      },
      screen: {
        getAllDisplays: () => displays,
        getPrimaryDisplay: () => ({ id: 2 }),
      },
      powerMonitor: { isOnBatteryPower: () => true },
      os: {
        cpus: () => [{ model: 'Intel Core i7' }, { model: 'Intel Core i7' }],
        release: () => '10.0.26200',
      },
      process: {
        platform: 'win32',
        arch: 'x64',
        versions: { electron: '43.3.0', chrome: '150.0', node: '22.0' },
        getSystemMemoryInfo: () => ({
          total: 33_000_000,
          free: 9_000_000,
          swapTotal: 1,
          label: 'x',
        }),
      },
      channel: 'website',
      shellState: { distribution: 'website', gpuForceOptOut: false },
    };
  }

  it('reduces every API to a whitelist and never leaks a non-whitelisted key', async () => {
    const info = await collectElectronHostInfo(fakeDeps());
    const asText = JSON.stringify(info);
    expect(asText).not.toContain('userName');
    expect(asText).not.toContain('player');
    expect(asText).not.toContain('machineModelName');
    expect(asText).not.toContain('a renderer document title');
    expect(asText).not.toContain('auxUnknown');
    expect(info).toMatchObject({
      appVersion: '0.43.2',
      channel: 'website',
      versions: { electron: '43.3.0', chrome: '150.0', node: '22.0' },
      platform: 'win32',
      arch: 'x64',
      osRelease: '10.0.26200',
      cpu: { model: 'Intel Core i7', logicalCores: 2 },
      // Numeric fields only: the string 'label' is dropped by type.
      memory: { total: 33_000_000, free: 9_000_000, swapTotal: 1 },
      onBatteryPower: true,
      gpuFeatureStatus: { gpu_compositing: 'enabled', webgl: 'enabled' },
    });
    expect((info.memory as Record<string, unknown>).label).toBeUndefined();
    expect(info.appMetrics).toEqual({
      processes: [
        { type: 'Browser', workingSetKb: 120_000, peakWorkingSetKb: 130_000, cpuPercent: 12.35 },
        { type: 'GPU', workingSetKb: 80_000, peakWorkingSetKb: 90_000, cpuPercent: 1 },
      ],
      totalWorkingSetKb: 200_000,
    });
    expect(info.displays).toEqual([
      {
        width: 3840,
        height: 2160,
        scaleFactor: 1.5,
        displayFrequency: 144,
        internal: false,
        primary: false,
      },
      {
        width: 1920,
        height: 1080,
        scaleFactor: 1,
        displayFrequency: 60,
        internal: true,
        primary: true,
      },
    ]);
    expect(info.gpu).toEqual({
      devices: [
        {
          vendorId: 4318,
          deviceId: 8712,
          active: true,
          driverVendor: 'NVIDIA',
          driverVersion: '580.0',
          deviceString: 'NVIDIA GeForce RTX 3090',
        },
      ],
      auxAttributes: {
        glRenderer: 'ANGLE (NVIDIA, Vulkan 1.4.312)',
        glVendor: 'Google Inc.',
        directComposition: true,
        maxMsaaSamples: '8',
      },
    });
    expect(info.shell).toEqual({ distribution: 'website', gpuForceOptOut: false });
  });

  it('survives EVERY getter throwing, with a null per field and no rejection', async () => {
    const boom = () => {
      throw new Error('wedged');
    };
    const info = await collectElectronHostInfo({
      app: {
        getVersion: boom,
        getAppMetrics: boom,
        getGPUFeatureStatus: boom,
        getGPUInfo: boom,
      },
      screen: { getAllDisplays: boom, getPrimaryDisplay: boom },
      powerMonitor: { isOnBatteryPower: boom },
      os: { cpus: boom, release: boom },
      process: { platform: 'win32', arch: 'x64', versions: {}, getSystemMemoryInfo: boom },
    });
    expect(info).toMatchObject({
      appVersion: null,
      channel: null,
      osRelease: null,
      cpu: { model: null, logicalCores: null },
      memory: {},
      appMetrics: null,
      onBatteryPower: false,
      displays: null,
      gpuFeatureStatus: null,
      gpu: null,
      shell: null,
    });
    expect(info.versions).toEqual({ electron: null, chrome: null, node: null });
  });

  it('gives up on getGPUInfo after its own timeout instead of holding the snapshot', async () => {
    const timers: Array<() => void> = [];
    const pending = await collectElectronHostInfo({
      app: {
        getVersion: () => '0.43.2',
        // Never settles: a wedged or gone GPU process.
        getGPUInfo: () => new Promise(() => {}),
      },
      process: { platform: 'win32', arch: 'x64', versions: {} },
      os: { cpus: () => [], release: () => '1' },
      setTimeout: (fn: () => void) => {
        timers.push(fn);
        // Fire immediately: the point is that the snapshot completes without it.
        fn();
        return timers.length;
      },
      clearTimeout: () => {},
    });
    expect(pending.gpu).toBe(null);
    expect(pending.appVersion).toBe('0.43.2');
  });

  it('answers null for the GPU half when getGPUInfo rejects', async () => {
    const info = await collectElectronHostInfo({
      app: { getGPUInfo: () => Promise.reject(new Error('gpu process gone')) },
      process: { platform: 'linux', arch: 'arm64', versions: {} },
      os: { cpus: () => [], release: () => '6.1' },
    });
    expect(info.gpu).toBe(null);
  });
});

describe('assembleHostDiagReport / hostDiagFileName', () => {
  it('builds the envelope with the recognizable head and the native half beside it', () => {
    const report = assembleHostDiagReport({
      game: { zone: 'Eastbrook', nope: 'dropped' },
      electron: { appVersion: '0.43.2' },
      native: {
        platform: 'win32',
        status: 'partial',
        reason: 'exit-code',
        exitCode: 2,
        durationMs: 5_120,
        report: REPORT,
      },
      now: new Date('2026-09-19T17:04:05.000Z'),
    });
    expect(report).toEqual({
      kind: 'woc-host-diag',
      schemaVersion: 1,
      generatedAt: '2026-09-19T17:04:05.000Z',
      game: { zone: 'Eastbrook' },
      electron: { appVersion: '0.43.2' },
      native: {
        platform: 'win32',
        status: 'partial',
        reason: 'exit-code',
        exitCode: 2,
        durationMs: 5_120,
        report: REPORT,
      },
    });
    expect(HOST_DIAG_KIND).toBe('woc-host-diag');
    expect(HOST_DIAG_SCHEMA_VERSION).toBe(1);
  });

  it('fills the native half even when nothing ran, so a reader is never guessing', () => {
    const report = assembleHostDiagReport({
      native: { platform: 'darwin', status: 'unsupported-platform', durationMs: 0 },
      now: 0,
    });
    expect(report.native).toEqual({
      platform: 'darwin',
      status: 'unsupported-platform',
      reason: null,
      exitCode: null,
      durationMs: 0,
      report: null,
    });
    // A caller that forgot the native half entirely must not produce a document
    // that reads as a successful collection.
    expect((assembleHostDiagReport({}).native as { status: string }).status).toBe('error');
  });

  it('names the file sortably, at second resolution, in local time', () => {
    const at = new Date(2026, 8, 19, 7, 4, 5);
    expect(hostDiagFileName(at)).toBe('woc-host-diag-20260919-070405.json');
    // Every component zero-padded, or the name stops sorting and stops parsing.
    expect(hostDiagFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      'woc-host-diag-20260102-030405.json',
    );
    expect(hostDiagFileName()).toMatch(/^woc-host-diag-\d{8}-\d{6}\.json$/);
  });
});

describe('runHostDiag (the IPC handler is wiring only)', () => {
  function runDeps(overrides: Record<string, unknown> = {}) {
    const showSaveDialog = vi.fn(() =>
      Promise.resolve({ canceled: false, filePath: 'C:\\Users\\player\\Documents\\diag.json' }),
    );
    const writeFileSync = vi.fn();
    const showItemInFolder = vi.fn();
    return {
      showSaveDialog,
      writeFileSync,
      showItemInFolder,
      deps: {
        platform: 'darwin' as const,
        app: { getVersion: () => '0.43.2', getPath: () => 'C:\\Users\\player\\Documents' },
        process: { platform: 'darwin', arch: 'arm64', versions: {} },
        os: { cpus: () => [], release: () => '24.0' },
        dialog: { showSaveDialog },
        shell: { showItemInFolder },
        writeFileSync,
        strings: DEFAULT_SHELL_STRINGS,
        game: { zone: 'Eastbrook' },
        now: () => 1_000,
        ...overrides,
      },
    };
  }

  it('saves the pretty-printed envelope and answers the BASE name only', async () => {
    const h = runDeps();
    const result = await runHostDiag(h.deps);
    expect(result).toMatchObject({
      status: 'saved',
      nativeStatus: 'unsupported-platform',
      fileName: 'diag.json',
    });
    expect(result.bytes).toBeGreaterThan(0);
    // Never the path: this value crosses to the renderer.
    expect(JSON.stringify(result)).not.toContain('Users');
    const [filePath, text] = h.writeFileSync.mock.calls[0] as unknown as [string, string];
    expect(filePath).toBe('C:\\Users\\player\\Documents\\diag.json');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "kind": "woc-host-diag"');
    expect(JSON.parse(text)).toMatchObject({ game: { zone: 'Eastbrook' } });
    // The dialog offers the documents folder and the localized labels the
    // renderer pushed; showItemInFolder reveals the file rather than opening it.
    const options = (
      h.showSaveDialog.mock.calls[0] as unknown as [unknown, Record<string, unknown>]
    )[1];
    expect(options.defaultPath).toBe(
      join('C:\\Users\\player\\Documents', hostDiagFileName(new Date(1_000))),
    );
    expect(options.title).toBe(DEFAULT_SHELL_STRINGS.hostDiagSaveTitle);
    expect(options.buttonLabel).toBe(DEFAULT_SHELL_STRINGS.hostDiagSaveButton);
    expect(options.filters).toEqual([
      { name: DEFAULT_SHELL_STRINGS.hostDiagFileType, extensions: ['json'] },
    ]);
    // createDirectory so the player can make a folder for the file they are
    // about to mail; showOverwriteConfirmation because the suggested name is
    // only second-resolution, so a save back onto an earlier report must ask.
    expect(options.properties).toEqual(['createDirectory', 'showOverwriteConfirmation']);
    expect(h.showItemInFolder).toHaveBeenCalledWith('C:\\Users\\player\\Documents\\diag.json');
  });

  it('degrades to the Electron half in the WRITTEN file when the script fails its hash', async () => {
    const spawn = vi.fn();
    const h = runDeps({
      platform: 'win32',
      spawn,
      readFileSync: () => Buffer.from('tampered'),
      sha256Hex: () => 'deadbeef',
    });
    const result = await runHostDiag(h.deps);
    expect(result).toMatchObject({ status: 'saved', nativeStatus: 'unavailable' });
    expect(spawn).not.toHaveBeenCalled();
    const written = JSON.parse((h.writeFileSync.mock.calls[0] as unknown as [string, string])[1]);
    expect(written.native).toMatchObject({ status: 'unavailable', reason: 'hash-mismatch' });
    // The Electron half is populated beside it, not an empty shell.
    expect(written.electron.appVersion).toBe('0.43.2');
  });

  it('writes nothing when the player cancels', async () => {
    const h = runDeps({
      dialog: { showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' }) },
    });
    await expect(runHostDiag(h.deps)).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.writeFileSync).not.toHaveBeenCalled();
    expect(h.showItemInFolder).not.toHaveBeenCalled();
  });

  it('answers error rather than throwing when the write or the dialog fails', async () => {
    const failedWrite = runDeps({
      writeFileSync: () => {
        throw new Error('EACCES');
      },
    });
    await expect(runHostDiag(failedWrite.deps)).resolves.toMatchObject({ status: 'error' });
    const failedDialog = runDeps({
      dialog: {
        showSaveDialog: () => {
          throw new Error('no window');
        },
      },
    });
    await expect(runHostDiag(failedDialog.deps)).resolves.toMatchObject({ status: 'error' });
  });

  it('single-flights: a second ask while one run is open answers busy', async () => {
    let release: (value: { canceled: boolean; filePath: string }) => void = () => {};
    const h = runDeps({
      dialog: {
        showSaveDialog: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
    });
    const first = runHostDiag(h.deps);
    // The dialog the player is looking at is still open: the second ask must not
    // stack another collection and another dialog behind it.
    await expect(runHostDiag(h.deps)).resolves.toEqual({
      status: 'busy',
      nativeStatus: null,
      durationMs: 0,
      bytes: 0,
    });
    release({ canceled: false, filePath: 'C:\\out\\diag.json' });
    await expect(first).resolves.toMatchObject({ status: 'saved' });
    // The guard releases: a later run works.
    await expect(runHostDiag(runDeps().deps)).resolves.toMatchObject({ status: 'saved' });
  });

  it('primes app.getAppMetrics() and reads it only AFTER the native half settles', async () => {
    // app.getAppMetrics() reports percentCPUUsage since the PREVIOUS call, so a
    // lone call always reads 0. That is the whole point of the priming call and
    // of deferring the real read: the figure that reaches the file must be the
    // app's average over the roughly 5 s collection, not a row of zeros.
    const native = harness();
    let nativeSettled = false;
    const readsAfterNative: boolean[] = [];
    // Call 1 is the prime (a fresh process reads 0); every later call reports a
    // real figure, exactly as Electron behaves.
    let calls = 0;
    const app = {
      getVersion: () => '0.43.2',
      getPath: () => 'C:\\out',
      getAppMetrics: () => {
        calls += 1;
        readsAfterNative.push(nativeSettled);
        return [
          {
            type: 'Browser',
            memory: { workingSetSize: 1_000 },
            cpu: { percentCPUUsage: calls === 1 ? 0 : 37.5 },
          },
        ];
      },
    };
    let written = '';
    const run = runHostDiag({
      ...native.deps,
      app,
      process: { platform: 'win32', arch: 'x64', versions: {} },
      os: { cpus: () => [], release: () => '10.0.26200' },
      dialog: {
        showSaveDialog: () => Promise.resolve({ canceled: false, filePath: 'C:\\out\\d.json' }),
      },
      shell: { showItemInFolder: () => {} },
      writeFileSync: (_path: string, text: string) => {
        written = text;
      },
      strings: DEFAULT_SHELL_STRINGS,
    });

    // The prime happened before either half was started, and nothing else has
    // asked yet: the Electron snapshot skipped the field.
    expect(calls, 'exactly one priming call, before the halves start').toBe(1);
    expect(readsAfterNative).toEqual([false]);

    // Settle the native half, which is the slow one.
    native.child.stdout.emit('data', Buffer.from(JSON.stringify(REPORT)));
    nativeSettled = true;
    native.child.emit('close', 0);
    await run;

    // The second (real) read came after the native half had settled.
    expect(calls).toBe(2);
    expect(readsAfterNative, 'the reading spans the whole collection').toEqual([false, true]);
    const report = JSON.parse(written) as {
      electron: { appMetrics: { processes: { cpuPercent: number }[] } };
    };
    expect(
      report.electron.appMetrics.processes[0]?.cpuPercent,
      'the primed figure, not the 0 a single call always yields',
    ).toBe(37.5);
  });
});

describe('the committed bundle verifies against the committed manifest (real bytes)', () => {
  const distDir = join(__dirname, '..', 'electron', 'host_diag', 'dist');

  it('the shipped HostDiag.ps1 passes the gate the shell runs before spawning it', () => {
    // No fakes: the real file, the real hash, the real manifest. A rebuild that
    // forgot to re-pin, or a hand-edited dist, would ship a diagnostic the shell
    // refuses to run, and only this assertion would notice before release.
    expect(verifyHostDiagScript(join(distDir, HOST_DIAG_MANIFEST.file))).toBe('ok');
    expect(HOST_DIAG_MANIFEST.file).toBe('HostDiag.ps1');
    expect(HOST_DIAG_MANIFEST.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('one changed byte is caught as a hash mismatch, not tolerated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-diag-tamper-'));
    try {
      const bytes = readFileSync(join(distDir, HOST_DIAG_MANIFEST.file));
      // One byte, deep inside the file: exactly the swap the check exists for,
      // since the .ps1 lives in a per-user-writable install directory.
      const tampered = Buffer.from(bytes);
      tampered[Math.floor(tampered.length / 2)] ^= 0x01;
      const tamperedPath = join(dir, HOST_DIAG_MANIFEST.file);
      writeFileSync(tamperedPath, tampered);
      expect(tampered.length).toBe(bytes.length);
      expect(verifyHostDiagScript(tamperedPath)).toBe('hash-mismatch');
      expect(basename(tamperedPath)).toBe('HostDiag.ps1');
      // And a missing file is the other arm, told apart from a swap.
      expect(verifyHostDiagScript(join(dir, 'absent.ps1'))).toBe('missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
