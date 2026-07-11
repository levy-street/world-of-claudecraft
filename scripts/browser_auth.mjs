// browser_auth.mjs — Cloudflare + Turnstile aware login bootstrap for multibox fleets.
// 
// When the live server has TURNSTILE_SECRET + a built client with VITE_TURNSTILE_SITEKEY,
// direct Node /api/login calls (the normal multibox path) are rejected with
// "verification failed, please try again".
//
// This script launches a *real* browser (puppeteer-core against your local Chrome/Edge),
// navigates to the game, waits out any outer Cloudflare challenges ("Just a moment..."),
// lets the in-page Turnstile widget do its thing (or lets you interact if it presents a
// visible challenge), fills the login form for the requested accounts, submits via the
// real client JS (so the turnstileToken is included), and captures the resulting game
// bearer tokens from the /api/login responses.
//
// Those tokens are what the WS layer actually uses. Once you have them you can feed them
// to a normal multibox run (see below) without ever calling password login again.
//
// Usage examples:
//   # e.g. the hunter (ryze2) — passwords from env or inline if you pass them
//   RYZE2_PASS=... node scripts/browser_auth.mjs
//
//   # Full fleet from a multibox config (recommended for ryze* etc.)
//   node scripts/browser_auth.mjs scripts/multibox.ryzeduo.json
//
//   # Or the spine (it will find the account list but you usually want a thin party file)
//   node scripts/browser_auth.mjs scripts/multibox.world.json
//
//   # Headed is default (you can watch/solve stubborn CF or Turnstile challenges).
//   # For fully automatic in a clean profile:
//   HEADLESS=1 node scripts/browser_auth.mjs scripts/multibox.duo.json
//
// Output: prints copy-pastable exports + writes ./multibox.tokens.json (gitignored in spirit).
// Then run your multibox with the tokens in the environment:
//   RYZE2_TOKEN=... node scripts/multibox.mjs scripts/multibox.ryzehunts.json
// (multibox.mjs understands *_TOKEN / WOC_TOKEN_* envs and will skip the password login step.)
//
// This is intended for the project owner / authorized multibox operator for adversarial
// testing and keeping the fleet running after the Turnstile gate was added. It is not a
// general bypass tool.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { resolve } from 'node:path';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';
import { loadConfig } from './multibox_config.mjs';

// load .env so account passwords (RYZE*_PASS) resolve
try { process.loadEnvFile(); } catch {}

const GAME_URL = process.env.GAME_URL ?? 'https://worldofclaudecraft.com';
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const OUT_TOKENS_FILE = 'multibox.tokens.json';

// Optional persistent Chrome profile dir. Point this at a profile where you have
// already successfully logged in (e.g. the ryze accounts). This re-uses
// cf_clearance, __cf_bm and other cookies + local browser signals, which dramatically
// improves the odds that Turnstile renders non-interactively (or with minimal friction).
// macOS example: ~/Library/Application Support/Google/Chrome/Default
// or a specific Profile 1 etc. Use a *copy* if you want to avoid polluting your daily driver.
const USER_DATA_DIR = process.env.USER_DATA_DIR || process.env.CHROME_PROFILE || process.env.PROFILE_DIR || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function passwordFor(cfg, user) {
  const a = cfg.accounts?.[user];
  if (typeof a === 'string') return a;
  if (a?.passEnv) return process.env[a.passEnv] ?? '';
  if (a?.pass) return a.pass;
  // Fallback: try common env names
  const envGuess = process.env[`${user.toUpperCase()}_PASS`] || process.env[`${user.toUpperCase()}_PASSWORD`];
  if (envGuess) return envGuess;
  return '';
}

async function waitForCloudflareClear(page, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let title = '';
    let html = '';
    try { title = await page.title(); } catch {}
    try { html = await page.content(); } catch {}
    const blob = (title + ' ' + html).toLowerCase();
    // Stricter match for common CF challenge pages (avoid false positive on normal content)
    const looksLikeCF =
      /attention required|just a moment|checking your browser|cf-browser-verification|challenge-platform|verify you are human/i.test(blob);
    if (!looksLikeCF) return true;

    // Light human-like activity to help simple JS challenges
    try {
      await page.mouse.move(120 + Math.random() * 300, 180 + Math.random() * 200);
      if (Math.random() < 0.4) await page.mouse.wheel({ deltaY: 40 + Math.random() * 60 });
    } catch {}
    await sleep(800 + Math.random() * 700);
  }
  return false;
}

// Wait for the login panel to be active (client JS shows it) and for ensureTurnstile()
// to have called render(), injecting the challenges.cloudflare.com iframe + computation.
async function waitForLoginPanelAndTurnstile(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const hasUser = !!document.querySelector('#login-user');
      const hasPass = !!document.querySelector('#login-pass');
      const container = document.getElementById('cf-turnstile-container');
      const hasIframe = !!(container && container.querySelector('iframe'));
      const ts = (window).turnstile;
      const widgetReady = !!(ts && container);
      return { hasUser, hasPass, hasIframe, widgetReady, containerChildren: container ? container.children.length : 0 };
    }).catch(() => ({}));

    if (state.hasUser && state.hasPass && (state.hasIframe || state.containerChildren > 0 || state.widgetReady)) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

// Actively wait (poll) for the Turnstile widget to have produced a response token.
// For invisible / non-interactive modes (common with good browser signals + persistent profile)
// this will return the token as soon as the widget finishes its internal work.
// In headed mode, if a visible challenge appears you can solve it and this will detect the result.
async function waitForTurnstileSolved(page, timeoutMs = 18000) {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    const resp = await page.evaluate(() => {
      try {
        const ts = (window).turnstile;
        const container = document.getElementById('cf-turnstile-container');
        if (!ts || !container) return '';
        // The client code stores the widgetId in its closure; we can also just ask for any response.
        // getResponse() without arg often works, or we try the known container.
        const direct = ts.getResponse ? ts.getResponse() : '';
        if (direct) return direct;
        // Fallback: look for hidden input that some Turnstile setups populate.
        const input = container.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : '';
      } catch { return ''; }
    }).catch(() => '');

    if (resp && typeof resp === 'string' && resp.length > 10) {
      return resp;
    }

    const now = Date.now();
    if (now - lastLog > 2500) {
      // Light interaction while waiting — helps some scoring and keeps the "human" signal fresh.
      try {
        await page.mouse.move(400 + Math.random() * 180, 420 + Math.random() * 80);
      } catch {}
      lastLog = now;
    }
    await sleep(220 + Math.random() * 180);
  }
  return '';
}

async function captureLoginToken(page, user, timeoutMs = 20000) {
  let token = null;
  const handler = async (resp) => {
    try {
      if (resp.url().includes('/api/login') && resp.status() === 200) {
        const data = await resp.json().catch(() => ({}));
        if (data && typeof data.token === 'string' && data.token.length > 20) {
          token = data.token;
        }
      }
    } catch {}
  };
  page.on('response', handler);

  const start = Date.now();
  while (!token && Date.now() - start < timeoutMs) {
    await sleep(120);
  }
  page.off('response', handler);
  return token;
}

async function waitForGameToken(page, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tok = await page.evaluate(() => {
        const w = window;
        if (w.api && typeof w.api.token === 'string' && w.api.token.length > 20) return w.api.token;
        if (w.__game && w.__game.online && typeof w.__game.online.token === 'string' && w.__game.online.token.length > 20) return w.__game.online.token;
        // If charselect panel is visible, the login succeeded and token is set on the api
        const cs = document.getElementById('charselect-panel');
        if (cs && cs.style.display !== 'none') {
          if (w.api && w.api.token) return w.api.token;
        }
        return '';
      });
      if (tok && tok.length > 20) return tok;
    } catch {}
    await sleep(800);
  }
  return '';
}

async function loginOneAccount(browser, user, password, label) {
  if (!password) throw new Error(`no password available for ${user} (set ${user.toUpperCase()}_PASS or use a config with passEnv)`);

  // Use createBrowserContext (modern Puppeteer API; the old createIncognitoBrowserContext was removed).
  // When USER_DATA_DIR is provided at launch, the browser instance uses the persistent profile,
  // which helps with CF clearance cookies and Turnstile risk scoring even for new contexts.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();

  // Realistic UA + headers help both outer CF and Turnstile risk scoring
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  });

  // Stealth: reduce automation signals for Turnstile and CF (applied per page)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // @ts-expect-error
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  const step = (s) => console.log(`  [${label}] ${s}`);

  try {
    step(`goto ${GAME_URL}`);
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(600);

    const cleared = await waitForCloudflareClear(page);
    if (!cleared) {
      step('WARNING: still seeing possible Cloudflare interstitial after wait — proceeding anyway (you may need to solve manually in headed mode)');
    } else {
      step('passed outer CF (or none present)');
    }

    // Make sure we are on the hero/login surface. The client shows #btn-online for the realm picker.
    // Click it if present, then the login panel should appear.
    try {
      await page.waitForSelector('#btn-online, #login-user, #login-pass', { timeout: 8000 });
    } catch {}

    // Click "Play Online" to surface the login panel (this is when the client calls ensureTurnstile and the challenge can fire).
    const needOnline = await page.$('#btn-online');
    if (needOnline) {
      await page.evaluate(() => {
        const b = document.querySelector('#btn-online');
        if (b) b.click();
      });
      await sleep(400);
    }

    // Wait for the client to show the actual login panel (so its Turnstile logic runs).
    await page.waitForFunction(() => {
      const panel = document.getElementById('login-panel');
      if (!panel) return false;
      const style = window.getComputedStyle(panel);
      return style.display !== 'none' && !panel.hidden;
    }, { timeout: 15000 }).catch(() => {});

    await page.waitForSelector('#login-user', { timeout: 10000 });
    await page.waitForSelector('#login-pass', { timeout: 5000 });

    await page.screenshot({ path: `tmp/auth_${label}_pre_fill.png` }).catch(() => {});

    step('form visible — filling credentials (human-like) so the Turnstile challenge can fire on the real client');
    try {
      await page.mouse.move(520 + Math.random() * 40, 480 + Math.random() * 30);
      await sleep(60 + Math.random() * 50);
    } catch {}
    await page.evaluate((u, p) => {
      const uel = document.querySelector('#login-user');
      const pel = document.querySelector('#login-pass');
      if (uel) { uel.value = u; uel.dispatchEvent(new Event('input', { bubbles: true })); }
      if (pel) { pel.value = p; pel.dispatchEvent(new Event('input', { bubbles: true })); }
    }, user, password);
    await sleep(100);

    await page.screenshot({ path: `tmp/auth_${label}_pre_challenge.png` }).catch(() => {});

    // Extract sitekey (public) from the served client bundle / HTML for manual render if needed.
    const sitekey = await page.evaluate(() => {
      const html = document.documentElement.outerHTML + ' ' + Array.from(document.scripts).map(s => s.textContent || '').join(' ');
      let m = html.match(/VITE_TURNSTILE_SITEKEY["']?\s*[:=]\s*["']([0-9a-zA-Z_-]{15,})["']/i);
      if (m && m[1]) return m[1];
      m = html.match(/["'](0x[0-9A-Za-z_-]{20,})["']/);
      return m ? m[1] : '';
    });

    // Force the Turnstile widget to render in the container using the real browser context.
    // This makes the challenge "fire" (visible UI or invisible computation) so we can get a token.
    if (sitekey) {
      await page.evaluate((key) => {
        const el = document.getElementById('cf-turnstile-container');
        const ts = (window).turnstile;
        if (el && ts && key) {
          try {
            el.innerHTML = '';
            (window).__cfWidgetId = ts.render(el, { sitekey: key, theme: 'light' });
          } catch (e) {}
        }
      }, sitekey);
      step(`Turnstile widget forced with sitekey (challenge should fire now in the window)`);
    }

    // Set up network capture (backup for the game token the client would receive).
    const tokenPromise = captureLoginToken(page, user, 180000);

    step('*** Headed Chrome window is open on your desktop ***');
    step('The Turnstile challenge is firing / rendered in the real browser window.');
    step('If it shows a visible challenge (checkbox, images, "verify you are human"), solve it in the Chrome window now.');
    step('The script will poll for the widget response (tsToken), then force the /api/login POST with it from the page context (so the token is passed even if client timing is picky).');
    step('Waiting up to ~60s for widget to produce token (auto or after your solve in window)...');

    // Poll for a tsToken from the widget we rendered (or the client rendered).
    // Active mouse activity helps some scoring.
    let tsToken = '';
    const pollStart = Date.now();
    while (!tsToken && (Date.now() - pollStart) < 60000) {
      tsToken = await page.evaluate(() => {
        try {
          const ts = (window).turnstile;
          const wid = (window).__cfWidgetId;
          let r = '';
          if (ts) {
            r = ts.getResponse ? (ts.getResponse(wid) || ts.getResponse() || '') : '';
          }
          if (!r) {
            const inp = document.querySelector('#cf-turnstile-container input[name*="turnstile"]');
            if (inp) r = inp.value || '';
          }
          return r;
        } catch { return ''; }
      }) || '';
      if (!tsToken) {
        try {
          await page.mouse.move(300 + Math.random()*200, 400 + Math.random()*100);
        } catch {}
        await sleep(400 + Math.random() * 300);
      }
    }

    if (tsToken) {
      step(`Got tsToken from widget (${tsToken.slice(0,8)}...). Forcing /api/login with it from page context...`);
      await page.screenshot({ path: `tmp/auth_${label}_pre_direct_login.png` }).catch(() => {});

      // Direct fetch from the *page* (real cookies, origin, user-agent, and now with our tsToken).
      // This "passes the token".
      const loginRes = await page.evaluate(async (u, p, t) => {
        const r = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p, turnstileToken: t }),
          credentials: 'include'
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
      }, user, password, tsToken);

      if (loginRes.status === 200 && loginRes.body && loginRes.body.token) {
        step(`SUCCESS — game token captured (${loginRes.body.token.slice(0, 8)}...)`);
        return loginRes.body.token;
      } else {
        const err = (loginRes.body && loginRes.body.error) || `HTTP ${loginRes.status}`;
        throw new Error(`direct login with tsToken failed for ${user}: ${err}`);
      }
    }

    // Fallback: if we still have no tsToken (e.g. heavy challenge), let the user finish in window and let client submit.
    step('No tsToken yet from widget. If headed, solve the challenge in the Chrome window now, then the client can submit.');
    step('Waiting for network /api/login success (client-driven)...');
    const token = await tokenPromise;
    if (token) {
      step(`SUCCESS — game token captured via client (${token.slice(0, 8)}...)`);
      return token;
    }

    throw new Error(`failed to obtain token for ${user}. Challenge may still be visible in the Chrome window — solve it and try re-running the script, or login manually in your browser and grab the token from the /api/login response in DevTools.`);
  } finally {
    try { await page.close(); } catch {}
    try { await context.close(); } catch {}
  }
}

async function main() {
  const arg = process.argv[2] ?? '';
  let users = [];
  let cfg = {};

  if (arg && arg.endsWith('.json')) {
    const cfgPath = resolve(arg);
    console.log(`loading accounts from ${cfgPath}`);
    cfg = loadConfig(cfgPath);
    const specs = (cfg.bots ?? []);
    users = [...new Set(specs.map((s) => s.user))];
    if (!users.length && cfg.accounts) {
      users = Object.keys(cfg.accounts);
    }
  } else {
    // Convenience: default to the surviving hunter account; pass any CLI list to override.
    const cliUsers = arg ? arg.split(/[,\s]+/).filter(Boolean) : [];
    users = cliUsers.length ? cliUsers : ['ryze2'];
    // Try to load the duo example if it exists for account metadata, but don't fail.
    try {
      cfg = loadConfig(resolve('scripts/multibox.duo.json'));
    } catch {
      try { cfg = loadConfig(resolve('scripts/multibox.world.json')); } catch {}
    }
  }

  if (!users.length) {
    console.error('no users to log in. Pass a multibox.*.json or a space/comma list of usernames.');
    process.exit(1);
  }

  console.log(`browser_auth: target=${GAME_URL} headed=${!HEADLESS} users=${users.join(', ')}`);

  fs.mkdirSync('tmp', { recursive: true });

  const launchOptions = {
    executablePath: EDGE,
    headless: HEADLESS ? 'new' : false,
    protocolTimeout: 120000,
    args: [
      '--window-size=1280,800',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      // --no-sandbox and disable-setuid-sandbox are required for the browser to launch
      // successfully in many environments (Linux containers, some macOS setups, CI, etc.)
      // without crashing on sandbox initialization. The working "nosandbox" version the
      // user has confirms this (see the banner in the provided screenshot). These do not
      // affect Turnstile/CF signals significantly when combined with other stealth
      // measures and a real profile.
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Avoid obvious automation flags that hurt Turnstile/CF scoring.
    ],
    defaultViewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  };
  if (USER_DATA_DIR) {
    launchOptions.userDataDir = USER_DATA_DIR;
    console.log(`[browser_auth] using persistent profile: ${USER_DATA_DIR}`);
  }
  const browser = await puppeteer.launch(launchOptions);

  const results = {};
  let anyFail = false;

  for (const user of users) {
    const pass = passwordFor(cfg, user);
    const label = user;
    console.log(`\n=== ${label} ===`);
    try {
      const tok = await loginOneAccount(browser, user, pass, label);
      results[user] = tok;
    } catch (e) {
      console.error(`  [${label}] FAILED: ${e.message}`);
      anyFail = true;
    }
    await sleep(400);
  }

  await browser.close();

  if (Object.keys(results).length === 0) {
    console.error('\nNo tokens captured. See errors above. (Run headed without HEADLESS=1 to interact with challenges.)');
    process.exit(1);
  }

  // Write sidecar (convenient for scripts that want to slurp it).
  fs.writeFileSync(OUT_TOKENS_FILE, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${OUT_TOKENS_FILE}`);

  // Print env-ready exports. The multibox patch below will pick these up.
  console.log('\n# Copy/paste or eval these for your next multibox run:');
  for (const [u, t] of Object.entries(results)) {
    const envName = `${u.toUpperCase()}_TOKEN`;
    console.log(`export ${envName}=${t}`);
  }
  console.log(`\n# Then e.g.:\n# node scripts/multibox.mjs scripts/multibox.duo.json\n`);

  if (anyFail) {
    console.log('Some accounts failed — you can re-run just for the missing ones:');
    console.log(`node scripts/browser_auth.mjs ${users.filter((u) => !results[u]).join(' ')}`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
