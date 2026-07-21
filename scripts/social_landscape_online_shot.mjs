// One-off local capture tool for PR #2099 (social window landscape relayout):
// captures the REAL populated Social window (Friends + Guild tabs) against a
// running online server instead of the offline placeholder, so the before/after
// screenshots actually demonstrate the two-column layout with real rows.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - a running server (ALLOW_DEV_COMMANDS is NOT required here: friend/guild
//     wiring uses the ordinary social wire commands, not dev cheats)
//   - a running vite dev client pointed at that server (WOC_DEV_API_TARGET)
//
// Usage: GAME_URL=http://localhost:5190 SHOTS_DIR=docs/screenshots/social-landscape-layout \
//        node scripts/social_landscape_online_shot.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { BROWSER_PATH } from './browser_path.mjs';
import { suppressGpuNotice } from './lib/gpu_notice_suppress.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5190';
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:8790';
const WS_BASE = SERVER_URL.replace(/^http/, 'ws');
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/social-landscape-layout';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-6);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);

async function api(path, body, token) {
  const res = await fetch(SERVER_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// A lightweight always-connected alt: registers, creates a character, joins the
// world over the raw wire, and stays connected so it shows up ONLINE in the
// friend/guild rows the two mains (desktop + mobile capture) both reference.
class AltBot {
  constructor(name, cls, idx) {
    this.name = name;
    this.cls = cls;
    this.idx = idx;
    this.events = [];
  }
  async join() {
    // Username stays short (server caps it at 24 chars); the character name (this.name)
    // is what actually shows in the Friends/Guild rows, so it carries the readable label.
    const username = `slay${this.idx}${uniq}`;
    const reg = await api('/api/register', {
      username,
      password: 'hunter22',
      email: `${username}@example.com`,
    });
    const char = await api('/api/characters', { name: this.name, class: this.cls }, reg.body.token);
    this.charId = char.body.id;
    await new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${WS_BASE}/ws`);
      const to = setTimeout(() => reject(new Error('timeout')), 20000);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ t: 'auth', token: reg.body.token, character: char.body.id }));
      });
      this.ws.on('message', (data) => {
        const msg = JSON.parse(String(data));
        if (msg.t === 'hello') {
          clearTimeout(to);
          resolve();
        } else if (msg.t === 'events') this.events.push(...msg.list);
      });
      this.ws.on('error', reject);
    });
  }
  cmd(p) {
    this.ws.send(JSON.stringify({ t: 'cmd', ...p }));
  }
  async acceptGuildInviteWhenSeen(timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.events.some((e) => e.type === 'guildInvite')) {
        this.cmd({ cmd: 'guild_accept' });
        return true;
      }
      await sleep(150);
    }
    return false;
  }
  close() {
    this.ws?.close();
  }
}

const ALT_SPECS = [
  ['Brannor', 'warrior'],
  ['Cindrel', 'mage'],
  ['Doriath', 'priest'],
  ['Elowen', 'rogue'],
  ['Fenwick', 'hunter'],
  ['Galandra', 'paladin'],
];
const alts = ALT_SPECS.map(([n, c], i) => new AltBot(`${n}${alpha}`, c, i));

console.log('joining alts...');
for (const a of alts) await a.join();

async function loginAndEnter(page, username, charName, cls, mobile = false) {
  // The first navigation against a still-warming vite dev server occasionally
  // aborts (a transient ERR_ABORTED, not a real failure); retry a couple of times.
  // Mirrors the proven scripts/mp_browser.mjs online-login recipe below (domcontentloaded
  // + a fixed settle sleep, then one evaluate-based click/fill/click), rather than
  // waiting on visibility signals that raced the game bundle's own DOM swaps here.
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(1000);
    }
  }
  if (lastErr) throw lastErr;
  if (mobile) await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.waitForSelector('#btn-online', { timeout: 30000 });
  await sleep(1000);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  // The desktop main's live world session (running alongside this page in the same
  // headless swiftshader browser) can starve a second page's rendering, so give this
  // a generous timeout rather than assuming a fixed page-load cost.
  await page.waitForSelector('#login-user', { visible: true, timeout: 45000 });
  // Current auth UI (src/main.ts setAuthMode): one #login-panel form that toggles
  // between login and register via #btn-auth-toggle, submitting through the single
  // #btn-login (its label/mode flip to "Create Account" in register mode). The older
  // dedicated #btn-register hook some other scripts assume no longer exists.
  // The auth panel can still be mid-render right after becoming visible (a locale-load
  // reflow can replace the form's DOM once more), so retry the fill+submit a few times
  // rather than fill once and race a possible rebuild.
  let filled = false;
  for (let attempt = 0; attempt < 6 && !filled; attempt++) {
    filled = await page.evaluate(
      (u, p, mail) => {
        const form = document.querySelector('#login-panel');
        const userEl = document.querySelector('#login-user');
        const passEl = document.querySelector('#login-pass');
        const toggle = document.querySelector('#btn-auth-toggle');
        const submit = document.querySelector('#btn-login');
        if (!form || !userEl || !passEl || !toggle || !submit) return false;
        if (form.dataset.authMode !== 'register') toggle.click();
        const emailEl = document.querySelector('#login-email');
        userEl.value = u;
        passEl.value = p;
        if (emailEl) emailEl.value = mail;
        submit.click();
        return true;
      },
      username,
      'hunter22',
      `${username}@example.com`,
    );
    if (!filled) await sleep(400);
  }
  if (!filled) throw new Error('login form never stabilized');
  // Multi-realm auth flow: a fresh login lands on #realm-panel first (pick a world),
  // even with only one realm configured. Wait for its row list to populate and pick
  // the first realm before the char select/create step ever becomes reachable.
  await page.waitForSelector('#realm-list .realm-row', { timeout: 15000 });
  await page.evaluate(() => {
    const row = document.querySelector('#realm-list .realm-row');
    (row instanceof HTMLElement ? row : null)?.click();
  });
  // A brand-new account has no characters yet, so main.ts drops straight into
  // #charcreate-panel (never #charselect-panel first); wait for either.
  await page.waitForFunction(
    () =>
      !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 15000, polling: 200 },
  );
  const onCreatePanel = await page.evaluate(
    () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
  );
  if (!onCreatePanel) {
    await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
    await page.waitForFunction(
      () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      { timeout: 10000, polling: 200 },
    );
  }
  await page.evaluate(
    (name, cls) => {
      document.querySelector('#new-char-name').value = name;
      document.querySelector(`#charcreate-panel .mini-class[data-class="${cls}"]`)?.click();
      document.querySelector('#btn-create-char').click();
    },
    charName,
    cls,
  );
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 10000, polling: 200 },
  );
  await sleep(700);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('#char-list .char-row')];
    const row =
      rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
    row?.querySelector('.enter-world-btn')?.click();
  }, charName);
  if (mobile) {
    // prepareWorldEntry (src/main.ts) gates world entry behind a "tap to continue"
    // mobile preflight prompt on a touch viewport, triggered ONLY once Enter World is
    // clicked (not earlier): dismiss it here, or beginWorldEntry() never runs and no
    // WS connection is ever opened (confirmed by an empty server access log otherwise).
    await page
      .waitForSelector('#mobile-preflight-continue', { visible: true, timeout: 8000 })
      .catch(() => {});
    await page.evaluate(() => document.querySelector('#mobile-preflight-continue')?.click());
  }
  // The post-login Welcome Screen (news/patch notes/Discord strip) gates startGame behind
  // a Continue click, same #ws-continue id enterOfflineGame (scripts/enter_offline_game.mjs)
  // dismisses offline; online shows it too and window.__game never appears until it clears.
  await sleep(1000);
  await page
    .waitForSelector('#ws-continue:not([disabled])', { visible: true, timeout: 20000 })
    .catch(() => {});
  await page.evaluate(() => {
    const btn = document.querySelector('#ws-continue');
    if (btn && !btn.disabled) btn.click();
  });
  await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
    timeout: 30000,
    polling: 500,
  });
}

// Wires the main account's Friends list and Guild membership: friend-adds every
// alt (one-directional, no accept needed) and founds+invites a guild that every
// alt accepts, so Friends/Guild tabs both show 6+ populated rows.
async function wireSocial(page, mainName) {
  await page.evaluate(
    (names) => {
      for (const n of names) window.__game.world.friendAdd(n);
    },
    alts.map((a) => a.name),
  );
  await sleep(400);
  await page.evaluate(
    (guildName) => window.__game.world.guildCreate(guildName),
    `Landscape${alpha}`,
  );
  await sleep(400);
  await page.evaluate(
    (names) => {
      for (const n of names) window.__game.world.guildInvite(n);
    },
    alts.map((a) => a.name),
  );
  await Promise.all(alts.map((a) => a.acceptGuildInviteWhenSeen()));
  await sleep(600);
  console.log(`social wired for ${mainName}`);
}

async function dismissCameraPrompt(page) {
  // The first-run "Choose Your Camera" prompt (main.ts maybeShowFirstRunCameraPrompt)
  // can appear a beat after world entry, so poll for it a few times rather than a
  // single early dismiss attempt; it otherwise overlaps the captured window.
  for (let i = 0; i < 6; i++) {
    const dismissed = await page
      .evaluate(() => {
        const btn = document.querySelector('.camera-prompt-confirm');
        if (btn instanceof HTMLElement) {
          btn.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (dismissed) return;
    await sleep(300);
  }
}

async function openSocialFriendsTab(page) {
  await dismissCameraPrompt(page);
  await page.evaluate(() => window.__game.hud.toggleSocial());
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#social-window');
      if (!el || getComputedStyle(el).display === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    },
    { timeout: 10000, polling: 200 },
  );
  await sleep(300);
  await page.evaluate(() => {
    document
      .querySelector('#social-window [data-tab="friends"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(500);
}

async function shootClipped(page, file) {
  const region = await page.evaluate(() => {
    const el = document.querySelector('#social-window');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!region || region.width <= 0 || region.height <= 0) {
    await page.screenshot({ path: file });
    return;
  }
  const m = 12;
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, region.x - m),
      y: Math.max(0, region.y - m),
      width: region.width + m * 2,
      height: region.height + m * 2,
    },
  });
}

// Desktop and mobile each get their OWN browser process, launched and closed in turn
// (not two pages sharing one browser): a live in-world session's per-frame sim/render
// work in headless swiftshader was observed to starve a second page badly enough that
// its login form never became interactive even with a very generous timeout. Splitting
// the browsers keeps each capture's page as the only thing that process renders.
async function launchBrowser() {
  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    protocolTimeout: 60000,
    userDataDir: `/tmp/claude-1000/social-shot-profile-${uniq}-${Date.now()}`,
    args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1600, height: 900 },
  });
}

try {
  // Desktop main: friends every alt, founds the guild, invites every alt in. The
  // alts stay connected (own WS bots, own process-independent sockets) so the
  // mobile capture below still sees them online for its own Friends tab.
  const desktopBrowser = await launchBrowser();
  const desktop = await desktopBrowser.newPage();
  await suppressGpuNotice(desktop);
  const desktopName = `Aldwin${alpha}`;
  await loginAndEnter(desktop, `soclaymain_${uniq}`, desktopName, 'mage');
  await wireSocial(desktop, desktopName);
  await openSocialFriendsTab(desktop);
  await dismissCameraPrompt(desktop);
  await shootClipped(desktop, `${OUT}/after-desktop.png`);
  await desktopBrowser.close();

  // Mobile main: separate account/character/browser, friends the same alts (still
  // online), so its Friends tab shows the same populated rows on a phone viewport.
  const mobileBrowser = await launchBrowser();
  const mobile = await mobileBrowser.newPage();
  await suppressGpuNotice(mobile);
  await mobile.emulate({
    // Landscape, not portrait: the game is landscape-locked on mobile (a portrait
    // viewport only shows the "Rotate to Landscape" gate), matching the mobile
    // viewport every other capture script in this repo uses (e.g. pr_shot_targets.mjs).
    viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const mobileName = `Aldwyn${alpha}`;
  await loginAndEnter(mobile, `soclaymobile_${uniq}`, mobileName, 'mage', true);
  // Dismiss the new-adventurer tutorial overlay (the same one enterOfflineGame skips
  // for the offline flow) so it never bleeds into the captured frame, and give the
  // fresh world connection a moment to settle before firing the friendAdd batch.
  await sleep(1000);
  await mobile.evaluate(() => document.querySelector('button.tut-skip')?.click()).catch(() => {});
  await sleep(500);
  for (const a of alts) {
    await mobile.evaluate((name) => window.__game.world.friendAdd(name), a.name);
    await sleep(150);
  }
  await sleep(800);
  await openSocialFriendsTab(mobile);
  await dismissCameraPrompt(mobile);
  await shootClipped(mobile, `${OUT}/after-mobile.png`);
  await mobileBrowser.close();

  console.log('captured after-desktop.png and after-mobile.png with real populated social data.');
} finally {
  for (const a of alts) a.close();
}
