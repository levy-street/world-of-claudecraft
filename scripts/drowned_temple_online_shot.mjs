// ONLINE evidence for the Drowned Temple: registers a throwaway account on a
// running dev server (ALLOW_DEV_COMMANDS=1), enters the Temple, and captures a
// few spots (the first vista, the Choir Court, the Mere Hydra, the Moonbridge)
// as the online client draws them from the server's snapshots. Evidence
// tooling, not a repo test.
//
//   node scripts/drowned_temple_online_shot.mjs [outDir]
//
// Env: GAME_URL (http://127.0.0.1:5200), SHOT_PREFIX (default "templo_online_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:5200';
const OUT = process.argv[2] ?? path.join('tmp', 'drowned_temple_online');
const PREFIX = process.env.SHOT_PREFIX ?? 'templo_online_';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36).slice(-6);

async function loginAndEnter(page, username, charName, cls) {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#btn-online', { timeout: 60000 });
  await sleep(1500);
  await page.evaluate(() => document.querySelector('#btn-online')?.click());
  await page.waitForSelector('#login-user', { visible: true, timeout: 60000 });
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
  await page.waitForSelector('#realm-list .realm-row', { timeout: 20000 });
  await page.evaluate(() => {
    const row = document.querySelector('#realm-list .realm-row');
    (row instanceof HTMLElement ? row : null)?.click();
  });
  await page.waitForFunction(
    () =>
      !document.querySelector('#charcreate-panel')?.hasAttribute('hidden') ||
      !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 20000, polling: 200 },
  );
  const onCreate = await page.evaluate(
    () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
  );
  if (!onCreate) {
    await page.evaluate(() => document.querySelector('#btn-new-character')?.click());
    await page.waitForFunction(
      () => !document.querySelector('#charcreate-panel')?.hasAttribute('hidden'),
      { timeout: 10000, polling: 200 },
    );
  }
  await page.evaluate(
    (name, c) => {
      document.querySelector('#new-char-name').value = name;
      document.querySelector(`#charcreate-panel .mini-class[data-class="${c}"]`)?.click();
      document.querySelector('#btn-create-char').click();
    },
    charName,
    cls,
  );
  await page.waitForFunction(
    () => !document.querySelector('#charselect-panel')?.hasAttribute('hidden'),
    { timeout: 15000, polling: 200 },
  );
  await sleep(800);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('#char-list .char-row')];
    const row =
      rows.find((r) => r.querySelector('.char-name')?.textContent?.trim() === name) ?? rows[0];
    row?.querySelector('.enter-world-btn')?.click();
  }, charName);
  await page.waitForFunction(() => window.__game?.world?.entities?.size >= 1, {
    timeout: 90000,
    polling: 500,
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: ['--window-size=1600,900', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
    defaultViewport: { width: 1600, height: 900 },
    protocolTimeout: 240000,
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await loginAndEnter(page, `tmpl${uniq}`, `Moon${uniq.replace(/[0-9]/g, 'a')}`, 'warrior');
    await sleep(4000);
    const dismiss = () =>
      page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          const t = (b.textContent ?? '').trim().toLowerCase();
          if (t === 'understood' || t === 'x' || t === 'close') b.click();
        }
      });
    await dismiss();
    const chat = async (cmd, wait = 1500) => {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(wait);
    };
    for (const cmd of ['/dev level 20', '/dev god', '/dev noaggro', '/dev temple enter']) {
      await chat(cmd, 2500);
    }
    await sleep(8000);
    await chat('/dev temple gates');
    const spots = [
      // [name, tp area, camera pitch, camera distance]
      ['entrada', 'landing', 0.08, 10],
      ['patio', 'court', 0.3, 20],
      ['hidra', 'pool', 0.2, 16],
      ['puente', 'bridge', 0.2, 14],
    ];
    for (const [name, area, pitch, dist] of spots) {
      await chat(`/dev temple tp ${area}`, 3500);
      await page.evaluate(
        (p, d) => {
          const input = window.__game.input;
          input.camYaw = 0;
          input.camPitch = p;
          input.camDist = d;
        },
        pitch,
        dist,
      );
      await sleep(2500);
      await dismiss();
      const file = path.join(OUT, `${PREFIX}${name}.png`);
      await page.screenshot({ path: file });
      console.log('SHOT', file);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
