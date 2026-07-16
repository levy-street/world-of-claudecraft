// Season 1 Armory visual pass: drives the real client through browse, inspect
// (try-on day/night + weapon turntable), buy, and apply, then screenshots the
// skinned weapon with its VFX in the live world from BOTH clients (the wearer
// and a bystander). Needs `npm run dev` + `npm run server` (+ the economy
// service with the Season 1 catalog on :8798) and the dev Postgres.
// Screenshots land in tmp/ (gitignored).
import { mkdirSync } from 'node:fs';
import process from 'node:process';
import pg from 'pg';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

process.loadEnvFile?.();
const URL = process.env.GAME_URL ?? 'http://localhost:5173/';
const UNIQ = Date.now()
  .toString(36)
  .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)])
  .slice(-5);
const PASS = 'hunter22';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
mkdirSync('tmp', { recursive: true });

async function dumpState(page, label) {
  const state = await page
    .evaluate(() => ({
      panels: [
        '#mode-select',
        '#login-panel',
        '#realm-panel',
        '#charselect-panel',
        '#charcreate-panel',
      ].filter((id) => {
        const el = document.querySelector(id);
        return el && !el.hasAttribute('hidden');
      }),
      err: document.querySelector('#login-error')?.textContent ?? '',
      csErr: document.querySelector('#charselect-error')?.textContent ?? '',
      rows: document.querySelectorAll('#char-list li').length,
      realms: document.querySelectorAll('#realm-list .realm-row').length,
    }))
    .catch(() => null);
  console.error(`STATE[${label}]`, JSON.stringify(state));
  await page.screenshot({ path: `tmp/armory_debug_${label}.png` }).catch(() => {});
}

async function tidyHud(page) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent?.trim() === 'Skip Tutorial') b.click();
    }
    document.querySelector('#discord-cta-close')?.click();
  });
}

async function zoomWorld(page, steps) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      canvas?.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }),
      );
    });
    await sleep(90);
  }
}

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 90000,
  args: [
    '--no-sandbox',
    '--window-size=1440,860',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  defaultViewport: { width: 1440, height: 860 },
});

async function enter(page, user, charName, cls) {
  try {
    page.on('pageerror', (e) => fails.push(`[${charName}] ${e.message}`));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#btn-online', { timeout: 30000 });
    await sleep(600);
    await page.evaluate(() => document.querySelector('#btn-online')?.click());
    await page.waitForSelector('#login-user', { timeout: 15000 });
    // Switch the shared auth form into register mode (reveals the email field).
    await page.evaluate(() => document.querySelector('#btn-auth-toggle')?.click());
    await sleep(300);
    await page.evaluate(
      (u, p) => {
        const set = (sel, v) => {
          const el = document.querySelector(sel);
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('#login-user', u);
        set('#login-pass', p);
        set('#login-email', `${u}@example.com`);
        document.querySelector('#btn-login').click();
      },
      user,
      PASS,
    );
    // Panels toggle via the hidden attribute in v0.24. Registration lands on the
    // realm picker first; click the one dev realm through to character select.
    await page.waitForFunction(
      () => document.querySelectorAll('#realm-list .realm-row').length > 0,
      { timeout: 15000, polling: 200 },
    );
    await sleep(300);
    await page.evaluate(() => {
      const row = document.querySelector('#realm-list .realm-row');
      (row?.querySelector('button') ?? row)?.click();
    });
    // A fresh account lands straight on Create Character; an account with a
    // roster lands on character select. Handle either.
    await page.waitForFunction(
      () =>
        !document.querySelector('#charselect-panel')?.hasAttribute('hidden') ||
        !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      { timeout: 15000, polling: 200 },
    );
    await sleep(600);
    const onCreate = await page.evaluate(
      () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
    );
    if (!onCreate) {
      await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
      await page.waitForFunction(
        () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
        { timeout: 8000, polling: 200 },
      );
    }
    await page.evaluate((klass) => {
      document.querySelector(`#charcreate-panel .mini-class[data-class="${klass}"]`)?.click();
    }, cls);
    await page.click('#new-char-name');
    await page.type('#new-char-name', charName, { delay: 25 });
    await sleep(250);
    await page.evaluate(() => document.querySelector('#btn-create-char')?.click());
    // Two clients + swiftshader on one CPU make the post-create transition slow;
    // accept either the roster screen or a direct world boot.
    await page.waitForFunction(
      () =>
        window.__game?.world ||
        (!document.querySelector('#charselect-panel')?.hasAttribute('hidden') &&
          document.querySelectorAll('#char-list li').length > 0),
      { timeout: 45000, polling: 400 },
    );
    const inWorld = await page.evaluate(() => !!window.__game?.world);
    if (!inWorld) {
      await sleep(700);
      await page.evaluate(() => {
        document.querySelector('#char-list li')?.click();
      });
      await sleep(400);
      await page.evaluate(() => document.querySelector('#btn-charselect-enter')?.click());
    }
    await page.waitForFunction(() => window.__game?.world?.entities?.size > 5, {
      timeout: 70000,
      polling: 500,
    });
    // A fresh character plays the first-spawn cinematic, which hides the whole
    // #ui layer until the camera lands: skip it (Escape) and wait for the HUD.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('ui')?.style.display !== 'none', {
      timeout: 25000,
      polling: 300,
    });
    await sleep(1200);
  } catch (err) {
    await dumpState(page, charName);
    throw err;
  }
}

const pageA = await browser.newPage();
await enter(pageA, `arm_${UNIQ}`, `Solbearer${UNIQ}`, 'warrior');

// Credit Claudium straight into the dev ledger (no free-grant API by design).
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const acc = await db.query('SELECT id FROM accounts WHERE username = $1', [`arm_${UNIQ}`]);
await db.query(
  `INSERT INTO claudium_ledger (account_id, delta, reason, ref, idempotency_key, at_ms)
   VALUES ($1, 20000, 'purchase', 'visual-e2e', $2, $3)`,
  [acc.rows[0].id, `visual-${UNIQ}`, Date.now()],
);
await db.end();

// Browse: open the store, wait for the armory sections + thumbnails.
// Open the store via the hud API (the chest button binds pointerdown, not
// click) and shoot IMMEDIATELY once the cards are painted: the tutorial system
// re-closes windows on its own schedule, so any settle delay loses the race.
await pageA.evaluate(() => window.__game.hud.toggleDailyRewards());
await pageA.waitForSelector('.armory-section .armory-card img', { timeout: 12000 });
await sleep(350);
await pageA.evaluate(() => {
  const win = document.querySelector('#daily-rewards-window');
  if (win && win.style.display !== 'block') window.__game.hud.toggleDailyRewards();
});
await pageA.screenshot({ path: 'tmp/armory_store.png' });
await tidyHud(pageA);
await sleep(600);

// Inspect the legendary hero sword: try-on (day), night, then weapon-only.
await pageA.evaluate(() => document.querySelector('[data-armory-skin="solheim_sword"]')?.click());
await pageA.waitForSelector('.armory-inspect canvas', { timeout: 12000 });
await sleep(2600);
await pageA.screenshot({ path: 'tmp/armory_inspect_day.png' });
await pageA.evaluate(() => document.querySelector('[data-armory-scene="night"]')?.click());
await sleep(1400);
await pageA.screenshot({ path: 'tmp/armory_inspect_night.png' });
await pageA.evaluate(() => document.querySelector('[data-armory-mode="weapon"]')?.click());
await sleep(2200);
await pageA.screenshot({ path: 'tmp/armory_inspect_weapon.png' });

// Buy through the panel (confirm dialog), then apply.
await pageA.evaluate(() => document.querySelector('[data-armory-buy]')?.click());
await pageA.waitForSelector('#confirm-dialog [data-ok]', { timeout: 8000 });
await sleep(400);
await pageA.screenshot({ path: 'tmp/armory_confirm_over_inspect.png' });
await pageA.evaluate(() => document.querySelector('#confirm-dialog [data-ok]')?.click());
await pageA.waitForSelector('[data-armory-apply]', { timeout: 12000 });
await sleep(400);
await pageA.screenshot({ path: 'tmp/armory_inspect_owned.png' });
await pageA.evaluate(() => document.querySelector('[data-armory-apply]')?.click());
await pageA.waitForSelector('[data-armory-detach]', { timeout: 12000 });
await pageA.screenshot({ path: 'tmp/armory_inspect_applied.png' });

// Close the panel + store; give the wire a beat; the wearer's own view.
await pageA.evaluate(() => {
  document.querySelector('.armory-inspect-close')?.click();
  document.querySelector('#daily-rewards-window [data-close]')?.click();
});
await sleep(1800);
await tidyHud(pageA);
await zoomWorld(pageA, 4);
await sleep(900);
const selfSkin = await pageA.evaluate(() => window.__game.world.player?.weaponSkinId ?? null);
if (selfSkin !== 'solheim_sword') fails.push(`self weaponSkinId ${selfSkin}`);
await pageA.screenshot({ path: 'tmp/armory_world_self.png' });

// Bystander: a second client at the same spawn must SEE the skin + VFX.
// Isolated context: sharing the default context would resume account A's
// localStorage session and hijack its character instead of registering B.
const ctxB = await browser.createBrowserContext();
const pageB = await ctxB.newPage();
await enter(pageB, `armb_${UNIQ}`, `Witness${UNIQ}`, 'mage');
const remoteSkin = await pageB.evaluate(async (wearerName) => {
  const until = async (fn, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 200));
    }
    return fn();
  };
  return until(() => {
    for (const e of window.__game.world.entities.values()) {
      if (e.name === wearerName) return e.weaponSkinId;
    }
    return null;
  }, 10000);
}, `Solbearer${UNIQ}`);
if (remoteSkin !== 'solheim_sword') fails.push(`remote weaponSkinId ${remoteSkin}`);
await tidyHud(pageB);
await zoomWorld(pageB, 5);
await sleep(1200);
await pageB.screenshot({ path: 'tmp/armory_world_bystander.png' });

await browser.close();
if (fails.length) {
  console.error(`VISUAL E2E FAILURES (${fails.length}):`);
  for (const f of fails) console.error(`  ${f}`);
  process.exit(1);
}
console.log('visual e2e ok: 7 screenshots in tmp/ (store, inspect x4, world x2)');
