// ONLINE evidence for the Sunken Bastion floor fix: registers a throwaway
// account on a running dev server (ALLOW_DEV_COMMANDS=1), enters the Bastion,
// stands in the moat ring and on the Sea Gate ramp cut, walks across them
// with the movement keys (the client's own prediction), logs the player's
// height as the client shows it, and captures each spot. Evidence tooling,
// not a repo test.
//
//   node scripts/sunken_bastion_online_floor_shot.mjs [outDir]
//
// Env: GAME_URL (http://127.0.0.1:5199), SHOT_PREFIX (default "online_").
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:5199';
const OUT = process.argv[2] ?? path.join('tmp', 'sunken_bastion_online');
const PREFIX = process.env.SHOT_PREFIX ?? 'online_';
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
    await loginAndEnter(page, `bast${uniq}`, `Tide${uniq.replace(/[0-9]/g, 'a')}`, 'warrior');
    await sleep(4000);
    // Clear the first-login greetings (the tutorial note, the store promo).
    const dismiss = () =>
      page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          const t = (b.textContent ?? '').trim().toLowerCase();
          if (t === 'understood' || t === '×' || t === 'x' || t === 'close') b.click();
        }
      });
    await dismiss();
    const chat = async (cmd, wait = 1500) => {
      await page.evaluate((c) => window.__game.world.chat(c), cmd);
      await sleep(wait);
    };
    for (const cmd of ['/dev level 20', '/dev god', '/dev noaggro', '/dev bastion enter']) {
      await chat(cmd, 2500);
    }
    await sleep(8000);
    await chat('/dev bastion gates');
    await chat('/dev bastion tp landing', 3000);
    const origin = await page.evaluate(() => {
      const p = window.__game.world.player;
      return { x: p.pos.x + 10, z: p.pos.z + 230 };
    });
    // A first short press wakes the movement wire (the first walk after
    // entering the world otherwise goes nowhere in a headless session).
    await page.keyboard.down('KeyW');
    await sleep(700);
    await page.keyboard.up('KeyW');
    await sleep(800);
    const spots = [
      // [name, instance-local start, facing (sim radians), walk ms]
      ['rampa', [0, -150], 0, 3200],
      ['foso', [-10, -124], 0, 3800],
    ];
    for (const [name, [lx, lz], facing, walk] of spots) {
      await chat(`/dev tp ${origin.x + lx} ${origin.z + lz}`, 2500);
      await page.evaluate((f) => {
        const input = window.__game.input;
        input.camYaw = -1.7;
        input.camPitch = 0.3;
        input.camDist = 11;
        window.__game.world.player.facing = f;
      }, facing);
      await sleep(2000);
      // Walk with the real movement key, sampling the shown height as we go.
      await page.keyboard.down('KeyW');
      const samples = [];
      const t0 = Date.now();
      while (Date.now() - t0 < walk) {
        samples.push(
          await page.evaluate(() => {
            const p = window.__game.world.player;
            return [+p.pos.x.toFixed(2), +p.pos.y.toFixed(3), +p.pos.z.toFixed(2)];
          }),
        );
        await sleep(250);
      }
      await page.keyboard.up('KeyW');
      console.log(
        'STATE',
        name,
        await page.evaluate(() => {
          const p = window.__game.world.player;
          return JSON.stringify({
            active: document.activeElement?.tagName + '#' + (document.activeElement?.id ?? ''),
            auras: (p.auras ?? []).map((a) => a.id),
            dead: p.dead,
            casting: p.castingAbility,
          });
        }),
      );
      await sleep(600);
      await dismiss();
      await sleep(300);
      console.log(
        'SAMPLES',
        name,
        JSON.stringify(
          samples.map(([x, y, z]) => [+(x - origin.x).toFixed(1), y, +(z - origin.z).toFixed(1)]),
        ),
      );
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
