// Guard: every client REST call resolves through `apiUrl()`, never a bare
// root-relative '/api/...'.
//
// Why this is a guard and not a style note. The desktop shell serves the page
// from `app://worldofclaudecraft` and its scheme handler falls back to
// index.html for any path it does not recognise (electron/main.cjs). A bare
// `fetch('/api/perf-report')` therefore resolved against THAT origin and came
// back 200 with the homepage HTML, so the beacon never left the application.
// `res.ok` was true, so the reporter counted a success and drained its retained
// worst-10s window: the evidence was destroyed rather than retried, and no
// desktop session had ever reached the perf telemetry (found 2026-09-12 on an
// Electron 43 client, against a fleet whose Linux rows were therefore all
// browsers). The same shape silently emptied the Arena and Battleground
// all-time ladders in the client, where `r.json()` threw on the HTML into a
// catch written for "offline or no server".
//
// THE URL IS THE ONLY LINE OF DEFENCE, deliberately. A 200 carrying
// `text/html` still counts as a delivered report in
// src/game/perf_reporter.ts, and `r.ok ? r.json() : null` still absorbs one in
// src/ui/arena_window.ts. Hardening those was considered and declined, so do
// not read this guard as closing the silent-success class: it closes exactly
// the misroute that triggered it.
//
// `apiUrl()` (src/client_origin.ts) prefixes the configured origin in the shell
// and the native WebViews and returns the path unchanged in a browser, which is
// what the resolution cases at the bottom pin, arm by arm.
//
// src/admin is the one exemption, by rule rather than by oversight: the admin
// dashboard is a separate entry served from the site origin itself, never from
// app://, and src/admin/CLAUDE.md forbids any relative import resolving outside
// that directory, so it cannot reach apiUrl at all. The exemption is asserted
// to still be load-bearing, so it has to be re-justified the day it stops being.
//
// Known limit: the sweep matches the LITERAL shape, which is the shape that
// shipped. A path assembled into a variable first is invisible to it, and has
// two live instances: src/net/online.ts (`${this.base}/api/card`), correct
// because `base` is already origin-resolved, and src/editor/net.ts, which is
// genuinely bare but clean by REACHABILITY, editor.html having no link from the
// game or the shell. Both would need a real defect to become one.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeApiOrigin } from '../src/runtime';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** The one exempt subtree, relative to SRC_ROOT. See the header. */
const EXEMPT_DIR = 'admin/';

/**
 * A request minted straight onto a root-relative /api path, in any quote
 * spelling. The whole request-mint family, not just `fetch`: `sendBeacon` is
 * the idiomatic replacement for a page-hide beacon and would reintroduce this
 * exact defect in this exact module. Trailing `(?![\w-])` so `/api?x=1` and
 * `/api'` count too, while `/apiary/...` does not.
 */
const BARE_API_REQUEST = /(?:fetch|sendBeacon|EventSource|new Request)\(\s*['"`]\/api(?![\w-])/;

/** The call sites this guard was written for, each with the text it must carry. */
const PINNED_CALLS: ReadonlyArray<readonly [string, string]> = [
  ['game/perf_reporter.ts', "apiUrl('/api/perf-report')"],
  ['site_presence.ts', "apiUrl('/api/site-presence')"],
  ['ui/arena_window.ts', 'apiUrl(`/api/arena/leaderboard?format='],
  ['ui/arena_window.ts', "apiUrl('/api/battleground/leaderboard')"],
];

/** The shell's real user agent, as the packaged client reports it. */
const SHELL_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) world-of-claudecraft/0.42.2 Chrome/150.0.7871.212 Electron/43.3.0 Safari/537.36';
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/**
 * Every build flag the origin policy reads, blanked. Stubbed on EVERY arm
 * rather than only where an arm needs a value: vitest populates
 * `import.meta.env` through Vite's .env loading, and pointing
 * VITE_DESKTOP_API_ORIGIN at a local server is a documented workflow, so an
 * unstubbed arm would pass or fail depending on the developer's own .env.
 */
const BLANK_BUILD_ENV: Readonly<Record<string, string>> = {
  VITE_DESKTOP_API_ORIGIN: '',
  VITE_API_ORIGIN: '',
  VITE_DESKTOP_RELATIVE_API: '',
  VITE_DESKTOP_APP: '',
  VITE_NATIVE_APP: '',
};

/**
 * `apiUrl` as a given build and host would resolve it. Re-imported per arm
 * because src/client_origin.ts captures DESKTOP_APP and DESKTOP_API_ORIGIN at
 * module evaluation, so the navigator and the env must be in place first.
 */
async function apiUrlFor(
  userAgent: string,
  env: Readonly<Record<string, string>> = {},
): Promise<(path: string, base?: string) => string> {
  for (const [name, value] of Object.entries({ ...BLANK_BUILD_ENV, ...env })) {
    vi.stubEnv(name, value);
  }
  vi.stubGlobal('navigator', { userAgent });
  vi.resetModules();
  return (await import('../src/client_origin')).apiUrl;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('client REST calls resolve through apiUrl', () => {
  it('reads src through the shared walker, recursively', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    const files = tsFilesUnder(SRC_ROOT).map((source) => source.file);
    // src is genuinely deep, so the recursion is provable against the real
    // tree: a single-level read would see none of these. net/ is the third
    // anchor on purpose, being the client REST layer this guard polices and
    // the subtree the floor's slack would otherwise be wide enough to hide.
    expect(files).toContain('render/characters/halo.ts');
    expect(files).toContain('sim/content/deeds.ts');
    expect(files).toContain('net/online.ts');
    expect(files.length).toBeGreaterThan(2800);
  });

  it('matches the shape that shipped and not the fixed one', () => {
    // The positive control. Without it the sweep below would pass vacuously
    // forever the day the pattern is narrowed or mistyped.
    expect(BARE_API_REQUEST.test("void fetch('/api/perf-report', { method: 'POST' })")).toBe(true);
    expect(BARE_API_REQUEST.test('fetch(`/api/arena/leaderboard?format=${f}`)')).toBe(true);
    expect(BARE_API_REQUEST.test("navigator.sendBeacon('/api/perf-report', body)")).toBe(true);
    expect(BARE_API_REQUEST.test("fetch(apiUrl('/api/perf-report'))")).toBe(false);
    expect(BARE_API_REQUEST.test("fetch('/apiary/bees')")).toBe(false);
  });

  it('has no bare root-relative /api request outside src/admin', () => {
    const offenders = tsFilesUnder(SRC_ROOT)
      .filter((source) => !source.file.startsWith(EXEMPT_DIR))
      .filter((source) => BARE_API_REQUEST.test(stripComments(readFileSync(source.full, 'utf8'))))
      .map((source) => source.file);
    expect(
      offenders,
      "a bare fetch('/api/...') resolves against app://worldofclaudecraft in the desktop shell and silently returns index.html: route it through apiUrl() from src/client_origin.ts",
    ).toEqual([]);
  });

  it('keeps the admin exemption load-bearing', () => {
    const exempt = tsFilesUnder(SRC_ROOT)
      .filter((source) => source.file.startsWith(EXEMPT_DIR))
      .filter((source) => BARE_API_REQUEST.test(stripComments(readFileSync(source.full, 'utf8'))))
      .map((source) => source.file);
    expect(
      exempt,
      'the admin exemption no longer excuses anything: re-justify it against src/admin/CLAUDE.md or drop it',
    ).toContain('admin/site_presence.ts');
  });

  it('pins every call site the fix touched', () => {
    // Guards the it.each below against a row being quietly deleted, which
    // would narrow the pin with no signal at all.
    expect(PINNED_CALLS).toHaveLength(4);
  });

  it.each(PINNED_CALLS)('%s sends %s through apiUrl', (file, call) => {
    // Through stripComments, or a stale comment quoting the fixed call would
    // satisfy the pin over reverted code.
    expect(stripComments(readFileSync(join(SRC_ROOT, file), 'utf8'))).toContain(call);
  });
});

describe('apiUrl resolution per host', () => {
  it('leaves a browser build relative', async () => {
    const apiUrl = await apiUrlFor(BROWSER_USER_AGENT);
    expect(apiUrl('/api/perf-report')).toBe('/api/perf-report');
  });

  it('resolves the packaged shell to the compiled-in production origin', async () => {
    const apiUrl = await apiUrlFor(SHELL_USER_AGENT);
    expect(apiUrl('/api/perf-report')).toBe('https://worldofclaudecraft.com/api/perf-report');
  });

  it('resolves the shell to a configured origin when the build sets one', async () => {
    const apiUrl = await apiUrlFor(SHELL_USER_AGENT, {
      VITE_DESKTOP_API_ORIGIN: 'http://127.0.0.1:9876',
    });
    expect(apiUrl('/api/site-presence')).toBe('http://127.0.0.1:9876/api/site-presence');
  });

  it('resolves a native WebView build to its configured API origin', async () => {
    const apiUrl = await apiUrlFor(BROWSER_USER_AGENT, {
      VITE_API_ORIGIN: 'https://api.example.test',
    });
    expect(apiUrl('/api/battleground/leaderboard')).toBe(
      'https://api.example.test/api/battleground/leaderboard',
    );
  });

  it('prefers the native origin over the desktop one', async () => {
    const apiUrl = await apiUrlFor(SHELL_USER_AGENT, {
      VITE_API_ORIGIN: 'https://api.example.test',
    });
    expect(apiUrl('/api/perf-report')).toBe('https://api.example.test/api/perf-report');
  });

  it('stays relative in an electron dev run', async () => {
    const apiUrl = await apiUrlFor(SHELL_USER_AGENT, { VITE_DESKTOP_RELATIVE_API: '1' });
    expect(apiUrl('/api/perf-report')).toBe('/api/perf-report');
  });

  it('resolves the origin from the user agent, not from the call site', () => {
    // src/runtime.ts's own contract, which tests/runtime.test.ts does not
    // cover. One level above apiUrl: it decides WHETHER to prefix, never where.
    for (const [name, value] of Object.entries(BLANK_BUILD_ENV)) vi.stubEnv(name, value);
    expect(runtimeApiOrigin(SHELL_USER_AGENT)).toBe('https://worldofclaudecraft.com');
    expect(runtimeApiOrigin(BROWSER_USER_AGENT)).toBe('');
  });
});
