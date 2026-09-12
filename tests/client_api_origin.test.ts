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
// `apiUrl()` (src/client_origin.ts) prefixes the configured origin in the shell
// and returns the path unchanged in a browser, so the browser arm is untouched.
//
// src/admin is the one exemption, by rule rather than by oversight: the admin
// dashboard is a separate entry served from the site origin itself, never from
// app://, and src/admin/CLAUDE.md forbids any relative import resolving outside
// that directory, so it cannot reach apiUrl at all.
//
// Known limit: the sweep matches the LITERAL shape, which is the shape that
// shipped. A path assembled into a variable first is not caught; the pins below
// cover the four call sites this was written for.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runtimeApiOrigin } from '../src/runtime';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

/** The one exempt subtree, relative to SRC_ROOT. See the header. */
const EXEMPT_DIR = 'admin/';

/** `fetch()` handed a root-relative /api path directly, in any quote spelling. */
const BARE_API_FETCH = /fetch\(\s*['"`]\/api\//;

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

describe('client REST calls resolve through apiUrl', () => {
  it('reads src through the shared walker, recursively', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    const files = tsFilesUnder(SRC_ROOT).map((source) => source.file);
    // src is genuinely deep, so the recursion is provable against the real
    // tree: a single-level read would see neither of these.
    expect(files).toContain('render/characters/halo.ts');
    expect(files).toContain('sim/content/deeds.ts');
    expect(files.length).toBeGreaterThan(2700);
  });

  it('has no bare root-relative /api fetch outside src/admin', () => {
    const offenders = tsFilesUnder(SRC_ROOT)
      .filter((source) => !source.file.startsWith(EXEMPT_DIR))
      .filter((source) => BARE_API_FETCH.test(stripComments(readFileSync(source.full, 'utf8'))))
      .map((source) => source.file);
    expect(
      offenders,
      "a bare fetch('/api/...') resolves against app://worldofclaudecraft in the desktop shell and silently returns index.html: route it through apiUrl() from src/client_origin.ts",
    ).toEqual([]);
  });

  it.each(PINNED_CALLS)('%s sends %s through apiUrl', (file, call) => {
    expect(readFileSync(join(SRC_ROOT, file), 'utf8')).toContain(call);
  });

  it('resolves an absolute origin in the shell and stays relative in a browser', () => {
    expect(runtimeApiOrigin(SHELL_USER_AGENT)).toBe('https://worldofclaudecraft.com');
    expect(runtimeApiOrigin(BROWSER_USER_AGENT)).toBe('');
  });
});
