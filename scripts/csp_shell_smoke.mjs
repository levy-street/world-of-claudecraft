// CSP shell smoke: drive real offline world entry under the desktop shell's
// Content-Security-Policy in a real browser, without packaging an app.
//
// Why this exists: the desktop (Electron) shell is the only host that serves a CSP
// (server/http/middleware/security_headers.ts deliberately defers it), and only
// PACKAGED builds apply it: electron:dev loads the Vite server and never hits the
// app:// handler that attaches the header (electron/main.cjs registerAppProtocol).
// So a CSP that refuses a resource the game needs stays invisible to every dev
// loop and every CI suite, and only surfaces in a packed build: that is how the
// v0.39.0 desktop build hung at world entry (three's ZSTDDecoder boots its WASM
// via a fetch of a data:application/wasm URI that connect-src did not allow).
//
// How: intercept the dev server's DOCUMENT response and attach the real
// buildContentSecurityPolicy() output (inline-script hashes recomputed for the
// dev HTML, exactly what the packaged shell does for dist/index.html), then run
// enterOfflineGame and fail on any first-party CSP violation. Violations are
// collected two ways: the page's securitypolicyviolation ledger, and console
// "Refused ..." texts, which also surface violations raised inside workers
// (worker scopes never fire the page-level event). Third-party origins the CSP
// blocks by design (analytics beacon hosts) are warnings only. Known limits:
// the CSP is built against the dev origin, so the https/wss production arm of
// the connect-src is exercised by tests/electron_shell_guards.test.ts instead,
// and the unit-level source contract lives in tests/gltf_decoder_csp.test.ts.
//
// Needs: npm run dev (:5173). Usage: node scripts/csp_shell_smoke.mjs
// (GAME_URL= overrides the dev server URL).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';

const require = createRequire(import.meta.url);
const {
  buildContentSecurityPolicy,
  extractInlineScriptHashes,
} = require('../electron/shell_guards.cjs');

const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const gameUrl = new URL(GAME_URL);
const origin = gameUrl.origin;
const NEGATIVE_PROBE_HOST = 'csp-smoke-negative-probe.invalid';
const WORLD_SETTLE_MS = 6000;
const LATE_LOAD_DRAIN_MS = 2500;
const PROBE_TIMEOUT_MS = 4000;

let fail = 0;
function check(name, cond, extra = '') {
  if (!cond) fail += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` :: ${extra}` : ''}`);
}

try {
  await fetch(GAME_URL, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`dev server not reachable at ${GAME_URL}; start it with: npm run dev`);
  process.exit(1);
}

fs.mkdirSync('tmp', { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// Console-text refusal ledger: violations raised inside workers reach the page
// console but never the page's securitypolicyviolation event, and this ledger is
// live for the whole run (no sampling window). The refusal message embeds the full
// policy string, so classification must use the blocked URL it names, never the
// message body.
const consoleRefusals = [];
const REFUSED_URL = /(?:Connecting to|cannot load|Refused to (?:connect|load)[^']*)\s+'?([^'\s]+)/;
page.on('console', (m) => {
  const text = m.text();
  if (!/Refused|violates the following Content Security Policy/i.test(text)) return;
  const url = REFUSED_URL.exec(text)?.[1] ?? '';
  consoleRefusals.push({ directive: 'console', blocked: url.replace(/[.']+$/, '') });
});

// Event ledger, installed before any document script runs.
await page.evaluateOnNewDocument(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI });
  });
});

// Attach the real desktop CSP to the document response only: a document's CSP header
// governs everything the page loads, so per-asset interception is unnecessary. A
// document we cannot re-fetch is ABORTED, never continued headerless: failing open
// would make every later "no violations" verdict vacuous.
await page.setRequestInterception(true);
page.on('request', (req) => {
  void (async () => {
    const isDoc =
      req.resourceType() === 'document' &&
      (req.url() === origin || req.url().startsWith(`${origin}/`));
    if (!isDoc) {
      await req.continue().catch(() => {});
      return;
    }
    try {
      const upstream = await fetch(req.url());
      const body = Buffer.from(await upstream.arrayBuffer());
      const csp = buildContentSecurityPolicy({
        apiOrigin: origin,
        scriptHashes: extractInlineScriptHashes(body.toString('utf8')),
      });
      await req.respond({
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'text/html',
          'content-security-policy': csp,
        },
        body,
      });
    } catch (err) {
      console.error('document interception failed, aborting the navigation (fail closed):', err);
      await req.abort().catch(() => {});
    }
  })();
});

await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 60000 });

// Sanity: the CSP must actually be attached and enforced, or every later "no
// violations" verdict is vacuous. The listener matches the probe's own host so a
// concurrent unrelated violation cannot satisfy (or spuriously fail) this check.
const enforcement = await page.evaluate(
  (host, timeoutMs) =>
    new Promise((res) => {
      const on = (e) => {
        if (!String(e.blockedURI).includes(host)) return;
        document.removeEventListener('securitypolicyviolation', on);
        res(e.effectiveDirective);
      };
      document.addEventListener('securitypolicyviolation', on);
      fetch(`https://${host}/`).catch(() => {});
      setTimeout(() => res(null), timeoutMs);
    }),
  NEGATIVE_PROBE_HOST,
  PROBE_TIMEOUT_MS,
);
check(
  'CSP attached and enforced (negative probe refused)',
  enforcement === 'connect-src',
  String(enforcement),
);

const booted = await enterOfflineGame(page, { settleMs: WORLD_SETTLE_MS });
check('offline world entry under the desktop CSP', booted);
await page.screenshot({ path: 'tmp/csp_smoke_world.png' });

// Direct probe of the exact ZSTDDecoder.init() bootstrap sequence.
const probe = await page.evaluate(async () => {
  try {
    const buf = await fetch('data:application/wasm;base64,AGFzbQEAAAA=').then((r) =>
      r.arrayBuffer(),
    );
    const mod = await WebAssembly.instantiate(buf, {});
    return { ok: true, bytes: buf.byteLength, instantiated: Boolean(mod.instance) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
check(
  'zstd decoder bootstrap (fetch data: wasm, then instantiate)',
  probe.ok === true && probe.bytes === 8 && probe.instantiated === true,
  JSON.stringify(probe),
);

// Drain late async loads (textures still streaming past the settle) before the final
// ledger read, then classify. First-party (failures): app resources on the dev origin,
// data:/blob: URIs, ws targets, and the URI-less script violations ('inline', 'eval',
// 'wasm-eval', empty). Vite's own HMR websocket (ws://<dev host>...?token=...) is
// dev-harness tooling with no packaged-shell counterpart, so a block on it is noise.
await new Promise((r) => setTimeout(r, LATE_LOAD_DRAIN_MS));
const eventViolations = await page.evaluate(() => window.__cspViolations ?? []);
const violations = [...eventViolations, ...consoleRefusals].filter(
  (v) => !v.blocked.includes(NEGATIVE_PROBE_HOST),
);
const isViteHmrSocket = (v) => {
  if (!v.blocked.startsWith('ws') || !v.blocked.includes('?token=')) return false;
  try {
    return new URL(v.blocked).hostname === gameUrl.hostname;
  } catch {
    return false;
  }
};
const isFirstParty = (v) =>
  !isViteHmrSocket(v) &&
  (v.blocked === '' ||
    v.blocked === 'inline' ||
    v.blocked === 'eval' ||
    v.blocked === 'wasm-eval' ||
    v.blocked.startsWith('data') ||
    v.blocked.startsWith('blob') ||
    v.blocked.startsWith('ws') ||
    v.blocked === origin ||
    v.blocked.startsWith(`${origin}/`));
const fatal = violations.filter(isFirstParty);
for (const w of violations.filter((v) => !isFirstParty(v))) {
  console.log(`WARN third-party blocked by CSP (by design): ${w.directive} ${w.blocked}`);
}
check(
  'no first-party CSP violations through world entry',
  fatal.length === 0,
  JSON.stringify(fatal.slice(0, 3)),
);
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

await browser.close();
console.log(fail > 0 ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(fail > 0 ? 1 : 0);
