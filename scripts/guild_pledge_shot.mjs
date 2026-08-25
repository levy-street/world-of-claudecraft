// One-off local capture tool for the guild pledge board PR screenshots
// (docs/prd/guild-pledge-board.md): seeds three guilds with distinct recruiting
// postures plus a standing pledge, then shoots the REAL surfaces against a REAL
// server: the guilds high-score tab (desktop + mobile), the unguilded viewer's
// live pledge flow (button -> Pledged chip -> my-pledge line), and the Guild
// Master's Pledges tab with the settings editor (desktop + mobile).
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - the dev Postgres up on DATABASE_URL
//   - a server from THIS branch:   PORT=8791 npm run server
//   - a vite client proxying to it: WOC_DEV_API_TARGET=http://127.0.0.1:8791 npx vite --port 5195
//
// Usage:
//   GAME_URL=http://localhost:5195 SERVER_URL=http://127.0.0.1:8791 \
//     node scripts/guild_pledge_shot.mjs
import fs from 'node:fs';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackDatabaseUrl, assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5195';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
const REALM = process.env.REALM_NAME ?? 'Claudemoon';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/guild-pledge-board';

assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackUrl(GAME_URL, 'GAME_URL');
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional; the guard below still sees a directly-passed value.
}
assertLoopbackDatabaseUrl(process.env.DATABASE_URL);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-5);
const alpha = uniq.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]);
const PASS = 'hunter22';

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

// Register an account + character via the real REST surface; returns char id.
async function mintCharacter(user, charName, cls) {
  const reg = await api('/api/register', {
    username: user,
    password: PASS,
    email: `${user}@example.com`,
  });
  if (!reg.body.token) throw new Error(`register ${user} failed: ${JSON.stringify(reg.body)}`);
  const char = await api('/api/characters', { name: charName, class: cls }, reg.body.token);
  if (!char.body.id) throw new Error(`char ${charName} failed: ${JSON.stringify(char.body)}`);
  return char.body.id;
}

// ---------------------------------------------------------------------------
// Seed: three guilds whose recruiting postures span the board's states, with
// member lifetime XP placing them on three different colour tiers, plus one
// standing pledge for the officer dashboard.
// ---------------------------------------------------------------------------
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// A previous run's seed (unique-suffixed copies of the same three guilds)
// would double every row on the board; drop them before seeding fresh.
await pool.query(
  `DELETE FROM guilds WHERE realm = $1 AND (name LIKE 'Iron Vanguard %' OR name LIKE 'Valley Wolves %' OR name LIKE 'Ashen Circle %')`,
  [REALM],
);

async function mintGuild(name, { enabled, minLevel, note }) {
  const r = await pool.query(
    `INSERT INTO guilds (name, realm, pledges_enabled, pledge_min_level, pledge_note)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, REALM, enabled, minLevel, note],
  );
  return r.rows[0].id;
}

async function seatMember(charId, guildId, rank, lifetimeXp, level) {
  await pool.query(
    `INSERT INTO guild_members (character_id, guild_id, rank) VALUES ($1, $2, $3)
     ON CONFLICT (character_id) DO UPDATE SET guild_id = EXCLUDED.guild_id, rank = EXCLUDED.rank`,
    [charId, guildId, rank],
  );
  await pool.query(
    `UPDATE characters SET level = $3,
       state = jsonb_set(jsonb_set(state, '{lifetimeXp}', $2::jsonb), '{level}', $4::jsonb)
     WHERE id = $1`,
    [charId, String(lifetimeXp), level, String(level)],
  );
}

const ivName = `Iron Vanguard ${alpha.slice(0, 2)}`;
const wolvesName = `Valley Wolves ${alpha.slice(0, 2)}`;
const ashenName = `Ashen Circle ${alpha.slice(0, 2)}`;
const iv = await mintGuild(ivName, {
  enabled: true,
  minLevel: 20,
  note: 'Serious raiding guild. Weeknights, bring consumables.',
});
const wolves = await mintGuild(wolvesName, {
  enabled: true,
  minLevel: 1,
  note: 'Chill levelling guild, everyone welcome.',
});
const ashen = await mintGuild(ashenName, {
  enabled: false,
  minLevel: 1,
  note: 'Roster full, not recruiting this season.',
});

// Members whose summed lifetime XP lands each guild on a distinct colour tier:
// Iron Vanguard 12M (tier 3 amber), Valley Wolves 400k (tier 1 green),
// Ashen Circle 50k (tier 0 classic blue).
const gmUser = `plgm${uniq}`;
const gmChar = `Aldwyn${alpha}`.slice(0, 12);
const gmId = await mintCharacter(gmUser, gmChar, 'warrior');
await seatMember(gmId, iv, 'leader', 6_000_000, 60);
await seatMember(
  await mintCharacter(`plm1${uniq}`, `Serah${alpha}`.slice(0, 12), 'mage'),
  iv,
  'member',
  6_000_000,
  58,
);
await seatMember(
  await mintCharacter(`plm2${uniq}`, `Torvin${alpha}`.slice(0, 12), 'paladin'),
  wolves,
  'leader',
  200_000,
  31,
);
await seatMember(
  await mintCharacter(`plm3${uniq}`, `Nissa${alpha}`.slice(0, 12), 'druid'),
  wolves,
  'member',
  200_000,
  27,
);
await seatMember(
  await mintCharacter(`plm4${uniq}`, `Corvo${alpha}`.slice(0, 12), 'rogue'),
  ashen,
  'leader',
  50_000,
  22,
);

// A standing pledge to Iron Vanguard, for the Guild Master's dashboard: a
// level-24 priest who cleared the guild's level floor.
const pledgerUser = `plpl${uniq}`;
const pledgerChar = `Mirelle${alpha}`.slice(0, 12);
const pledgerId = await mintCharacter(pledgerUser, pledgerChar, 'priest');
await pool.query(
  `UPDATE characters SET level = 24, state = jsonb_set(state, '{level}', '24'::jsonb) WHERE id = $1`,
  [pledgerId],
);
await pool.query(
  `INSERT INTO guild_pledges (character_id, guild_id) VALUES ($1, $2)
   ON CONFLICT (character_id) DO UPDATE SET guild_id = EXCLUDED.guild_id`,
  [pledgerId, iv],
);

// The unguilded viewer who will pledge LIVE during the capture.
const aspirantUser = `plas${uniq}`;
const aspirantChar = `Bryn${alpha}`.slice(0, 12);
await mintCharacter(aspirantUser, aspirantChar, 'paladin');
await pool.end();
console.log(`seeded: ${ivName} (#${iv}), ${wolvesName} (#${wolves}), ${ashenName} (#${ashen})`);

// ---------------------------------------------------------------------------
// Capture.
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 240000,
  args: [
    '--no-sandbox',
    '--window-size=1440,900',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1440, height: 900 },
});

async function enter(page, user, charName) {
  page.on('pageerror', (e) => console.log(`[pageerror ${charName}]`, String(e).slice(0, 200)));
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) console.log(`[nav ${charName}]`, f.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console ${charName}]`, m.text().slice(0, 160));
  });
  // ?lowgfx forces the cheap graphics tier: the windows under capture are DOM
  // and identical across tiers, and the software rasterizer stays responsive
  // even on a loaded machine.
  await page.goto(`${GAME_URL}/?lowgfx`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(700);
  await page.evaluate(
    (u, p) => {
      document.querySelector('#btn-online').click();
      document.querySelector('#login-user').value = u;
      document.querySelector('#login-pass').value = p;
      document.querySelector('#btn-login').click();
    },
    user,
    PASS,
  );
  // Post-login the shell shows either the realm list (fresh account, no
  // remembered realm) or character select directly. Panels toggle via the
  // `hidden` attribute (the market_mp_e2e style.display wait is stale).
  const visible = (id) => {
    const el = document.querySelector(id);
    return el !== null && !el.hasAttribute('hidden');
  };
  await page.waitForFunction(
    `(${visible.toString()})('#charselect-panel') || ((${visible.toString()})('#realm-panel') && !!document.querySelector('.realm-row'))`,
    { timeout: 15000, polling: 200 },
  );
  await page.evaluate(() => {
    const rp = document.querySelector('#realm-panel');
    if (rp && !rp.hasAttribute('hidden')) document.querySelector('.realm-row')?.click();
  });
  await page.waitForFunction(`(${visible.toString()})('#charselect-panel')`, {
    timeout: 15000,
    polling: 200,
  });
  await sleep(600);
  await page.evaluate((name) => {
    [...document.querySelectorAll('.char-row')]
      .find((r) => r.querySelector('.char-name')?.textContent === name)
      ?.querySelector('.enter-world-btn')
      ?.click();
  }, charName);
  // Phone-class viewports get the "Play in Landscape Fullscreen" preflight
  // between character select and the world; continue through it when it shows.
  await sleep(1200);
  await page.evaluate(() => {
    const btn = document.getElementById('mobile-preflight-continue');
    if (btn && btn.offsetParent !== null) btn.click();
  });
  await page.waitForFunction(() => window.__game?.world?.entities?.size > 1, {
    timeout: 90000,
    polling: 500,
  });
  await sleep(2500);
  // New characters land on the Proving Shore with the greeting dialog up;
  // click its own confirm so the close path runs (a blind Escape would open
  // the game menu instead whenever the greeting is not up).
  await page.evaluate(() => {
    document.getElementById('tutorial-greeting')?.querySelector('button')?.click();
  });
  await sleep(800);
  // The world must still be live (a crash-guard reload would strand the run on
  // the home screen with __game gone).
  await page.waitForFunction(() => !!window.__game?.hud, { timeout: 10000, polling: 300 });
}

// Deliberate logout before closing a session's page: a raw close leaves the
// character linkdead for the 5-minute grace, and the NEXT session's re-login of
// the same character then stalls on the takeover flow instead of entering.
async function leave(page) {
  await page.evaluate(() => {
    const online = window.__game?.online;
    online?.sendLogout?.();
  });
  await sleep(600);
  await page.close();
}

// Strip the capture-noise chrome a fresh character accrues: the Proving Shore
// greeting (its Escape-dismiss can lose a race with a re-open), the Discord
// link banner, and the headless-SwiftShader GPU notice.
async function cleanHud(page) {
  await page.evaluate(() => {
    document.getElementById('tutorial-greeting')?.remove();
    document.getElementById('discord-cta-banner')?.setAttribute('hidden', '');
    document.getElementById('perf-nudge')?.remove();
    document.getElementById('gpu-notice')?.remove();
  });
}

async function shot(page, file) {
  await cleanHud(page);
  await sleep(500);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`${OUT}/${file}`);
}

// SESSIONS=asp|gm filters the capture to one half (a rerun convenience: the
// four sessions are independent, and a machine-load hiccup in one should not
// force replaying the others).
const SESSIONS = process.env.SESSIONS ?? 'all';
const wantAsp = SESSIONS === 'all' || SESSIONS === 'asp';
const wantGm = SESSIONS === 'all' || SESSIONS === 'gm';

// --- Session 1 (desktop): the unguilded aspirant's board + live pledge ----
if (wantAsp) {
  const page = await browser.newPage();
  await enter(page, aspirantUser, aspirantChar);
  await page.evaluate(() => window.__game.hud.toggleLeaderboard());
  await page.waitForSelector('[data-leaderboard-tab="guilds"]', { timeout: 10000 });
  await page.click('[data-leaderboard-tab="guilds"]');
  await page.waitForSelector('.lb-guild-entry', { timeout: 15000 });
  await shot(page, 'board-guilds-tab-desktop.png');

  // The live pledge: click the Valley Wolves row's button, the cell flips to
  // its Pledged chip on the repaint.
  await page.evaluate((guild) => {
    document.querySelector(`[data-guild-pledge="${guild}"]`)?.click();
  }, wolvesName);
  await page.waitForFunction(
    () => [...document.querySelectorAll('.lb-pledge-chip.on')].length > 0,
    { timeout: 15000, polling: 300 },
  );
  await shot(page, 'board-guilds-tab-pledged-desktop.png');

  // The standing-pledge line on the social window's guild tab (the social
  // frame carrying myPledge lands on the pledge push).
  await page.evaluate(() => {
    window.__game.hud.toggleLeaderboard();
    window.__game.hud.toggleSocial();
  });
  await page.waitForSelector('[data-tab="guild"]', { timeout: 10000 });
  await page.click('[data-tab="guild"]');
  await page.waitForSelector('.soc-my-pledge', { timeout: 15000 });
  await shot(page, 'social-my-pledge-desktop.png');
  await leave(page);
}

// --- Session 2 (mobile): the same board under the touch layout -------------
// A separate page whose mobile viewport is set BEFORE navigation: flipping
// isMobile/hasTouch on a live page makes Puppeteer reload it, which dumps the
// session back on the home screen mid-capture.
if (wantAsp) {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await enter(page, aspirantUser, aspirantChar);
  await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.evaluate(() => window.__game.hud.toggleLeaderboard());
  await page.waitForSelector('[data-leaderboard-tab="guilds"]', { timeout: 10000 });
  await page.evaluate(() => {
    document
      .querySelector('[data-leaderboard-tab="guilds"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  try {
    await page.waitForSelector('.lb-guild-entry', { timeout: 15000 });
  } catch (err) {
    console.log(
      'mobile board state:',
      await page.evaluate(() => ({
        window: document.querySelector('#leaderboard-window')?.style.display,
        body: document.querySelector('.lb-body')?.textContent?.slice(0, 120),
        tabs: [...document.querySelectorAll('[data-leaderboard-tab]')].map((t) => t.className),
      })),
    );
    await page.screenshot({ path: `${OUT}/_debug-mobile-board.png` });
    throw err;
  }
  await shot(page, 'board-guilds-tab-mobile.png');
  await leave(page);
}

// --- Session 3 (desktop): the Guild Master's dashboard ---------------------
if (wantGm) {
  const page = await browser.newPage();
  await enter(page, gmUser, gmChar);
  await page.evaluate(() => window.__game.hud.toggleSocial());
  await page.waitForSelector('[data-tab="pledges"]', { timeout: 15000 });
  await page.click('[data-tab="pledges"]');
  await page.waitForSelector('.soc-pledge-settings', { timeout: 10000 });
  await shot(page, 'social-pledges-tab-desktop.png');
  await leave(page);
}

// --- Session 4 (mobile): the dashboard under the touch layout --------------
if (wantGm) {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await enter(page, gmUser, gmChar);
  await page.evaluate(() => document.body.classList.add('mobile-touch'));
  await page.evaluate(() => window.__game.hud.toggleSocial());
  await page.waitForSelector('[data-tab="pledges"]', { timeout: 15000 });
  await page.evaluate(() => {
    document
      .querySelector('[data-tab="pledges"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForSelector('.soc-pledge-settings', { timeout: 10000 });
  await shot(page, 'social-pledges-tab-mobile.png');
  await leave(page);
}

await browser.close();
process.exit(0);
