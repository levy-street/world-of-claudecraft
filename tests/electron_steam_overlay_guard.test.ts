import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  allowGpuUnderSteamOverlay,
  GPU_SANDBOX_SWITCH,
  OVERLAY_DETECTED_LOG,
  STEAM_OVERLAY_LIB,
  steamOverlayPreloaded,
} from '../electron/steam_overlay_guard.cjs';

const STEAM = '/home/deck/.local/share/Steam';
const O32 = `${STEAM}/ubuntu12_32/gameoverlayrenderer.so`;
const O64 = `${STEAM}/ubuntu12_64/gameoverlayrenderer.so`;
// Exactly what Steam sets, leading empty element and all.
const STEAM_PRELOAD = `:${O32}:${O64}`;

function fakeApp() {
  const switches: string[] = [];
  return { switches, app: { commandLine: { appendSwitch: (n: string) => switches.push(n) } } };
}

describe('the switch itself (a load-bearing literal)', () => {
  it('is the GPU sandbox switch, spelled the way Chromium spells it', () => {
    // Chromium matches switch names EXACTLY and silently ignores unknown ones, so a typo here
    // ships a build that still dies on SIGTRAP under Steam with nothing to show for it.
    expect(GPU_SANDBOX_SWITCH).toBe('disable-gpu-sandbox');
  });

  it('is NOT one of the broader relaxations that also worked', () => {
    // --no-sandbox and --in-process-gpu both fixed the crash on the Deck too. They are not what
    // ships: --no-sandbox drops the RENDERER sandbox, which is the boundary that actually
    // contains page content, and --in-process-gpu removes GPU process isolation entirely.
    expect(GPU_SANDBOX_SWITCH).not.toBe('no-sandbox');
    expect(GPU_SANDBOX_SWITCH).not.toBe('in-process-gpu');
  });

  it('pins the library name it looks for', () => {
    expect(STEAM_OVERLAY_LIB).toBe('gameoverlayrenderer.so');
  });
});

describe('steamOverlayPreloaded', () => {
  it('detects the value Steam actually sets', () => {
    expect(steamOverlayPreloaded({ LD_PRELOAD: STEAM_PRELOAD })).toBe(true);
  });

  it('detects either architecture on its own', () => {
    // Steam injects both copies; ld.so ignores the wrong-ELF-class one, so either may be the
    // one that matters and both must count.
    expect(steamOverlayPreloaded({ LD_PRELOAD: O32 })).toBe(true);
    expect(steamOverlayPreloaded({ LD_PRELOAD: O64 })).toBe(true);
  });

  it('splits on spaces as well as colons, which is what glibc accepts', () => {
    expect(steamOverlayPreloaded({ LD_PRELOAD: `/opt/mangohud.so ${O64}` })).toBe(true);
  });

  it('finds it among other preloads', () => {
    expect(steamOverlayPreloaded({ LD_PRELOAD: `/opt/mangohud.so:${O64}:/opt/gamemode.so` })).toBe(
      true,
    );
  });

  it('matches the BASENAME, not a substring of the path', () => {
    // The absolute prefix moves with the Steam install (~/.steam/steam, flatpak, Deck), so the
    // basename is the stable part; a directory that merely contains the name is not the library.
    expect(steamOverlayPreloaded({ LD_PRELOAD: '/opt/gameoverlayrenderer.so.d/other.so' })).toBe(
      false,
    );
    expect(steamOverlayPreloaded({ LD_PRELOAD: '/weird/prefix-gameoverlayrenderer.so' })).toBe(
      false,
    );
  });

  it.each([
    ['an unrelated preload', { LD_PRELOAD: '/opt/mangohud.so' }],
    ['an empty value', { LD_PRELOAD: '' }],
    ['only the empty element Steam prefixes', { LD_PRELOAD: ':' }],
    ['no LD_PRELOAD at all', {}],
  ])('is false for %s', (_label, env) => {
    expect(steamOverlayPreloaded(env as Record<string, string | undefined>)).toBe(false);
  });
});

describe('allowGpuUnderSteamOverlay', () => {
  it('appends the switch when Steam injected its overlay', () => {
    const f = fakeApp();
    const applied = allowGpuUnderSteamOverlay({
      platform: 'linux',
      env: { LD_PRELOAD: STEAM_PRELOAD },
      app: f.app,
    });

    expect(applied).toBe(true);
    expect(f.switches).toEqual(['disable-gpu-sandbox']);
  });

  it('leaves an ordinary launch completely alone', () => {
    // The whole point of gating it: a desktop launch keeps the full sandbox. An unconditional
    // relaxation would spend the security of every launch on the few that need it.
    const f = fakeApp();
    const applied = allowGpuUnderSteamOverlay({
      platform: 'linux',
      env: { LD_PRELOAD: '/opt/mangohud.so' },
      app: f.app,
    });

    expect(applied).toBe(false);
    expect(f.switches).toEqual([]);
  });

  it.each(['win32', 'darwin'])('is inert on %s, where Steam does not preload', (platform) => {
    const f = fakeApp();
    expect(
      allowGpuUnderSteamOverlay({ platform, env: { LD_PRELOAD: STEAM_PRELOAD }, app: f.app }),
    ).toBe(false);
    expect(f.switches).toEqual([]);
  });

  it('logs the exact token docs/desktop-release.md tells an operator to grep for', () => {
    // The doc names this string as the way to verify a Steam launch, which makes it a support
    // procedure rather than prose. Asserting only that log.info fired would let a reword break
    // the documented check with the suite still green.
    const log = { info: vi.fn(), warn: vi.fn() };
    allowGpuUnderSteamOverlay({
      platform: 'linux',
      env: { LD_PRELOAD: STEAM_PRELOAD },
      app: fakeApp().app,
      log,
    });
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining(OVERLAY_DETECTED_LOG),
      expect.anything(),
    );
    expect(OVERLAY_DETECTED_LOG).toBe('[steam] Steam overlay detected');
    const doc = readFileSync(new URL('../docs/desktop-release.md', import.meta.url), 'utf8');
    expect(doc).toContain(OVERLAY_DETECTED_LOG);
  });

  it('keeps the grep token OFF the failure path', () => {
    // The doc makes this string the operator's "the guard fired" check, so a warn line
    // containing it would match on the one launch where it did not fire: the same false-success
    // shape as the return value, moved one layer out.
    const log = { info: vi.fn(), warn: vi.fn() };
    allowGpuUnderSteamOverlay({
      platform: 'linux',
      env: { LD_PRELOAD: STEAM_PRELOAD },
      app: null,
      log,
    });

    expect(log.warn).toHaveBeenCalled();
    const warned = String(log.warn.mock.calls[0]?.[0] ?? '');
    expect(warned).not.toContain(OVERLAY_DETECTED_LOG);
  });

  it('never takes the app down if appending fails', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const app = {
      commandLine: {
        appendSwitch: () => {
          throw new Error('nope');
        },
      },
    };
    expect(() =>
      allowGpuUnderSteamOverlay({
        platform: 'linux',
        env: { LD_PRELOAD: STEAM_PRELOAD },
        app,
        log,
      }),
    ).not.toThrow();
    expect(log.warn).toHaveBeenCalled();
  });

  it.each([
    ['a missing app object', null],
    ['an app with no commandLine', {}],
    ['a commandLine with no appendSwitch', { commandLine: {} }],
    ['a non-function appendSwitch', { commandLine: { appendSwitch: 'nope' } }],
  ])('reports FALSE when nothing was appended (%s)', (_label, app) => {
    // Returning true here would log the operator's grep token on a launch where the switch
    // never landed, so the one signal telling them the guard fired would be wrong exactly when
    // it did not. The previous version of this test asserted only "does not throw", which
    // passes either way, and that is how the regression stayed unpinned.
    const log = { info: vi.fn(), warn: vi.fn() };
    const applied = allowGpuUnderSteamOverlay({
      platform: 'linux',
      env: { LD_PRELOAD: STEAM_PRELOAD },
      app: app as never,
      log,
    });

    expect(applied).toBe(false);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('main.cjs wiring', () => {
  const raw = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  // Comments stripped first: a commented-out call would otherwise satisfy every check below
  // while shipping a build that still dies under Steam.
  const main = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('calls it exactly once, at module top level', () => {
    expect(main.match(/allowGpuUnderSteamOverlay\(/g) ?? []).toHaveLength(1);
    expect(main).toMatch(/^allowGpuUnderSteamOverlay\(\{ app, log \}\);/m);
    expect(main).toContain("require('./steam_overlay_guard.cjs')");
  });

  it('runs BEFORE app ready, or Chromium never reads the switch', () => {
    // Chromium reads its command line when the GPU process is created. A switch appended after
    // app 'ready' is accepted by the API and silently ignored, which is the worst failure shape:
    // the code looks right and the crash persists.
    const call = main.indexOf('allowGpuUnderSteamOverlay({');
    const ready = main.indexOf('app.whenReady(');
    expect(call).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(-1);
    expect(call).toBeLessThan(ready);
  });

  it('sits beside the other Chromium switch work, after logging exists', () => {
    // It takes `log`, so it has to be after initLogging; grouping it with the GPU force keeps
    // both switch appenders in one place.
    expect(main.indexOf('initLogging(')).toBeLessThan(main.indexOf('allowGpuUnderSteamOverlay({'));
    expect(main.indexOf('forceHighPerformanceGpu({ app, log });')).toBeLessThan(
      main.indexOf('allowGpuUnderSteamOverlay({'),
    );
  });
});
